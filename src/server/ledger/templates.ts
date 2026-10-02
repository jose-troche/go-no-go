// Deterministic callout and promotion templates (spec 10.1, 11.4). LLM text is never promoted.
import { STATION_NAMES, STATUS_LABELS, type Station, type Status } from "../../shared/roles";
import { formatClock, type Phase } from "../../shared/phases";

export const TEMPLATES = {
  status: "tpl.status",
  decision: "tpl.decision",
  poll: "tpl.poll",
  publicPhase: "tpl.public.phase",
  publicWeather: "tpl.public.weather",
  publicRange: "tpl.public.range",
  publicDecision: "tpl.public.decision",
  publicMilestone: "tpl.public.milestone",
} as const;

export function statusCallout(station: Station, status: Status, reason?: string): string {
  const name = STATION_NAMES[station];
  if (status === "GO") return `${name} is GO.`;
  if (status === "WATCH") return `${name} is watching: ${lower(reason ?? "an item is off nominal")}.`;
  if (status === "NO_GO") return `${name} is NO-GO: ${lower(reason ?? "a launch commit criterion is violated")}.`;
  return `${name} is ${STATUS_LABELS[status]}.`;
}

export function phaseCallout(phase: Phase, clock: number): string {
  switch (phase) {
    case "FUELING":
      return `Countdown is underway at ${formatClock(clock)}. Propellant loading in progress.`;
    case "BUILT_IN_HOLD":
      return `Holding at ${formatClock(clock)} for the planned built-in hold.`;
    case "TERMINAL_COUNT":
      return `Terminal count is underway from ${formatClock(clock)}.`;
    case "AUTO_SEQUENCE":
      return "Auto sequence start. The vehicle is in control.";
    case "ASCENT":
      return "Liftoff!";
    case "HOLD":
      return `Holding at ${formatClock(clock)}.`;
    case "PAD_ABORT":
      return "Pad abort. Engines shut down; the vehicle is being safed.";
    case "SCRUB":
      return "The launch attempt is scrubbed.";
    case "ENDED":
      return "Simulation complete.";
    default:
      return "";
  }
}

/** Public statements: deterministic, number-free except the clock. */
export const PUBLIC_STATEMENTS = {
  countdown: "The countdown is underway and propellant loading has begun.",
  builtInHold: "The team is in the planned built-in hold, polling for a go.",
  allGo: "All stations are GO for launch.",
  holding: "The team is holding the count while they work an issue.",
  weatherNoGo: (reason: string) => `Weather is NO-GO: ${lower(reason)}.`,
  weatherLightning: "Weather is NO-GO due to lightning in the area.",
  weatherGo: "Weather is favorable for launch.",
  rangeNotClear: "The range is not yet clear.",
  rangeClear: "The range is clear.",
  resumed: "The count has resumed.",
  recycle: "The team is recycling the count to T-10:00 for another attempt.",
  padAbort: "The engines shut down before liftoff. The vehicle is safe.",
  scrub: "Today's launch attempt has been scrubbed. The vehicle is safe.",
  liftoff: "Liftoff of Kestrel-2 carrying Aurora-3!",
  milestone: (label: string) => `${label}.`,
  end: "Kestrel-2 is on a nominal trajectory, coasting to orbit.",
};

/** Lowercases a leading capital unless it starts an acronym ("LOX", "GPS"). */
export function lower(s: string): string {
  if (!s.length || (s.length > 1 && s[1] === s[1].toUpperCase() && /[A-Z]/.test(s[1]))) return s;
  return s[0].toLowerCase() + s.slice(1);
}
