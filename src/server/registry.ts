// Registry Durable Object (implementation guide 3.1 D8, 7.9): global caps, room-creation rate limits, daily LLM budget.
import { DurableObject } from "cloudflare:workers";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const STALE_MS = 3 * 60 * 60 * 1000;

export type ReserveResult = { ok: true; code: string } | { ok: false; error: "busy" | "rate_limited" };

export class Registry extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, state TEXT NOT NULL) WITHOUT ROWID`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ip_creates (ip_hash TEXT, hour INTEGER, count INTEGER, PRIMARY KEY (ip_hash, hour)) WITHOUT ROWID`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS llm_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL, fallbacks INTEGER NOT NULL DEFAULT 0, rooms INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`);
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    });
  }

  private day(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  private activeCount(now: number): number {
    const row = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM rooms WHERE state != 'ended' AND last_seen > ?`, now - STALE_MS).one();
    return row.n;
  }

  async reserveRoom(ipHash: string): Promise<ReserveResult> {
    const now = Date.now();
    const hour = Math.floor(now / 3_600_000);
    const used = this.sql.exec<{ count: number }>(`SELECT count FROM ip_creates WHERE ip_hash = ? AND hour = ?`, ipHash, hour).toArray()[0]?.count ?? 0;
    if (used >= Number(this.env.ROOM_CREATES_PER_IP_PER_HOUR)) return { ok: false, error: "rate_limited" };
    if (this.activeCount(now) >= Number(this.env.MAX_ACTIVE_ROOMS)) return { ok: false, error: "busy" };
    let code = "";
    for (let i = 0; i < 20; i++) {
      const b = new Uint8Array(6);
      crypto.getRandomValues(b);
      code = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
      if (!this.sql.exec(`SELECT 1 FROM rooms WHERE code = ?`, code).toArray().length) break;
    }
    this.sql.exec(`INSERT INTO rooms (code, created_at, last_seen, state) VALUES (?, ?, ?, 'lobby')`, code, now, now);
    this.sql.exec(
      `INSERT INTO ip_creates (ip_hash, hour, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, hour) DO UPDATE SET count = count + 1`,
      ipHash,
      hour,
    );
    this.sql.exec(`INSERT INTO llm_budget (day, used, rooms) VALUES (?, 0, 1) ON CONFLICT(day) DO UPDATE SET rooms = rooms + 1`, this.day(now));
    console.log(JSON.stringify({ event: "room.created", code }));
    return { ok: true, code };
  }

  async touchRoom(code: string, state: "lobby" | "running" | "ended"): Promise<void> {
    this.sql.exec(`UPDATE rooms SET last_seen = ?, state = ? WHERE code = ?`, Date.now(), state, code);
  }

  async releaseRoom(code: string): Promise<void> {
    this.sql.exec(`DELETE FROM rooms WHERE code = ?`, code);
  }

  /** Takes one unit of the daily LLM budget. */
  async takeLlmUnit(): Promise<boolean> {
    const day = this.day();
    const used = this.sql.exec<{ used: number }>(`SELECT used FROM llm_budget WHERE day = ?`, day).toArray()[0]?.used ?? 0;
    if (used >= Number(this.env.DAILY_LLM_CALLS)) {
      console.log(JSON.stringify({ event: "budget.exhausted", day, used }));
      return false;
    }
    this.sql.exec(`INSERT INTO llm_budget (day, used) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used = used + 1`, day);
    return true;
  }

  async recordFallback(): Promise<void> {
    this.sql.exec(`INSERT INTO llm_budget (day, used, fallbacks) VALUES (?, 0, 1) ON CONFLICT(day) DO UPDATE SET fallbacks = fallbacks + 1`, this.day());
  }

  async stats() {
    const now = Date.now();
    const today = this.sql.exec<{ used: number; fallbacks: number; rooms: number }>(`SELECT used, fallbacks, rooms FROM llm_budget WHERE day = ?`, this.day(now)).toArray()[0];
    return {
      activeRooms: this.activeCount(now),
      maxActiveRooms: Number(this.env.MAX_ACTIVE_ROOMS),
      roomsToday: today?.rooms ?? 0,
      llmCallsToday: today?.used ?? 0,
      llmDailyBudget: Number(this.env.DAILY_LLM_CALLS),
      fallbacksToday: today?.fallbacks ?? 0,
    };
  }

  /** Daily pruning of old rate-limit rows, budgets, and stale rooms. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    this.sql.exec(`DELETE FROM ip_creates WHERE hour < ?`, Math.floor(now / 3_600_000) - 2);
    this.sql.exec(`DELETE FROM llm_budget WHERE day < ?`, this.day(now - 7 * 86_400_000));
    this.sql.exec(`DELETE FROM rooms WHERE last_seen < ?`, now - 24 * 60 * 60 * 1000);
    await this.ctx.storage.setAlarm(now + 24 * 60 * 60 * 1000);
  }
}
