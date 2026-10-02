import { createContext, useContext } from "react";
import type { ChannelId } from "../../shared/channels";
import { useFrame, useReducedMotion } from "./motion";
import { createTelemetryStore, type TelemetryStore } from "./telemetryStore";

export const TelemetryCtx = createContext<TelemetryStore>(createTelemetryStore());

/** Interpolated numeric channel value; undefined when the viewer cannot see the channel. */
export function useInterpolated(channel: ChannelId, fps = 20): number | undefined {
  const store = useContext(TelemetryCtx);
  const now = useFrame(fps);
  const reduced = useReducedMotion();
  if (reduced) {
    const v = store.raw(channel);
    return typeof v === "number" ? v : undefined;
  }
  return store.value(channel, now);
}

export function useTelemetryStore(): TelemetryStore {
  return useContext(TelemetryCtx);
}
