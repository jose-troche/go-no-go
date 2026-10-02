import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";

export interface StrikeView { d: number; b: number; age: number }

/** Top-down lightning radar: rings at 10, 20, 40 km; strikes fade over 2 sim minutes; rule countdown arc (spec G2). */
export function RadarScope({ strikes, ruleRemaining, restricted }: { strikes: StrikeView[] | undefined; ruleRemaining: number | undefined; restricted?: boolean }) {
  if (restricted || !strikes) return <Restricted label="Lightning radar: outside your console's view" height={200} />;
  const R = 90;
  const k = R / 40;
  const frac = Math.max(0, Math.min(1, (ruleRemaining ?? 0) / 900));
  const a1 = -Math.PI / 2 + frac * Math.PI * 2;
  const big = frac > 0.5 ? 1 : 0;
  return (
    <figure style={{ margin: 0, textAlign: "center" }} aria-label={`Lightning radar: ${strikes.length} recent strikes${ruleRemaining ? `, lightning rule active` : ""}`}>
      <svg viewBox="0 0 200 200" width="100%" style={{ maxWidth: 220 }} aria-hidden="true">
        {[10, 20, 40].map((r) => (
          <g key={r}>
            <circle cx={100} cy={100} r={r * k} fill="none" stroke={r === 10 ? TOKENS.nogo : TOKENS.muted} strokeOpacity={r === 10 ? 0.7 : 0.45} strokeDasharray={r === 10 ? "4 3" : undefined} />
            <text x={100 + r * k * 0.71 + 2} y={100 - r * k * 0.71 - 2} fontSize={10} fill={TOKENS.muted}>{r} km</text>
          </g>
        ))}
        <line x1={100} x2={100} y1={10} y2={190} stroke={TOKENS.muted} strokeOpacity={0.25} />
        <line x1={10} x2={190} y1={100} y2={100} stroke={TOKENS.muted} strokeOpacity={0.25} />
        {frac > 0 && <path d={`M 100 ${100 - R - 6} A ${R + 6} ${R + 6} 0 ${big} 1 ${100 + (R + 6) * Math.cos(a1)} ${100 + (R + 6) * Math.sin(a1)}`} fill="none" stroke={TOKENS.watch} strokeWidth={3} />}
        {strikes.map((s, i) => {
          const a = ((s.b - 90) * Math.PI) / 180;
          const d = Math.min(40, s.d) * k;
          const op = Math.max(0.15, 1 - s.age / 120);
          return (
            <g key={i} transform={`translate(${100 + d * Math.cos(a)} ${100 + d * Math.sin(a)})`} opacity={op}>
              <path d="M -3 -6 L 2 -1 L -1 0 L 3 6 L -2 1 L 1 0 Z" fill={TOKENS.watch} />
            </g>
          );
        })}
        <circle cx={100} cy={100} r={3.5} fill={TOKENS.line} />
      </svg>
      <figcaption className="small">
        {ruleRemaining ? <>Lightning rule: <b className="num">{Math.floor(ruleRemaining / 60)}:{String(Math.floor(ruleRemaining % 60)).padStart(2, "0")}</b> remaining</> : "Lightning rule clear"}
      </figcaption>
    </figure>
  );
}
