import { formatDuration } from "../../../shared/phases";
import { TOKENS } from "../../../shared/tokens";

const WINDOW = 30 * 60;

/** Launch window timeline with the projected liftoff marker (spec G6). */
export function WindowBar({ windowRemaining }: { windowRemaining: number }) {
  const projected = WINDOW - windowRemaining; // seconds after window open
  const late = windowRemaining < 0;
  const x = (s: number) => 24 + (Math.max(-60, Math.min(WINDOW + 200, s)) / WINDOW) * 270;
  return (
    <figure style={{ margin: 0 }} aria-label={`Launch window: ${late ? "projected liftoff is past the window close" : `${formatDuration(windowRemaining)} of slack`}`}>
      <svg viewBox="0 0 340 62" width="100%" aria-hidden="true">
        <line x1={24} x2={294} y1={30} y2={30} stroke={TOKENS.muted} strokeWidth={10} strokeOpacity={0.35} />
        <line x1={24} x2={24} y1={18} y2={42} stroke={TOKENS.line} />
        <line x1={294} x2={294} y1={18} y2={42} stroke={TOKENS.line} />
        <text x={24} y={58} fill={TOKENS.muted} fontSize={13} textAnchor="middle">open</text>
        <text x={294} y={58} fill={TOKENS.muted} fontSize={13} textAnchor="middle">close</text>
        <g transform={`translate(${x(projected)} 30)`}>
          <polygon points="0,-12 6,-20 -6,-20" fill={late ? TOKENS.nogo : TOKENS.accent} />
          <line x1={0} x2={0} y1={-12} y2={10} stroke={late ? TOKENS.nogo : TOKENS.accent} strokeWidth={2} />
        </g>
        <text x={Math.min(250, Math.max(60, x(projected)))} y={11} fill={late ? TOKENS.nogo : TOKENS.line} fontSize={13} textAnchor="middle">projected liftoff</text>
      </svg>
      <figcaption className="small">
        {late ? <span style={{ color: TOKENS.nogo }}>Projected liftoff is {formatDuration(-windowRemaining)} past the window close</span> : <>Window slack <b className="num">{formatDuration(windowRemaining)}</b></>}
      </figcaption>
    </figure>
  );
}
