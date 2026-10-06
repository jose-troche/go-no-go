// Guided walkthrough: spotlights one region at a time with what it is, why it matters, and a workplace equivalent.
import { useEffect, useMemo, useState } from "react";
import { EXPLAIN, TOUR } from "../../content/guide";
import { useReducedMotion } from "../../hooks/motion";
import { useGuide } from "../context";
import { boxOf, ExplainBody, Floating, type Box } from "./Floating";

function findRegion(id: string): Element | null {
  for (const el of document.querySelectorAll(`[data-explain="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) return el;
  }
  return null;
}

export function Tour() {
  const { tourOpen, endTour } = useGuide();
  const reduced = useReducedMotion();
  const steps = useMemo(() => (tourOpen ? TOUR.filter((id) => findRegion(id)) : []), [tourOpen]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const id = steps[i];

  useEffect(() => {
    if (tourOpen) setI(0);
  }, [tourOpen]);

  useEffect(() => {
    if (!tourOpen || !id) return;
    const el = findRegion(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fits = r.height < window.innerHeight - 260;
    el.scrollIntoView({ block: fits ? "center" : "start", behavior: reduced ? "auto" : "smooth" });
    let raf = 0;
    let last = "";
    const measure = () => {
      const cur = findRegion(id);
      if (cur) {
        const b = boxOf(cur, 6);
        const key = `${Math.round(b.top)},${Math.round(b.left)},${Math.round(b.width)},${Math.round(b.height)}`;
        if (key !== last) {
          last = key;
          setBox(b);
        }
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [tourOpen, id, reduced]);

  useEffect(() => {
    if (!tourOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [tourOpen, endTour, steps.length]);

  if (!tourOpen || !id || !box) return null;
  const last = i === steps.length - 1;
  return (
    <div className="tour" data-guide-ui="">
      <div className="tour-blocker" onClick={endTour} />
      <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      <Floating anchor={box} className="tour-card" label={`Tour step ${i + 1} of ${steps.length}`}>
        <div className="tour-step small muted">
          Step {i + 1} of {steps.length}
        </div>
        <ExplainBody e={EXPLAIN[id]} />
        <div className="tour-nav">
          <button className="btn link" onClick={endTour}>
            Skip tour
          </button>
          <span className="spacer" />
          {i > 0 && (
            <button className="btn small" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn small primary" autoFocus onClick={() => (last ? endTour() : setI(i + 1))}>
            {last ? "Start exploring" : "Next"}
          </button>
        </div>
      </Floating>
    </div>
  );
}
