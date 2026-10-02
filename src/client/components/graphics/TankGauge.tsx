import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";

/** Two-stage tank schematic with LOX and fuel fill levels (spec G3). */
export function TankGauge({ lox, fuel, restricted }: { lox: number | undefined; fuel: number | undefined; restricted?: boolean }) {
  if (restricted || (lox === undefined && fuel === undefined)) return <Restricted label="Propellant levels: outside your console's view" height={200} />;
  const tank = (x: number, y: number, h: number, pct: number | undefined, color: string, label: string) => {
    const p = Math.max(0, Math.min(100, pct ?? 0));
    return (
      <g>
        <rect x={x} y={y} width={44} height={h} rx={8} fill="none" stroke={TOKENS.line} />
        <rect x={x + 3} y={y + 3 + (h - 6) * (1 - p / 100)} width={38} height={(h - 6) * (p / 100)} rx={5} fill={color} opacity={0.85} />
        <text x={x + 52} y={y + h / 2} fill={TOKENS.line} fontSize={11} fontFamily="Barlow Condensed" dominantBaseline="middle">
          {label} {pct === undefined ? "—" : `${p.toFixed(0)}%`}
        </text>
      </g>
    );
  };
  return (
    <figure style={{ margin: 0 }} aria-label={`LOX ${lox?.toFixed(0) ?? "unknown"} percent, fuel ${fuel?.toFixed(0) ?? "unknown"} percent`}>
      <svg viewBox="0 0 170 220" width="100%" style={{ maxWidth: 220 }} aria-hidden="true">
        <text x={4} y={12} fill={TOKENS.muted} fontSize={10}>Stage 2</text>
        {tank(4, 18, 40, lox, TOKENS.lox, "LOX")}
        {tank(4, 62, 30, fuel, TOKENS.fuel, "Fuel")}
        <text x={4} y={108} fill={TOKENS.muted} fontSize={10}>Stage 1</text>
        {tank(4, 114, 56, lox, TOKENS.lox, "LOX")}
        {tank(4, 174, 40, fuel, TOKENS.fuel, "Fuel")}
      </svg>
    </figure>
  );
}
