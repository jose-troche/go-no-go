// Station agent contract (spec 10.2, implementation guide 7.4). Agents never call the LLM to decide.
import type { ChannelId, Telemetry } from "../../shared/channels";
import type { PolledStation, Station, Status } from "../../shared/roles";
import type { SignalTopic } from "../../shared/protocol";
import type { StationEval } from "../sim/lcc";

/** A2A-style descriptor, served read-only for teaching. Not a full A2A implementation. */
export interface AgentCard {
  id: string;
  name: string;
  station: Station;
  description: string;
  version: string;
  responsibilities: string[];
  ownedChannels: ChannelId[];
  subscriptions: SignalTopic[];
  publishes: SignalTopic[];
  actions: Array<{ id: string; description: string; requiresHuman?: boolean }>;
  policies: string[];
  protocol: string;
}

export interface StationInput {
  station: PolledStation;
  eval: StationEval;
  telemetry: Telemetry;
  abs: number;
}

export interface StationOutput {
  status: Status;
  reasons: string[];
}

export interface Assessment {
  entity: string;
  attribute: string;
  value: unknown;
  summary: string;
  confidence: number;
}

export interface AutoAction {
  action: "contact_vessel";
  reason: string;
}

export interface StationAgent {
  station: PolledStation;
  card: AgentCard;
  ownedChannels: ChannelId[];
  subscriptions: SignalTopic[];
  evaluate(input: StationInput): StationOutput;
  onSignal?(topic: SignalTopic, payload: Record<string, unknown>, t: Telemetry): Assessment | null;
  defaultConflictResolution?(): "recalibrate_b";
  autoActions?(input: StationInput & { intrusionSeconds: number; contacted: boolean }): AutoAction[];
}

export function baseEvaluate(input: StationInput): StationOutput {
  return { status: input.eval.status, reasons: input.eval.reasons.map((r) => r.text) };
}

export const CARD_PROTOCOL = "a2a-style agent card (teaching descriptor; the full A2A protocol is out of scope)";
