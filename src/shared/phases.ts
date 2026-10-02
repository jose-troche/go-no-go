export const PHASES = [
  "LOBBY",
  "FUELING",
  "BUILT_IN_HOLD",
  "TERMINAL_COUNT",
  "AUTO_SEQUENCE",
  "ASCENT",
  "HOLD",
  "PAD_ABORT",
  "SCRUB",
  "ENDED",
] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  LOBBY: "Lobby",
  FUELING: "Fueling",
  BUILT_IN_HOLD: "Built-in hold",
  TERMINAL_COUNT: "Terminal count",
  AUTO_SEQUENCE: "Auto sequence",
  ASCENT: "Ascent",
  HOLD: "Hold",
  PAD_ABORT: "Pad abort",
  SCRUB: "Scrubbed",
  ENDED: "Ended",
};

/** Phases in which the countdown clock advances. */
export const COUNTING_PHASES: readonly Phase[] = ["FUELING", "TERMINAL_COUNT", "AUTO_SEQUENCE", "ASCENT"];
/** Phases in which the server ticks (spec 18). */
export const TICKING_PHASES: readonly Phase[] = [
  "FUELING",
  "BUILT_IN_HOLD",
  "TERMINAL_COUNT",
  "AUTO_SEQUENCE",
  "ASCENT",
  "HOLD",
  "PAD_ABORT",
  "SCRUB",
];

export const SCENARIO_IDS = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "SURPRISE"] as const;
export type ScenarioSetting = (typeof SCENARIO_IDS)[number];
export const ANOMALY_IDS = ["S1", "S2", "S3", "S4", "S5", "S6"] as const;
export type ScenarioId = (typeof ANOMALY_IDS)[number];

export const SCENARIO_LABELS: Record<ScenarioSetting, string> = {
  S0: "Nominal",
  S1: "Rising upper winds",
  S2: "Sensor disagreement",
  S3: "Boat in the hazard area",
  S4: "Lightning nearby",
  S5: "Engine not ready",
  S6: "Transient glitch",
  SURPRISE: "Surprise me",
};

export const TIMESCALES = [1, 2, 4, 8] as const;

/** Formats a count time in seconds relative to T-0 as "T-04:00" / "T+01:02". */
export function formatClock(t: number): string {
  const sign = t < 0 ? "-" : "+";
  const s = Math.abs(Math.round(t < 0 ? Math.ceil(t) : Math.floor(t)));
  const m = Math.floor(s / 60);
  return `T${sign}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  const neg = sec < 0;
  const s = Math.floor(Math.abs(sec));
  const m = Math.floor(s / 60);
  return `${neg ? "-" : ""}${m}:${String(s % 60).padStart(2, "0")}`;
}
