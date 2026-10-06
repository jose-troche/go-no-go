// Explain mode: outlines every explained region with a translucent overlay and a label.
// Hover (or tap) a region for its explanation; click a label to pin it. The UI underneath stays usable.
import { useEffect, useState } from "react";
import { EXPLAIN } from "../../content/guide";
import { useGuide } from "../context";
import { boxOf, ExplainBody, Floating, type Box } from "./Floating";

interface Region {
  el: Element;
  id: string;
  box: Box;
}

function visible(b: Box) {
  return b.width > 4 && b.height > 4 && b.top < window.innerHeight && b.top + b.height > 0;
}

export function ExplainLayer() {
  const { explain, setExplain, tourOpen, introOpen } = useGuide();
  const on = explain && !tourOpen && !introOpen;
  const [regions, setRegions] = useState<Region[]>([]);
  const [hover, setHover] = useState<Element | null>(null);
  const [pinned, setPinned] = useState<Element | null>(null);

  useEffect(() => {
    if (!on) {
      setRegions([]);
      setHover(null);
      setPinned(null);
      return;
    }
    const measure = () => {
      const list: Region[] = [];
      document.querySelectorAll("[data-explain]").forEach((el) => {
        const id = el.getAttribute("data-explain")!;
        if (!EXPLAIN[id]) return;
        const box = boxOf(el);
        if (visible(box)) list.push({ el, id, box });
      });
      setRegions(list);
    };
    measure();
    const t = setInterval(measure, 300);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const track = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.("[data-guide-ui]")) return;
      setHover(target?.closest?.("[data-explain]") ?? null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExplain(false);
    };
    document.addEventListener("pointerover", track);
    document.addEventListener("pointerdown", track);
    document.addEventListener("keydown", key);
    return () => {
      clearInterval(t);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerover", track);
      document.removeEventListener("pointerdown", track);
      document.removeEventListener("keydown", key);
    };
  }, [on, setExplain]);

  if (!on) return null;
  const activeEl = pinned ?? hover;
  const active = regions.find((r) => r.el === activeEl);
  return (
    <div className="explain-layer" aria-live="polite">
      <div className="explain-banner" data-guide-ui="">
        <b>Explain mode</b> Hover or tap any outlined part to see what it shows and why it matters.
        <button className="btn small" onClick={() => setExplain(false)}>Done</button>
      </div>
      {regions.map((r, i) => (
        <div
          key={i}
          className={`explain-box ${r === active ? "active" : ""}`}
          style={{ top: r.box.top, left: r.box.left, width: r.box.width, height: r.box.height }}
        >
          {r === active && <span className="explain-label">{EXPLAIN[r.id].title}</span>}
          <button
            className="explain-badge"
            data-guide-ui=""
            onClick={() => setPinned(pinned === r.el ? null : r.el)}
            onMouseEnter={() => setHover(r.el)}
            aria-label={`Explain: ${EXPLAIN[r.id].title}`}
          >
            ?
          </button>
        </div>
      ))}
      {active && (
        <Floating anchor={active.box} className="explain-card" label={EXPLAIN[active.id].title}>
          <ExplainBody e={EXPLAIN[active.id]} />
          {pinned && (
            <button className="btn small" onClick={() => setPinned(null)}>
              Close
            </button>
          )}
        </Floating>
      )}
    </div>
  );
}
