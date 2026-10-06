// The LaunchRoom Agent: one Durable Object per room (implementation guide 3.1 D1, 7.3).
// A thin I/O shell around the deterministic Room runtime. Every role-sensitive message goes through the policy filter.
import { Agent, type Connection, type ConnectionContext, type WSMessage } from "agents";
import { ClientMsg, LIMITS, MAX_MESSAGE_BYTES, cleanText, type PublicRoomState, type ServerMsg } from "../../shared/protocol";
import { TIMESCALES, type ScenarioSetting } from "../../shared/phases";
import { STATIONS } from "../../shared/roles";
import { checkAuthority } from "../policy/authority";
import { verifyToken } from "../auth";
import { factToRow, Ledger, rowToFact } from "../ledger/ledger";
import { SCHEMA, type FactRow } from "../ledger/schema";
import { factsForPrompt, hiddenCount, leaks, type Principal } from "../policy/policy";
import { createProvider } from "../llm/provider";
import { ANSWER_MAX_TOKENS, NARRATIVE_MAX_TOKENS, filterCitations, narrativeSystem, narrativeUser, questionSystem, questionUser } from "../llm/prompts";
import { SessionLimiter } from "../llm/budget";
import { Room, type LoggedAction, type RoomConfig } from "./runtime";
import { buildSnapshot, buildTick, eventFor, publicState, templateAnswer } from "./egress";
import { staleSeats } from "./heartbeat";
import { principalView } from "../policy/policy";

type ConnInfo = { sid: string; nick: string };

const MAX_CONNECTIONS = 25;
const MAX_SPECTATORS = 20;
const LOBBY_EXPIRY_S = 30 * 60;
const ENDED_EXPIRY_S = 2 * 60 * 60;
const ACTIONS_PER_WINDOW = 30;
const ACTION_WINDOW_MS = 10_000;
const MAX_CATCHUP_TICKS = 5;
/** A paused mission resumes on its own after this long, so an abandoned tab cannot hold a room slot frozen. */
const MAX_PAUSE_S = 15 * 60;

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...data }));
}

export class LaunchRoom extends Agent<Env, PublicRoomState> {
  override initialState: PublicRoomState = { code: "", phase: "LOBBY", seats: {}, spectators: 0, scenario: "S0", timescale: 4, creatorNick: "", paused: false };

  private room: Room | null = null;
  private startedAt: number | null = null;
  /** Wall-clock time the sim director paused at; ticks are anchored to startedAt, which shifts forward on resume. */
  private pausedAt: number | null = null;
  private lastSeen = new Map<string, number>();
  private limiter = new SessionLimiter();
  private actionCounts = new Map<string, { start: number; n: number }>();
  private llmCalls = 0;
  private aarCache = new Map<string, { narrative: string; factIds: string[]; source: "llm" | "template" }>();
  private questionSeq = 0;

  // ---------- Lifecycle ----------

  override async onStart() {
    for (const stmt of SCHEMA) this.ctx.storage.sql.exec(stmt);
    const rows = this.sql<{ k: string; v: string }>`SELECT k, v FROM room_config`;
    const cfg = new Map(rows.map((r) => [r.k, r.v]));
    if (!cfg.has("config")) return;
    const config = JSON.parse(cfg.get("config")!) as RoomConfig;
    this.startedAt = cfg.has("startedAt") ? Number(cfg.get("startedAt")) : null;
    this.pausedAt = cfg.has("pausedAt") ? Number(cfg.get("pausedAt")) : null;
    this.llmCalls = Number(cfg.get("llmCalls") ?? 0);
    this.rebuild(config);
    if (this.room?.running && this.pausedAt === null) await this.ensureTicking();
  }

  /** Rebuilds the room from config, action log, and ledger (spec 18 resilience). */
  private rebuild(config: RoomConfig) {
    const ledger = new Ledger();
    const facts = this.sql<FactRow>`SELECT * FROM facts ORDER BY seq`.map(rowToFact);
    ledger.restore(facts);
    const room = new Room(config, ledger);
    const actions = this.sql<{ action: string }>`SELECT action FROM action_log ORDER BY seq`.map((r) => JSON.parse(r.action) as LoggedAction);
    const target = this.targetTick();
    let i = 0;
    const applyDue = () => {
      while (i < actions.length && actions[i].tick <= room.ticks) room.apply(actions[i++]);
    };
    applyDue();
    while (room.running && room.ticks < target) {
      room.tick();
      applyDue();
    }
    while (i < actions.length) room.apply(actions[i++]);
    room.drain();
    ledger.setPersistHook((f) => this.persistFact(f));
    this.room = room;
    log("room.rebuilt", { code: config.code, ticks: room.ticks, facts: ledger.size(), phase: room.phase });
  }

  private tickMs(): number {
    return (this.room?.config.tickSeconds ?? Number(this.env.TICK_SECONDS)) * 1000;
  }

  /** Ticks are anchored to wall-clock time since start, so a restart can replay to the same tick without per-tick writes. */
  private targetTick(): number {
    if (this.startedAt === null) return 0;
    return Math.round(((this.pausedAt ?? Date.now()) - this.startedAt) / this.tickMs());
  }

  private persistFact(f: ReturnType<Ledger["append"]>) {
    const r = factToRow(f);
    this.sql`INSERT OR IGNORE INTO facts (id, seq, sim_time, abs_time, created_at, kind, domain, entity, attribute, value, summary_text, source_type, source_ref, asserted_by, station, confidence, vis_full, vis_summary, derived_from, supersedes, valid_until, promoted_by)
      VALUES (${r.id}, ${r.seq}, ${r.sim_time}, ${r.abs_time}, ${r.created_at}, ${r.kind}, ${r.domain}, ${r.entity}, ${r.attribute}, ${r.value}, ${r.summary_text}, ${r.source_type}, ${r.source_ref}, ${r.asserted_by}, ${r.station}, ${r.confidence}, ${r.vis_full}, ${r.vis_summary}, ${r.derived_from}, ${r.supersedes}, ${r.valid_until}, ${r.promoted_by})`;
  }

  private setConfig(k: string, v: string) {
    this.sql`INSERT INTO room_config (k, v) VALUES (${k}, ${v}) ON CONFLICT(k) DO UPDATE SET v = excluded.v`;
  }

  // ---------- RPC from the Worker ----------

  async initRoom(input: { code: string; scenario: ScenarioSetting; timescale: number; creatorSid: string; creatorNick: string }): Promise<boolean> {
    if (this.room) return false;
    const createdAt = Date.now();
    const config: RoomConfig = {
      code: input.code,
      seed: Room.seedFor(input.code, createdAt),
      scenario: input.scenario,
      timescale: input.timescale,
      tickSeconds: Number(this.env.TICK_SECONDS) || 2,
      createdAt,
      creatorSid: input.creatorSid,
      creatorNick: input.creatorNick,
    };
    this.setConfig("config", JSON.stringify(config));
    const ledger = new Ledger((f) => this.persistFact(f));
    this.room = new Room(config, ledger);
    this.syncPublic();
    await this.schedule(LOBBY_EXPIRY_S, "lobbyExpiry");
    return true;
  }

  async canJoin(): Promise<{ ok: true } | { ok: false; error: "not_found" | "full" | "ended" }> {
    if (!this.room) return { ok: false, error: "not_found" };
    if (this.room.phase === "ENDED" && !this.room.ledger.size()) return { ok: false, error: "ended" };
    if (this.connectionCount() >= MAX_CONNECTIONS) return { ok: false, error: "full" };
    return { ok: true };
  }

  // ---------- Connections ----------

  override validateStateChange(_next: PublicRoomState, source: Connection | "server") {
    if (source !== "server") throw new Error("Room state is read-only for clients");
  }

  private connectionCount(): number {
    let n = 0;
    for (const _ of this.getConnections()) n++;
    return n;
  }

  private info(conn: Connection): ConnInfo | null {
    return (conn.state as ConnInfo | null) ?? null;
  }

  private principalOf(conn: Connection): Principal | null {
    const i = this.info(conn);
    return i && this.room ? this.room.principal(i.sid) : null;
  }

  override async onConnect(conn: Connection, ctx: ConnectionContext) {
    const token = new URL(ctx.request.url).searchParams.get("token");
    const claims = await verifyToken(token, this.env.SESSION_SECRET, this.name);
    if (!claims || !this.room) {
      conn.close(4001, "invalid token");
      return;
    }
    const sids = new Set<string>();
    for (const c of this.getConnections()) {
      const i = this.info(c);
      if (i && c.id !== conn.id) sids.add(i.sid);
    }
    const seated = this.room.seatOf(claims.sid) !== null;
    const spectators = [...sids].filter((s) => this.room!.seatOf(s) === null).length;
    if (!sids.has(claims.sid) && (this.connectionCount() > MAX_CONNECTIONS || (!seated && spectators >= MAX_SPECTATORS))) {
      this.send(conn, null, { type: "error", code: "room_full", message: "This control room is full." });
      conn.close(4003, "room full");
      return;
    }
    conn.setState({ sid: claims.sid, nick: claims.nick } satisfies ConnInfo);
    this.room.nicks.set(claims.sid, claims.nick);
    this.lastSeen.set(claims.sid, Date.now());
    const p = this.room.principal(claims.sid);
    this.send(conn, p, { type: "welcome", you: principalView(p), room: this.publicView() });
    this.send(conn, p, { type: "snapshot", state: buildSnapshot(this.room, p) });
    this.syncPublic();
  }

  override async onClose(conn: Connection) {
    const i = this.info(conn);
    if (!this.room || !i) return;
    const stillHere = [...this.getConnections()].some((c) => c.id !== conn.id && this.info(c)?.sid === i.sid);
    // In the lobby nothing ticks, so a seat held by a closed tab is released right away.
    if (!stillHere && this.room.phase === "LOBBY") {
      const seat = this.room.seatOf(i.sid);
      if (seat) this.logAndApply("system", "", { type: "seat.timeout", station: seat });
    }
    this.syncPublic(conn.id);
    const others = [...this.getConnections()].filter((c) => c.id !== conn.id).length;
    if (!others && this.pausedAt !== null) await this.setPaused(false);
    if (this.room.phase === "LOBBY" && this.connectionCount() <= 1) await this.schedule(LOBBY_EXPIRY_S, "lobbyExpiry");
  }

  override async onMessage(conn: Connection, raw: WSMessage) {
    if (!this.room) return;
    const i = this.info(conn);
    if (!i) return;
    const text = typeof raw === "string" ? raw : "";
    if (!text || text.length > MAX_MESSAGE_BYTES) return this.send(conn, null, { type: "error", code: "too_large", message: "Message rejected." });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return this.send(conn, null, { type: "error", code: "bad_message", message: "Malformed message." });
    }
    const res = ClientMsg.safeParse(parsed);
    if (!res.success) return this.send(conn, null, { type: "error", code: "bad_message", message: "Unrecognized message." });
    const msg = res.data;
    this.lastSeen.set(i.sid, Date.now());
    if (msg.type === "heartbeat") return;
    if (!this.allowAction(i.sid)) return this.send(conn, null, { type: "error", code: "rate_limited", message: "Slow down a little." });

    const p = this.room.principal(i.sid);
    switch (msg.type) {
      case "ask":
        return this.handleAsk(p, msg.text, msg.clientId);
      case "why":
        return this.send(conn, p, { type: "why.result", factId: msg.factId, chain: this.room.ledger.whyChain(p, msg.factId) });
      case "aar.request":
        return this.handleAar(conn, p);
      case "room.reset":
      case "room.pause": {
        const denied = checkAuthority(p, msg, { phase: this.room.phase, seats: this.room.seats });
        if (denied) return this.send(conn, p, { type: "error", code: "forbidden", message: denied });
        if (msg.type === "room.pause") {
          if (!this.room.running) return this.send(conn, p, { type: "error", code: "bad_phase", message: "Nothing is running to pause." });
          return this.setPaused(msg.paused);
        }
        if (msg.timescale !== undefined && !(TIMESCALES as readonly number[]).includes(msg.timescale)) {
          return this.send(conn, p, { type: "error", code: "bad_timescale", message: "Unsupported timescale." });
        }
        return this.resetRoom(msg.scenario, msg.timescale);
      }
      default: {
        const wasLobby = this.room.phase === "LOBBY";
        this.logAndApply(i.sid, i.nick, msg);
        if (wasLobby && this.room.phase !== "LOBBY") await this.onMissionStart();
      }
    }
  }

  private allowAction(sid: string): boolean {
    const now = Date.now();
    const c = this.actionCounts.get(sid);
    if (!c || now - c.start > ACTION_WINDOW_MS) {
      this.actionCounts.set(sid, { start: now, n: 1 });
      return true;
    }
    c.n++;
    return c.n <= ACTIONS_PER_WINDOW;
  }

  /** Persists to the ordered action log, applies to the deterministic room, then fans out. */
  private logAndApply(sid: string, nick: string, msg: LoggedAction["msg"]) {
    this.logApply(sid, nick, msg);
    this.flush();
  }

  private logApply(sid: string, nick: string, msg: LoggedAction["msg"]) {
    const room = this.room!;
    const entry: LoggedAction = { tick: room.ticks, sid, nick, msg };
    this.sql`INSERT INTO action_log (sim_time, actor, action) VALUES (${room.abs}, ${sid}, ${JSON.stringify(entry)})`;
    const res = room.apply(entry);
    if (!res.ok && msg.type !== "seat.timeout") log("action.denied", { code: room.config.code, type: msg.type });
  }

  // ---------- Sim director: pause and restart ----------

  private async setPaused(paused: boolean) {
    if (paused && this.pausedAt === null) {
      this.pausedAt = Date.now();
      this.setConfig("pausedAt", String(this.pausedAt));
      await this.stopTicking();
      await this.schedule(MAX_PAUSE_S, "pauseExpiry");
    } else if (!paused && this.pausedAt !== null) {
      if (this.startedAt !== null) {
        this.startedAt += Date.now() - this.pausedAt;
        this.setConfig("startedAt", String(this.startedAt));
      }
      this.pausedAt = null;
      this.sql`DELETE FROM room_config WHERE k = 'pausedAt'`;
      for (const s of this.getSchedules().filter((x) => x.callback === "pauseExpiry")) await this.cancelSchedule(s.id);
      if (this.room?.running) await this.ensureTicking();
    }
    this.syncPublic();
  }

  async pauseExpiry() {
    await this.setPaused(false);
  }

  /**
   * Restarts the mission in place from T-15:00 (new seed, empty ledger and action log), keeping
   * everyone's seat or watched console. Lets a visitor switch scenarios without creating rooms.
   */
  private async resetRoom(scenario?: ScenarioSetting, timescale?: number) {
    const old = this.room!;
    await this.stopTicking();
    for (const s of this.getSchedules().filter((x) => x.callback !== "tick")) await this.cancelSchedule(s.id);
    this.sql`DELETE FROM facts`;
    this.sql`DELETE FROM action_log`;
    this.sql`DELETE FROM room_config WHERE k IN ('startedAt', 'pausedAt')`;
    this.startedAt = null;
    this.pausedAt = null;
    this.aarCache.clear();
    const createdAt = Date.now();
    const config: RoomConfig = {
      ...old.config,
      scenario: scenario ?? old.config.scenario,
      timescale: timescale ?? old.config.timescale,
      seed: Room.seedFor(old.config.code, createdAt),
      createdAt,
    };
    this.setConfig("config", JSON.stringify(config));
    this.room = new Room(config, new Ledger((f) => this.persistFact(f)));
    const nick = (sid: string) => old.nicks.get(sid) ?? "guest";
    for (const st of STATIONS) {
      const sid = old.seats[st];
      if (sid) this.logApply(sid, nick(sid), { type: "seat.claim", station: st });
    }
    for (const [sid, st] of old.observers) this.logApply(sid, nick(sid), { type: "room.observe", station: st });
    this.logApply(config.creatorSid, config.creatorNick, { type: "room.start" });
    this.room.drain();
    log("room.reset", { code: this.name, scenario: config.scenario, timescale: config.timescale });
    await this.onMissionStart();
    for (const conn of this.getConnections()) {
      const p = this.principalOf(conn);
      if (!p) continue;
      this.send(conn, p, { type: "welcome", you: principalView(p), room: this.publicView() });
      this.send(conn, p, { type: "snapshot", state: buildSnapshot(this.room, p) });
    }
    this.syncPublic();
  }

  private async onMissionStart() {
    this.startedAt = Date.now();
    this.setConfig("startedAt", String(this.startedAt));
    await this.registry().touchRoom(this.name, "running");
    await this.ensureTicking();
    log("room.started", { code: this.name, scenario: this.room!.config.scenario });
  }

  // ---------- Ticks ----------

  private async ensureTicking() {
    const existing = this.getSchedules().filter((s) => s.callback === "tick");
    for (const s of existing.slice(1)) await this.cancelSchedule(s.id);
    if (!existing.length) await this.scheduleEvery(this.tickMs() / 1000, "tick");
  }

  private async stopTicking() {
    for (const s of this.getSchedules().filter((x) => x.callback === "tick")) await this.cancelSchedule(s.id);
  }

  async tick() {
    const room = this.room;
    if (!room || !room.running || this.pausedAt !== null) return this.stopTicking();
    const target = Math.max(this.targetTick(), room.ticks + 1);
    let n = 0;
    while (room.running && room.ticks < target && n++ < MAX_CATCHUP_TICKS) room.tick();

    for (const station of staleSeats(room.seats, this.lastSeen, Date.now())) {
      this.logAndApply("system", "", { type: "seat.timeout", station });
    }
    this.flush();
    for (const conn of this.getConnections()) {
      const p = this.principalOf(conn);
      if (p) this.send(conn, p, buildTick(room, p));
    }
    if (!room.running) await this.stopTicking();
  }

  async lobbyExpiry() {
    if (this.room?.phase === "LOBBY" && this.connectionCount() === 0) await this.cleanup();
  }

  async cleanup() {
    log("room.ended", { code: this.name, phase: this.room?.phase, facts: this.room?.ledger.size() });
    try {
      await this.registry().releaseRoom(this.name);
    } catch (e) {
      log("registry.error", { error: String(e) });
    }
    for (const c of this.getConnections()) c.close(4004, "room expired");
    this.room = null;
    await this.destroy();
  }

  // ---------- Fan-out (only egress path) ----------

  private registry() {
    return this.env.Registry.getByName("global");
  }

  private publicView(): PublicRoomState {
    const pub = publicState(this.room!);
    let spectators = 0;
    const seen = new Set<string>();
    for (const c of this.getConnections()) {
      const i = this.info(c);
      if (!i || seen.has(i.sid)) continue;
      seen.add(i.sid);
      if (this.room!.seatOf(i.sid) === null && !this.room!.observers.has(i.sid)) spectators++;
    }
    return { ...pub, spectators, paused: this.pausedAt !== null };
  }

  /** Agent state is synced to EVERY client: only PublicRoomState goes here (D3). Written only on change (D4). */
  private syncPublic(excludeConnId?: string) {
    if (!this.room) return;
    const next = this.publicView();
    if (excludeConnId) {
      const c = [...this.getConnections()].find((x) => x.id === excludeConnId);
      const i = c && this.info(c);
      if (i && this.room.seatOf(i.sid) === null && !this.room.observers.has(i.sid) && ![...this.getConnections()].some((x) => x.id !== excludeConnId && this.info(x)?.sid === i.sid)) {
        next.spectators = Math.max(0, next.spectators - 1);
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(this.state)) this.setState(next);
  }

  private send(conn: Connection, p: Principal | null, msg: ServerMsg) {
    const s = JSON.stringify(msg);
    if (p && leaks(p, s)) {
      log("leak.guard", { code: this.name, type: msg.type, role: p.role });
      return;
    }
    conn.send(s);
  }

  private connectionsFor(sid: string): Connection[] {
    return [...this.getConnections()].filter((c) => this.info(c)?.sid === sid);
  }

  /** Drains room events and sends each connection only what its principal may see. */
  private flush() {
    const room = this.room;
    if (!room) return;
    const events = room.drain();
    if (!events.length) return;
    let publicChanged = false;
    const resnap = new Set<string>();
    for (const ev of events) {
      if (ev.e === "public") publicChanged = true;
      if (ev.e === "seat") resnap.add(ev.sid);
      if (ev.e === "ended") void this.onEnded();
    }
    for (const conn of this.getConnections()) {
      const p = this.principalOf(conn);
      if (!p) continue;
      if (resnap.has(p.sid)) continue; // gets a full snapshot below
      for (const ev of events) {
        const m = eventFor(room, p, ev);
        if (m) this.send(conn, p, m);
      }
    }
    for (const sid of resnap) {
      for (const conn of this.connectionsFor(sid)) {
        const p = room.principal(sid);
        this.send(conn, p, { type: "welcome", you: principalView(p), room: this.publicView() });
        this.send(conn, p, { type: "snapshot", state: buildSnapshot(room, p) });
      }
    }
    if (publicChanged || resnap.size) this.syncPublic();
  }

  private async onEnded() {
    await this.stopTicking();
    await this.registry().touchRoom(this.name, "ended");
    await this.schedule(ENDED_EXPIRY_S, "cleanup");
  }

  // ---------- LLM: questions and after-action narrative ----------

  private async llmAllowed(): Promise<boolean> {
    if (this.llmCalls >= Number(this.env.ROOM_LLM_CALLS)) {
      log("budget.exhausted", { scope: "room", code: this.name });
      return false;
    }
    if (!(await this.registry().takeLlmUnit())) return false;
    this.llmCalls++;
    this.setConfig("llmCalls", String(this.llmCalls));
    return true;
  }

  private async handleAsk(p: Principal, rawText: string, clientId?: string) {
    const room = this.room!;
    const questionId = clientId ?? `q_${++this.questionSeq}`;
    const reply = (m: ServerMsg) => this.connectionsFor(p.sid).forEach((c) => this.send(c, p, m));
    const limited = this.limiter.take(p.sid, Date.now());
    if (limited) return reply({ type: "error", code: "rate_limited", message: limited });
    const question = cleanText(rawText, LIMITS.question);
    if (!question) return;

    const facts = factsForPrompt(p, room.ledger, { text: question, limit: 20 });
    const hidden = hiddenCount(p, room.ledger) > 0;
    const provider = createProvider(this.env);
    if (provider && (await this.llmAllowed())) {
      try {
        const out = await provider.complete({
          system: questionSystem(p.role),
          user: questionUser(p.role, room.clock, room.phase, facts, hidden, question),
          maxTokens: ANSWER_MAX_TOKENS,
        });
        const { text, factIds } = filterCitations(out, new Set(facts.map((f) => f.id)));
        log("llm.call", { code: this.name, kind: "ask", provider: provider.name });
        return reply({ type: "answer", questionId, text, factIds, source: "llm" });
      } catch (e) {
        log("llm.fallback", { code: this.name, error: String(e) });
        await this.registry().recordFallback();
      }
    } else {
      log("llm.fallback", { code: this.name, reason: provider ? "budget" : "template_mode" });
    }
    const t = templateAnswer(facts, hidden ? 1 : 0);
    reply({ type: "answer", questionId, text: t.text, factIds: t.factIds, source: "template" });
  }

  private async handleAar(conn: Connection, p: Principal) {
    const room = this.room!;
    const key = `${p.role}:${p.creator}`;
    const cached = this.aarCache.get(key);
    if (cached && !room.running) return this.send(conn, p, { type: "aar", ...cached });
    const facts = factsForPrompt(p, room.ledger, { text: "decision hold scrub poll liftoff conflict waiver status phase", limit: 40 })
      .sort((a, b) => a.id.localeCompare(b.id));
    const hidden = hiddenCount(p, room.ledger) > 0;
    const outcome = room.ledger.all().some((f) => f.attribute === "end") ? "nominal ascent" : room.ledger.all().some((f) => (f.value as { to?: string })?.to === "SCRUB") ? "scrubbed" : room.phase;
    let result: { narrative: string; factIds: string[]; source: "llm" | "template" } | null = null;
    const provider = createProvider(this.env);
    if (!room.running && provider && (await this.llmAllowed())) {
      try {
        const out = await provider.complete({ system: narrativeSystem(p.role), user: narrativeUser(p.role, outcome, facts, hidden), maxTokens: NARRATIVE_MAX_TOKENS });
        const f = filterCitations(out, new Set(facts.map((x) => x.id)));
        result = { narrative: f.text, factIds: f.factIds, source: "llm" };
        log("llm.call", { code: this.name, kind: "aar", provider: provider.name });
      } catch (e) {
        log("llm.fallback", { code: this.name, error: String(e) });
      }
    }
    if (!result) {
      const key = facts.filter((f) => f.kind === "decision" || f.kind === "event" || f.kind === "statement").slice(-8);
      const narrative = key.length
        ? `${key.map((f) => `${f.summary_text.replace(/\.$/, "")} [${f.id}]`).join(". ")}.${hidden ? " Some of this mission is outside this view." : ""}`
        : "Nothing has happened yet in this view.";
      result = { narrative, factIds: key.map((f) => f.id), source: "template" };
    }
    if (!room.running) this.aarCache.set(key, result);
    this.send(conn, p, { type: "aar", ...result });
  }
}
