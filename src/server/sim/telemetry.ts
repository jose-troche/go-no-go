// Channel models (spec 7.3). Pure and deterministic given the seed and step sequence.
import type { Phase, ScenarioId } from "../../shared/phases";
import type { Telemetry } from "../../shared/channels";
import { noise, smoothNoise } from "./rng";
import {
  type ActiveAnomaly,
  HAZARD_POLYGON,
  S3_SPEED,
  S3_START,
  S4_STRIKES,
  S5_ENGINE_INDEX,
  S5_READINESS,
  ENGINE_READY_THRESHOLD,
  S6_DROP_SECONDS,
  LIGHTNING_RULE_KM,
  LIGHTNING_RULE_SECONDS,
  RECALIBRATION_SECONDS,
  anomalyDt,
  s1Shear,
  s2Drift,
  s4Ceiling,
} from "./scenarios";
import { T_FUEL_DONE, T_IGNITION, T_START, ascentProfile } from "./timeline";

export interface Strike {
  abs: number;
  dist: number;
  bearing: number;
}

export interface Vessel {
  id: string;
  kind: "vessel" | "aircraft";
  x: number;
  y: number;
  vx: number;
  vy: number;
  scripted: boolean;
  contacted: boolean;
}

export interface World {
  seed: number;
  loxLoad: number;
  fuelLoad: number;
  loxRate: number;
  strikes: Strike[];
  nextStrike: number;
  lastCloseStrikeAbs: number | null;
  vessels: Vessel[];
  sensorB: "normal" | "recalibrating" | "recalibrated" | "untrusted";
  recalUntil: number | null;
  /** Sensor B drift frozen at this many psi once trusted or recalibrated. */
  engineReadiness: number[];
  engineFault: boolean;
  ignitions: number;
  s5Consumed: boolean;
}

export interface WorldCtx {
  abs: number;
  clock: number;
  phase: Phase;
  anomalies: Partial<Record<ScenarioId, ActiveAnomaly>>;
}

export function createWorld(seed: number): World {
  return {
    seed,
    loxLoad: 0,
    fuelLoad: 0,
    loxRate: 0,
    strikes: [],
    nextStrike: 0,
    lastCloseStrikeAbs: null,
    vessels: [
      { id: "v1", kind: "vessel", x: 15, y: -6.5, vx: 0.004, vy: 0.0005, scripted: false, contacted: false },
      { id: "a1", kind: "aircraft", x: -8, y: 8.5, vx: 0.09, vy: 0, scripted: false, contacted: false },
    ],
    sensorB: "normal",
    recalUntil: null,
    engineReadiness: new Array(9).fill(0),
    engineFault: false,
    ignitions: 0,
    s5Consumed: false,
  };
}

function smoothstep(f: number): number {
  const x = Math.max(0, Math.min(1, f));
  return x * x * (3 - 2 * x);
}

export function pointInPolygon(x: number, y: number, poly: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fuelCurve(clock: number, doneAt: number): number {
  return 100 * smoothstep((clock - T_START) / (doneAt - T_START));
}

/** Advances stateful parts of the world by one sim second. */
export function stepWorld(w: World, ctx: WorldCtx): void {
  const { abs, clock, phase } = ctx;
  const running = phase !== "LOBBY";
  if (!running) return;

  // Fueling: loads rise along an S-curve and never drain; then hold in the replenish band.
  if (phase !== "ASCENT") {
    const prevLox = w.loxLoad;
    const replenish = (stream: string) => 99 + 0.8 * smoothNoise(w.seed, stream, abs, 40);
    w.loxLoad = clock < T_FUEL_DONE ? Math.max(w.loxLoad, fuelCurve(clock, T_FUEL_DONE)) : w.loxLoad >= 97.5 ? replenish("loxrep") : Math.max(w.loxLoad, 98.5);
    w.fuelLoad = clock < T_FUEL_DONE - 30 ? Math.max(w.fuelLoad, fuelCurve(clock, T_FUEL_DONE - 30)) : w.fuelLoad >= 97.5 ? replenish("fuelrep") : Math.max(w.fuelLoad, 98.5);
    w.loxRate = Math.max(0, w.loxLoad - prevLox);
  } else {
    w.loxRate = 0;
  }

  // Lightning (S4).
  const s4 = ctx.anomalies.S4;
  if (s4) {
    const dt = abs - s4.startAbs;
    while (w.nextStrike < S4_STRIKES.length && S4_STRIKES[w.nextStrike].dt <= dt) {
      const s = S4_STRIKES[w.nextStrike];
      const jitter = noise(w.seed, "strike", w.nextStrike);
      const strike = { abs: s4.startAbs + s.dt, dist: Math.max(5.5, s.dist + jitter * 0.8), bearing: s.bearing + jitter * 6 };
      w.strikes.push(strike);
      if (strike.dist < LIGHTNING_RULE_KM) w.lastCloseStrikeAbs = strike.abs;
      w.nextStrike++;
    }
  }
  w.strikes = w.strikes.filter((s) => abs - s.abs < 600);

  // Vessels and aircraft move along straight paths.
  const s3 = ctx.anomalies.S3;
  if (s3 && !w.vessels.some((v) => v.scripted)) {
    w.vessels.push({ id: "v2", kind: "vessel", x: S3_START[0], y: S3_START[1], vx: 0, vy: S3_SPEED, scripted: true, contacted: false });
  }
  for (const v of w.vessels) {
    v.x += v.vx;
    v.y += v.vy;
    if (v.kind === "aircraft" && v.x > 40) v.x = -10;
  }

  // Sensor B recalibration (S2 resolution).
  if (w.sensorB === "recalibrating" && w.recalUntil !== null && abs >= w.recalUntil) {
    w.sensorB = "recalibrated";
    w.recalUntil = null;
  }

  // Engines ramp to readiness over 2 sim seconds from T-00:03.
  if (phase === "AUTO_SEQUENCE" && clock >= T_IGNITION) {
    const ramp = Math.min(1, (clock - T_IGNITION + 1) / 2);
    for (let i = 0; i < 9; i++) {
      const target = w.engineFault && i === S5_ENGINE_INDEX ? S5_READINESS : 0.985 + 0.01 * noise(w.seed, "eng", i + w.ignitions * 9);
      w.engineReadiness[i] = Math.min(target, ramp * target);
    }
  } else if (phase === "ASCENT") {
    w.engineReadiness.fill(1);
  } else if (phase !== "PAD_ABORT") {
    w.engineReadiness.fill(0);
  }
}

/** Called at the moment of ignition. Applies S5 to the first ignition after it activates. */
export function igniteEngines(w: World, ctx: WorldCtx): void {
  w.ignitions++;
  w.engineFault = !!ctx.anomalies.S5 && !w.s5Consumed;
  if (w.engineFault) w.s5Consumed = true;
}

export function startRecalibration(w: World, abs: number): void {
  w.sensorB = "recalibrating";
  w.recalUntil = abs + RECALIBRATION_SECONDS;
}

export function contactVessel(w: World): boolean {
  const v = w.vessels.find((x) => x.scripted && !x.contacted);
  if (!v) return false;
  v.contacted = true;
  v.vy *= 2; // halves the remaining time inside the hazard area
  return true;
}

export function hazardIntruders(w: World): Vessel[] {
  return w.vessels.filter((v) => v.kind === "vessel" && pointInPolygon(v.x, v.y, HAZARD_POLYGON));
}

export function lightningClock(w: World, abs: number): number {
  if (w.lastCloseStrikeAbs === null) return 0;
  return Math.max(0, w.lastCloseStrikeAbs + LIGHTNING_RULE_SECONDS - abs);
}

export function upperShear(w: World, ctx: WorldCtx): number {
  const base = 0.34 + 0.05 * smoothNoise(w.seed, "shear", ctx.abs, 90) + 0.01 * noise(w.seed, "shearN", ctx.abs);
  const s1 = ctx.anomalies.S1;
  if (!s1) return base;
  const v = s1Shear(anomalyDt(s1, ctx.abs));
  return Number.isNaN(v) ? base : v + 0.01 * noise(w.seed, "shearN", ctx.abs);
}

const r = (x: number, d: number) => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

/** Full-detail telemetry at the current sim second. The policy filter decides who sees what. */
export function sampleTelemetry(w: World, ctx: WorldCtx): Telemetry {
  const { abs, clock, phase } = ctx;
  const seed = w.seed;

  const shear = upperShear(w, ctx);
  const surfaceWind = 10 + 3 * smoothNoise(seed, "wind", abs, 120) + 0.8 * noise(seed, "windN", abs);
  const s4 = ctx.anomalies.S4;
  const s4c = s4 ? s4Ceiling(abs - s4.startAbs) : NaN;
  const ceiling = Number.isNaN(s4c) ? 7500 + 600 * smoothNoise(seed, "ceil", abs, 300) : s4c + 120 * smoothNoise(seed, "ceil", abs, 60);
  const temp = 23 + 1.5 * smoothNoise(seed, "temp", abs, 600);
  const recent = w.strikes.filter((s) => abs - s.abs < 300);
  const lightningDist = recent.length ? Math.min(...recent.map((s) => s.dist)) : 99;
  const lClock = lightningClock(w, abs);

  const psiA = 52 + 0.6 * smoothNoise(seed, "psiA", abs, 50) + 0.12 * noise(seed, "psiAn", abs);
  const s2 = ctx.anomalies.S2;
  const drift = s2 && w.sensorB !== "recalibrated" ? s2Drift(abs - s2.startAbs) : 0;
  const psiB: number | string =
    w.sensorB === "recalibrating" ? "offline" : r(psiA + (w.sensorB === "recalibrated" ? 0.1 : 0.8) + drift + 0.12 * noise(seed, "psiBn", abs), 2);

  const s6 = ctx.anomalies.S6;
  const gpsLock = !(s6 && abs - s6.startAbs >= 0 && abs - s6.startAbs < S6_DROP_SECONDS);

  const margin = 40 - 35 * shear + 0.6 * smoothNoise(seed, "margin", abs, 20);
  const intrusions = hazardIntruders(w).length;
  const enginesReady = w.engineReadiness.filter((x) => x >= ENGINE_READY_THRESHOLD).length;

  const t: Telemetry = {
    "wx.surface_wind": r(surfaceWind, 1),
    "wx.upper_shear": r(shear, 3),
    "wx.lightning_dist": r(lightningDist, 1),
    "wx.lightning_clock": Math.round(lClock),
    "wx.strikes": JSON.stringify(recent.map((s) => ({ d: r(s.dist, 1), b: Math.round(s.bearing), age: Math.round(abs - s.abs) }))),
    "wx.cloud_ceiling": Math.round(ceiling),
    "wx.temp": r(temp, 1),
    "prop.lox_load": r(w.loxLoad, 1),
    "prop.fuel_load": r(w.fuelLoad, 1),
    "prop.lox_psi_a": r(psiA, 2),
    "prop.lox_psi_b": psiB,
    "prop.fuel_psi": r(42 + 0.6 * smoothNoise(seed, "fpsi", abs, 45), 2),
    "prop.lox_temp": r(89 + 0.5 * smoothNoise(seed, "ltemp", abs, 200), 2),
    "prop.engines_ready": enginesReady,
    "prop.engine_readiness": w.engineReadiness.map((x) => r(x, 2)).join(","),
    "gnc.imu_drift": r(0.02 + 0.004 * smoothNoise(seed, "imu", abs, 60) + 0.001 * noise(seed, "imuN", abs), 4),
    "gnc.gps_lock": gpsLock,
    "gnc.traj_margin": r(margin, 1),
    "rso.hazard_intrusions": intrusions,
    "rso.fts": "ready",
    "rso.tracking": "locked",
    "rso.vessels": JSON.stringify(w.vessels.map((v) => ({ id: v.id, k: v.kind, x: r(v.x, 2), y: r(v.y, 2) }))),
    "pub.fueling": Math.round(((w.loxLoad + w.fuelLoad) / 2) / 5) * 5,
    "pub.lightning": lClock > 0 || lightningDist < 20 ? "nearby" : "clear",
  };
  if (phase === "ASCENT") {
    const p = ascentProfile(clock);
    t["asc.altitude"] = r(p.altitude, 2);
    t["asc.velocity"] = Math.round(p.velocity);
    t["asc.q"] = r(p.q, 1);
  }
  return t;
}
