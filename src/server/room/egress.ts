// Per-principal message building. Everything a client receives is assembled here through the policy filter.
import { STATIONS, STATION_NAMES, type Station } from "../../shared/roles";
import type {
  ConflictView,
  FactProjection,
  FilteredRoomState,
  LccView,
  PollView,
  PromptView,
  PublicRoomState,
  ServerMsg,
  StatusView,
  WaiverView,
} from "../../shared/protocol";
import {
  hiddenCount,
  levelFor,
  levelForVisibility,
  principalView,
  project,
  projectHistory,
  projectSignal,
  projectStatuses,
  projectTelemetry,
  type Principal,
} from "../policy/policy";
import { LCCS, LCC_BY_ID, isWaivable } from "../sim/lcc";
import { CONFLICT_GRACE_SECONDS } from "../sim/scenarios";
import type { Room, RoomEvent } from "./runtime";

const SNAPSHOT_FACTS = 400;

export function publicState(room: Room): PublicRoomState {
  const seats: PublicRoomState["seats"] = {};
  for (const s of STATIONS) {
    const sid = room.seats[s];
    if (sid) seats[s] = { nick: room.nicks.get(sid) ?? "operator" };
  }
  return {
    code: room.config.code,
    phase: room.phase,
    seats,
    spectators: 0,
    scenario: room.config.scenario,
    timescale: room.config.timescale,
    creatorNick: room.config.creatorNick,
  };
}

function visibleIds(room: Room, p: Principal, ids: string[]): string[] {
  return ids.filter((id) => {
    const f = room.ledger.get(id);
    return f && levelFor(p, f) !== "NONE";
  });
}

export function statusViews(room: Room, p: Principal): Partial<Record<Station, StatusView>> {
  const raw: Partial<Record<Station, StatusView>> = {};
  for (const s of STATIONS) {
    const st = s === "FD" ? null : room.stations[s];
    const sid = room.seats[s];
    raw[s] = {
      status: room.displayStatus(s),
      reasons: st ? st.reasons.slice(0, 3) : [],
      factIds: st ? visibleIds(room, p, st.factId ? [st.factId, ...st.factIds] : st.factIds) : [],
      operator: sid ? "human" : "agent",
      nick: sid ? room.nicks.get(sid) : undefined,
    };
  }
  return projectStatuses(p, raw);
}

export function pollView(room: Room, p: Principal): PollView | null {
  if (!room.poll || p.role === "PUBLIC") return null;
  const poll = room.poll;
  return {
    id: poll.id,
    state: poll.state,
    result: poll.result,
    openedBy: poll.openedBy,
    calls: poll.calls.map((c) => ({
      station: c.station,
      state: c.state,
      answer: c.answer,
      by: c.by,
      note: c.note,
      deadlineMs: c.deadlineTick !== undefined && c.state === "awaiting_human" ? Math.max(0, (c.deadlineTick - room.ticks) * room.config.tickSeconds * 1000) : undefined,
    })),
  };
}

export function waiverViews(room: Room, p: Principal): WaiverView[] {
  if (p.role === "PUBLIC") return [];
  return [...room.waivers.values()]
    .filter((w) => p.role === "FD" || p.role === w.station)
    .map((w) => ({
      id: w.id,
      lccId: w.lccId,
      lccLabel: LCC_BY_ID[w.lccId]?.label ?? w.lccId,
      station: w.station,
      state: w.state,
      reason: w.reason,
      requestedBy: w.requestedBy,
    }));
}

export function conflictViews(room: Room, p: Principal): ConflictView[] {
  if (p.role !== "FD" && p.role !== "PROP") return [];
  const t = room.telemetry;
  const trustBlocked = room.trustABlocked();
  return [...room.conflicts.values()].map((c) => {
    const view: ConflictView = {
      id: c.id,
      state: c.state,
      station: c.station,
      title: "LOX pressure sensors A and B disagree",
      ageSeconds: Math.round(room.abs - c.openedAbs),
      graceSeconds: CONFLICT_GRACE_SECONDS,
      resolution: c.resolution === "recalibrate_b" ? "Recalibrate sensor B" : c.resolution === "trust_a" ? "Trust sensor A" : undefined,
    };
    const a = t["prop.lox_psi_a"];
    const b = t["prop.lox_psi_b"];
    view.sources = [
      ...(typeof a === "number" ? [{ label: "Sensor A", value: a, unit: "psi" }] : []),
      ...(typeof b === "number" ? [{ label: "Sensor B", value: b, unit: "psi" }] : []),
    ];
    const temp = t["prop.lox_temp"];
    if (typeof temp === "number") view.corroborating = [{ label: "LOX temperature", value: temp, unit: "K", nominal: temp <= 90 }];
    if (c.state === "open") {
      const isHumanProp = p.role === "PROP";
      view.options = [
        {
          choice: "recalibrate_b",
          label: "Recalibrate sensor B",
          consequence: "Fail-safe. Sensor B goes offline for about 3 sim minutes; Propulsion stays NO-GO until it returns.",
          allowed: isHumanProp,
          why: isHumanProp ? undefined : "Only the Propulsion console can resolve this",
        },
        {
          choice: "trust_a",
          label: "Trust sensor A",
          consequence: "Fast. Sensor B is excluded for this attempt; Propulsion returns to GO. Recorded with your name and reason.",
          allowed: isHumanProp && !trustBlocked,
          why: !isHumanProp ? "Human-only decision at the Propulsion console" : (trustBlocked ?? undefined),
        },
      ];
    }
    return view;
  });
}

export function lccViews(room: Room, p: Principal): LccView[] {
  if (p.role === "PUBLIC") return [];
  const waived = room.waivedSet();
  const results = new Map(room.lastEval?.results.map((r) => [r.id, r]) ?? []);
  return LCCS.filter((l) => p.role === "FD" || l.station === p.role).map((l) => ({
    id: l.id,
    label: l.label,
    waivable: isWaivable(l, room.telemetry),
    violated: !!results.get(l.id)?.violated,
    waived: waived.has(l.id),
  }));
}

export function promptsFor(room: Room, p: Principal): PromptView[] {
  const out: PromptView[] = [];
  const poll = room.poll;
  if (poll?.state === "open") {
    const call = poll.calls[poll.cursor];
    if (call?.state === "awaiting_human" && room.seats[call.station] === p.sid && call.deadlineTick !== undefined) {
      const seconds = Math.max(0, (call.deadlineTick - room.ticks) * room.config.tickSeconds);
      out.push({ kind: "poll_confirm", data: { pollId: poll.id, station: call.station, deadlineMs: seconds * 1000, seconds } });
    }
  }
  if (p.role === "PROP") for (const c of conflictViews(room, p)) if (c.state === "open") out.push({ kind: "conflict", data: c });
  if (p.role === "FD") for (const w of waiverViews(room, p)) if (w.state === "requested") out.push({ kind: "waiver_decision", data: w });
  return out;
}

function visibleFacts(room: Room, p: Principal): FactProjection[] {
  const out: FactProjection[] = [];
  for (const f of room.ledger.all()) {
    const proj = project(p, f);
    if (proj) out.push(proj);
  }
  return out.slice(-SNAPSHOT_FACTS);
}

export function buildSnapshot(room: Room, p: Principal): FilteredRoomState {
  return {
    code: room.config.code,
    phase: room.phase,
    simTime: room.clock,
    windowRemaining: room.windowRemaining(),
    windowOpen: room.abs >= 900,
    timescale: room.timescale,
    you: principalView(p),
    seats: publicState(room).seats,
    statuses: statusViews(room, p),
    telemetry: projectTelemetry(p, room.telemetry),
    history: projectHistory(p, room.history),
    facts: visibleFacts(room, p),
    callouts: room.callouts
      .filter((c) => levelForVisibility(p, c.visibility) !== "NONE")
      .map(({ visibility: _v, ...c }) => ({ ...c, factIds: visibleIds(room, p, c.factIds) })),
    poll: pollView(room, p),
    prompts: promptsFor(room, p),
    waivers: waiverViews(room, p),
    conflicts: conflictViews(room, p),
    lccs: lccViews(room, p),
    hiddenCount: hiddenCount(p, room.ledger),
    advice: p.role === "FD" ? room.advice : null,
    scenarioActive: p.creator ? Object.keys(room.anomalies) : null,
    milestone: room.phase === "ASCENT" || room.phase === "ENDED" ? room.milestone : null,
    tags: room.tags(),
  };
}

export function buildTick(room: Room, p: Principal): ServerMsg {
  return {
    type: "tick",
    simTime: room.clock,
    phase: room.phase,
    windowRemaining: room.windowRemaining(),
    windowOpen: room.abs >= 900,
    timescale: room.timescale,
    telemetry: projectTelemetry(p, room.telemetry),
    statuses: statusViews(room, p),
    hiddenCount: hiddenCount(p, room.ledger),
    milestone: room.phase === "ASCENT" || room.phase === "ENDED" ? room.milestone : null,
    tags: room.tags(),
    advice: p.role === "FD" ? room.advice : null,
    lccs: lccViews(room, p),
    conflicts: conflictViews(room, p),
  };
}

/** Converts one room event into the message (if any) this principal may receive. */
export function eventFor(room: Room, p: Principal, ev: RoomEvent): ServerMsg | null {
  switch (ev.e) {
    case "fact": {
      const proj = project(p, ev.fact);
      return proj ? { type: "fact", fact: proj } : null;
    }
    case "callout":
      if (levelForVisibility(p, ev.visibility) === "NONE") return null;
      return { type: "callout", callout: { ...ev.callout, factIds: visibleIds(room, p, ev.callout.factIds) } };
    case "signal": {
      const payload = projectSignal(p, ev.topic, ev.payload);
      return payload ? { type: "signal", topic: ev.topic, payload } : null;
    }
    case "poll": {
      const poll = pollView(room, p);
      return poll ? { type: "poll", poll } : null;
    }
    case "prompt": {
      if (ev.sid !== p.sid) return null;
      const prompt = promptsFor(room, p).find((x) => x.kind === ev.kind);
      return prompt ? { type: "prompt", prompt } : null;
    }
    case "prompt.clear":
      return p.role === "PUBLIC" ? null : { type: "prompt.clear", kind: ev.kind, id: ev.id };
    case "error":
      return ev.sid === p.sid ? { type: "error", code: ev.code, message: ev.message } : null;
    case "waivers":
      return p.role === "PUBLIC" ? null : { type: "waivers", waivers: waiverViews(room, p) };
    default:
      return null;
  }
}

/** Template answer used when the LLM is unavailable (spec 10.1, AC-19). */
export function templateAnswer(facts: FactProjection[], hidden: number): { text: string; factIds: string[] } {
  const top = facts.slice(0, 3);
  if (!top.length) {
    return { text: `Nothing relevant is visible from this console yet.${hidden ? " Some of this is outside your console's view." : ""}`, factIds: [] };
  }
  const lines = top.map((f) => `${f.summary_text} [${f.id}]`);
  return {
    text: `Here is what this console can see: ${lines.join("; ")}.${hidden ? " Some of this is outside your console's view." : ""}`,
    factIds: top.map((f) => f.id),
  };
}

export function stationLabel(s: Station | "SYS"): string {
  return s === "SYS" ? "System" : STATION_NAMES[s];
}
