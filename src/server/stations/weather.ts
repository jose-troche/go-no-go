import type { StationAgent } from "./types";
import { CARD_PROTOCOL, baseEvaluate } from "./types";

export const weather: StationAgent = {
  station: "WX",
  ownedChannels: ["wx.surface_wind", "wx.upper_shear", "wx.lightning_dist", "wx.cloud_ceiling", "wx.temp"],
  subscriptions: [],
  card: {
    id: "agent:wx",
    name: "Weather console agent",
    station: "WX",
    description: "Watches the sky: surface and upper-level winds, lightning, clouds, and temperature.",
    version: "1.0",
    responsibilities: [
      "Report Weather status from the launch commit criteria",
      "Explain conditions in plain language",
      "Publish the upper-winds signal that Guidance depends on",
      "Enforce the lightning rule",
    ],
    ownedChannels: ["wx.surface_wind", "wx.upper_shear", "wx.lightning_dist", "wx.cloud_ceiling", "wx.temp"],
    subscriptions: [],
    publishes: ["wx.upper_winds", "wx.lightning", "station.status"],
    actions: [
      { id: "report_status", description: "Answer the go/no-go poll" },
      { id: "request_waiver", description: "Request a waiver on a waivable weather LCC (cloud ceiling)", requiresHuman: true },
    ],
    policies: ["Status is computed by the deterministic LCC engine", "Lightning within 10 km starts a 15-minute rule clock"],
    protocol: CARD_PROTOCOL,
  },
  evaluate: baseEvaluate,
};
