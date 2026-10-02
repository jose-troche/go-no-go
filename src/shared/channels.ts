// Channel ids and display metadata only. Thresholds and scenario scripts are server-only (src/server/sim).
export const CHANNELS = [
  "wx.surface_wind",
  "wx.upper_shear",
  "wx.lightning_dist",
  "wx.lightning_clock",
  "wx.strikes",
  "wx.cloud_ceiling",
  "wx.temp",
  "prop.lox_load",
  "prop.fuel_load",
  "prop.lox_psi_a",
  "prop.lox_psi_b",
  "prop.fuel_psi",
  "prop.lox_temp",
  "prop.engines_ready",
  "prop.engine_readiness",
  "gnc.imu_drift",
  "gnc.gps_lock",
  "gnc.traj_margin",
  "rso.hazard_intrusions",
  "rso.fts",
  "rso.tracking",
  "rso.vessels",
  "asc.altitude",
  "asc.velocity",
  "asc.q",
  "pub.fueling",
  "pub.lightning",
] as const;
export type ChannelId = (typeof CHANNELS)[number];
export type TelemetryValue = number | string | boolean;
export type Telemetry = Partial<Record<ChannelId, TelemetryValue>>;

export type Domain = "wx" | "prop" | "gnc" | "rso" | "fd" | "asc" | "sys";

export function channelDomain(c: ChannelId): Domain | "pub" {
  return c.split(".")[0] as Domain | "pub";
}

export const CHANNEL_META: Partial<Record<ChannelId, { label: string; unit: string; digits: number }>> = {
  "wx.surface_wind": { label: "Surface wind", unit: "kt", digits: 0 },
  "wx.upper_shear": { label: "Upper-level shear", unit: "", digits: 2 },
  "wx.lightning_dist": { label: "Nearest lightning", unit: "km", digits: 0 },
  "wx.cloud_ceiling": { label: "Cloud ceiling", unit: "ft", digits: 0 },
  "wx.temp": { label: "Temperature", unit: "°C", digits: 1 },
  "prop.lox_load": { label: "LOX load", unit: "%", digits: 1 },
  "prop.fuel_load": { label: "Fuel load", unit: "%", digits: 1 },
  "prop.lox_psi_a": { label: "LOX pressure A", unit: "psi", digits: 1 },
  "prop.lox_psi_b": { label: "LOX pressure B", unit: "psi", digits: 1 },
  "prop.fuel_psi": { label: "Fuel pressure", unit: "psi", digits: 1 },
  "prop.lox_temp": { label: "LOX temperature", unit: "K", digits: 1 },
  "prop.engines_ready": { label: "Engines ready", unit: "of 9", digits: 0 },
  "gnc.imu_drift": { label: "IMU drift", unit: "deg/hr", digits: 3 },
  "gnc.traj_margin": { label: "Trajectory margin", unit: "%", digits: 1 },
  "rso.hazard_intrusions": { label: "Hazard intrusions", unit: "", digits: 0 },
  "asc.altitude": { label: "Altitude", unit: "km", digits: 1 },
  "asc.velocity": { label: "Velocity", unit: "m/s", digits: 0 },
  "asc.q": { label: "Dynamic pressure", unit: "kPa", digits: 1 },
};

/** Channels kept in the sparkline ring buffer. */
export const HISTORY_CHANNELS: readonly ChannelId[] = [
  "wx.surface_wind",
  "wx.upper_shear",
  "wx.cloud_ceiling",
  "wx.temp",
  "prop.lox_psi_a",
  "prop.lox_psi_b",
  "prop.fuel_psi",
  "prop.lox_temp",
  "gnc.imu_drift",
  "gnc.traj_margin",
  "asc.altitude",
  "asc.velocity",
];
