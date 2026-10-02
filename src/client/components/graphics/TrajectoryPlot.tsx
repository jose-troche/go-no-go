import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";

/** Planned corridor and the predicted path bending with upper-level shear (spec G4). */
export function TrajectoryPlot({ margin, shear, restricted }: { margin: number | undefined; shear: number | undefined; restricted?: boolean }) {
  if (restricted || margin === undefined) return <Restricted label="Trajectory: outside your console's view" height={180} />;
  const s = shear ?? Math.max(0, (40 - margin) / 35);
  const path: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = 20 + t * 260;
    const nominal = 150 - 130 * Math.pow(t, 0.7);
    const bend = s * 46 * Math.pow(t, 1.6);
    path.push(`${x},${nominal + bend}`);
  }
  const corridor = (off: number) => Array.from({ length: 21 }, (_, i) => { const t = i / 20; return `${20 + t * 260},${150 - 130 * Math.pow(t, 0.7) + off * (0.3 + t)}`; });
  const status = margin < 15 ? TOKENS.nogo : margin < 25 ? TOKENS.watch : TOKENS.go;
  return (
    <figure style={{ margin: 0 }} aria-label={`Trajectory margin ${margin.toFixed(1)} percent`}>
      <svg viewBox="0 0 300 170" width="100%" aria-hidden="true">
        <polygon points={[...corridor(-26), ...corridor(26).reverse()].join(" ")} fill={TOKENS.line} fillOpacity={0.08} stroke={TOKENS.muted} strokeOpacity={0.5} />
        <polyline points={path.join(" ")} fill="none" stroke={status} strokeWidth={2.5} />
        <line x1={20} x2={290} y1={160} y2={160} stroke={TOKENS.muted} strokeOpacity={0.4} />
        <text x={24} y={16} fill={TOKENS.muted} fontSize={13}>corridor and predicted path</text>
      </svg>
      <figcaption className="small">Trajectory margin <b className="num" style={{ color: status }}>{margin.toFixed(1)}%</b> <span className="muted">(limit 15%)</span></figcaption>
    </figure>
  );
}

export function GpsConstellation({ locked, restricted }: { locked: boolean | undefined; restricted?: boolean }) {
  if (restricted || locked === undefined) return <Restricted label="GPS: outside your console's view" height={120} />;
  const sats = [[20, 25], [70, 12], [125, 22], [160, 50], [40, 60], [110, 58]];
  return (
    <figure style={{ margin: 0 }} aria-label={`GPS ${locked ? "locked" : "lock lost"}`}>
      <svg viewBox="0 0 180 120" width="100%" style={{ maxWidth: 240 }} aria-hidden="true">
        {sats.map(([x, y], i) => (
          <g key={i}>
            {locked && <line x1={x} y1={y} x2={90} y2={104} stroke={TOKENS.go} strokeOpacity={0.5} strokeDasharray="2 3" />}
            <rect x={x - 4} y={y - 3} width={8} height={6} fill={TOKENS.line} />
            <line x1={x - 10} x2={x + 10} y1={y} y2={y} stroke={TOKENS.line} />
          </g>
        ))}
        <path d="M 86 112 L 90 96 L 94 112 Z" fill={TOKENS.accent} />
      </svg>
      <figcaption className="small">GPS <span className={`lamp ${locked ? "GO" : "WATCH"}`}>{locked ? "locked" : "lock lost"}</span></figcaption>
    </figure>
  );
}
