// The room runtime: a pure, deterministic model of one launch room. No I/O.
// The LaunchRoom Durable Object (and the headless runner) drive it with ticks and logged actions,
// then drain its outbox through the policy filter.
import { CHANNEL_META, HISTORY_CHANNELS, channelDomain, type ChannelId, type Domain, type Telemetry } from "../../shared/channels";
import { type Phase, type ScenarioId, type ScenarioSetting, TIMESCALES, formatClock } from "../../shared/phases";
import { POLLED_STATIONS, STATIONS, STATION_NAMES, type PolledStation, type Station, type Status } from "../../shared/roles";
import { cleanText, LIMITS, type CalloutView, type ClientMsg, type Fact, type PollAnswer, type SignalTopic, type Visibility } from "../../shared/protocol";
import { Ledger, type FactDraft } from "../ledger/ledger";
import { PUBLIC_STATEMENTS, TEMPLATES, lower, phaseCallout, statusCallout } from "../ledger/templates";
import { VIS, defaultVisibility, principalOf, type Principal } from "../policy/policy";
import { checkAuthority } from "../policy/authority";
import { hashSeed } from "../sim/rng";
import { ANOMALY_START_CLOCK, CONFLICT_GRACE_SECONDS, CONFLICT_TOLERANCE_PSI, LIGHTNING_RULE_KM, planScenario, type ActiveAnomaly } from "../sim/scenarios";
import { LCC_BY_ID, LCCS, createLccRuntime, evaluateLccs, isWaivable, type Band, type LccEvaluation, type LccRuntime } from "../sim/lcc";
import {
  createWorld,
  contactVessel,
  hazardIntruders,
  igniteEngines,
  lightningClock,
  sampleTelemetry,
  startRecalibration,
  stepWorld,
  type World,
  type WorldCtx,
} from "../sim/telemetry";
import {
  ASCENT_MILESTONES,
  ASCENT_TIMESCALE,
  T_ASCENT_END,
  T_AUTO_SEQUENCE,
  T_BUILT_IN_HOLD,
  T_IGNITION,
  T_RECYCLE,
  T_START,
  WINDOW_CLOSE_ABS,
  WINDOW_OPEN_ABS,
  clockRuns,
  isCountPhase,
} from "../sim/timeline";
import { STATION_AGENTS } from "../stations";
import { adviceText, earliestLiftoff, fdPolicy, holdNeedsPoll, type FdActionName } from "../stations/flightDirector";

export interface RoomConfig {
  code: string;
  seed: number;
  scenario: ScenarioSetting;
  timescale: number;
  tickSeconds: number;
  createdAt: number;
  creatorSid: string;
  creatorNick: string;
}

export type SystemMsg = { type: "seat.timeout"; station: Station };

/** One entry of the ordered action log. `tick` is the number of ticks completed when it was applied. */
export interface LoggedAction {
  tick: number;
  sid: string;
  nick: string;
  msg: ClientMsg | SystemMsg;
}

export type RoomEvent =
  | { e: "fact"; fact: Fact }
  | { e: "callout"; callout: CalloutView; visibility: Visibility }
  | { e: "signal"; topic: SignalTopic; payload: Record<string, unknown> }
  | { e: "poll" }
  | { e: "prompt"; sid: string; kind: "poll_confirm" | "conflict" | "waiver_decision"; id: string }
  | { e: "prompt.clear"; kind: "poll_confirm" | "conflict" | "waiver_decision"; id: string }
  | { e: "public" }
  | { e: "seat"; sid: string }
  | { e: "error"; sid: string; code: string; message: string }
  | { e: "waivers" }
  | { e: "ended" };

export interface PollCall {
  station: PolledStation;
  state: "waiting" | "calling" | "awaiting_human" | "answered";
  answer: PollAnswer | null;
  by: "agent" | "human" | null;
  note?: string;
  deadlineTick?: number;
  factId?: string;
}
export interface Poll {
  id: string;
  state: "open" | "closed";
  cursor: number;
  calls: PollCall[];
  result: "ALL_GO" | "NOT_GO" | null;
  openedBy: "agent" | "human";
  factId: string;
}

export interface Conflict {
  id: string;
  station: PolledStation;
  openedAbs: number;
  state: "open" | "resolved";
  factId: string;
  resolution?: string;
}

export interface Waiver {
  id: string;
  lccId: string;
  station: PolledStation;
  state: "requested" | "approved" | "denied" | "expired";
  reason: string;
  requestedBy: string;
  requestedSid: string;
  factId: string;
}

interface BandTrack {
  band: Band;
  factId: string | null;
  pending: Band | null;
  pendingSince: number;
}

interface StationState {
  status: Status;
  reasons: string[];
  factIds: string[];
  factId: string | null;
  pending: Status | null;
  pendingSince: number;
}

export const POLL_CONFIRM_SECONDS = 20;
const BAND_SETTLE_SECONDS = 3;
const STATUS_SETTLE_SECONDS = 3;
const HISTORY_LEN = 60;
const CALLOUT_LEN = 80;

export class Room {
  readonly ledger: Ledger;
  readonly world: World;
  config: RoomConfig;
  phase: Phase = "LOBBY";
  clock = T_START;
  abs = 0;
  ticks = 0;
  phaseEnteredAbs = 0;
  holdBeganClock: number | null = null;
  holdPrevPhase: Phase | null = null;

  planned: ScenarioId[] = [];
  triggered = new Set<ScenarioId>();
  anomalies: Partial<Record<ScenarioId, ActiveAnomaly>> = {};

  seats: Partial<Record<Station, string>> = {};
  nicks = new Map<string, string>();

  telemetry: Telemetry = {};
  history: Partial<Record<string, number[]>> = {};
  lccRt: LccRuntime = createLccRuntime();
  lastEval: LccEvaluation | null = null;
  bands: Record<string, BandTrack> = {};
  stations: Record<PolledStation, StationState>;

  conflicts = new Map<string, Conflict>();
  conflictCandidateSince: number | null = null;
  waivers = new Map<string, Waiver>();
  poll: Poll | null = null;
  pollCount = 0;
  pollPassed = false;
  lastPollClosedAbs: number | null = null;

  callouts: Array<CalloutView & { visibility: Visibility }> = [];
  private calloutSeq = 0;
  lastStatement: string | null = null;
  milestone: string | null = null;
  armsRetracted = false;

  private lastShearSignal: { shear: number; band: Band } | null = null;
  private intrusionSince: number | null = null;
  private rangeClear = true;
  private recommendedScrub = false;
  advice: string | null = null;
  private waiverSeq = 0;
  private conflictSeq = 0;

  outbox: RoomEvent[] = [];
  /** Wall-clock source; overridden in tests for reproducible created_at. */
  now: () => number = () => Date.now();

  constructor(config: RoomConfig, ledger?: Ledger) {
    this.config = { ...config };
    this.ledger = ledger ?? new Ledger();
    this.world = createWorld(config.seed);
    this.stations = Object.fromEntries(
      POLLED_STATIONS.map((s) => [s, { status: "STANDBY", reasons: [], factIds: [], factId: null, pending: null, pendingSince: 0 }]),
    ) as unknown as Record<PolledStation, StationState>;
    this.nicks.set(config.creatorSid, config.creatorNick);
  }

  static seedFor(code: string, createdAt: number): number {
    return hashSeed(`${code}:${createdAt}`);
  }

  // ---------- Derived views ----------

  get timescale(): number {
    return this.phase === "ASCENT" ? ASCENT_TIMESCALE : this.config.timescale;
  }

  get running(): boolean {
    return this.phase !== "LOBBY" && this.phase !== "ENDED";
  }

  principal(sid: string): Principal {
    return principalOf(this.seats, this.config.creatorSid, sid, this.nicks.get(sid) ?? "guest");
  }

  seatOf(sid: string): Station | null {
    return STATIONS.find((s) => this.seats[s] === sid) ?? null;
  }

  humanAt(station: Station): boolean {
    return this.seats[station] !== undefined;
  }

  noGoStations(): PolledStation[] {
    return POLLED_STATIONS.filter((s) => this.stations[s].status === "NO_GO");
  }

  /** Earliest time known perishable blocks (lightning rule, sensor recalibration) clear. */
  blockedUntilAbs(): number {
    let t = this.abs;
    const lc = lightningClock(this.world, this.abs);
    if (lc > 0) t = Math.max(t, this.abs + lc);
    if (this.world.recalUntil !== null) t = Math.max(t, this.world.recalUntil);
    return t;
  }

  needsPoll(): boolean {
    if (this.phase === "BUILT_IN_HOLD") return !this.pollPassed;
    if (this.phase === "HOLD") return holdNeedsPoll(this.holdBeganClock) && !this.pollPassed;
    if (this.phase === "FUELING") return true;
    return false;
  }

  projectedLiftoff(): number {
    return Math.max(WINDOW_OPEN_ABS, earliestLiftoff({ abs: this.abs, clock: this.clock, blockedUntilAbs: this.blockedUntilAbs() }, this.needsPoll()));
  }

  windowRemaining(): number {
    if (this.phase === "LOBBY") return WINDOW_CLOSE_ABS - WINDOW_OPEN_ABS;
    if (this.phase === "ASCENT" || this.phase === "ENDED" || this.phase === "SCRUB") return 0;
    return WINDOW_CLOSE_ABS - this.projectedLiftoff();
  }

  displayStatus(s: Station): Status {
    if (this.phase === "LOBBY") return "STANDBY";
    if (s === "FD") {
      const all = POLLED_STATIONS.map((x) => this.displayStatus(x));
      if (all.includes("NO_GO")) return "NO_GO";
      if (all.includes("WATCH")) return "WATCH";
      if (all.includes("STANDBY")) return "STANDBY";
      return "GO";
    }
    const call = this.poll?.state === "open" ? this.poll.calls.find((c) => c.station === s) : undefined;
    if (call?.state === "awaiting_human") return "STANDBY";
    return this.stations[s].status;
  }

  waivedSet(): Set<string> {
    return new Set([...this.waivers.values()].filter((w) => w.state === "approved").map((w) => w.lccId));
  }

  openConflicts(): Conflict[] {
    return [...this.conflicts.values()].filter((c) => c.state === "open");
  }

  // ---------- Outbox helpers ----------

  private fact(d: FactDraft): Fact {
    const f = this.ledger.append(d, { simTime: this.clock, absTime: this.abs, now: this.now() });
    this.outbox.push({ e: "fact", fact: f });
    return f;
  }

  private callout(station: Station | "SYS", text: string, factIds: string[], visibility: Visibility) {
    const c = { id: ++this.calloutSeq, station, text, factIds, simTime: this.clock };
    this.callouts.push({ ...c, visibility });
    if (this.callouts.length > CALLOUT_LEN) this.callouts.shift();
    this.outbox.push({ e: "callout", callout: c, visibility });
  }

  private calloutFor(f: Fact, station: Station | "SYS", text: string) {
    this.callout(station, text, [f.id], f.visibility);
  }

  private signal(topic: SignalTopic, payload: Record<string, unknown>) {
    this.outbox.push({ e: "signal", topic, payload });
  }

  private actorRef(sid: string): string {
    return sid.startsWith("agent:") || sid === "system" ? sid : `human:${sid}`;
  }

  /** Public statement promoted through an approved template (spec 11.4). Deduplicated. */
  private statement(text: string, template: string, by: string, derived: string[] = []) {
    if (text === this.lastStatement) return;
    this.lastStatement = text;
    const f = this.fact({
      kind: "statement",
      domain: "sys",
      entity: "public:statement",
      attribute: "text",
      value: { text },
      summary_text: text,
      source_type: "template",
      source_ref: template,
      asserted_by: by,
      station: "SYS",
      derived_from: derived,
      promotion: { template, by, visibility: VIS.everyone() },
    });
    return f;
  }

  private fdActor(): string {
    return this.humanAt("FD") ? `human:${this.seats.FD}` : "agent:fd";
  }

  // ---------- Phases ----------

  private setPhase(next: Phase, reason: string, by: string, derived: string[] = [], calloutText?: string) {
    const prev = this.phase;
    this.phase = next;
    this.phaseEnteredAbs = this.abs;
    const f = this.fact({
      kind: "event",
      domain: "sys",
      entity: "room:phase",
      attribute: "phase",
      value: { from: prev, to: next, reason },
      summary_text: `${phaseCallout(next, this.clock) || next} ${reason ? `(${reason})` : ""}`.trim(),
      source_type: by.startsWith("human:") ? "human" : by === "rule" ? "rule" : "agent",
      asserted_by: by,
      station: "SYS",
      derived_from: derived,
      visibility: VIS.everyone(),
    });
    this.calloutFor(f, "SYS", calloutText ?? phaseCallout(next, this.clock));
    this.outbox.push({ e: "public" });
    if (next === "ENDED") this.outbox.push({ e: "ended" });
    return f;
  }

  // ---------- Actions ----------

  /**
   * Applies one logged action. Authority is checked first; denials produce an FD-visible fact.
   * Deterministic: the same log against the same state yields the same facts.
   */
  apply(entry: LoggedAction): { ok: boolean } {
    const { sid, msg } = entry;
    if (entry.nick) this.nicks.set(sid, entry.nick);
    if (msg.type === "seat.timeout") {
      this.releaseSeat(msg.station, true);
      return { ok: true };
    }
    const p = this.principal(sid);
    const denied = checkAuthority(p, msg, { phase: this.phase, seats: this.seats });
    if (denied) {
      this.deny(p, msg, denied);
      return { ok: false };
    }
    const err = (code: string, message: string) => {
      this.outbox.push({ e: "error", sid, code, message });
      return { ok: false };
    };
    switch (msg.type) {
      case "seat.claim": {
        const holder = this.seats[msg.station];
        if (holder && holder !== sid) return err("seat_taken", "That console is already taken.");
        if (holder === sid) return { ok: true };
        const old = this.seatOf(sid);
        if (old) this.releaseSeat(old, false);
        this.seats[msg.station] = sid;
        const f = this.fact({
          kind: "event",
          domain: "sys",
          entity: `seat:${msg.station}`,
          attribute: "occupant",
          value: { nick: p.nick, station: msg.station },
          summary_text: `${p.nick} took the ${STATION_NAMES[msg.station]} console`,
          source_type: "human",
          asserted_by: this.actorRef(sid),
          station: msg.station,
          visibility: VIS.everyone(),
        });
        this.calloutFor(f, msg.station, `${STATION_NAMES[msg.station]} console is now staffed by ${p.nick}.`);
        this.outbox.push({ e: "seat", sid }, { e: "public" });
        this.promptsForNewSeat(msg.station, sid);
        return { ok: true };
      }
      case "seat.release": {
        const s = this.seatOf(sid);
        if (s) this.releaseSeat(s, false);
        return { ok: true };
      }
      case "heartbeat":
        return { ok: true };
      case "room.configure": {
        if (this.phase !== "LOBBY") return err("bad_phase", "The scenario can only be changed in the lobby.");
        if (msg.scenario) this.config.scenario = msg.scenario;
        if (msg.timescale !== undefined) {
          if (!(TIMESCALES as readonly number[]).includes(msg.timescale)) return err("bad_timescale", "Unsupported timescale.");
          this.config.timescale = msg.timescale;
        }
        this.outbox.push({ e: "public" });
        return { ok: true };
      }
      case "room.start": {
        if (this.phase !== "LOBBY") return err("bad_phase", "The countdown has already started.");
        this.planned = planScenario(this.config.scenario, this.config.seed);
        this.clock = T_START;
        this.abs = 0;
        this.setPhase("FUELING", "", `human:${sid}`);
        this.statement(PUBLIC_STATEMENTS.countdown, TEMPLATES.publicPhase, "agent:fd");
        this.sample();
        this.evaluate(true);
        return { ok: true };
      }
      case "sim.inject": {
        if (!this.running || this.phase === "ASCENT" || this.phase === "SCRUB") return err("bad_phase", "Anomalies can only be injected during the countdown.");
        if (this.anomalies[msg.scenario]) return err("already_active", "That anomaly is already active.");
        this.activate(msg.scenario, true, sid);
        return { ok: true };
      }
      case "fd.action":
        return this.fdAction(msg.action, `human:${sid}`, sid, "human") ? { ok: true } : { ok: false };
      case "poll.confirm": {
        const call = this.poll?.state === "open" && this.poll.id === msg.pollId ? this.poll.calls[this.poll.cursor] : undefined;
        if (!call || call.state !== "awaiting_human" || call.station !== p.role) return err("no_poll", "There is no poll answer awaiting your confirmation.");
        this.answerPoll(call, "GO", "human", `Confirmed by ${p.nick} at ${STATION_NAMES[call.station]}`, sid);
        return { ok: true };
      }
      case "waiver.request":
        return this.requestWaiver(p, msg.lccId, cleanText(msg.reason, LIMITS.reason)) ? { ok: true } : { ok: false };
      case "waiver.decide":
        return this.decideWaiver(p, msg.waiverId, msg.approve, cleanText(msg.reason, LIMITS.reason)) ? { ok: true } : { ok: false };
      case "conflict.resolve": {
        const c = this.conflicts.get(msg.conflictId);
        if (!c || c.state !== "open") return err("no_conflict", "That conflict is not open.");
        if (msg.choice === "trust_a") {
          const why = this.trustABlocked();
          if (why) return err("not_allowed", why);
        }
        this.resolveConflict(c, msg.choice, "human", sid, cleanText(msg.reason ?? "", LIMITS.reason));
        return { ok: true };
      }
      case "station.action": {
        if (!this.contact("human", sid)) return err("no_vessel", "There is no vessel to contact.");
        return { ok: true };
      }
      case "ask":
      case "why":
      case "aar.request":
        return { ok: true };
    }
  }

  private deny(p: Principal, msg: ClientMsg, message: string) {
    const f = this.fact({
      kind: "decision",
      domain: "fd",
      entity: `access:${p.role}`,
      attribute: "denied",
      value: { action: msg.type, sub: "action" in msg ? msg.action : undefined, nick: p.nick, role: p.role },
      summary_text: `Denied: ${p.nick} (${p.role === "PUBLIC" ? "spectator" : STATION_NAMES[p.role]}) attempted an action without authority`,
      source_type: "rule",
      source_ref: "authority",
      asserted_by: "rule:authority",
      station: "FD",
      visibility: VIS.fdOnly(),
    });
    this.outbox.push({ e: "error", sid: p.sid, code: "forbidden", message });
    void f;
  }

  private releaseSeat(station: Station, timeout: boolean) {
    const sid = this.seats[station];
    if (!sid) return;
    delete this.seats[station];
    const nick = this.nicks.get(sid) ?? "operator";
    const f = this.fact({
      kind: "event",
      domain: "sys",
      entity: `seat:${station}`,
      attribute: "occupant",
      value: { nick: null, station, timeout },
      summary_text: `${nick} left the ${STATION_NAMES[station]} console${timeout ? " (inactive)" : ""}`,
      source_type: timeout ? "rule" : "human",
      asserted_by: timeout ? "rule:heartbeat" : this.actorRef(sid),
      station,
      visibility: VIS.everyone(),
    });
    this.calloutFor(f, station, `${STATION_NAMES[station]} console is back on autopilot.`);
    // A pending human confirmation falls back to the agent.
    const call = this.poll?.state === "open" ? this.poll.calls[this.poll.cursor] : undefined;
    if (call && call.station === station && call.state === "awaiting_human") {
      call.state = "calling";
      this.outbox.push({ e: "prompt.clear", kind: "poll_confirm", id: this.poll!.id });
    }
    this.outbox.push({ e: "seat", sid }, { e: "public" });
  }

  private promptsForNewSeat(station: Station, sid: string) {
    if (station === "FD") {
      for (const w of this.waivers.values()) if (w.state === "requested") this.outbox.push({ e: "prompt", sid, kind: "waiver_decision", id: w.id });
    }
    if (station === "PROP") {
      for (const c of this.openConflicts()) this.outbox.push({ e: "prompt", sid, kind: "conflict", id: c.id });
    }
  }

  private activate(id: ScenarioId, injected: boolean, sid?: string) {
    this.anomalies[id] = { id, startAbs: this.abs, injected };
    this.triggered.add(id);
    this.fact({
      kind: "event",
      domain: "sys",
      entity: `scenario:${id}`,
      attribute: "active",
      value: { id, injected },
      summary_text: injected ? `Sim director injected anomaly ${id}` : `Scenario anomaly ${id} began`,
      source_type: "sim_director",
      asserted_by: sid ? `human:${sid}` : "sim_director",
      station: "SYS",
      visibility: VIS.director(),
    });
  }

  // ---------- FD actions ----------

  /** Executes an FD action for a human FD or the FD agent. Returns false (with an error to the human) when not allowed now. */
  fdAction(action: FdActionName, by: string, sid: string | null, who: "human" | "agent", reason = ""): boolean {
    const fail = (message: string) => {
      if (sid) this.outbox.push({ e: "error", sid, code: "not_now", message });
      return false;
    };
    const ph = this.phase;
    const decide = (decision: string, summary: string, derived: string[] = []) => {
      const f = this.fact({
        kind: "decision",
        domain: "fd",
        entity: "countdown",
        attribute: "decision",
        value: { decision, reason, by: who, nick: sid ? this.nicks.get(sid) : undefined, seat: who === "human" ? "FD" : undefined },
        summary_text: summary,
        source_type: who,
        source_ref: TEMPLATES.decision,
        asserted_by: by,
        station: "FD",
        derived_from: derived,
        promotion: { template: TEMPLATES.decision, by, visibility: VIS.stations() },
      });
      this.signal("fd.decision", { decision, factId: f.id });
      return f;
    };
    switch (action) {
      case "hold": {
        if (!isCountPhase(ph)) return fail("The count is not running.");
        if (ph === "AUTO_SEQUENCE" && this.clock >= T_IGNITION) return fail("Too late to hold: ignition has started.");
        const f = decide("hold", `Hold called by ${who === "human" ? "the Flight Director" : "the FD agent"}${reason ? `: ${reason}` : ""}`, this.noGoEvidence());
        this.calloutFor(f, "FD", "Hold, hold, hold.");
        this.enterHold(f.id, by);
        return true;
      }
      case "resume": {
        if (ph !== "BUILT_IN_HOLD" && ph !== "HOLD") return fail("The count is not holding.");
        const nogo = this.noGoStations();
        if (nogo.length) return fail(`Cannot resume: ${nogo.map((s) => STATION_NAMES[s]).join(", ")} NO-GO.`);
        const needsPoll = ph === "BUILT_IN_HOLD" || holdNeedsPoll(this.holdBeganClock);
        if (needsPoll && !this.pollPassed) return fail("Cannot resume: run a go/no-go poll with all stations GO first.");
        const target: Phase = ph === "BUILT_IN_HOLD" ? "TERMINAL_COUNT" : (this.holdPrevPhase ?? "FUELING");
        const f = decide("resume", "Count resumed", this.poll?.state === "closed" ? [this.poll.factId] : []);
        this.holdBeganClock = null;
        this.holdPrevPhase = null;
        this.setPhase(target, "resume", by, [f.id], `Count resumed at ${formatClock(this.clock)}.`);
        this.statement(PUBLIC_STATEMENTS.resumed, TEMPLATES.publicDecision, "agent:fd");
        return true;
      }
      case "recycle": {
        const ok = ph === "PAD_ABORT" || (ph === "HOLD" && (this.holdPrevPhase === "TERMINAL_COUNT" || this.holdPrevPhase === "AUTO_SEQUENCE"));
        if (!ok) return fail("Recycle is only possible after a pad abort or a hold in terminal count.");
        const f = decide("recycle", "Recycling the count to T-10:00");
        this.clock = T_RECYCLE;
        this.holdBeganClock = null;
        this.holdPrevPhase = null;
        this.pollPassed = false;
        this.armsRetracted = false;
        this.setPhase("FUELING", "recycle", by, [f.id], "Recycling the count to T-10:00. Propellant replenish continues.");
        this.statement(PUBLIC_STATEMENTS.recycle, TEMPLATES.publicDecision, "agent:fd");
        return true;
      }
      case "scrub": {
        if (!(isCountPhase(ph) || ph === "BUILT_IN_HOLD" || ph === "HOLD" || ph === "PAD_ABORT")) return fail("Nothing to scrub.");
        if (ph === "AUTO_SEQUENCE" && this.clock >= T_IGNITION) return fail("Too late to scrub: ignition has started.");
        const f = decide("scrub", `Launch attempt scrubbed${reason ? `: ${reason}` : ""}`);
        this.calloutFor(f, "FD", `We are scrubbing for today${reason ? `: ${reason}` : ""}.`);
        this.closePoll(true);
        this.setPhase("SCRUB", reason || "scrub", by, [f.id]);
        this.statement(PUBLIC_STATEMENTS.scrub, TEMPLATES.publicDecision, "agent:fd");
        this.expireWaivers("the attempt ended");
        return true;
      }
      case "poll": {
        if (ph !== "BUILT_IN_HOLD" && ph !== "HOLD") return fail("Polls run during a hold.");
        if (this.poll?.state === "open") return fail("A poll is already in progress.");
        this.openPoll(who, by);
        return true;
      }
    }
  }

  private noGoEvidence(): string[] {
    return this.noGoStations()
      .map((s) => this.stations[s].factId)
      .filter((x): x is string => !!x);
  }

  private enterHold(decisionId: string, by: string) {
    this.holdBeganClock = this.clock;
    this.holdPrevPhase = this.phase;
    this.pollPassed = false;
    this.setPhase("HOLD", "", by, [decisionId]);
    this.statement(PUBLIC_STATEMENTS.holding, TEMPLATES.publicDecision, "agent:fd");
  }

  // ---------- Poll (spec 14) ----------

  private openPoll(who: "human" | "agent", by: string) {
    const id = `poll_${++this.pollCount}`;
    const f = this.fact({
      kind: "decision",
      domain: "fd",
      entity: `poll:${id}`,
      attribute: "state",
      value: { pollId: id, state: "open" },
      summary_text: "Go/no-go poll opened",
      source_type: who,
      source_ref: TEMPLATES.poll,
      asserted_by: by,
      station: "FD",
      promotion: { template: TEMPLATES.poll, by, visibility: VIS.stations() },
    });
    this.poll = {
      id,
      state: "open",
      cursor: 0,
      calls: POLLED_STATIONS.map((station) => ({ station, state: "waiting", answer: null, by: null })),
      result: null,
      openedBy: who,
      factId: f.id,
    };
    this.pollPassed = false;
    this.calloutFor(f, "FD", "All stations, this is the Flight Director. Stand by for the go/no-go poll.");
    this.signal("fd.poll", { pollId: id, state: "open" });
    this.outbox.push({ e: "poll" });
  }

  /** Advances the poll by one station per tick. Unseated stations answer immediately. */
  private advancePoll() {
    const poll = this.poll;
    if (!poll || poll.state !== "open") return;
    const call = poll.calls[poll.cursor];
    if (!call) return this.closePoll(false);
    const st = this.stations[call.station];
    if (call.state === "waiting") {
      call.state = "calling";
      this.callout("FD", `${STATION_NAMES[call.station]}?`, [poll.factId], VIS.stations());
      this.outbox.push({ e: "poll" });
    }
    if (call.state === "calling") {
      const seated = this.humanAt(call.station);
      if (st.status === "NO_GO") {
        this.answerPoll(call, "NO_GO", "agent", st.reasons[0]);
      } else if (!seated) {
        this.answerPoll(call, "GO", "agent", st.status === "WATCH" ? `go, watching: ${st.reasons[0] ?? ""}`.trim() : undefined);
      } else {
        call.state = "awaiting_human";
        call.deadlineTick = this.ticks + Math.ceil(POLL_CONFIRM_SECONDS / this.config.tickSeconds);
        this.outbox.push({ e: "prompt", sid: this.seats[call.station]!, kind: "poll_confirm", id: poll.id }, { e: "poll" });
      }
    } else if (call.state === "awaiting_human") {
      if (st.status === "NO_GO") {
        this.outbox.push({ e: "prompt.clear", kind: "poll_confirm", id: poll.id });
        this.answerPoll(call, "NO_GO", "agent", st.reasons[0]);
      } else if (call.deadlineTick !== undefined && this.ticks >= call.deadlineTick) {
        this.outbox.push({ e: "prompt.clear", kind: "poll_confirm", id: poll.id });
        this.answerPoll(call, "STANDBY", "human", "No confirmation within 20 seconds");
      }
    }
  }

  private answerPoll(call: PollCall, answer: PollAnswer, by: "agent" | "human", note?: string, sid?: string) {
    const poll = this.poll!;
    call.state = "answered";
    call.answer = answer;
    call.by = by;
    call.note = note;
    const st = this.stations[call.station];
    const asserted = by === "human" && sid ? `human:${sid}` : `agent:${call.station.toLowerCase()}`;
    const label = answer === "NO_GO" ? "NO-GO" : answer;
    const f = this.fact({
      kind: "decision",
      domain: "fd",
      entity: `poll:${poll.id}`,
      attribute: `answer:${call.station}`,
      value: { pollId: poll.id, station: call.station, answer, by, nick: sid ? this.nicks.get(sid) : undefined, seat: by === "human" ? call.station : undefined },
      summary_text: `${STATION_NAMES[call.station]} answered ${label}${by === "human" ? " (human)" : ""}`,
      source_type: by,
      source_ref: TEMPLATES.poll,
      asserted_by: asserted,
      station: call.station,
      derived_from: st.factId ? [poll.factId, st.factId] : [poll.factId],
      promotion: { template: TEMPLATES.poll, by: asserted, visibility: VIS.stations() },
      supersede: false,
    });
    call.factId = f.id;
    if (sid) this.outbox.push({ e: "prompt.clear", kind: "poll_confirm", id: poll.id });
    this.calloutFor(f, call.station, `${STATION_NAMES[call.station]} is ${label}${note && answer !== "GO" ? `: ${note}` : ""}.`);
    this.signal("fd.poll", { pollId: poll.id, state: "answer", station: call.station, answer });
    poll.cursor++;
    if (poll.cursor >= poll.calls.length) this.closePoll(false);
    this.outbox.push({ e: "poll" });
  }

  private closePoll(aborted: boolean) {
    const poll = this.poll;
    if (!poll || poll.state !== "open") return;
    poll.state = "closed";
    this.lastPollClosedAbs = this.abs;
    const allGo = !aborted && poll.calls.every((c) => c.answer === "GO");
    poll.result = allGo ? "ALL_GO" : "NOT_GO";
    this.pollPassed = allGo;
    const bad = poll.calls.filter((c) => c.answer !== "GO");
    const text = aborted
      ? "Poll cancelled"
      : allGo
        ? "All stations GO"
        : `Poll incomplete: ${bad.map((c) => `${STATION_NAMES[c.station]} ${c.answer === "NO_GO" ? "NO-GO" : (c.answer ?? "no answer")}`).join(", ")}`;
    const f = this.fact({
      kind: "decision",
      domain: "fd",
      entity: `poll:${poll.id}`,
      attribute: "state",
      value: { pollId: poll.id, state: "closed", result: poll.result, answers: poll.calls.map((c) => ({ station: c.station, answer: c.answer, by: c.by })) },
      summary_text: text,
      source_type: "agent",
      source_ref: TEMPLATES.poll,
      asserted_by: "agent:fd",
      station: "FD",
      derived_from: poll.calls.map((c) => c.factId).filter((x): x is string => !!x),
      promotion: { template: TEMPLATES.poll, by: "agent:fd", visibility: VIS.stations() },
    });
    this.calloutFor(f, "FD", `${text}.`);
    this.signal("fd.poll", { pollId: poll.id, state: "closed", result: poll.result });
    if (allGo) this.statement(PUBLIC_STATEMENTS.allGo, TEMPLATES.publicDecision, "agent:fd", [f.id]);
    this.outbox.push({ e: "poll" });
  }

  // ---------- Waivers (spec 15) ----------

  private requestWaiver(p: Principal, lccId: string, reason: string): boolean {
    const lcc = LCC_BY_ID[lccId];
    const station = p.role as PolledStation;
    const err = (m: string) => {
      this.outbox.push({ e: "error", sid: p.sid, code: "waiver_invalid", message: m });
      return false;
    };
    if (!lcc || lcc.station !== station) return err("You can only request waivers on your own station's criteria.");
    if (!isWaivable(lcc, this.telemetry)) return err(`${lcc.id} is not waivable.`);
    if (!reason) return err("A waiver request needs a written reason.");
    if ([...this.waivers.values()].some((w) => w.lccId === lccId && (w.state === "requested" || w.state === "approved")))
      return err("A waiver for that criterion is already pending or active.");
    const id = `w_${++this.waiverSeq}`;
    const evidence = this.bands[lccId]?.factId;
    const f = this.fact({
      kind: "waiver",
      domain: channelDomain(lcc.channel) as Domain,
      entity: `waiver:${id}`,
      attribute: "state",
      value: { waiverId: id, lccId, state: "requested", reason, nick: p.nick, seat: station },
      summary_text: `${STATION_NAMES[station]} requested a waiver on ${lcc.id}`,
      source_type: "human",
      asserted_by: `human:${p.sid}`,
      station,
      derived_from: evidence ? [evidence] : [],
      visibility: { full: ["FD", station], summary: [] },
    });
    const w: Waiver = { id, lccId, station, state: "requested", reason, requestedBy: p.nick, requestedSid: p.sid, factId: f.id };
    this.waivers.set(id, w);
    this.outbox.push({ e: "waivers" });
    if (this.humanAt("FD")) {
      this.outbox.push({ e: "prompt", sid: this.seats.FD!, kind: "waiver_decision", id });
    } else {
      this.outbox.push({
        e: "error",
        sid: p.sid,
        code: "waiver_needs_human_fd",
        message: "Waiver request recorded. Waivers need a human Flight Director, and the FD console is on autopilot.",
      });
    }
    return true;
  }

  private decideWaiver(p: Principal, waiverId: string, approve: boolean, reason: string): boolean {
    const w = this.waivers.get(waiverId);
    if (!w || w.state !== "requested") {
      this.outbox.push({ e: "error", sid: p.sid, code: "no_waiver", message: "That waiver is not pending." });
      return false;
    }
    w.state = approve ? "approved" : "denied";
    const f = this.fact({
      kind: "waiver",
      domain: channelDomain(LCC_BY_ID[w.lccId].channel) as Domain,
      entity: `waiver:${w.id}`,
      attribute: "state",
      value: { waiverId: w.id, lccId: w.lccId, state: w.state, reason, nick: p.nick, seat: "FD" },
      summary_text: `Flight Director ${approve ? "approved" : "denied"} the waiver on ${w.lccId}`,
      source_type: "human",
      asserted_by: `human:${p.sid}`,
      station: "FD",
      derived_from: [w.factId],
      visibility: { full: ["FD", w.station], summary: [] },
    });
    this.calloutFor(f, "FD", `Waiver on ${w.lccId} ${approve ? "approved" : "denied"} by the Flight Director.`);
    this.outbox.push({ e: "prompt.clear", kind: "waiver_decision", id: w.id }, { e: "waivers" });
    return true;
  }

  private expireWaivers(why: string, onlyLcc?: string) {
    for (const w of this.waivers.values()) {
      if (w.state !== "approved" && w.state !== "requested") continue;
      if (onlyLcc && w.lccId !== onlyLcc) continue;
      if (onlyLcc && w.state !== "approved") continue;
      w.state = "expired";
      this.fact({
        kind: "waiver",
        domain: channelDomain(LCC_BY_ID[w.lccId].channel) as Domain,
        entity: `waiver:${w.id}`,
        attribute: "state",
        value: { waiverId: w.id, lccId: w.lccId, state: "expired", why },
        summary_text: `Waiver on ${w.lccId} expired: ${why}`,
        source_type: "rule",
        asserted_by: "rule:waiver",
        station: w.station,
        derived_from: [w.factId],
        visibility: { full: ["FD", w.station], summary: [] },
      });
      this.outbox.push({ e: "prompt.clear", kind: "waiver_decision", id: w.id });
    }
    this.outbox.push({ e: "waivers" });
  }

  // ---------- Conflicts (spec 11.5, S2) ----------

  trustABlocked(): string | null {
    const a = this.telemetry["prop.lox_psi_a"];
    const temp = this.telemetry["prop.lox_temp"];
    if (typeof a !== "number" || a < 48 || a > 56) return "Sensor A is not within limits, so it cannot be trusted alone.";
    if (typeof temp !== "number" || temp > 90) return "LOX temperature is not nominal, so there is no corroborating evidence for sensor A.";
    return null;
  }

  private detectConflicts() {
    const a = this.telemetry["prop.lox_psi_a"];
    const b = this.telemetry["prop.lox_psi_b"];
    if (this.world.sensorB !== "normal" || typeof a !== "number" || typeof b !== "number" || this.openConflicts().length) {
      this.conflictCandidateSince = null;
      return;
    }
    if (Math.abs(a - b) <= CONFLICT_TOLERANCE_PSI) {
      this.conflictCandidateSince = null;
      return;
    }
    if (this.conflictCandidateSince === null) this.conflictCandidateSince = this.abs;
    if (this.abs - this.conflictCandidateSince < BAND_SETTLE_SECONDS) return;

    const snap = (ch: "prop.lox_psi_a" | "prop.lox_psi_b", v: number, label: string) =>
      this.fact({
        kind: "observation",
        domain: "prop",
        entity: `sensor:${ch}`,
        attribute: "snapshot",
        value: { value: v, unit: "psi" },
        summary_text: `${label} reading captured as evidence`,
        source_type: "sensor",
        source_ref: ch,
        asserted_by: "sensor",
        station: "PROP",
        supersede: false,
      });
    const fa = snap("prop.lox_psi_a", a, "LOX pressure sensor A");
    const fb = snap("prop.lox_psi_b", b, "LOX pressure sensor B");
    const id = `c_${++this.conflictSeq}`;
    const f = this.fact({
      kind: "conflict",
      domain: "prop",
      entity: `conflict:${id}`,
      attribute: "state",
      value: { conflictId: id, state: "open", sources: ["prop.lox_psi_a", "prop.lox_psi_b"], a, b, delta: Math.round((b - a) * 10) / 10 },
      summary_text: "LOX pressure sensors A and B disagree beyond tolerance; the system will not pick one",
      source_type: "rule",
      source_ref: "LCC-PROP-04",
      asserted_by: "agent:prop",
      station: "PROP",
      derived_from: [fa.id, fb.id],
      visibility: { full: ["FD", "PROP"], summary: [] },
    });
    const c: Conflict = { id, station: "PROP", openedAbs: this.abs, state: "open", factId: f.id };
    this.conflicts.set(id, c);
    this.conflictCandidateSince = null;
    this.calloutFor(f, "PROP", "Propulsion: LOX pressure sensors disagree. Not averaging, not picking. Conflict open.");
    this.signal("prop.conflict", { conflictId: id, state: "open", sensors: ["A", "B"] });
    if (this.humanAt("PROP")) this.outbox.push({ e: "prompt", sid: this.seats.PROP!, kind: "conflict", id });
  }

  private resolveConflict(c: Conflict, choice: "recalibrate_b" | "trust_a", who: "human" | "agent", sid: string | null, reason: string) {
    c.state = "resolved";
    const nick = sid ? this.nicks.get(sid) : undefined;
    if (choice === "recalibrate_b") startRecalibration(this.world, this.abs);
    else this.world.sensorB = "untrusted";
    c.resolution = choice;
    const label = choice === "recalibrate_b" ? "Recalibrate sensor B" : "Trust sensor A";
    const by = who === "human" ? `human:${sid}` : "agent:prop";
    const d = this.fact({
      kind: "decision",
      domain: "prop",
      entity: `conflict:${c.id}`,
      attribute: "resolution",
      value: { conflictId: c.id, choice, by: who, nick, seat: who === "human" ? "PROP" : undefined, reason: reason || (who === "agent" ? "Fail-safe default after 60 sim seconds unresolved" : "") },
      summary_text: `${label} chosen by ${who === "human" ? `${nick} at Propulsion` : "the Propulsion agent"}`,
      source_type: who,
      asserted_by: by,
      station: "PROP",
      derived_from: [c.factId],
      visibility: { full: ["FD", "PROP"], summary: [] },
    });
    this.fact({
      kind: "conflict",
      domain: "prop",
      entity: `conflict:${c.id}`,
      attribute: "state",
      value: { conflictId: c.id, state: "resolved", choice },
      summary_text: `Sensor conflict resolved: ${label.toLowerCase()}`,
      source_type: who,
      asserted_by: by,
      station: "PROP",
      derived_from: [d.id],
      visibility: { full: ["FD", "PROP"], summary: [] },
    });
    this.calloutFor(d, "PROP", `Propulsion: ${label.toLowerCase()}${choice === "recalibrate_b" ? "; sensor B offline for about 3 sim minutes" : ""}.`);
    this.signal("prop.conflict", { conflictId: c.id, state: "resolved", choice });
    this.outbox.push({ e: "prompt.clear", kind: "conflict", id: c.id });
  }

  // ---------- Range ----------

  private contact(who: "human" | "agent", sid: string | null): boolean {
    if (!contactVessel(this.world)) return false;
    const by = who === "human" ? `human:${sid}` : "agent:rso";
    const f = this.fact({
      kind: "decision",
      domain: "rso",
      entity: "vessel:v2",
      attribute: "contact",
      value: { by: who, nick: sid ? this.nicks.get(sid) : undefined },
      summary_text: `Range Safety contacted the vessel in the hazard area${who === "agent" ? " (agent)" : ""}`,
      source_type: who,
      asserted_by: by,
      station: "RSO",
      visibility: defaultVisibility("observation", "rso", "RSO", "vessel:v2"),
    });
    this.calloutFor(f, "RSO", "Range Safety: hailing the vessel and asking it to clear the hazard area.");
    return true;
  }

  // ---------- Simulation ----------

  private ctx(): WorldCtx {
    return { abs: this.abs, clock: this.clock, phase: this.phase, anomalies: this.anomalies };
  }

  private sample() {
    this.telemetry = sampleTelemetry(this.world, this.ctx());
  }

  /** One tick: `tickSeconds * timescale` sim seconds, then per-tick agent work. */
  tick() {
    if (!this.running) return;
    this.ticks++;
    if (this.phase === "SCRUB") {
      this.setPhase("ENDED", "", "rule");
      return;
    }
    const steps = Math.max(1, Math.round(this.config.tickSeconds * this.timescale));
    for (let i = 0; i < steps && this.running && (this.phase as Phase) !== "SCRUB"; i++) this.step();
    if (!this.running) return;
    this.perTick();
    this.pushHistory();
  }

  private step() {
    this.abs += 1;
    const prevClock = this.clock;
    if (clockRuns(this.phase)) this.clock += 1;
    const crossed = (t: number) => prevClock < t && this.clock >= t;

    // Scheduled anomalies trigger as the count passes their start time.
    if (isCountPhase(this.phase)) {
      for (const id of this.planned) {
        if (!this.triggered.has(id) && this.clock >= ANOMALY_START_CLOCK[id]) this.activate(id, false);
      }
    }

    // Clock-driven sequence events.
    if (this.phase === "FUELING" && this.clock >= T_BUILT_IN_HOLD) {
      this.clock = T_BUILT_IN_HOLD;
      this.setPhase("BUILT_IN_HOLD", "", "rule");
      this.statement(PUBLIC_STATEMENTS.builtInHold, TEMPLATES.publicPhase, "agent:fd");
    } else if (this.phase === "TERMINAL_COUNT" && crossed(-30)) {
      this.armsRetracted = true;
      this.callout("SYS", "Umbilical arms retracting.", [], VIS.everyone());
    }
    if (this.phase === "TERMINAL_COUNT" && this.clock >= T_AUTO_SEQUENCE) {
      this.setPhase("AUTO_SEQUENCE", "", "rule");
    }
    if (this.phase === "AUTO_SEQUENCE" && crossed(T_IGNITION)) {
      igniteEngines(this.world, this.ctx());
      this.callout("SYS", "Ignition sequence start.", [], VIS.everyone());
    }

    stepWorld(this.world, this.ctx());
    this.sample();

    if (this.phase === "AUTO_SEQUENCE" && this.clock >= 0) {
      this.liftoffOrAbort();
    } else if (this.phase === "ASCENT") {
      this.ascentEvents(prevClock);
      return;
    }

    if ((this.phase as Phase) !== "ASCENT" && this.running && (this.phase as Phase) !== "SCRUB") {
      this.detectConflicts();
      this.evaluate(false);
      this.rangeSignals();
      this.shearSignal();
      this.autoRules();
    }
  }

  private liftoffOrAbort() {
    const ready = Number(this.telemetry["prop.engines_ready"] ?? 0);
    const readiness = String(this.telemetry["prop.engine_readiness"] ?? "");
    const f = this.fact({
      kind: "observation",
      domain: "prop",
      entity: "sensor:prop.engines_ready",
      attribute: "value_band",
      value: { band: ready >= 9 ? "nominal" : "violation", value: ready, readiness, lccId: "LCC-PROP-07" },
      summary_text: ready >= 9 ? "All engines report ready" : "Not all engines reached readiness",
      source_type: "sensor",
      source_ref: "LCC-PROP-07",
      asserted_by: "sensor",
      station: "PROP",
    });
    if (ready >= 9) {
      this.clock = 0;
      this.setPhase("ASCENT", "", "rule", [f.id]);
      this.milestone = "Liftoff";
      this.statement(PUBLIC_STATEMENTS.liftoff, TEMPLATES.publicMilestone, "agent:fd");
      for (const s of POLLED_STATIONS) this.stations[s].status = "GO";
    } else {
      const status = this.fact({
        kind: "status",
        domain: "prop",
        entity: "station:PROP",
        attribute: "status",
        value: { status: "NO_GO", reasons: ["Not all engines reached readiness"] },
        summary_text: "Propulsion is NO-GO: engine readiness",
        source_type: "agent",
        asserted_by: "agent:prop",
        station: "PROP",
        derived_from: [f.id],
        promotion: { template: TEMPLATES.status, by: "agent:prop", visibility: VIS.stations() },
      });
      this.stations.PROP = { ...this.stations.PROP, status: "NO_GO", reasons: ["Not all engines reached readiness"], factIds: [f.id], factId: status.id };
      this.clock = 0;
      this.setPhase("PAD_ABORT", "engine readiness", "rule", [status.id]);
      this.statement(PUBLIC_STATEMENTS.padAbort, TEMPLATES.publicDecision, "agent:fd");
    }
  }

  private ascentEvents(prevClock: number) {
    for (const m of ASCENT_MILESTONES) {
      if (m.t > 0 && prevClock < m.t && this.clock >= m.t) {
        this.milestone = m.label;
        const f = this.fact({
          kind: "event",
          domain: "asc",
          entity: "ascent:milestone",
          attribute: m.id,
          value: { milestone: m.id, label: m.label },
          summary_text: m.label,
          source_type: "sensor",
          asserted_by: "system",
          station: "SYS",
          visibility: VIS.everyone(),
          supersede: false,
        });
        this.calloutFor(f, "SYS", `${m.label}.`);
        this.statement(m.id === "end" ? PUBLIC_STATEMENTS.end : PUBLIC_STATEMENTS.milestone(m.label), TEMPLATES.publicMilestone, "agent:fd");
      }
    }
    if (this.clock >= T_ASCENT_END) this.setPhase("ENDED", "", "rule");
  }

  /** LCC evaluation, observation facts on band changes, and status facts on status changes. */
  private evaluate(initial: boolean) {
    const ctx = { abs: this.abs, clock: this.clock, sensorBExcluded: this.world.sensorB === "untrusted" };
    const ev = evaluateLccs(
      this.telemetry,
      ctx,
      this.lccRt,
      this.waivedSet(),
      this.openConflicts().map((c) => ({ id: c.id, station: c.station, openedAbs: c.openedAbs })),
    );
    this.lastEval = ev;

    // Observation facts on band changes (with a short settle to avoid flapping on noise).
    for (const r of ev.results) {
      const lcc = LCC_BY_ID[r.id];
      const track = (this.bands[r.id] ??= { band: "nominal", factId: null, pending: null, pendingSince: 0 });
      if (r.band === "na" || r.band === track.band) {
        track.pending = null;
        continue;
      }
      const urgent = r.band === "violation" || lcc.immediate;
      if (track.pending !== r.band) {
        track.pending = r.band;
        track.pendingSince = this.abs;
      }
      if (!urgent && this.abs - track.pendingSince < BAND_SETTLE_SECONDS) continue;
      const raw = this.telemetry[lcc.channel];
      const meta = CHANNEL_META[lcc.channel];
      const isLightning = lcc.id === "LCC-WX-03";
      const lc = lightningClock(this.world, this.abs);
      const f = this.fact({
        kind: "observation",
        domain: channelDomain(lcc.channel) as Domain,
        entity: `sensor:${lcc.channel}`,
        attribute: "value_band",
        value: { band: r.band, value: raw, unit: meta?.unit ?? "", lccId: lcc.id, ...(isLightning ? { ruleRemaining: Math.round(lc) } : {}) },
        summary_text: lcc.text[r.band as "nominal" | "off_nominal" | "violation"],
        source_type: "sensor",
        source_ref: lcc.id,
        asserted_by: "sensor",
        station: lcc.station,
        valid_until: isLightning && lc > 0 ? this.abs + lc : null,
      });
      const prevBand = track.band;
      track.band = r.band;
      track.factId = f.id;
      track.pending = null;
      if (prevBand === "violation" && r.band !== "violation") this.expireWaivers("the criterion cleared", r.id);
    }

    // Station statuses.
    for (const s of POLLED_STATIONS) {
      const agent = STATION_AGENTS[s];
      const out = agent.evaluate({ station: s, eval: ev.stations[s], telemetry: this.telemetry, abs: this.abs });
      const st = this.stations[s];
      if (out.status === st.status) {
        st.pending = null;
        st.reasons = out.reasons;
        continue;
      }
      // GO <-> WATCH changes settle briefly to avoid flapping on noise; NO-GO entries and exits are immediate.
      if (!initial && out.status !== "NO_GO" && st.status !== "NO_GO" && st.status !== "STANDBY") {
        if (st.pending !== out.status) {
          st.pending = out.status;
          st.pendingSince = this.abs;
        }
        if (this.abs - st.pendingSince < STATUS_SETTLE_SECONDS) continue;
      }
      this.changeStatus(s, out.status, out.reasons, ev);
    }
  }

  private changeStatus(s: PolledStation, status: Status, reasons: string[], ev: LccEvaluation) {
    const st = this.stations[s];
    const prev = st.status;
    const evidence = new Set<string>();
    for (const r of ev.stations[s].reasons) {
      if (r.lccId && this.bands[r.lccId]?.factId) evidence.add(this.bands[r.lccId].factId!);
      if (r.conflictId) evidence.add(this.conflicts.get(r.conflictId)!.factId);
    }
    if (s === "GNC") {
      const a = this.ledger.currentFact("derived:gnc.traj_margin", "assessment");
      if (a && (status !== "GO" || prev === "NO_GO")) evidence.add(a.id);
    }
    if (status === "GO" && prev !== "STANDBY") {
      // Back to GO: cite the observations that cleared.
      for (const l of LCCS) if (l.station === s && this.bands[l.id]?.factId) evidence.add(this.bands[l.id].factId!);
    }
    const label = status === "NO_GO" ? "NO-GO" : status;
    const f = this.fact({
      kind: "status",
      domain: s.toLowerCase() as Domain,
      entity: `station:${s}`,
      attribute: "status",
      value: { status, previous: prev, reasons },
      summary_text: `${STATION_NAMES[s]} is ${label}${reasons[0] && status !== "GO" ? `: ${lower(reasons[0])}` : ""}`,
      source_type: "agent",
      source_ref: TEMPLATES.status,
      asserted_by: `agent:${s.toLowerCase()}`,
      station: s,
      derived_from: [...evidence],
      promotion: { template: TEMPLATES.status, by: `agent:${s.toLowerCase()}`, visibility: VIS.stations() },
    });
    st.status = status;
    st.reasons = reasons;
    st.factIds = [...evidence];
    st.factId = f.id;
    st.pending = null;
    if (prev !== "STANDBY" || status !== "GO") this.calloutFor(f, s, statusCallout(s, status, reasons[0]));
    this.signal("station.status", { station: s, status, evidence: [...evidence] });
    if (status === "NO_GO") this.pollPassed = false;

    // Public promotions by the owning station (spec 11.4).
    if (s === "WX" && (status === "NO_GO" || prev === "NO_GO")) {
      const lightning = ev.stations.WX.reasons.some((r) => r.lccId === "LCC-WX-03");
      const text = status === "NO_GO" ? (lightning ? PUBLIC_STATEMENTS.weatherLightning : PUBLIC_STATEMENTS.weatherNoGo(reasons[0] ?? "conditions are outside limits")) : PUBLIC_STATEMENTS.weatherGo;
      this.statement(text, TEMPLATES.publicWeather, "agent:wx", [f.id]);
    }
  }

  private rangeSignals() {
    const intruders = hazardIntruders(this.world).length;
    const clear = intruders === 0;
    if (!clear && this.intrusionSince === null) this.intrusionSince = this.abs;
    if (clear) this.intrusionSince = null;
    if (clear !== this.rangeClear) {
      this.rangeClear = clear;
      this.signal("rso.range_status", { clear, intrusions: intruders });
      const ev = this.bands["LCC-RSO-01"]?.factId;
      this.statement(clear ? PUBLIC_STATEMENTS.rangeClear : PUBLIC_STATEMENTS.rangeNotClear, TEMPLATES.publicRange, "agent:rso", ev ? [ev] : []);
    }
    const latest = this.world.strikes[this.world.strikes.length - 1];
    if (latest && latest.abs === this.abs && latest.dist < 20) {
      this.signal("wx.lightning", { dist: Math.round(latest.dist * 10) / 10, ruleExpiresIn: Math.round(lightningClock(this.world, this.abs)), withinRule: latest.dist < LIGHTNING_RULE_KM });
    }
  }

  /** Publishes wx.upper_winds on every 0.05 change or band crossing; Guidance derives an assessment from it. */
  private shearSignal() {
    const shear = this.telemetry["wx.upper_shear"] as number;
    const band = this.bands["LCC-WX-02"]?.band ?? "nominal";
    const last = this.lastShearSignal;
    if (last && Math.abs(shear - last.shear) < 0.05 && band === last.band) return;
    const trend = !last ? "steady" : shear > last.shear ? "rising" : "easing";
    this.lastShearSignal = { shear, band };
    const sig = this.fact({
      kind: "observation",
      domain: "wx",
      entity: "sensor:wx.upper_shear",
      attribute: "signal",
      value: { shear, trend, band },
      summary_text: `Upper-level winds update (${trend})`,
      source_type: "sensor",
      source_ref: "wx.upper_winds",
      asserted_by: "agent:wx",
      station: "WX",
      derived_from: this.bands["LCC-WX-02"]?.factId ? [this.bands["LCC-WX-02"].factId!] : [],
    });
    this.signal("wx.upper_winds", { shear, trend, band, factId: sig.id });
    const a = STATION_AGENTS.GNC.onSignal?.("wx.upper_winds", { shear, trend }, this.telemetry);
    if (a) {
      const margin = this.bands["LCC-GNC-03"]?.factId;
      this.fact({
        kind: "assessment",
        domain: "gnc",
        entity: a.entity,
        attribute: a.attribute,
        value: a.value,
        summary_text: a.summary,
        source_type: "agent",
        source_ref: "wx.upper_winds",
        asserted_by: "agent:gnc",
        station: "GNC",
        confidence: a.confidence,
        derived_from: margin ? [sig.id, margin] : [sig.id],
      });
    }
  }

  /** Deterministic system rules: auto-hold on NO-GO, window close, agent conflict default, RSO contact. */
  private autoRules() {
    const nogo = this.noGoStations();
    const holdable = this.phase === "FUELING" || this.phase === "TERMINAL_COUNT" || (this.phase === "AUTO_SEQUENCE" && this.clock < T_IGNITION);
    if (holdable && nogo.length) {
      const f = this.fact({
        kind: "decision",
        domain: "fd",
        entity: "countdown",
        attribute: "decision",
        value: { decision: "hold", reason: "NO-GO", stations: nogo, by: "rule" },
        summary_text: `Automatic hold: ${nogo.map((s) => STATION_NAMES[s]).join(", ")} NO-GO`,
        source_type: "rule",
        source_ref: TEMPLATES.decision,
        asserted_by: this.humanAt("FD") ? "rule:auto-hold" : "agent:fd",
        station: "FD",
        derived_from: this.noGoEvidence(),
        promotion: { template: TEMPLATES.decision, by: "agent:fd", visibility: VIS.stations() },
      });
      this.signal("fd.decision", { decision: "hold", factId: f.id });
      this.enterHold(f.id, "rule");
    }

    if (this.abs >= WINDOW_CLOSE_ABS && (isCountPhase(this.phase) || this.phase === "BUILT_IN_HOLD" || this.phase === "HOLD" || this.phase === "PAD_ABORT")) {
      if (!(this.phase === "AUTO_SEQUENCE" && this.clock >= T_IGNITION)) this.fdAction("scrub", "rule", null, "agent", "the launch window closed");
    }

    // Conflict owner default: the PROP agent recalibrates after the grace period when no human is seated.
    for (const c of this.openConflicts()) {
      if (!this.humanAt(c.station) && this.abs - c.openedAbs >= CONFLICT_GRACE_SECONDS) {
        const choice = STATION_AGENTS.PROP.defaultConflictResolution?.() ?? "recalibrate_b";
        this.resolveConflict(c, choice, "agent", null, "");
      }
    }
  }

  private perTick() {
    if (this.phase === "ASCENT" || !this.running) return;
    this.advancePoll();

    // RSO agent action when unseated.
    if (!this.humanAt("RSO") && this.intrusionSince !== null) {
      const contacted = this.world.vessels.some((v) => v.scripted && v.contacted);
      const acts = STATION_AGENTS.RSO.autoActions?.({
        station: "RSO",
        eval: this.lastEval!.stations.RSO,
        telemetry: this.telemetry,
        abs: this.abs,
        intrusionSeconds: this.abs - this.intrusionSince,
        contacted,
      });
      if (acts?.length) this.contact("agent", null);
    }

    // Flight Director agent: acts when unseated, advises when a human is seated.
    const proposal = fdPolicy({
      phase: this.phase,
      clock: this.clock,
      abs: this.abs,
      phaseEnteredAbs: this.phaseEnteredAbs,
      noGo: this.noGoStations(),
      pollOpen: this.poll?.state === "open",
      pollPassed: this.pollPassed,
      lastPollClosedAbs: this.lastPollClosedAbs,
      holdBeganClock: this.holdBeganClock,
      blockedUntilAbs: this.blockedUntilAbs(),
    });
    if (proposal?.action === "recommend_scrub" && !this.recommendedScrub) {
      this.recommendedScrub = true;
      const f = this.fact({
        kind: "assessment",
        domain: "fd",
        entity: "window",
        attribute: "recommendation",
        value: { recommendation: "scrub", projectedLiftoffAbs: this.projectedLiftoff(), windowCloseAbs: WINDOW_CLOSE_ABS },
        summary_text: "FD agent recommends a scrub: liftoff can no longer fit in the window",
        source_type: "agent",
        asserted_by: "agent:fd",
        station: "FD",
        visibility: VIS.stations(),
      });
      this.calloutFor(f, "FD", "Flight Director agent: liftoff can no longer fit in the window. Recommend scrub.");
    }
    if (this.humanAt("FD")) {
      this.advice = proposal ? adviceText(proposal) : null;
    } else {
      this.advice = null;
      if (proposal && proposal.action !== "recommend_scrub" && proposal.action !== "hold") {
        this.fdAction(proposal.action, "agent:fd", null, "agent", proposal.reason);
      }
    }
  }

  private pushHistory() {
    for (const c of HISTORY_CHANNELS) {
      const v = this.telemetry[c as ChannelId];
      if (typeof v !== "number") continue;
      const arr = (this.history[c] ??= []);
      arr.push(v);
      if (arr.length > HISTORY_LEN) arr.shift();
    }
  }

  /** Rocket-scene tags shown to everyone. */
  tags(): string[] {
    const t: string[] = [];
    if (this.phase === "HOLD" || this.phase === "BUILT_IN_HOLD") t.push("Holding");
    if (this.phase === "SCRUB" || (this.phase === "ENDED" && this.lastPhaseWasScrub())) t.push("Scrubbed");
    if (this.phase === "PAD_ABORT") t.push("Vehicle safe");
    if (this.armsRetracted && (this.phase === "TERMINAL_COUNT" || this.phase === "AUTO_SEQUENCE" || this.phase === "ASCENT")) t.push("Arms retracted");
    if (this.phase === "AUTO_SEQUENCE" && this.clock >= T_IGNITION) t.push("Ignition");
    return t;
  }

  private lastPhaseWasScrub(): boolean {
    const f = this.ledger.currentFact("room:phase", "phase");
    const v = f?.value as { from?: Phase } | undefined;
    return v?.from === "SCRUB";
  }

  drain(): RoomEvent[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }
}
