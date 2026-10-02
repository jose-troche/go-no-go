// THE policy filter (spec 12). Every role-sensitive egress path goes through this module:
// telemetry, facts, signals, LLM prompt facts, why-chains, after-action reports, status board, hidden counter.
import { channelDomain, type ChannelId, type Domain, type Telemetry } from "../../shared/channels";
import { STATIONS, DIRECTOR, type Role, type Station, type Status, type VisibilityRole } from "../../shared/roles";
import type {
  Fact,
  FactKind,
  FactProjection,
  PrincipalView,
  SignalTopic,
  StatusView,
  Visibility,
} from "../../shared/protocol";

export interface Principal {
  sid: string;
  nick: string;
  role: Role;
  creator: boolean;
}

export type Level = "FULL" | "SUMMARY" | "NONE";

const ALL_STATIONS: VisibilityRole[] = [...STATIONS];
const others = (...full: Station[]) => STATIONS.filter((s) => !full.includes(s)) as VisibilityRole[];

// ---------- Visibility matrix (spec 12.3), as data ----------

/** Domain rows for observations and assessments. */
const DOMAIN_MATRIX: Record<Domain, Visibility> = {
  wx: { full: ["FD", "WX"], summary: others("FD", "WX") },
  prop: { full: ["FD", "PROP"], summary: others("FD", "PROP") },
  gnc: { full: ["FD", "GNC"], summary: others("FD", "GNC") },
  rso: { full: ["FD", "RSO"], summary: others("FD", "RSO") },
  asc: { full: [...ALL_STATIONS, "PUBLIC"], summary: [] },
  fd: { full: ALL_STATIONS, summary: [] },
  sys: { full: ALL_STATIONS, summary: [] },
};

/**
 * Per-entity exceptions. Upper-level shear is shared only with subscribers of the
 * wx.upper_winds signal (GNC); other consoles never learn of it.
 */
const ENTITY_EXCEPTIONS: Record<string, Visibility> = {
  "sensor:wx.upper_shear": { full: ["FD", "WX", "GNC"], summary: [] },
};

/** Default visibility for a new fact, before derived-visibility intersection or promotion. */
export function defaultVisibility(kind: FactKind, domain: Domain, station: Station | "SYS", entity: string): Visibility {
  const own = (station === "SYS" ? [] : [station]) as VisibilityRole[];
  switch (kind) {
    case "status":
    case "decision":
      return { full: ALL_STATIONS, summary: [] };
    case "waiver":
    case "conflict":
      return { full: uniq(["FD", ...own]), summary: [] };
    case "statement":
      return { full: [...ALL_STATIONS, "PUBLIC"], summary: [] };
    case "event":
      return { full: [...ALL_STATIONS, "PUBLIC"], summary: [] };
    case "observation":
    case "assessment":
      return clone(ENTITY_EXCEPTIONS[entity] ?? DOMAIN_MATRIX[domain]);
  }
}

export const VIS = {
  fdOnly: (): Visibility => ({ full: ["FD"], summary: [] }),
  director: (): Visibility => ({ full: [DIRECTOR], summary: [] }),
  everyone: (): Visibility => ({ full: [...ALL_STATIONS, "PUBLIC"], summary: [] }),
  stations: (): Visibility => ({ full: [...ALL_STATIONS], summary: [] }),
};

/** Derived visibility: per-role minimum level across all parents (spec 11.4). */
export function intersectVisibility(parents: readonly Visibility[]): Visibility {
  if (parents.length === 0) return { full: [], summary: [] };
  const roles: VisibilityRole[] = [...ALL_STATIONS, "PUBLIC", DIRECTOR];
  const full: VisibilityRole[] = [];
  const summary: VisibilityRole[] = [];
  for (const r of roles) {
    let level = 2;
    for (const v of parents) level = Math.min(level, v.full.includes(r) ? 2 : v.summary.includes(r) ? 1 : 0);
    if (level === 2) full.push(r);
    else if (level === 1) summary.push(r);
  }
  return { full, summary };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
function clone(v: Visibility): Visibility {
  return { full: [...v.full], summary: [...v.summary] };
}

// ---------- Principals ----------

export function principalOf(seats: Partial<Record<Station, string>>, creatorSid: string, sid: string, nick: string): Principal {
  const seat = STATIONS.find((s) => seats[s] === sid);
  return { sid, nick, role: seat ?? "PUBLIC", creator: sid === creatorSid };
}

export function principalView(p: Principal): PrincipalView {
  return { sid: p.sid, nick: p.nick, role: p.role, creator: p.creator };
}

// ---------- Facts ----------

export function levelForVisibility(p: Principal, v: Visibility): Level {
  if (v.full.includes(p.role) || (p.creator && v.full.includes(DIRECTOR))) return "FULL";
  if (v.summary.includes(p.role) || (p.creator && v.summary.includes(DIRECTOR))) return "SUMMARY";
  return "NONE";
}

export function levelFor(p: Principal, fact: Fact): Level {
  return levelForVisibility(p, fact.visibility);
}

function factStatus(f: Fact): Status | undefined {
  if (f.kind !== "status") return undefined;
  const v = f.value as { status?: Status } | null;
  return v?.status;
}

export function project(p: Principal, fact: Fact): FactProjection | null {
  const level = levelFor(p, fact);
  if (level === "NONE") return null;
  if (level === "SUMMARY") {
    return { level, id: fact.id, kind: fact.kind, station: fact.station, status: factStatus(fact), summary_text: fact.summary_text, sim_time: fact.sim_time };
  }
  const { visibility: _v, ...rest } = fact;
  return { level, ...rest, status: factStatus(fact) };
}

export interface LedgerView {
  all(): readonly Fact[];
  get(id: string): Fact | undefined;
}

export function hiddenCount(p: Principal, ledger: LedgerView): number {
  let n = 0;
  for (const f of ledger.all()) if (levelFor(p, f) === "NONE") n++;
  return n;
}

export interface PromptQuery {
  text: string;
  limit?: number;
}

/** The ONLY way the LLM layer gets facts: projected through the asker's principal. */
export function factsForPrompt(p: Principal, ledger: LedgerView, q: PromptQuery): FactProjection[] {
  const words = new Set(
    q.text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  const visible: Array<{ f: FactProjection; score: number }> = [];
  const facts = ledger.all();
  facts.forEach((fact, i) => {
    const proj = project(p, fact);
    if (!proj) return;
    const text = `${proj.summary_text} ${proj.kind} ${proj.station}`.toLowerCase();
    let score = (i / Math.max(1, facts.length)) * 2; // recency
    for (const w of words) if (text.includes(w)) score += 3;
    if (proj.kind === "status" || proj.kind === "decision") score += 1;
    visible.push({ f: proj, score });
  });
  visible.sort((a, b) => b.score - a.score);
  return visible.slice(0, q.limit ?? 20).map((x) => x.f);
}

// ---------- Telemetry ----------

const PUBLIC_TIER = new Set<ChannelId>(["wx.surface_wind", "wx.temp", "asc.altitude", "asc.velocity", "pub.fueling", "pub.lightning"]);
const CHANNEL_EXCEPTIONS: Partial<Record<ChannelId, Role[]>> = { "wx.upper_shear": ["GNC"] };
const DOMAIN_OWNER: Partial<Record<string, Station>> = { wx: "WX", prop: "PROP", gnc: "GNC", rso: "RSO" };

export function telemetryLevel(p: Principal, c: ChannelId): "FULL" | "PUBLIC" | "NONE" {
  const d = channelDomain(c);
  if (d === "pub") return "FULL";
  if (d === "asc") {
    if (p.role !== "PUBLIC") return "FULL";
    return PUBLIC_TIER.has(c) ? "FULL" : "NONE";
  }
  if (p.role === "FD" || DOMAIN_OWNER[d] === p.role || CHANNEL_EXCEPTIONS[c]?.includes(p.role)) return "FULL";
  return PUBLIC_TIER.has(c) ? "PUBLIC" : "NONE";
}

/** Role-filtered telemetry sample (enforcement point 1). Public-tier values are rounded. */
export function projectTelemetry(p: Principal, t: Telemetry): Telemetry {
  const out: Telemetry = {};
  for (const [k, v] of Object.entries(t) as Array<[ChannelId, Telemetry[ChannelId]]>) {
    if (v === undefined) continue;
    const level = telemetryLevel(p, k);
    if (level === "NONE") continue;
    out[k] = level === "PUBLIC" && typeof v === "number" ? Math.round(v) : v;
  }
  return out;
}

export function projectHistory(p: Principal, h: Partial<Record<string, number[]>>): Partial<Record<string, number[]>> {
  const out: Partial<Record<string, number[]>> = {};
  for (const [k, v] of Object.entries(h)) if (v && telemetryLevel(p, k as ChannelId) === "FULL") out[k] = v;
  return out;
}

// ---------- Status board (enforcement point 7) ----------

export function projectStatuses(p: Principal, s: Partial<Record<Station, StatusView>>): Partial<Record<Station, StatusView>> {
  if (p.role === "PUBLIC") return {};
  const out: Partial<Record<Station, StatusView>> = {};
  for (const st of STATIONS) {
    const v = s[st];
    if (!v) continue;
    // Reasons are summary-safe text. Evidence ids are kept only for facts the viewer can see (checked by caller).
    out[st] = { ...v, reasons: [...v.reasons], factIds: [...v.factIds] };
  }
  return out;
}

// ---------- Signals (enforcement point 3) ----------

interface SignalRule {
  full: Role[];
  summary: Role[];
  summaryFields: string[];
}
const SIGNAL_RULES: Record<SignalTopic, SignalRule> = {
  "wx.upper_winds": { full: ["WX", "GNC", "FD"], summary: [], summaryFields: [] },
  "wx.lightning": { full: ["WX", "FD", "RSO"], summary: [], summaryFields: [] },
  "prop.conflict": { full: ["PROP", "FD"], summary: [], summaryFields: [] },
  "rso.range_status": { full: ["RSO", "FD"], summary: ["WX", "PROP", "GNC", "PUBLIC"], summaryFields: ["clear"] },
  "station.status": { full: ["FD"], summary: ["WX", "PROP", "GNC", "RSO"], summaryFields: ["station", "status"] },
  "fd.poll": { full: [...STATIONS], summary: [], summaryFields: [] },
  "fd.decision": { full: [...STATIONS], summary: ["PUBLIC"], summaryFields: ["decision"] },
};

export function signalSubscribers(topic: SignalTopic): Role[] {
  const r = SIGNAL_RULES[topic];
  return [...r.full, ...r.summary];
}

export function projectSignal(p: Principal, topic: SignalTopic, payload: Record<string, unknown>): Record<string, unknown> | null {
  const rule = SIGNAL_RULES[topic];
  if (rule.full.includes(p.role)) return { ...payload };
  if (rule.summary.includes(p.role)) {
    const out: Record<string, unknown> = {};
    for (const k of rule.summaryFields) if (k in payload) out[k] = payload[k];
    return out;
  }
  return null;
}

// ---------- Leak guard (implementation guide section 12) ----------

const FORBIDDEN_PUBLIC = /"(prop\.|gnc\.|rso\.|wx\.upper)[a-z_]*"\s*:/;

/** Returns true when a message destined for a PUBLIC principal contains a forbidden channel key. */
export function leaks(p: Principal, serialized: string): boolean {
  return p.role === "PUBLIC" && FORBIDDEN_PUBLIC.test(serialized);
}
