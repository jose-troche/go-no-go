import { createContext, useContext, type ReactNode } from "react";
import type { RoomHandle } from "../hooks/useRoom";

export const RoomCtx = createContext<RoomHandle | null>(null);
export function useRoomCtx(): RoomHandle {
  const r = useContext(RoomCtx);
  if (!r) throw new Error("RoomCtx missing");
  return r;
}

/** True while explain mode is on: concept annotations render inline next to what they explain. */
export const LensCtx = createContext(false);

export interface Guide {
  explain: boolean;
  setExplain(v: boolean): void;
  introOpen: boolean;
  openIntro(): void;
  closeIntro(): void;
  tourOpen: boolean;
  startTour(): void;
  endTour(): void;
}

const noop = () => {};
export const GuideCtx = createContext<Guide>({
  explain: false,
  setExplain: noop,
  introOpen: false,
  openIntro: noop,
  closeIntro: noop,
  tourOpen: false,
  startTour: noop,
  endTour: noop,
});
export const useGuide = () => useContext(GuideCtx);

/** Concept annotation (spec 16.5): only rendered in explain mode. */
export function LensNote({ topic, children }: { topic: string; children: ReactNode }) {
  const on = useContext(LensCtx);
  if (!on) return null;
  return (
    <span className="lens-note" role="note">
      {children}{" "}
      <a href={`/learn#lens-${topic}`} target="_blank" rel="noreferrer">
        Learn more
      </a>
    </span>
  );
}
