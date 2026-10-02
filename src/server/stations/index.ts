import type { PolledStation } from "../../shared/roles";
import type { StationAgent, AgentCard } from "./types";
import { weather } from "./weather";
import { propulsion } from "./propulsion";
import { guidance } from "./guidance";
import { range } from "./range";
import { FD_CARD } from "./flightDirector";

export const STATION_AGENTS: Record<PolledStation, StationAgent> = { WX: weather, PROP: propulsion, GNC: guidance, RSO: range };

export function agentCard(station: string): AgentCard | null {
  if (station === "FD") return FD_CARD;
  const a = (STATION_AGENTS as Record<string, StationAgent>)[station];
  return a ? a.card : null;
}
