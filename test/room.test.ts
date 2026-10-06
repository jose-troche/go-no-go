import { describe, expect, it } from "vitest";
import { Room, type LoggedAction } from "../src/server/room/runtime";
import { CREATOR_SID } from "../src/server/room/headless";
import { staleSeats, SEAT_TIMEOUT_MS } from "../src/server/room/heartbeat";
import { eventFor, buildSnapshot } from "../src/server/room/egress";
import type { ClientMsg } from "../src/shared/protocol";
import type { ScenarioSetting } from "../src/shared/phases";

function makeRoom(scenario: ScenarioSetting = "S0") {
  const room = new Room({ code: "ROOM42", seed: 42, scenario, timescale: 4, tickSeconds: 2, createdAt: 0, creatorSid: CREATOR_SID, creatorNick: "director" });
  room.now = () => 1000 + room.abs;
  const act = (sid: string, nick: string, msg: ClientMsg) => {
    const entry: LoggedAction = { tick: room.ticks, sid, nick, msg };
    const res = room.apply(entry);
    return { res, events: room.drain() };
  };
  const runUntil = (pred: (r: Room) => boolean, max = 3000) => {
    for (let i = 0; i < max && room.running && !pred(room); i++) room.tick();
    room.drain();
  };
  return { room, act, runUntil };
}

describe("authority (AC-10)", () => {
  it("rejects a hold from a non-FD participant and logs a fact visible to FD", () => {
    const { room, act, runUntil } = makeRoom();
    act("s_wx", "wendy", { type: "seat.claim", station: "WX" });
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.clock > -800);
    const { res, events } = act("s_wx", "wendy", { type: "fd.action", action: "hold" });
    expect(res.ok).toBe(false);
    const err = events.find((e) => e.e === "error");
    expect(err && err.e === "error" && err.message).toBe("Only the Flight Director can call a hold");
    const fact = events.find((e) => e.e === "fact");
    expect(fact && fact.e === "fact" && fact.fact.visibility.full).toEqual(["FD"]);
    expect(room.phase).toBe("FUELING");
  });
  it("only the creator can start or inject", () => {
    const { act } = makeRoom();
    expect(act("s_other", "x", { type: "room.start" }).res.ok).toBe(false);
    expect(act(CREATOR_SID, "director", { type: "room.start" }).res.ok).toBe(true);
    expect(act("s_other", "x", { type: "sim.inject", scenario: "S1" }).res.ok).toBe(false);
  });
  it("a human FD can hold and the agent cannot resume over them", () => {
    const { room, act, runUntil } = makeRoom();
    act("s_fd", "flo", { type: "seat.claim", station: "FD" });
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.clock > -800);
    expect(act("s_fd", "flo", { type: "fd.action", action: "hold" }).res.ok).toBe(true);
    expect(room.phase).toBe("HOLD");
    for (let i = 0; i < 20; i++) room.tick();
    expect(room.phase).toBe("HOLD");
    expect(room.advice).toMatch(/resume/i);
    expect(act("s_fd", "flo", { type: "fd.action", action: "resume" }).res.ok).toBe(true);
    expect(room.phase).toBe("FUELING");
  });
});

describe("seats", () => {
  it("one human per console; switching releases the old seat", () => {
    const { room, act } = makeRoom();
    act("a", "ann", { type: "seat.claim", station: "WX" });
    expect(act("b", "bob", { type: "seat.claim", station: "WX" }).res.ok).toBe(false);
    act("a", "ann", { type: "seat.claim", station: "GNC" });
    expect(room.seats.WX).toBeUndefined();
    expect(room.seats.GNC).toBe("a");
    expect(room.principal("a").role).toBe("GNC");
    expect(room.principal("b").role).toBe("PUBLIC");
  });
  it("AC-22: stale seats are released and the agent announces autopilot", () => {
    const { room, act } = makeRoom();
    act("a", "ann", { type: "seat.claim", station: "WX" });
    const lastSeen = new Map([["a", 0]]);
    expect(staleSeats(room.seats, lastSeen, SEAT_TIMEOUT_MS - 1)).toEqual([]);
    expect(staleSeats(room.seats, lastSeen, SEAT_TIMEOUT_MS + 1)).toEqual(["WX"]);
    const { events } = act("system", "", { type: "seat.timeout", station: "WX" } as never);
    expect(room.seats.WX).toBeUndefined();
    const callout = events.find((e) => e.e === "callout");
    expect(callout && callout.e === "callout" && callout.callout.text).toBe("Weather console is back on autopilot.");
  });
});

describe("waivers (AC-11)", () => {
  it("records a request without a human FD and explains why it cannot be approved", () => {
    const { room, act, runUntil } = makeRoom("S4");
    act("w", "wendy", { type: "seat.claim", station: "WX" });
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.lastEval?.results.find((x) => x.id === "LCC-WX-04")?.violated === true);
    const { res, events } = act("w", "wendy", { type: "waiver.request", lccId: "LCC-WX-04", reason: "Clouds are thin" });
    expect(res.ok).toBe(true);
    expect(room.waivers.size).toBe(1);
    const err = events.find((e) => e.e === "error");
    expect(err && err.e === "error" && err.code).toBe("waiver_needs_human_fd");
    // Lightning is not waivable.
    expect(act("w", "wendy", { type: "waiver.request", lccId: "LCC-WX-03", reason: "x" }).res.ok).toBe(false);
  });
  it("a human FD can approve; the waived LCC no longer forces NO-GO", () => {
    const { room, act, runUntil } = makeRoom("S4");
    act("w", "wendy", { type: "seat.claim", station: "WX" });
    act("f", "flo", { type: "seat.claim", station: "FD" });
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.lastEval?.results.find((x) => x.id === "LCC-WX-04")?.violated === true);
    const req = act("w", "wendy", { type: "waiver.request", lccId: "LCC-WX-04", reason: "Clouds are thin" });
    expect(req.events.some((e) => e.e === "prompt" && e.sid === "f" && e.kind === "waiver_decision")).toBe(true);
    const id = [...room.waivers.keys()][0];
    expect(act("w", "wendy", { type: "waiver.decide", waiverId: id, approve: true, reason: "" }).res.ok).toBe(false);
    expect(act("f", "flo", { type: "waiver.decide", waiverId: id, approve: true, reason: "Accept thin layer" }).res.ok).toBe(true);
    room.tick();
    expect(room.lastEval?.results.find((x) => x.id === "LCC-WX-04")?.waived).toBe(true);
  });
});

describe("poll confirmation (AC-12)", () => {
  it("a seated GO station that does not confirm within 20 seconds answers STANDBY", () => {
    const { room, act, runUntil } = makeRoom();
    act("g", "gus", { type: "seat.claim", station: "GNC" });
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.poll?.calls.find((c) => c.station === "GNC")?.state === "awaiting_human");
    expect(room.displayStatus("GNC")).toBe("STANDBY");
    runUntil((r) => r.poll?.state === "closed");
    const call = room.poll!.calls.find((c) => c.station === "GNC")!;
    expect(call.answer).toBe("STANDBY");
    expect(room.poll!.result).toBe("NOT_GO");
    expect(room.phase).toBe("BUILT_IN_HOLD");
  });
  it("confirming in time answers GO", () => {
    const { room, act, runUntil } = makeRoom();
    act("g", "gus", { type: "seat.claim", station: "GNC" });
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.poll?.calls.find((c) => c.station === "GNC")?.state === "awaiting_human");
    const snap = buildSnapshot(room, room.principal("g"));
    expect(snap.prompts.some((p) => p.kind === "poll_confirm")).toBe(true);
    act("g", "gus", { type: "poll.confirm", pollId: room.poll!.id });
    runUntil((r) => r.phase === "TERMINAL_COUNT");
    expect(room.phase).toBe("TERMINAL_COUNT");
  });
});

describe("conflicts with a human (AC-09)", () => {
  it("Trust sensor A records nickname, seat, and reason, and PROP returns to GO", () => {
    const { room, act, runUntil } = makeRoom("S2");
    act("p", "pat", { type: "seat.claim", station: "PROP" });
    act(CREATOR_SID, "director", { type: "room.start" });
    // Confirm poll answers when asked so the count proceeds.
    runUntil((r) => {
      const c = r.poll?.state === "open" ? r.poll.calls[r.poll.cursor] : undefined;
      if (c?.state === "awaiting_human") r.apply({ tick: r.ticks, sid: "p", nick: "pat", msg: { type: "poll.confirm", pollId: r.poll!.id } });
      return r.openConflicts().length > 0;
    });
    const c = room.openConflicts()[0];
    expect(c).toBeDefined();
    const { res, events } = act("p", "pat", { type: "conflict.resolve", conflictId: c.id, choice: "trust_a", reason: "Temperature corroborates A" });
    expect(res.ok).toBe(true);
    const d = events.find((e) => e.e === "fact" && e.fact.kind === "decision");
    const v = d && d.e === "fact" ? (d.fact.value as Record<string, unknown>) : {};
    expect(v).toMatchObject({ nick: "pat", seat: "PROP", reason: "Temperature corroborates A", choice: "trust_a" });
    for (let i = 0; i < 3; i++) room.tick();
    expect(room.stations.PROP.status).toBe("GO");
  });
  it("trust_a from a non-PROP seat is denied", () => {
    const { act } = makeRoom("S2");
    act("w", "wendy", { type: "seat.claim", station: "WX" });
    expect(act("w", "wendy", { type: "conflict.resolve", conflictId: "c_1", choice: "trust_a" }).res.ok).toBe(false);
  });
});

describe("event projection", () => {
  it("errors only go to the actor", () => {
    const { room, act } = makeRoom();
    const { events } = act("x", "xena", { type: "fd.action", action: "hold" });
    const err = events.find((e) => e.e === "error")!;
    expect(eventFor(room, room.principal("x"), err)).not.toBeNull();
    expect(eventFor(room, room.principal("y"), err)).toBeNull();
  });
});

describe("watching a console (observe)", () => {
  it("grants the console's view but none of its authority, and the agent keeps operating", () => {
    const { room, act, runUntil } = makeRoom("S1");
    act("s_viewer", "vic", { type: "room.observe", station: "FD" });
    const p = room.principal("s_viewer");
    expect(p).toMatchObject({ role: "FD", seated: false });
    expect(room.humanAt("FD")).toBe(false);
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.clock > -800);
    const { res, events } = act("s_viewer", "vic", { type: "fd.action", action: "hold" });
    expect(res.ok).toBe(false);
    const err = events.find((e) => e.e === "error");
    expect(err && err.e === "error" && err.message).toMatch(/watching Flight Director/);
    // Full FD visibility: Weather's raw shear is in the snapshot.
    expect(buildSnapshot(room, p).telemetry["wx.upper_shear"]).toBeTypeOf("number");
    // The FD agent still runs the mission on its own.
    runUntil((r) => r.phase === "HOLD");
    expect(room.phase).toBe("HOLD");
  });
  it("cannot watch a console a person operates, and watchers are bumped when someone takes control", () => {
    const { room, act } = makeRoom();
    act("s_a", "ann", { type: "room.observe", station: "WX" });
    const { events } = act("s_b", "bob", { type: "seat.claim", station: "WX" });
    expect(room.principal("s_a").role).toBe("PUBLIC");
    expect(events.some((e) => e.e === "seat" && e.sid === "s_a")).toBe(true);
    expect(act("s_a", "ann", { type: "room.observe", station: "WX" }).res.ok).toBe(false);
  });
  it("switching from operating to watching releases the seat", () => {
    const { room, act } = makeRoom();
    act("s_a", "ann", { type: "seat.claim", station: "PROP" });
    act("s_a", "ann", { type: "room.observe", station: "PROP" });
    expect(room.humanAt("PROP")).toBe(false);
    expect(room.principal("s_a")).toMatchObject({ role: "PROP", seated: false });
    act("s_a", "ann", { type: "room.observe", station: null });
    expect(room.principal("s_a").role).toBe("PUBLIC");
  });
});

describe("speed changes mid-mission", () => {
  it("applies a new timescale to later ticks but refuses a scenario change", () => {
    const { room, act, runUntil } = makeRoom();
    act(CREATOR_SID, "director", { type: "room.start" });
    runUntil((r) => r.clock > -880);
    expect(act(CREATOR_SID, "director", { type: "room.configure", timescale: 8 }).res.ok).toBe(true);
    const before = room.clock;
    room.tick();
    expect(room.clock - before).toBe(16);
    expect(act(CREATOR_SID, "director", { type: "room.configure", scenario: "S2" }).res.ok).toBe(false);
  });
});
