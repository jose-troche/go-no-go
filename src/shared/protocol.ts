// Wire protocol shared by client and server (spec 17). Every inbound message is validated with ClientMsg.
import { z } from "zod";
import { ANOMALY_IDS, PHASES, SCENARIO_IDS, TIMESCALES, type Phase, type ScenarioSetting } from "./phases";
import { STATIONS, type Role, type Station, type Status, type VisibilityRole, type PolledStation } from "./roles";
import type { Telemetry, Domain } from "./channels";

export const MAX_MESSAGE_BYTES = 4096;
export const LIMITS = { nickname: 24, reason: 200, question: 280 } as const;

/** Strips markup and control characters, collapses whitespace, and truncates. */
export function cleanText(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const StationZ = z.enum(STATIONS);
const ScenarioIdZ = z.enum(ANOMALY_IDS);
const ScenarioSettingZ = z.enum(SCENARIO_IDS);
const TimescaleZ = z.union(TIMESCALES.map((t) => z.literal(t)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<2>]);
const Reason = z.string().max(LIMITS.reason * 2);

export const ClientMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("seat.claim"), station: StationZ }),
  z.object({ type: z.literal("seat.release") }),
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("room.start") }),
  z.object({
    type: z.literal("room.configure"),
    scenario: ScenarioSettingZ.optional(),
    timescale: z.number().int().optional(),
  }),
  z.object({ type: z.literal("sim.inject"), scenario: ScenarioIdZ }),
  /** Watch a console without operating it: the agent stays in control. null returns to the public view. */
  z.object({ type: z.literal("room.observe"), station: StationZ.nullable() }),
  /** Sim director: restart the mission in place from T-15:00, optionally with a new scenario or timescale. */
  z.object({ type: z.literal("room.reset"), scenario: ScenarioSettingZ.optional(), timescale: z.number().int().optional() }),
  /** Sim director: freeze or unfreeze the mission (clock and window both stop). */
  z.object({ type: z.literal("room.pause"), paused: z.boolean() }),
  z.object({ type: z.literal("fd.action"), action: z.enum(["poll", "hold", "resume", "recycle", "scrub"]) }),
  z.object({ type: z.literal("poll.confirm"), pollId: z.string().max(64) }),
  z.object({ type: z.literal("waiver.request"), lccId: z.string().max(32), reason: Reason }),
  z.object({ type: z.literal("waiver.decide"), waiverId: z.string().max(64), approve: z.boolean(), reason: Reason }),
  z.object({
    type: z.literal("conflict.resolve"),
    conflictId: z.string().max(64),
    choice: z.enum(["recalibrate_b", "trust_a"]),
    reason: Reason.optional(),
  }),
  z.object({ type: z.literal("station.action"), action: z.literal("contact_vessel") }),
  z.object({ type: z.literal("ask"), text: z.string().min(1).max(LIMITS.question * 2), clientId: z.string().max(40).optional() }),
  z.object({ type: z.literal("why"), factId: z.string().max(64) }),
  z.object({ type: z.literal("aar.request") }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;
export type ClientMsgType = ClientMsg["type"];
export { TimescaleZ };

export const CreateRoomBody = z.object({
  scenario: ScenarioSettingZ,
  timescale: z.number().int(),
  nickname: z.string().min(1).max(80),
  /** The landing-page demo room: counted against its own, roomier per-address limit. */
  demo: z.boolean().optional(),
});
export const JoinRoomBody = z.object({ nickname: z.string().min(1).max(80) });

// ---------- Facts ----------

export const FACT_KINDS = ["observation", "assessment", "status", "conflict", "decision", "waiver", "statement", "event"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type SourceType = "sensor" | "rule" | "agent" | "human" | "template" | "sim_director";

export interface Visibility {
  full: VisibilityRole[];
  summary: VisibilityRole[];
}

export interface Fact {
  id: string;
  seq: number;
  /** Count time in seconds relative to T-0 (negative before liftoff). */
  sim_time: number;
  /** Mission elapsed sim seconds since the countdown started; keeps advancing during holds. */
  abs_time: number;
  created_at: number;
  kind: FactKind;
  domain: Domain;
  entity: string;
  attribute: string;
  value: unknown;
  summary_text: string;
  source_type: SourceType;
  source_ref: string | null;
  asserted_by: string;
  station: Station | "SYS";
  confidence: number;
  visibility: Visibility;
  derived_from: string[];
  supersedes: string | null;
  /** Mission elapsed time after which the fact is stale. */
  valid_until: number | null;
  promoted_by: string | null;
}

export type FullProjection = Omit<Fact, "visibility"> & { level: "FULL"; status?: Status };
export interface SummaryProjection {
  level: "SUMMARY";
  id: string;
  kind: FactKind;
  station: Station | "SYS";
  status?: Status;
  summary_text: string;
  sim_time: number;
}
export type FactProjection = FullProjection | SummaryProjection;

// ---------- Views ----------

export interface SeatView {
  nick: string;
}

/** The ONLY state synced to every client via Agent setState. Never put role-sensitive data here. */
export interface PublicRoomState {
  code: string;
  phase: Phase;
  seats: Partial<Record<Station, SeatView>>;
  spectators: number;
  scenario: ScenarioSetting;
  timescale: number;
  creatorNick: string;
  /** The sim director froze the mission. */
  paused: boolean;
}

export interface PrincipalView {
  sid: string;
  nick: string;
  /** The console whose view this participant receives: their seat, the console they watch, or PUBLIC. */
  role: Role;
  creator: boolean;
  /** True when operating the console (seated human); false when watching it or spectating. */
  seated: boolean;
}

export interface StatusView {
  status: Status;
  reasons: string[];
  factIds: string[];
  operator: "human" | "agent";
  nick?: string;
}

export type PollAnswer = "GO" | "NO_GO" | "STANDBY";
export interface PollCallView {
  station: PolledStation;
  state: "waiting" | "calling" | "awaiting_human" | "answered";
  answer: PollAnswer | null;
  by: "agent" | "human" | null;
  note?: string;
  deadlineMs?: number;
}
export interface PollView {
  id: string;
  state: "open" | "closed";
  calls: PollCallView[];
  result: "ALL_GO" | "NOT_GO" | null;
  openedBy: "agent" | "human";
}

export interface WaiverView {
  id: string;
  lccId: string;
  lccLabel: string;
  station: Station;
  state: "requested" | "approved" | "denied" | "expired";
  reason: string;
  requestedBy: string;
}

export interface ConflictOption {
  choice: "recalibrate_b" | "trust_a";
  label: string;
  consequence: string;
  allowed: boolean;
  why?: string;
}
export interface ConflictView {
  id: string;
  state: "open" | "resolved";
  station: Station;
  title: string;
  ageSeconds: number;
  graceSeconds: number;
  sources?: Array<{ label: string; value: number; unit: string }>;
  corroborating?: Array<{ label: string; value: number; unit: string; nominal: boolean }>;
  options?: ConflictOption[];
  resolution?: string;
}

export interface CalloutView {
  id: number;
  station: Station | "SYS";
  text: string;
  factIds: string[];
  simTime: number;
}

export interface LccView {
  id: string;
  label: string;
  waivable: boolean;
  violated: boolean;
  waived: boolean;
}

export type PromptView =
  | { kind: "poll_confirm"; data: { pollId: string; station: Station; deadlineMs: number; seconds: number } }
  | { kind: "conflict"; data: ConflictView }
  | { kind: "waiver_decision"; data: WaiverView };

export interface FilteredRoomState {
  code: string;
  phase: Phase;
  simTime: number;
  windowRemaining: number;
  windowOpen: boolean;
  timescale: number;
  you: PrincipalView;
  seats: Partial<Record<Station, SeatView>>;
  statuses: Partial<Record<Station, StatusView>>;
  telemetry: Telemetry;
  history: Partial<Record<string, number[]>>;
  facts: FactProjection[];
  callouts: CalloutView[];
  poll: PollView | null;
  prompts: PromptView[];
  waivers: WaiverView[];
  conflicts: ConflictView[];
  lccs: LccView[];
  hiddenCount: number;
  advice: string | null;
  scenarioActive: string[] | null;
  milestone: string | null;
  tags: string[];
}

export type SignalTopic =
  | "wx.upper_winds"
  | "wx.lightning"
  | "prop.conflict"
  | "rso.range_status"
  | "station.status"
  | "fd.poll"
  | "fd.decision";

export type ServerMsg =
  | { type: "welcome"; you: PrincipalView; room: PublicRoomState }
  | { type: "snapshot"; state: FilteredRoomState }
  | {
      type: "tick";
      simTime: number;
      phase: Phase;
      windowRemaining: number;
      windowOpen: boolean;
      timescale: number;
      telemetry: Telemetry;
      statuses: Partial<Record<Station, StatusView>>;
      hiddenCount: number;
      milestone: string | null;
      tags: string[];
      advice: string | null;
      lccs: LccView[];
      conflicts: ConflictView[];
    }
  | { type: "fact"; fact: FactProjection }
  | { type: "signal"; topic: SignalTopic; payload: unknown }
  | { type: "callout"; callout: CalloutView }
  | { type: "poll"; poll: PollView }
  | { type: "prompt"; prompt: PromptView }
  | { type: "prompt.clear"; kind: PromptView["kind"]; id: string }
  | { type: "waivers"; waivers: WaiverView[] }
  | { type: "answer"; questionId: string; text: string; factIds: string[]; source: "llm" | "template" }
  | { type: "why.result"; factId: string; chain: WhyNode[] }
  | { type: "aar"; narrative: string; factIds: string[]; source: "llm" | "template" }
  | { type: "error"; code: string; message: string };

export type WhyNode = { depth: number; fact: FactProjection } | { depth: number; hidden: true; count: number };

const ServerTypes = [
  "welcome", "snapshot", "tick", "fact", "signal", "callout", "poll", "prompt", "prompt.clear",
  "waivers", "answer", "why.result", "aar", "error",
] as const;
/** Light structural validation on the client; the server is the trusted side. */
export const ServerMsgZ = z.looseObject({ type: z.enum(ServerTypes) });

export type { Phase, Station, Role, Status };
export const PHASE_LIST = PHASES;
