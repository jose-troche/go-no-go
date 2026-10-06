import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Explainer } from "../../content/guide";

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function boxOf(el: Element, pad = 0): Box {
  const r = el.getBoundingClientRect();
  return { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

const M = 12;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Places a card next to an anchor box: below, above, beside, or inside it when the anchor fills the screen. */
function place(a: Box, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visTop = Math.max(a.top, 0);
  const visBottom = Math.min(a.top + a.height, vh);
  if (vh - visBottom >= h + M + 8) return { top: visBottom + 8, left: clamp(a.left, M, vw - w - M) };
  if (visTop >= h + M + 8) return { top: visTop - h - 8, left: clamp(a.left, M, vw - w - M) };
  const right = a.left + a.width + 8;
  if (vw - right >= w + M) return { top: clamp(visTop, M, vh - h - M), left: right };
  if (a.left - 8 >= w + M) return { top: clamp(visTop, M, vh - h - M), left: a.left - w - 8 };
  return { top: clamp(visTop + M, M, vh - h - M), left: clamp(a.left + M, M, vw - w - M) };
}

/** A card positioned against an anchor box; measures itself so it never spills off screen. */
export function Floating({ anchor, children, className = "", label }: { anchor: Box; children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 340, h: 180 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (Math.abs(w - size.w) > 1 || Math.abs(h - size.h) > 1) setSize({ w, h });
  });
  const pos = place(anchor, size.w, size.h);
  return (
    <div ref={ref} className={`floating ${className}`} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={label} data-guide-ui="">
      {children}
    </div>
  );
}

export function ExplainBody({ e }: { e: Explainer }) {
  return (
    <>
      <h4>{e.title}</h4>
      <p>{e.what}</p>
      {e.why && (
        <p className="why-line">
          <b>Why it matters</b> {e.why}
        </p>
      )}
      {e.atWork && (
        <p className="work-line">
          <b>At work</b> {e.atWork}
        </p>
      )}
    </>
  );
}
