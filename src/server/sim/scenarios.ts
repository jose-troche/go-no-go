// Anomaly scripts S1 to S6 (spec 9). Server-only: never import from the client.
import type { ScenarioId, ScenarioSetting } from "../../shared/phases";
import { Rng } from "./rng";

export interface ActiveAnomaly {
  id: ScenarioId;
  /** Mission elapsed time when the anomaly started. */
  startAbs: number;
  injected: boolean;
}

/** Count time at which each scheduled anomaly begins. */
export const ANOMALY_START_CLOCK: Record<ScenarioId, number> = {
  S1: -9 * 60,
  S2: -6 * 60,
  S3: -5 * 60,
  S4: -7 * 60,
  S5: -3,
  S6: -8 * 60,
};

/** Resolves a room's scenario setting into the anomalies it will run. Seeded, so "Surprise me" is reproducible. */
export function planScenario(setting: ScenarioSetting, seed: number): ScenarioId[] {
  if (setting === "S0") return [];
  if (setting !== "SURPRISE") return [setting];
  const rng = new Rng(seed ^ 0x5eed);
  const pool: ScenarioId[] = ["S1", "S2", "S3", "S4", "S6"];
  const count = rng.float() < 0.5 ? 1 : 2;
  const picks = rng.shuffle(pool).slice(0, count);
  if (rng.float() < 0.1) picks.push("S5");
  return picks;
}

// ---------- S1: rising upper winds ----------

export function s1Shear(dt: number): number {
  if (dt < 0) return NaN;
  const ease = (a: number, b: number, f: number) => a + (b - a) * (f * f * (3 - 2 * f));
  if (dt < 240) return ease(0.45, 0.78, dt / 240);
  if (dt < 600) return 0.78;
  if (dt < 780) return ease(0.78, 0.55, (dt - 600) / 180);
  return 0.55;
}

// ---------- S2: sensor disagreement ----------

/** Psi of drift added to sensor B, +0.5 psi per sim minute. */
export function s2Drift(dt: number): number {
  return dt < 0 ? 0 : (0.5 * dt) / 60;
}
export const RECALIBRATION_SECONDS = 180;
export const CONFLICT_TOLERANCE_PSI = 3;
export const CONFLICT_GRACE_SECONDS = 60;

// ---------- S3: boat in the hazard area ----------

export { HAZARD_POLYGON } from "../../shared/geo";
export const S3_START: [number, number] = [12, -1.6];
/** km per sim second; crosses the polygon in about 4 sim minutes. */
export const S3_SPEED = 3.2 / 240;

// ---------- S4: lightning nearby ----------

/**
 * A storm cell that lingers near the pad. The first strike at 8 km starts the
 * 15-minute lightning rule; later close strikes restart it, which is what
 * pushes the attempt against the window close (AC-16).
 */
export const S4_STRIKES: ReadonlyArray<{ dt: number; dist: number; bearing: number }> = [
  { dt: 0, dist: 8, bearing: 250 },
  { dt: 70, dist: 14, bearing: 246 },
  { dt: 200, dist: 9, bearing: 241 },
  { dt: 330, dist: 7, bearing: 238 },
  { dt: 470, dist: 12, bearing: 236 },
  { dt: 610, dist: 6, bearing: 233 },
  { dt: 760, dist: 9, bearing: 230 },
  { dt: 900, dist: 13, bearing: 228 },
  { dt: 1040, dist: 8, bearing: 225 },
  { dt: 1200, dist: 17, bearing: 222 },
  { dt: 1360, dist: 26, bearing: 219 },
  { dt: 1520, dist: 35, bearing: 216 },
];
export const LIGHTNING_RULE_SECONDS = 15 * 60;
export const LIGHTNING_RULE_KM = 10;

/** Cloud ceiling under the storm cell, ft. NaN outside its influence. */
export function s4Ceiling(dt: number): number {
  if (dt < 0 || dt > 1300) return NaN;
  if (dt < 180) return 7400 - (3800 * dt) / 180;
  if (dt < 900) return 3600;
  return 3600 + ((7400 - 3600) * (dt - 900)) / 400;
}

// ---------- S5: engine not ready ----------

export const S5_ENGINE_INDEX = 6; // engine 7
export const S5_READINESS = 0.87;
export const ENGINE_READY_THRESHOLD = 0.95;

// ---------- S6: transient glitch ----------

export const S6_DROP_SECONDS = 5;

export function anomalyDt(a: ActiveAnomaly | undefined, abs: number): number {
  return a ? abs - a.startAbs : -1;
}
