import { TOKENS } from "../../../shared/tokens";
import { useFrame, useReducedMotion } from "../../hooks/motion";
import { Restricted } from "./Restricted";

/** Artificial horizon whose needle jitter reflects IMU drift (spec G4). */
export function AttitudeIndicator({ drift, restricted }: { drift: number | undefined; restricted?: boolean }) {
  const now = useFrame(30);
  const reduced = useReducedMotion();
  if (restricted || drift === undefined) return <Restricted label="Attitude: outside your console's view" height={160} />;
  const amp = reduced ? 0 : Math.min(8, drift * 160);
  const roll = amp * Math.sin(now / 230) + amp * 0.5 * Math.sin(now / 71);
  const pitch = amp * 0.8 * Math.sin(now / 410);
  return (
    <figure style={{ margin: 0, textAlign: "center" }} aria-label={`Attitude indicator, IMU drift ${drift.toFixed(3)} degrees per hour`}>
      <svg viewBox="0 0 120 120" width="100%" style={{ maxWidth: 170 }} aria-hidden="true">
        <defs><clipPath id="ai-clip"><circle cx={60} cy={60} r={50} /></clipPath></defs>
        <g clipPath="url(#ai-clip)">
          <g transform={`rotate(${roll} 60 60) translate(0 ${pitch})`}>
            <rect x={-40} y={-40} width={200} height={100} fill={TOKENS.lox} fillOpacity={0.25} />
            <rect x={-40} y={60} width={200} height={100} fill={TOKENS.fuel} fillOpacity={0.22} />
            <line x1={-40} x2={160} y1={60} y2={60} stroke={TOKENS.line} />
            {[-20, -10, 10, 20].map((p) => <line key={p} x1={48} x2={72} y1={60 + p} y2={60 + p} stroke={TOKENS.line} strokeOpacity={0.6} />)}
          </g>
        </g>
        <circle cx={60} cy={60} r={50} fill="none" stroke={TOKENS.line} />
        <path d="M 30 60 L 50 60 L 55 66 M 90 60 L 70 60 L 65 66" stroke={TOKENS.accent} strokeWidth={3} fill="none" />
        <circle cx={60} cy={60} r={2.5} fill={TOKENS.accent} />
      </svg>
      <figcaption className="small">IMU drift <b className="num">{drift.toFixed(3)}</b> deg/hr</figcaption>
    </figure>
  );
}
