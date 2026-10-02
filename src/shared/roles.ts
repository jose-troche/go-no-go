export const STATIONS = ["FD", "WX", "PROP", "GNC", "RSO"] as const;
export type Station = (typeof STATIONS)[number];

/** Stations polled by the Flight Director, in call order (spec 14). */
export const POLLED_STATIONS = ["WX", "PROP", "GNC", "RSO"] as const;
export type PolledStation = (typeof POLLED_STATIONS)[number];

export const ROLES = [...STATIONS, "PUBLIC"] as const;
export type Role = (typeof ROLES)[number];

/** Pseudo-role used in fact visibility for sim-director-only facts. Matched by the creator flag, never by seat. */
export const DIRECTOR = "DIRECTOR" as const;
export type VisibilityRole = Role | typeof DIRECTOR;

export const STATION_NAMES: Record<Station, string> = {
  FD: "Flight Director",
  WX: "Weather",
  PROP: "Propulsion",
  GNC: "Guidance",
  RSO: "Range Safety",
};

export const ROLE_NAMES: Record<Role, string> = { ...STATION_NAMES, PUBLIC: "Public view" };

export const STATUSES = ["GO", "NO_GO", "WATCH", "STANDBY"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  GO: "GO",
  NO_GO: "NO-GO",
  WATCH: "WATCH",
  STANDBY: "STANDBY",
};

export function isStation(x: unknown): x is Station {
  return typeof x === "string" && (STATIONS as readonly string[]).includes(x);
}
