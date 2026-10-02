import type { StationAgent } from "./types";
import { CARD_PROTOCOL, baseEvaluate } from "./types";

export const propulsion: StationAgent = {
  station: "PROP",
  ownedChannels: ["prop.lox_load", "prop.fuel_load", "prop.lox_psi_a", "prop.lox_psi_b", "prop.fuel_psi", "prop.lox_temp", "prop.engines_ready"],
  subscriptions: [],
  card: {
    id: "agent:prop",
    name: "Propulsion console agent",
    station: "PROP",
    description: "Watches the vehicle: propellant loading, tank pressures, temperatures, and engine readiness.",
    version: "1.0",
    responsibilities: [
      "Track LOX and fuel loading to flight level",
      "Own the dual LOX pressure sensors and surface disagreements as conflicts",
      "Report readiness of all 9 first-stage engines",
    ],
    ownedChannels: ["prop.lox_load", "prop.fuel_load", "prop.lox_psi_a", "prop.lox_psi_b", "prop.fuel_psi", "prop.lox_temp", "prop.engines_ready"],
    subscriptions: [],
    publishes: ["prop.conflict", "station.status"],
    actions: [
      { id: "report_status", description: "Answer the go/no-go poll" },
      { id: "recalibrate_b", description: "Resolve a sensor conflict by recalibrating sensor B (3 sim minutes)" },
      { id: "trust_a", description: "Resolve a sensor conflict by trusting sensor A with corroborating evidence", requiresHuman: true },
      { id: "request_waiver", description: "Request a waiver on LOX temperature", requiresHuman: true },
    ],
    policies: ["Never average or silently pick between disagreeing sensors", "Default conflict resolution is the fail-safe recalibration"],
    protocol: CARD_PROTOCOL,
  },
  evaluate: baseEvaluate,
  defaultConflictResolution: () => "recalibrate_b",
};
