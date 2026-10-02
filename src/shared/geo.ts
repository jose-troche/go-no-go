// Range geography for the map display (km, pad at the origin, launch azimuth along +x).
// Public geography only: no thresholds or scenario scripts.
export const HAZARD_POLYGON: ReadonlyArray<[number, number]> = [
  [6, -1.2],
  [28, -2.6],
  [28, 2.6],
  [6, 1.2],
];
export const COASTLINE: ReadonlyArray<[number, number]> = [
  [2.6, -10],
  [2.2, -6],
  [2.9, -2],
  [2.4, 2],
  [3.1, 6],
  [2.7, 10],
];
export const TRACKING_STATIONS: ReadonlyArray<{ id: string; x: number; y: number }> = [
  { id: "Cape", x: -1.5, y: -3 },
  { id: "North Point", x: -2, y: 6 },
  { id: "Sea Platform", x: 18, y: 7 },
];
