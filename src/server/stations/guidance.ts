import type { StationAgent } from "./types";
import { CARD_PROTOCOL, baseEvaluate } from "./types";

export const guidance: StationAgent = {
  station: "GNC",
  ownedChannels: ["gnc.imu_drift", "gnc.gps_lock", "gnc.traj_margin"],
  subscriptions: ["wx.upper_winds"],
  card: {
    id: "agent:gnc",
    name: "Guidance console agent",
    station: "GNC",
    description: "Watches the path: inertial alignment, GPS, and trajectory margin derived from upper-level winds.",
    version: "1.0",
    responsibilities: [
      "Monitor inertial drift and GPS lock",
      "Compute trajectory margin from Weather's upper-winds signal",
      "Avoid overreacting to transient glitches (10-second debounce)",
    ],
    ownedChannels: ["gnc.imu_drift", "gnc.gps_lock", "gnc.traj_margin"],
    subscriptions: ["wx.upper_winds"],
    publishes: ["station.status"],
    actions: [
      { id: "report_status", description: "Answer the go/no-go poll" },
      { id: "request_waiver", description: "Request a waiver on GPS lock", requiresHuman: true },
    ],
    policies: ["Trajectory margin = 40 - 35 x upper shear", "A derived assessment cites the Weather facts it came from"],
    protocol: CARD_PROTOCOL,
  },
  evaluate: baseEvaluate,
  onSignal(topic, payload, t) {
    if (topic !== "wx.upper_winds") return null;
    const margin = typeof t["gnc.traj_margin"] === "number" ? (t["gnc.traj_margin"] as number) : NaN;
    const band = margin < 15 ? "violation" : margin < 25 ? "off_nominal" : "nominal";
    const summary =
      band === "violation"
        ? "Trajectory margin is below limit due to upper winds"
        : band === "off_nominal"
          ? "Upper winds are eating into trajectory margin"
          : "Upper winds leave a healthy trajectory margin";
    return {
      entity: "derived:gnc.traj_margin",
      attribute: "assessment",
      value: { margin: Math.round(margin * 10) / 10, band, shear: payload.shear, trend: payload.trend },
      summary,
      confidence: 0.9,
    };
  },
};
