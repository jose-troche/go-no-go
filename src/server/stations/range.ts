import type { StationAgent } from "./types";
import { CARD_PROTOCOL, baseEvaluate } from "./types";

export const CONTACT_AFTER_SECONDS = 60;

export const range: StationAgent = {
  station: "RSO",
  ownedChannels: ["rso.hazard_intrusions", "rso.fts", "rso.tracking"],
  subscriptions: ["wx.lightning"],
  card: {
    id: "agent:rso",
    name: "Range Safety console agent",
    station: "RSO",
    description: "Watches the surroundings: the offshore hazard area, the flight termination system, and tracking.",
    version: "1.0",
    responsibilities: ["Keep the hazard area clear", "Confirm the flight termination system is ready", "Confirm tracking lock"],
    ownedChannels: ["rso.hazard_intrusions", "rso.fts", "rso.tracking"],
    subscriptions: ["wx.lightning"],
    publishes: ["rso.range_status", "station.status"],
    actions: [
      { id: "report_status", description: "Answer the go/no-go poll" },
      { id: "contact_vessel", description: "Hail a vessel in the hazard area (agent acts after 60 sim seconds of intrusion)" },
    ],
    policies: ["Any intrusion is an immediate NO-GO", "The public only learns whether the range is clear"],
    protocol: CARD_PROTOCOL,
  },
  evaluate: baseEvaluate,
  autoActions(input) {
    if (input.intrusionSeconds >= CONTACT_AFTER_SECONDS && !input.contacted) {
      return [{ action: "contact_vessel", reason: "A vessel has been in the hazard area for a minute" }];
    }
    return [];
  },
};
