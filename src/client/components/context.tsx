import { createContext, useContext, type ReactNode } from "react";
import type { RoomHandle } from "../hooks/useRoom";

export const RoomCtx = createContext<RoomHandle | null>(null);
export function useRoomCtx(): RoomHandle {
  const r = useContext(RoomCtx);
  if (!r) throw new Error("RoomCtx missing");
  return r;
}

export const LensCtx = createContext(false);

/** Concept lens annotation (spec 16.5): only rendered when the lens is on. */
export function LensNote({ topic, children }: { topic: string; children: ReactNode }) {
  const on = useContext(LensCtx);
  if (!on) return null;
  return (
    <span className="lens-note" role="note">
      {children}{" "}
      <a href={`/#lens-${topic}`} target="_blank" rel="noreferrer">
        Learn more
      </a>
    </span>
  );
}
