// Keeps the last two telemetry samples so graphics can interpolate between 2-second ticks (guide 8.2).
import type { ChannelId, Telemetry } from "../../shared/channels";

export interface TelemetryStore {
  push(t: Telemetry, at: number, timescale: number): void;
  reset(t: Telemetry, at: number): void;
  /** Linear interpolation for numbers; snaps for booleans and strings. undefined when not visible. */
  value(c: ChannelId, now: number): number | undefined;
  raw(c: ChannelId): Telemetry[ChannelId];
  current(): Telemetry;
}

export const TICK_MS = 2000;

export function createTelemetryStore(): TelemetryStore {
  let prev: Telemetry = {};
  let cur: Telemetry = {};
  let at = 0;
  return {
    push(t, when) {
      prev = cur;
      cur = t;
      at = when;
    },
    reset(t, when) {
      prev = t;
      cur = t;
      at = when;
    },
    value(c, now) {
      const b = cur[c];
      if (typeof b !== "number") return undefined;
      const a = prev[c];
      if (typeof a !== "number") return b;
      const f = Math.max(0, Math.min(1, (now - at) / TICK_MS));
      return a + (b - a) * f;
    },
    raw(c) {
      return cur[c];
    },
    current() {
      return cur;
    },
  };
}
