// Seat inactivity (spec 5, 15; AC-22). Pure helper used by the LaunchRoom tick.
import { STATIONS, type Station } from "../../shared/roles";

export const SEAT_TIMEOUT_MS = 90_000;

/** Seats whose occupant has not sent a heartbeat within the timeout. */
export function staleSeats(seats: Partial<Record<Station, string>>, lastSeen: ReadonlyMap<string, number>, now: number): Station[] {
  return STATIONS.filter((s) => {
    const sid = seats[s];
    if (!sid) return false;
    const seen = lastSeen.get(sid);
    return seen === undefined || now - seen > SEAT_TIMEOUT_MS;
  });
}
