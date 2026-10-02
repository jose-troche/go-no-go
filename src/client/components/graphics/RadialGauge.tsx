import type { Status } from "../../../shared/roles";
import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";

export interface RadialGaugeProps {
  value: number | undefined;
  min: number;
  max: number;
  nominal?: [number, number];
  limit?: [number, number];
  unit: string;
  label: string;
  status?: Status;
  digits?: number;
  restricted?: boolean;
  size?: number;
  offline?: boolean;
}

const START = -225;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export function RadialGauge({ value, min, max, nominal, limit, unit, label, status, digits = 1, restricted, size = 150, offline }: RadialGaugeProps) {
  if (restricted) return <Restricted label={`${label}: outside your console's view`} height={size * 0.8} />;
  const ang = (v: number) => START + (SWEEP * (Math.max(min, Math.min(max, v)) - min)) / (max - min);
  const cx = 60, cy = 60, r = 46;
  const needle = value === undefined ? null : ang(value);
  const color = status === "NO_GO" ? TOKENS.nogo : status === "WATCH" ? TOKENS.watch : TOKENS.line;
  return (
    <figure style={{ margin: 0, textAlign: "center" }} aria-label={`${label}: ${offline ? "offline" : value === undefined ? "no data" : `${value.toFixed(digits)} ${unit}`}`}>
      <svg viewBox="0 0 120 108" width="100%" style={{ maxWidth: size }} role="img" aria-hidden="true">
        <path d={arc(cx, cy, r, START, START + SWEEP)} fill="none" stroke={TOKENS.muted} strokeOpacity={0.35} strokeWidth={8} />
        {limit && <path d={arc(cx, cy, r, ang(limit[0]), ang(limit[1]))} fill="none" stroke={TOKENS.line} strokeOpacity={0.25} strokeWidth={8} />}
        {nominal && <path d={arc(cx, cy, r, ang(nominal[0]), ang(nominal[1]))} fill="none" stroke={TOKENS.go} strokeOpacity={0.55} strokeWidth={8} />}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const a = START + SWEEP * f;
          const [x0, y0] = polar(cx, cy, r - 7, a);
          const [x1, y1] = polar(cx, cy, r - 12, a);
          return <line key={f} x1={x0} y1={y0} x2={x1} y2={y1} stroke={TOKENS.muted} strokeWidth={1} />;
        })}
        {needle !== null && !offline && (
          <g transform={`rotate(${needle} ${cx} ${cy})`}>
            <line x1={cx} y1={cy} x2={cx + r - 4} y2={cy} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          </g>
        )}
        <circle cx={cx} cy={cy} r={4} fill={TOKENS.line} />
        <text x={cx} y={cy + 26} textAnchor="middle" fill={offline ? TOKENS.watch : TOKENS.line} fontFamily="Barlow Condensed" fontSize={18} fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
          {offline ? "offline" : value === undefined ? "—" : value.toFixed(digits)}
        </text>
        <text x={cx} y={cy + 38} textAnchor="middle" fill={TOKENS.muted} fontSize={9}>{unit}</text>
        <text x={cx - 38} y={104} textAnchor="middle" fill={TOKENS.muted} fontSize={8}>{min}</text>
        <text x={cx + 38} y={104} textAnchor="middle" fill={TOKENS.muted} fontSize={8}>{max}</text>
      </svg>
      <figcaption className="small" style={{ marginTop: -4 }}>{label}</figcaption>
    </figure>
  );
}
