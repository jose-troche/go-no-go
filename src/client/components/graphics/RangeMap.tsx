import { COASTLINE, HAZARD_POLYGON, TRACKING_STATIONS } from "../../../shared/geo";
import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";

export interface VesselView { id: string; k: "vessel" | "aircraft"; x: number; y: number }

/** Top-down range map (spec G5): coast, pad, azimuth, hazard polygon, traffic, tracking lock lines. */
export function RangeMap({ vessels, intrusions, tracking, ascending, altitude, restricted }: {
  vessels: VesselView[] | undefined; intrusions: number | undefined; tracking: string | undefined; ascending?: boolean; altitude?: number; restricted?: boolean;
}) {
  if (restricted || !vessels) return <Restricted label="Range map: outside your console's view" height={220} />;
  const X = (x: number) => 30 + (x + 10) * 9;
  const Y = (y: number) => 110 - y * 9;
  const poly = HAZARD_POLYGON.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  const hot = (intrusions ?? 0) > 0;
  const track = ascending ? Math.min(40, 3 + (altitude ?? 0) * 0.6) : 0;
  return (
    <figure style={{ margin: 0 }} aria-label={`Range map: hazard area ${hot ? "not clear" : "clear"}, ${vessels.length} tracked objects`}>
      <svg viewBox="0 0 420 220" width="100%" aria-hidden="true">
        <path d={`M ${COASTLINE.map(([x, y]) => `${X(x)} ${Y(y)}`).join(" L ")} L 0 ${Y(-10)} L 0 ${Y(10)} Z`} fill={TOKENS.line} fillOpacity={0.06} />
        <polyline points={COASTLINE.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill="none" stroke={TOKENS.line} strokeOpacity={0.7} />
        <line x1={X(0)} y1={Y(0)} x2={X(38)} y2={Y(0)} stroke={TOKENS.muted} strokeDasharray="6 4" />
        <polygon points={poly} fill={hot ? TOKENS.nogo : TOKENS.line} fillOpacity={hot ? 0.28 : 0.07} stroke={hot ? TOKENS.nogo : TOKENS.line} strokeWidth={hot ? 2 : 1} />
        <text x={X(17)} y={Y(3.4)} fill={hot ? TOKENS.nogo : TOKENS.muted} fontSize={10} textAnchor="middle">hazard area</text>
        {TRACKING_STATIONS.map((s) => (
          <g key={s.id}>
            <line x1={X(s.x)} y1={Y(s.y)} x2={X(track)} y2={Y(0)} stroke={tracking === "locked" ? TOKENS.go : TOKENS.watch} strokeOpacity={0.5} strokeDasharray="2 3" />
            <path d={`M ${X(s.x) - 6} ${Y(s.y) + 4} A 6 6 0 0 1 ${X(s.x) + 6} ${Y(s.y) + 4} Z`} fill="none" stroke={TOKENS.line} />
            <text x={X(s.x)} y={Y(s.y) + 15} fill={TOKENS.muted} fontSize={8} textAnchor="middle">{s.id}</text>
          </g>
        ))}
        {ascending && <line x1={X(0)} y1={Y(0)} x2={X(track)} y2={Y(0)} stroke={TOKENS.accent} strokeWidth={3} />}
        <rect x={X(0) - 4} y={Y(0) - 4} width={8} height={8} fill={TOKENS.accent} />
        <text x={X(0)} y={Y(0) + 16} fill={TOKENS.line} fontSize={9} textAnchor="middle">pad</text>
        {vessels.map((v) =>
          v.k === "vessel" ? (
            <g key={v.id} transform={`translate(${X(v.x)} ${Y(v.y)})`}>
              <path d="M -6 -2 L 6 -2 L 4 3 L -4 3 Z" fill={TOKENS.line} />
              <line x1={0} y1={-2} x2={0} y2={-8} stroke={TOKENS.line} />
            </g>
          ) : (
            <g key={v.id} transform={`translate(${X(v.x)} ${Y(v.y)})`}>
              <path d="M -7 0 L 7 0 M 1 -5 L 3 0 L 1 5 M -6 -2 L -5 0 L -6 2" stroke={TOKENS.line} fill="none" strokeWidth={1.5} />
            </g>
          ),
        )}
      </svg>
    </figure>
  );
}
