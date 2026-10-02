// Action authority matrix (spec 12.4). Each client message type maps to a predicate over (principal, room).
import type { ClientMsg } from "../../shared/protocol";
import type { Phase } from "../../shared/phases";
import type { Station } from "../../shared/roles";
import type { Principal } from "./policy";

export interface AuthorityRoom {
  phase: Phase;
  seats: Partial<Record<Station, string>>;
}

/** Returns null when allowed, otherwise the specific message shown to the user. */
type Check = (p: Principal, msg: ClientMsg, room: AuthorityRoom) => string | null;

const FD_ACTION_NAMES = {
  poll: "start a poll",
  hold: "call a hold",
  resume: "resume the count",
  recycle: "recycle the count",
  scrub: "scrub the launch",
} as const;

const seated = (p: Principal) => p.role !== "PUBLIC";

export const AUTHORITY: Record<ClientMsg["type"], Check> = {
  "seat.claim": () => null,
  "seat.release": (p) => (seated(p) ? null : "You are not seated at a console"),
  heartbeat: () => null,
  "room.start": (p) => (p.creator ? null : "Only the sim director (room creator) can start the countdown"),
  "room.configure": (p) => (p.creator ? null : "Only the sim director (room creator) can change the scenario"),
  "sim.inject": (p) => (p.creator ? null : "Only the sim director (room creator) can inject anomalies"),
  "fd.action": (p, msg) => {
    if (msg.type !== "fd.action") return null;
    return p.role === "FD" ? null : `Only the Flight Director can ${FD_ACTION_NAMES[msg.action]}`;
  },
  "poll.confirm": (p) => (seated(p) && p.role !== "FD" ? null : "Only the seated operator of a polled station can confirm its answer"),
  "waiver.request": (p) => (seated(p) && p.role !== "FD" ? null : "Only the seated operator of the owning station can request a waiver"),
  "waiver.decide": (p) => (p.role === "FD" ? null : "Only a human Flight Director can approve or deny waivers"),
  "conflict.resolve": (p) => (p.role === "PROP" ? null : "Only the Propulsion console can resolve a propulsion sensor conflict"),
  "station.action": (p) => (p.role === "RSO" ? null : "Only Range Safety can contact a vessel"),
  ask: () => null,
  why: () => null,
  "aar.request": () => null,
};

export function checkAuthority(p: Principal, msg: ClientMsg, room: AuthorityRoom): string | null {
  return AUTHORITY[msg.type](p, msg, room);
}
