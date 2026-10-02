// Headless driver: runs a room with every console on autopilot (plus optional scripted actions)
// and collects the messages each viewer role would receive. Used by `npm run sim` and the tests.
import type { Role } from "../../shared/roles";
import type { ScenarioSetting } from "../../shared/phases";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import type { Principal } from "../policy/policy";
import { Room, type LoggedAction, type RoomConfig } from "./runtime";
import { buildTick, eventFor } from "./egress";

export interface HeadlessOptions {
  scenario: ScenarioSetting;
  seed?: number;
  timescale?: number;
  viewers?: Role[];
  /** Actions to apply before a given tick, keyed by tick number (0 = lobby). */
  script?: Array<{ tick: number; sid: string; nick: string; msg: ClientMsg }>;
  maxTicks?: number;
  /** Called after each tick with the room, for assertions. */
  onTick?: (room: Room) => void;
}

export interface HeadlessResult {
  room: Room;
  log: LoggedAction[];
  messages: Record<string, ServerMsg[]>;
}

export const CREATOR_SID = "s_creator";

export function viewer(role: Role, creator = false): Principal {
  return { sid: `viewer_${role}`, nick: `viewer-${role}`, role, creator };
}

export function runHeadless(opts: HeadlessOptions): HeadlessResult {
  const config: RoomConfig = {
    code: "TEST42",
    seed: opts.seed ?? 42,
    scenario: opts.scenario,
    timescale: opts.timescale ?? 4,
    tickSeconds: 2,
    createdAt: 0,
    creatorSid: CREATOR_SID,
    creatorNick: "director",
  };
  const room = new Room(config);
  room.now = () => 1_700_000_000_000 + room.abs * 1000;
  const log: LoggedAction[] = [];
  const viewers = (opts.viewers ?? []).map((r) => viewer(r));
  const messages: Record<string, ServerMsg[]> = Object.fromEntries(viewers.map((v) => [v.role, []]));

  const flush = () => {
    const events = room.drain();
    for (const v of viewers) {
      for (const ev of events) {
        const m = eventFor(room, v, ev);
        if (m) messages[v.role].push(m);
      }
    }
  };
  const applyAt = (tick: number) => {
    for (const a of opts.script ?? []) {
      if (a.tick !== tick) continue;
      const entry: LoggedAction = { tick: room.ticks, sid: a.sid, nick: a.nick, msg: a.msg };
      log.push(entry);
      room.apply(entry);
      flush();
    }
  };

  applyAt(0);
  if (room.phase === "LOBBY") {
    const start: LoggedAction = { tick: 0, sid: CREATOR_SID, nick: "director", msg: { type: "room.start" } };
    log.push(start);
    room.apply(start);
    flush();
  }
  const max = opts.maxTicks ?? 2000;
  while (room.running && room.ticks < max) {
    applyAt(room.ticks + 1);
    room.tick();
    flush();
    for (const v of viewers) messages[v.role].push(buildTick(room, v));
    opts.onTick?.(room);
  }
  return { room, log, messages };
}

/** Rebuilds a room from config and action log (spec 7.1, 18 resilience). */
export function replay(config: RoomConfig, log: LoggedAction[], ticks: number, now?: (room: Room) => number): Room {
  const room = new Room(config);
  if (now) room.now = () => now(room);
  let i = 0;
  const applyDue = () => {
    while (i < log.length && log[i].tick <= room.ticks) room.apply(log[i++]);
  };
  applyDue();
  while (room.ticks < ticks && (room.running || i < log.length)) {
    if (!room.running && room.phase !== "LOBBY") break;
    room.tick();
    applyDue();
    if (room.phase === "LOBBY" && i >= log.length) break;
  }
  room.drain();
  return room;
}
