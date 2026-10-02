// Flight Director agent policies (spec 10.3). A pure function over room state that proposes actions.
// When no human sits at FD the room executes them; with a human FD they are sent as advice.
import type { Phase } from "../../shared/phases";
import type { PolledStation } from "../../shared/roles";
import { T_BUILT_IN_HOLD, T_RECYCLE, WINDOW_CLOSE_ABS } from "../sim/timeline";
import type { AgentCard } from "./types";
import { CARD_PROTOCOL } from "./types";

export const FD_CARD: AgentCard = {
  id: "agent:fd",
  name: "Flight Director agent",
  station: "FD",
  description: "Owns the countdown, the go/no-go poll, and the final decision when no human Flight Director is seated.",
  version: "1.0",
  responsibilities: [
    "Run the poll at the built-in hold and after any hold clears",
    "Call a hold immediately when any station goes NO-GO",
    "Resume only after a poll with all stations GO",
    "Recommend recycle or scrub after a pad abort",
    "Scrub when the window closes",
  ],
  ownedChannels: [],
  subscriptions: ["wx.upper_winds", "wx.lightning", "prop.conflict", "rso.range_status", "station.status"],
  publishes: ["fd.poll", "fd.decision"],
  actions: [
    { id: "poll", description: "Open the go/no-go poll" },
    { id: "hold", description: "Hold the count" },
    { id: "resume", description: "Resume the count after an all-GO poll" },
    { id: "recycle", description: "Recycle to T-10:00" },
    { id: "scrub", description: "Scrub the attempt" },
    { id: "approve_waiver", description: "Approve or deny waivers", requiresHuman: true },
  ],
  policies: ["Never approves waivers: they need a human Flight Director", "Advises instead of acting when a human sits at FD"],
  protocol: CARD_PROTOCOL,
};

export interface FdView {
  phase: Phase;
  clock: number;
  abs: number;
  phaseEnteredAbs: number;
  noGo: PolledStation[];
  pollOpen: boolean;
  /** An all-GO poll has passed and no station has gone NO-GO since. */
  pollPassed: boolean;
  lastPollClosedAbs: number | null;
  holdBeganClock: number | null;
  /** Earliest mission time at which known perishable blocks (lightning rule, recalibration) clear. */
  blockedUntilAbs: number;
}

export type FdActionName = "poll" | "hold" | "resume" | "recycle" | "scrub";
export interface FdProposal {
  action: FdActionName | "recommend_scrub";
  reason: string;
}

const SETTLE_SECONDS = 8;
const REPOLL_SECONDS = 16;
const POLL_ALLOWANCE = 60;

export function holdNeedsPoll(holdBeganClock: number | null): boolean {
  return holdBeganClock !== null && holdBeganClock >= T_BUILT_IN_HOLD;
}

/** Earliest feasible liftoff in mission elapsed time from the current state. */
export function earliestLiftoff(v: Pick<FdView, "abs" | "clock" | "blockedUntilAbs">, needsPoll: boolean): number {
  return Math.max(v.abs, v.blockedUntilAbs) + Math.max(0, -v.clock) + (needsPoll ? POLL_ALLOWANCE : 0);
}

export function fdPolicy(v: FdView): FdProposal | null {
  const settled = v.abs - v.phaseEnteredAbs >= SETTLE_SECONDS;
  const repollOk = v.lastPollClosedAbs === null || v.abs - v.lastPollClosedAbs >= REPOLL_SECONDS;
  const countPhase = v.phase === "FUELING" || v.phase === "TERMINAL_COUNT" || v.phase === "AUTO_SEQUENCE";

  if (countPhase && v.noGo.length) return { action: "hold", reason: `${v.noGo.join(", ")} NO-GO` };

  if (v.phase === "BUILT_IN_HOLD" || v.phase === "HOLD") {
    const needsPoll = v.phase === "BUILT_IN_HOLD" || holdNeedsPoll(v.holdBeganClock);
    const latest = earliestLiftoff(v, needsPoll && !v.pollPassed);
    if (latest > WINDOW_CLOSE_ABS) {
      return { action: "recommend_scrub", reason: "Liftoff can no longer fit inside the launch window" };
    }
    if (v.noGo.length || v.pollOpen || !settled) return null;
    if (!needsPoll) return { action: "resume", reason: "All stations are clear" };
    if (v.pollPassed) return { action: "resume", reason: "All stations are GO" };
    if (repollOk) return { action: "poll", reason: "Stations are clear; polling for a go" };
    return null;
  }

  if (v.phase === "PAD_ABORT") {
    if (v.abs - v.phaseEnteredAbs < 10) return null;
    const recycleLiftoff = v.abs + -T_RECYCLE + POLL_ALLOWANCE + 30;
    if (recycleLiftoff <= WINDOW_CLOSE_ABS) return { action: "recycle", reason: "The window still allows another attempt" };
    return { action: "scrub", reason: "Not enough window left to recycle" };
  }
  return null;
}

export function adviceText(p: FdProposal): string {
  switch (p.action) {
    case "hold":
      return `Recommend: hold. ${p.reason}.`;
    case "poll":
      return `Recommend: start the poll. ${p.reason}.`;
    case "resume":
      return `Recommend: resume the count. ${p.reason}.`;
    case "recycle":
      return `Recommend: recycle to T-10:00. ${p.reason}.`;
    case "scrub":
      return `Recommend: scrub. ${p.reason}.`;
    case "recommend_scrub":
      return `Recommend: scrub. ${p.reason}.`;
  }
}
