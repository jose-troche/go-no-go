// G1: the rocket and pad, the one hero element (spec 16.4). Flat fills, thin strokes, SVG only.
import type { Phase } from "../../../shared/phases";
import { TOKENS } from "../../../shared/tokens";
import type { ReactElement } from "react";
import { useFrame, useReducedMotion } from "../../hooks/motion";

export interface RocketSceneProps {
  phase: Phase;
  /** Mission time relative to T-0, locally interpolated. */
  clock: number;
  tags: string[];
  milestone?: string | null;
  windKt?: number;
  ceilingFt?: number;
  /** Average propellant load, 0..100, for vapor intensity. */
  fueling?: number;
  lightning?: boolean;
  altitudeKm?: number;
  dawn?: boolean;
  showLabels?: boolean;
}

const W = 400;
const H = 500;
const PAD_Y = 430;
const PARTICLES = 48;
const EXT = 1200;

function lerpColor(a: string, b: string, f: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * Math.max(0, Math.min(1, f))));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function skyColor(altKm: number, dawn: boolean): string {
  const ground = dawn ? "#2b4f77" : "#2d5d8c";
  if (altKm < 12) return lerpColor(ground, "#1c2f66", altKm / 12);
  if (altKm < 50) return lerpColor("#1c2f66", "#0a0f24", (altKm - 12) / 38);
  return lerpColor("#0a0f24", "#03050c", (altKm - 50) / 60);
}

/** Deterministic pseudo-random in [0, 1) for particle seeds. */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function RocketScene(props: RocketSceneProps) {
  const reduced = useReducedMotion();
  const now = useFrame(reduced ? 4 : 60);
  const { phase, clock, tags, milestone, windKt = 8, ceilingFt, fueling = 0, lightning, altitudeKm = 0, dawn = false, showLabels = true } = props;

  const ascending = phase === "ASCENT" || (phase === "ENDED" && altitudeKm > 0);
  const t = ascending ? Math.max(0, clock) : 0;
  const ignition = phase === "AUTO_SEQUENCE" && clock >= -3;
  const padAbort = phase === "PAD_ABORT";
  const scrubbed = tags.includes("Scrubbed");
  const armsOut = !(phase === "AUTO_SEQUENCE" || ascending || (phase === "TERMINAL_COUNT" && clock >= -30) || tags.includes("Arms retracted"));
  const meco = t >= 148 && t < 158;
  const staged = t >= 151;
  const fairingSep = t >= 190;
  const engineOn = ignition || (ascending && !meco && phase !== "ENDED") || (phase === "ENDED" && ascending && false);

  // Camera follow: the rocket climbs to 40% of the frame, then the world scrolls.
  const altPx = altitudeKm * 380;
  const rise = reduced ? (ascending ? 200 : 0) : Math.min(altPx, 200);
  const scroll = reduced ? (ascending ? 900 : 0) : Math.max(0, altPx - 200);
  const sky = skyColor(altitudeKm, dawn);
  const stars = altitudeKm > 30 ? Math.min(1, (altitudeKm - 30) / 30) : 0;

  const flicker = reduced ? 1 : 0.82 + 0.18 * Math.sin(now / 33) * Math.sin(now / 17);
  const windAngle = Math.max(-75, Math.min(75, (windKt / 25) * 70));

  // Vapor: rate tracks loading during fueling, steady venting in holds, steam after a pad abort.
  const venting = !ascending && phase !== "LOBBY" && phase !== "ENDED" && !ignition;
  let vaporRate = 0;
  if (venting) vaporRate = phase === "FUELING" ? 0.35 + 0.65 * Math.min(1, fueling / 60) : scrubbed ? 0.25 : 0.55;
  if (dawn) vaporRate = 0.55;
  if (padAbort) vaporRate = 1;

  const rocketX = 180;
  const rocketBaseY = PAD_Y - rise;
  const groundY = PAD_Y + scroll;

  const particles: ReactElement[] = [];
  if (!reduced && vaporRate > 0) {
    const n = Math.round(PARTICLES * vaporRate);
    for (let i = 0; i < n; i++) {
      const life = 2600 + hash(i) * 1800;
      const age = ((now + hash(i + 50) * life) % life) / life;
      const fromTop = i % 3 !== 0;
      const sx = rocketX + (fromTop ? 10 : -12 + hash(i + 9) * 24);
      const sy = fromTop ? rocketBaseY - 150 + hash(i + 3) * 30 : groundY - 6;
      const drift = (windKt / 12) * 70 * age;
      const x = sx + drift + (hash(i + 7) - 0.5) * 30 * age;
      const y = sy - (fromTop ? 18 : 30) * age + (fromTop ? 22 * age * age : 0);
      const r = (padAbort ? 14 : 5) + age * (padAbort ? 30 : 14);
      particles.push(<circle key={i} cx={x} cy={y} r={r} fill="#f4f8fb" opacity={(1 - age) * (padAbort ? 0.5 : 0.35)} />);
    }
  }

  // Exhaust plume particles during ascent (skipped in reduced motion).
  const exhaust: ReactElement[] = [];
  if (!reduced && engineOn && ascending && t < 40) {
    for (let i = 0; i < 24; i++) {
      const life = 1200 + hash(i + 90) * 900;
      const age = ((now + hash(i + 120) * life) % life) / life;
      exhaust.push(<circle key={i} cx={rocketX + (hash(i) - 0.5) * 60 * age} cy={groundY - 4 - 10 * age} r={8 + 26 * age} fill="#e9eef3" opacity={(1 - age) * 0.4 * Math.max(0, 1 - t / 40)} />);
    }
  }

  const flash = lightning && !reduced && (Math.floor(now / 170) % 23 === 0 || Math.floor(now / 130) % 37 === 0);
  const cloudY = ceilingFt ? Math.max(30, PAD_Y - 60 - ((ceilingFt - 2000) / 8000) * 300) + scroll * 0.4 : null;

  const label = showLabels ? tags.find((x) => x === "Holding" || x === "Scrubbed" || x === "Vehicle safe") : undefined;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMax meet" overflow="hidden" role="img" aria-label={sceneLabel(phase, milestone, tags)}>
      {/* The sky and grid extend past the viewBox so wide or tall containers stay filled. */}
      <rect x={-EXT} y={-EXT} width={W + 2 * EXT} height={H + EXT} fill={flash ? lerpColor(sky, "#c9d6ff", 0.35) : sky} />
      <g stroke={TOKENS.line} strokeOpacity={0.05}>
        {Array.from({ length: Math.ceil((W + 2 * EXT) / 16) }, (_, i) => <line key={`v${i}`} x1={i * 16 - EXT} x2={i * 16 - EXT} y1={-EXT} y2={H} />)}
        {Array.from({ length: Math.ceil((H + EXT) / 16) }, (_, i) => <line key={`h${i}`} x1={-EXT} x2={W + EXT} y1={i * 16 - EXT} y2={i * 16 - EXT} />)}
      </g>
      {stars > 0 &&
        Array.from({ length: 120 }, (_, i) => <circle key={i} cx={hash(i + 200) * (W + 800) - 400} cy={hash(i + 400) * (H + 300) * 0.8 - 300} r={hash(i + 600) * 1.3 + 0.3} fill="#fff" opacity={stars * (0.4 + 0.6 * hash(i + 800))} />)}
      {dawn && <circle cx={330} cy={PAD_Y - 10} r={26} fill={TOKENS.accent} opacity={0.55} />}

      {lightning && (
        <g opacity={flash ? 1 : 0.35}>
          <path d="M 330 120 L 318 160 L 328 162 L 312 205" stroke={TOKENS.watch} strokeWidth={2} fill="none" />
        </g>
      )}
      {cloudY !== null && (
        <g fill="#e6edf3" opacity={0.22}>
          <ellipse cx={-160} cy={cloudY + 4} rx={110} ry={11} />
          <ellipse cx={560} cy={cloudY - 2} rx={120} ry={12} />
          <ellipse cx={80} cy={cloudY} rx={70} ry={10} />
          <ellipse cx={300} cy={cloudY + 8} rx={90} ry={12} />
          <ellipse cx={200} cy={cloudY - 6} rx={40} ry={7} />
        </g>
      )}

      {/* ground and pad */}
      <g transform={`translate(0 ${groundY - PAD_Y})`}>
        <rect x={-EXT} y={PAD_Y} width={W + 2 * EXT} height={H} fill="#0c1f35" />
        <line x1={-EXT} x2={W + EXT} y1={PAD_Y} y2={PAD_Y} stroke={TOKENS.line} strokeOpacity={0.6} />
        <rect x={rocketX - 46} y={PAD_Y - 8} width={92} height={8} fill="none" stroke={TOKENS.line} />
        {/* tower */}
        <g stroke={TOKENS.line} strokeWidth={1.2} fill="none">
          <rect x={232} y={PAD_Y - 230} width={22} height={222} />
          {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M 232 ${PAD_Y - 230 + i * 20} L 254 ${PAD_Y - 210 + i * 20}`} />)}
          <g transform={`rotate(${armsOut ? 0 : -52} 232 ${PAD_Y - 205})`}>
            <rect x={196} y={PAD_Y - 208} width={36} height={6} fill={TOKENS.panel} />
          </g>
          <g transform={`rotate(${armsOut ? 0 : -58} 232 ${PAD_Y - 120})`}>
            <rect x={196} y={PAD_Y - 123} width={36} height={6} fill={TOKENS.panel} />
          </g>
          <line x1={243} y1={PAD_Y - 230} x2={243} y2={PAD_Y - 262} />
        </g>
        {/* flag follows surface wind */}
        <g transform={`translate(243 ${PAD_Y - 260}) rotate(${windAngle})`}>
          <path d={`M 0 0 L 18 3 L 0 8 Z`} fill={TOKENS.accent} />
        </g>
        {exhaust}
      </g>

      {particles}

      {/* rocket */}
      <g transform={`translate(0 ${-rise})`}>
        {/* first stage (falls away after separation) */}
        <g transform={staged ? `translate(${reduced ? -60 : -Math.min(80, (t - 151) * 3)} ${reduced ? 120 : Math.min(400, (t - 151) * (t - 151) * 0.8)}) rotate(${staged ? Math.min(40, (t - 151) * 2) : 0} ${rocketX} ${PAD_Y - 60})` : undefined} opacity={staged ? Math.max(0, 1 - (t - 151) / 12) : 1}>
          <rect x={rocketX - 14} y={PAD_Y - 150} width={28} height={140} fill="#e9eef3" stroke={TOKENS.bg} />
          <rect x={rocketX - 14} y={PAD_Y - 90} width={28} height={6} fill={TOKENS.bg} opacity={0.35} />
          <path d={`M ${rocketX - 14} ${PAD_Y - 22} L ${rocketX - 24} ${PAD_Y - 8} L ${rocketX - 14} ${PAD_Y - 10} Z M ${rocketX + 14} ${PAD_Y - 22} L ${rocketX + 24} ${PAD_Y - 8} L ${rocketX + 14} ${PAD_Y - 10} Z`} fill={TOKENS.line} />
          {engineOn && !staged && (
            <path
              d={`M ${rocketX - 12} ${PAD_Y - 10} Q ${rocketX} ${PAD_Y + 40 + 50 * flicker * (ignition ? 0.6 : 1)} ${rocketX + 12} ${PAD_Y - 10} Z`}
              fill={TOKENS.accent}
              opacity={0.95}
            />
          )}
          {engineOn && !staged && <path d={`M ${rocketX - 6} ${PAD_Y - 10} Q ${rocketX} ${PAD_Y + 18 * flicker} ${rocketX + 6} ${PAD_Y - 10} Z`} fill="#ffe2b8" />}
        </g>
        {/* interstage + second stage */}
        <rect x={rocketX - 12} y={PAD_Y - 196} width={24} height={46} fill="#e9eef3" stroke={TOKENS.bg} />
        {staged && t >= 158 && phase === "ASCENT" && (
          <path d={`M ${rocketX - 6} ${PAD_Y - 150} Q ${rocketX} ${PAD_Y - 110 + 14 * flicker} ${rocketX + 6} ${PAD_Y - 150} Z`} fill="#ffd2a6" opacity={0.85} />
        )}
        {/* fairing halves */}
        <g transform={fairingSep ? `translate(${reduced ? -30 : -Math.min(50, (t - 190) * 4)} ${reduced ? 20 : Math.min(60, (t - 190) * 2)}) rotate(${reduced ? -20 : -Math.min(35, (t - 190) * 3)} ${rocketX} ${PAD_Y - 196})` : undefined} opacity={fairingSep ? Math.max(0, 1 - (t - 190) / 10) : 1}>
          <path d={`M ${rocketX - 13} ${PAD_Y - 196} L ${rocketX - 13} ${PAD_Y - 226} Q ${rocketX - 13} ${PAD_Y - 250} ${rocketX} ${PAD_Y - 256} L ${rocketX} ${PAD_Y - 196} Z`} fill="#f4f8fb" stroke={TOKENS.bg} />
        </g>
        <g transform={fairingSep ? `translate(${reduced ? 30 : Math.min(50, (t - 190) * 4)} ${reduced ? 20 : Math.min(60, (t - 190) * 2)}) rotate(${reduced ? 20 : Math.min(35, (t - 190) * 3)} ${rocketX} ${PAD_Y - 196})` : undefined} opacity={fairingSep ? Math.max(0, 1 - (t - 190) / 10) : 1}>
          <path d={`M ${rocketX + 13} ${PAD_Y - 196} L ${rocketX + 13} ${PAD_Y - 226} Q ${rocketX + 13} ${PAD_Y - 250} ${rocketX} ${PAD_Y - 256} L ${rocketX} ${PAD_Y - 196} Z`} fill="#e9eef3" stroke={TOKENS.bg} />
        </g>
        {fairingSep && <rect x={rocketX - 6} y={PAD_Y - 214} width={12} height={18} rx={2} fill={TOKENS.fuel} />}
      </g>

      {showLabels && milestone && ascending && (
        <g>
          <rect x={12} y={14} width={Math.max(120, milestone.length * 9 + 24)} height={30} rx={4} fill={TOKENS.bg} opacity={0.85} />
          <text x={24} y={34} fill={TOKENS.line} fontFamily="Barlow Condensed" fontWeight={600} fontSize={18}>{milestone}</text>
        </g>
      )}
      {label && (
        <g>
          <rect x={12} y={14} width={label.length * 10 + 30} height={30} rx={4} fill={TOKENS.bg} opacity={0.85} stroke={label === "Holding" ? TOKENS.watch : label === "Vehicle safe" ? TOKENS.go : TOKENS.muted} />
          <text x={26} y={34} fill={TOKENS.line} fontFamily="Barlow Condensed" fontWeight={600} fontSize={18}>{label}</text>
        </g>
      )}
    </svg>
  );
}

function sceneLabel(phase: Phase, milestone: string | null | undefined, tags: string[]): string {
  if (phase === "ASCENT") return `Kestrel-2 in flight${milestone ? `: ${milestone}` : ""}`;
  if (tags.includes("Vehicle safe")) return "Pad abort: engines shut down, vehicle safe";
  if (tags.includes("Scrubbed")) return "Launch scrubbed, vehicle on the pad";
  if (tags.includes("Holding")) return "Kestrel-2 on the pad, countdown holding";
  return "Kestrel-2 on the pad at Cape Meridian";
}
