// Mission clock, phases, and launch window (spec 6).
import type { Phase } from "../../shared/phases";

export const T_START = -15 * 60; // T-15:00
export const T_BUILT_IN_HOLD = -4 * 60; // T-04:00
export const T_AUTO_SEQUENCE = -10; // T-00:10
export const T_ARMS_RETRACT = -30; // T-00:30
export const T_IGNITION = -3; // T-00:03
export const T_ASCENT_END = 4 * 60; // T+04:00
export const T_RECYCLE = -10 * 60; // T-10:00
export const T_FUEL_DONE = -5.5 * 60; // T-05:30

/** Mission elapsed time at which the planned T-0 falls (no planned hold time). */
export const WINDOW_OPEN_ABS = -T_START;
export const WINDOW_LENGTH = 30 * 60;
export const WINDOW_CLOSE_ABS = WINDOW_OPEN_ABS + WINDOW_LENGTH;

export const ASCENT_TIMESCALE = 2;

export const ASCENT_MILESTONES: ReadonlyArray<{ t: number; id: string; label: string }> = [
  { t: 0, id: "liftoff", label: "Liftoff" },
  { t: 62, id: "max_q", label: "Max-Q" },
  { t: 148, id: "meco", label: "Main engine cutoff" },
  { t: 151, id: "stage_sep", label: "Stage separation" },
  { t: 158, id: "ses", label: "Second stage ignition" },
  { t: 190, id: "fairing_sep", label: "Fairing separation" },
  { t: 240, id: "end", label: "Nominal trajectory, coasting to orbit" },
];

export function isCountPhase(p: Phase): boolean {
  return p === "FUELING" || p === "TERMINAL_COUNT" || p === "AUTO_SEQUENCE";
}

export function clockRuns(p: Phase): boolean {
  return isCountPhase(p) || p === "ASCENT";
}

/** Seconds of count remaining before T-0 from a given clock value. */
export function remainingCount(clock: number): number {
  return Math.max(0, -clock);
}

/**
 * Projected liftoff in mission elapsed time. Adds a nominal allowance for the
 * built-in hold poll when the count has not yet passed T-04:00.
 */
export function projectedLiftoff(abs: number, clock: number, phase: Phase): number {
  let extra = 0;
  if (clock <= T_BUILT_IN_HOLD && phase !== "TERMINAL_COUNT" && phase !== "AUTO_SEQUENCE") extra = 60;
  return Math.max(WINDOW_OPEN_ABS, abs + remainingCount(clock) + extra);
}

/** Window slack: how much later than projected liftoff the window closes. */
export function windowRemaining(abs: number, clock: number, phase: Phase): number {
  if (phase === "ASCENT" || phase === "ENDED" || phase === "SCRUB") return 0;
  if (phase === "LOBBY") return WINDOW_LENGTH;
  return WINDOW_CLOSE_ABS - projectedLiftoff(abs, clock, phase);
}

export function ascentProfile(t: number): { altitude: number; velocity: number; q: number } {
  const x = Math.max(0, Math.min(1, t / 240));
  return {
    altitude: 160 * Math.pow(x, 1.9),
    velocity: 7200 * Math.pow(x, 1.6),
    q: t <= 0 ? 0 : 35 * Math.exp(-Math.pow((t - 62) / 30, 2)),
  };
}
