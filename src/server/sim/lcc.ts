// Launch commit criteria engine (spec 8). Pure: telemetry + waivers + conflicts in, statuses out.
import type { ChannelId, Telemetry } from "../../shared/channels";
import type { PolledStation, Status } from "../../shared/roles";
import { T_BUILT_IN_HOLD, T_IGNITION } from "./timeline";
import { CONFLICT_GRACE_SECONDS } from "./scenarios";

export type Band = "nominal" | "off_nominal" | "violation" | "na";

export interface LccCtx {
  abs: number;
  clock: number;
  /** Sensor B excluded after a human chose "Trust sensor A". */
  sensorBExcluded: boolean;
}

export interface LccDef {
  id: string;
  station: PolledStation;
  label: string;
  channel: ChannelId;
  /** Extra channels shown as evidence. */
  evidence?: ChannelId[];
  waivable: boolean | ((t: Telemetry) => boolean);
  immediate: boolean;
  band(t: Telemetry, ctx: LccCtx): Band;
  /** Plain-language lines safe for summary viewers: no numbers. */
  text: { nominal: string; off_nominal: string; violation: string };
}

const num = (t: Telemetry, c: ChannelId) => (typeof t[c] === "number" ? (t[c] as number) : NaN);
const range = (v: number, nomLo: number, nomHi: number, limLo: number, limHi: number): Band => {
  if (Number.isNaN(v)) return "na";
  if (v < limLo || v > limHi) return "violation";
  if (v < nomLo || v > nomHi) return "off_nominal";
  return "nominal";
};

export const DEBOUNCE_SECONDS = 10;

export const LCCS: readonly LccDef[] = [
  {
    id: "LCC-WX-01", station: "WX", label: "Surface wind at most 25 kt", channel: "wx.surface_wind", waivable: false, immediate: false,
    band: (t) => range(num(t, "wx.surface_wind"), 0, 14, 0, 25),
    text: { nominal: "Surface winds are calm", off_nominal: "Surface winds are gusty but within limits", violation: "Surface winds exceed the launch limit" },
  },
  {
    id: "LCC-WX-02", station: "WX", label: "Upper-level shear at most 0.70", channel: "wx.upper_shear", waivable: false, immediate: false,
    band: (t) => range(num(t, "wx.upper_shear"), 0, 0.6, 0, 0.7),
    text: { nominal: "Upper-level winds are within normal range", off_nominal: "Upper-level winds are rising", violation: "Upper-level wind shear is above the limit" },
  },
  {
    id: "LCC-WX-03", station: "WX", label: "No lightning within 10 km in the last 15 minutes", channel: "wx.lightning_dist", evidence: ["wx.lightning_clock"], waivable: false, immediate: true,
    band: (t) => {
      const d = num(t, "wx.lightning_dist");
      const clock = num(t, "wx.lightning_clock");
      if (d < 10 || clock > 0) return "violation";
      if (d <= 40) return "off_nominal";
      return "nominal";
    },
    text: { nominal: "No lightning in the area", off_nominal: "Lightning observed at a distance", violation: "Lightning within the safety radius; the lightning rule is in effect" },
  },
  {
    id: "LCC-WX-04", station: "WX", label: "Cloud ceiling at least 4,000 ft", channel: "wx.cloud_ceiling", waivable: true, immediate: false,
    band: (t) => range(num(t, "wx.cloud_ceiling"), 6000, Infinity, 4000, Infinity),
    text: { nominal: "Cloud ceiling is high", off_nominal: "Clouds are lowering", violation: "Cloud ceiling is below the launch limit" },
  },
  {
    id: "LCC-WX-05", station: "WX", label: "Temperature between 2 and 35 °C", channel: "wx.temp", waivable: false, immediate: false,
    band: (t) => range(num(t, "wx.temp"), 18, 28, 2, 35),
    text: { nominal: "Temperature is comfortable", off_nominal: "Temperature is outside the usual band", violation: "Temperature is outside launch limits" },
  },
  {
    id: "LCC-PROP-01", station: "PROP", label: "LOX load at least 98% from T-04:00", channel: "prop.lox_load", waivable: false, immediate: false,
    band: (t, c) => (c.clock < T_BUILT_IN_HOLD ? "nominal" : range(num(t, "prop.lox_load"), 98, 100.5, 98, 101)),
    text: { nominal: "LOX loading is on profile", off_nominal: "LOX loading is off profile", violation: "LOX load is below flight level" },
  },
  {
    id: "LCC-PROP-02", station: "PROP", label: "Fuel load at least 98% from T-04:00", channel: "prop.fuel_load", waivable: false, immediate: false,
    band: (t, c) => (c.clock < T_BUILT_IN_HOLD ? "nominal" : range(num(t, "prop.fuel_load"), 98, 100.5, 98, 101)),
    text: { nominal: "Fuel loading is on profile", off_nominal: "Fuel loading is off profile", violation: "Fuel load is below flight level" },
  },
  {
    id: "LCC-PROP-03", station: "PROP", label: "LOX pressure sensor A between 48 and 56 psi", channel: "prop.lox_psi_a", waivable: false, immediate: false,
    band: (t) => range(num(t, "prop.lox_psi_a"), 50, 54, 48, 56),
    text: { nominal: "LOX tank pressure A is nominal", off_nominal: "LOX tank pressure A is drifting", violation: "LOX tank pressure A is out of limits" },
  },
  {
    id: "LCC-PROP-04", station: "PROP", label: "LOX pressure sensor B between 48 and 56 psi and available", channel: "prop.lox_psi_b", waivable: false, immediate: true,
    band: (t, c) => {
      if (c.sensorBExcluded) return "na";
      if (t["prop.lox_psi_b"] === "offline") return "violation";
      const b = range(num(t, "prop.lox_psi_b"), 50, 54, 48, 56);
      return b === "violation" ? "off_nominal" : b; // out-of-range B is handled as a conflict with A, not a silent NO-GO
    },
    text: { nominal: "LOX tank pressure B is nominal", off_nominal: "LOX tank pressure B is reading high", violation: "LOX pressure sensor B is offline" },
  },
  {
    id: "LCC-PROP-05", station: "PROP", label: "Fuel pressure between 38 and 46 psi", channel: "prop.fuel_psi", waivable: false, immediate: false,
    band: (t) => range(num(t, "prop.fuel_psi"), 40, 44, 38, 46),
    text: { nominal: "Fuel tank pressure is nominal", off_nominal: "Fuel tank pressure is drifting", violation: "Fuel tank pressure is out of limits" },
  },
  {
    id: "LCC-PROP-06", station: "PROP", label: "LOX temperature at most 92 K", channel: "prop.lox_temp", waivable: true, immediate: false,
    band: (t) => range(num(t, "prop.lox_temp"), 0, 90, 0, 92),
    text: { nominal: "LOX temperature is nominal", off_nominal: "LOX is warming", violation: "LOX temperature is above the limit" },
  },
  {
    id: "LCC-PROP-07", station: "PROP", label: "All 9 engines ready at T-0", channel: "prop.engines_ready", waivable: false, immediate: true,
    band: (t, c) => (c.clock < T_IGNITION + 2 || c.clock > 0 ? "na" : num(t, "prop.engines_ready") >= 9 ? "nominal" : "violation"),
    text: { nominal: "All engines report ready", off_nominal: "Engines are coming up", violation: "Not all engines reached readiness" },
  },
  {
    id: "LCC-GNC-01", station: "GNC", label: "IMU drift at most 0.05 deg/hr", channel: "gnc.imu_drift", waivable: false, immediate: false,
    band: (t) => range(num(t, "gnc.imu_drift"), 0, 0.03, 0, 0.05),
    text: { nominal: "Inertial alignment is good", off_nominal: "Inertial drift is elevated", violation: "Inertial drift exceeds the limit" },
  },
  {
    id: "LCC-GNC-02", station: "GNC", label: "GPS lock (10 s debounce)", channel: "gnc.gps_lock", waivable: true, immediate: false,
    band: (t) => (t["gnc.gps_lock"] === true ? "nominal" : "violation"),
    text: { nominal: "GPS is locked", off_nominal: "GPS lock is intermittent", violation: "GPS lock lost" },
  },
  {
    id: "LCC-GNC-03", station: "GNC", label: "Trajectory margin at least 15%", channel: "gnc.traj_margin", evidence: ["wx.upper_shear"], waivable: false, immediate: false,
    band: (t) => range(num(t, "gnc.traj_margin"), 25, Infinity, 15, Infinity),
    text: { nominal: "Trajectory margin is healthy", off_nominal: "Trajectory margin is shrinking", violation: "Trajectory margin is below the limit" },
  },
  {
    id: "LCC-RSO-01", station: "RSO", label: "No intrusions in the hazard area", channel: "rso.hazard_intrusions", waivable: false, immediate: true,
    band: (t) => (num(t, "rso.hazard_intrusions") === 0 ? "nominal" : "violation"),
    text: { nominal: "The hazard area is clear", off_nominal: "Traffic near the hazard area", violation: "The hazard area is not clear" },
  },
  {
    id: "LCC-RSO-02", station: "RSO", label: "Flight termination system ready", channel: "rso.fts", waivable: false, immediate: true,
    band: (t) => (t["rso.fts"] === "ready" ? "nominal" : "violation"),
    text: { nominal: "Flight termination system is ready", off_nominal: "Flight termination system check in progress", violation: "Flight termination system fault" },
  },
  {
    id: "LCC-RSO-03", station: "RSO", label: "Tracking locked (degraded is waivable)", channel: "rso.tracking", waivable: (t) => t["rso.tracking"] === "degraded", immediate: false,
    band: (t) => (t["rso.tracking"] === "locked" ? "nominal" : "violation"),
    text: { nominal: "Tracking stations are locked", off_nominal: "Tracking is degraded", violation: "Tracking is not locked" },
  },
];

export const LCC_BY_ID: Record<string, LccDef> = Object.fromEntries(LCCS.map((l) => [l.id, l]));

export function isWaivable(l: LccDef, t: Telemetry): boolean {
  return typeof l.waivable === "function" ? l.waivable(t) : l.waivable;
}

export interface LccRuntime {
  /** Mission elapsed time when each LCC's raw violation began; absent when not violating. */
  since: Record<string, number>;
}

export function createLccRuntime(): LccRuntime {
  return { since: {} };
}

export interface LccResult {
  id: string;
  station: PolledStation;
  band: Band;
  violated: boolean;
  debouncing: boolean;
  waived: boolean;
}

export interface ConflictInput {
  id: string;
  station: PolledStation;
  openedAbs: number;
}

export interface StationEval {
  status: Status;
  /** Most severe first. */
  reasons: Array<{ text: string; lccId?: string; conflictId?: string; severity: number }>;
}

export interface LccEvaluation {
  results: LccResult[];
  stations: Record<PolledStation, StationEval>;
}

/** Evaluates every LCC and derives each station's status. Mutates only the debounce runtime. */
export function evaluateLccs(
  t: Telemetry,
  ctx: LccCtx,
  rt: LccRuntime,
  waived: ReadonlySet<string>,
  conflicts: readonly ConflictInput[],
): LccEvaluation {
  const results: LccResult[] = [];
  const stations: Record<PolledStation, StationEval> = {
    WX: { status: "GO", reasons: [] },
    PROP: { status: "GO", reasons: [] },
    GNC: { status: "GO", reasons: [] },
    RSO: { status: "GO", reasons: [] },
  };
  const rank: Record<Status, number> = { GO: 0, STANDBY: 0, WATCH: 1, NO_GO: 2 };
  const raise = (s: PolledStation, st: Status) => {
    if (rank[st] > rank[stations[s].status]) stations[s].status = st;
  };

  for (const l of LCCS) {
    const band = l.band(t, ctx);
    let violated = false;
    let debouncing = false;
    if (band === "violation") {
      if (rt.since[l.id] === undefined) rt.since[l.id] = ctx.abs;
      violated = l.immediate || ctx.abs - rt.since[l.id] >= DEBOUNCE_SECONDS;
      debouncing = !violated;
    } else {
      delete rt.since[l.id];
    }
    const isWaived = violated && waived.has(l.id);
    results.push({ id: l.id, station: l.station, band, violated, debouncing, waived: isWaived });

    if (violated && !isWaived) {
      raise(l.station, "NO_GO");
      stations[l.station].reasons.push({ text: l.text.violation, lccId: l.id, severity: 2 });
    } else if (violated && isWaived) {
      raise(l.station, "WATCH");
      stations[l.station].reasons.push({ text: `${l.text.violation} (waived)`, lccId: l.id, severity: 1 });
    } else if (debouncing) {
      raise(l.station, "WATCH");
      stations[l.station].reasons.push({ text: `${l.text.violation} (confirming)`, lccId: l.id, severity: 1 });
    } else if (band === "off_nominal") {
      raise(l.station, "WATCH");
      stations[l.station].reasons.push({ text: l.text.off_nominal, lccId: l.id, severity: 0 });
    }
  }

  for (const c of conflicts) {
    const age = ctx.abs - c.openedAbs;
    if (age >= CONFLICT_GRACE_SECONDS) {
      raise(c.station, "NO_GO");
      stations[c.station].reasons.push({ text: "Two sensors disagree and the conflict is unresolved", conflictId: c.id, severity: 2 });
    } else {
      raise(c.station, "WATCH");
      stations[c.station].reasons.push({ text: "Two sensors disagree; awaiting resolution", conflictId: c.id, severity: 1 });
    }
  }
  for (const s of Object.values(stations)) s.reasons.sort((a, b) => b.severity - a.severity);
  return { results, stations };
}
