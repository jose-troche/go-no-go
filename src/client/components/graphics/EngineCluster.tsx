import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";
import { useFrame, useReducedMotion } from "../../hooks/motion";

/** Bottom view: 8 engines in a ring around 1 center engine (spec G3). Engine 7 is index 6. */
export function EngineCluster({ readiness, restricted }: { readiness: number[] | undefined; restricted?: boolean }) {
  const now = useFrame(15);
  const reduced = useReducedMotion();
  if (restricted || !readiness) return <Restricted label="Engine readiness: outside your console's view" height={160} />;
  const pos = [...Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return [60 + 38 * Math.cos(a), 60 + 38 * Math.sin(a)];
  }), [60, 60]];
  const ready = readiness.filter((r) => r >= 0.95).length;
  return (
    <figure style={{ margin: 0, textAlign: "center" }} aria-label={`${ready} of 9 engines ready`}>
      <svg viewBox="0 0 120 120" width="100%" style={{ maxWidth: 170 }} aria-hidden="true">
        <circle cx={60} cy={60} r={56} fill="none" stroke={TOKENS.muted} strokeOpacity={0.5} />
        {pos.map(([x, y], i) => {
          const r = readiness[i] ?? 0;
          const lit = r > 0.05;
          const bad = lit && r < 0.95 && readiness.some((v) => v >= 0.95);
          const flicker = lit && !reduced ? 0.75 + 0.25 * Math.sin(now / 40 + i) : 1;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={11} fill={lit ? (bad ? TOKENS.nogo : TOKENS.accent) : "none"} fillOpacity={lit ? r * flicker : 0} stroke={bad ? TOKENS.nogo : TOKENS.line} strokeWidth={bad ? 2 : 1} />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fill={lit && !bad ? "#1a1208" : TOKENS.line} fontFamily="Barlow Condensed">{i + 1}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="small">
        Engines ready <b className="num">{ready}</b> of 9
        {readiness.some((r, i) => r > 0.05 && r < 0.95 && readiness.some((v) => v >= 0.95) && i >= 0) && <span className="lamp NO_GO" style={{ marginLeft: 8 }}>NO-GO: engine below readiness</span>}
      </figcaption>
    </figure>
  );
}
