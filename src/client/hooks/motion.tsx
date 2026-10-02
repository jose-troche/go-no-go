// Reduced motion (spec 16.6) and the single shared animation loop (implementation guide 8.2).
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

const MotionCtx = createContext(false);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return <MotionCtx.Provider value={reduced}>{children}</MotionCtx.Provider>;
}

export function useReducedMotion(): boolean {
  return useContext(MotionCtx);
}

// One requestAnimationFrame loop for the page; components subscribe at the rate they need.
type Sub = { fps: number; last: number; fn: () => void };
const subs = new Set<Sub>();
let raf = 0;
let frameNow = typeof performance !== "undefined" ? performance.now() : 0;

function loop(t: number) {
  frameNow = t;
  for (const s of subs) {
    if (t - s.last >= 1000 / s.fps - 1) {
      s.last = t;
      s.fn();
    }
  }
  raf = subs.size ? requestAnimationFrame(loop) : 0;
}

function subscribe(fps: number) {
  return (fn: () => void) => {
    const s: Sub = { fps, last: 0, fn };
    subs.add(s);
    if (!raf) raf = requestAnimationFrame(loop);
    return () => {
      subs.delete(s);
    };
  };
}

const subscribers = new Map<number, (fn: () => void) => () => void>();

/** Returns the current frame time, re-rendering at up to `fps` (4 fps under reduced motion). */
export function useFrame(fps = 60): number {
  const reduced = useReducedMotion();
  const rate = reduced ? Math.min(fps, 4) : fps;
  let sub = subscribers.get(rate);
  if (!sub) {
    sub = subscribe(rate);
    subscribers.set(rate, sub);
  }
  return useSyncExternalStore(sub, () => frameNow, () => 0);
}
