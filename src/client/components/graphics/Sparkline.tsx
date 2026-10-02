import { TOKENS } from "../../../shared/tokens";

export function Sparkline({ values, width = 120, height = 28, color = TOKENS.line, limit }: { values: number[] | undefined; width?: number; height?: number; color?: string; limit?: number }) {
  if (!values || values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (limit !== undefined) {
    lo = Math.min(lo, limit);
    hi = Math.max(hi, limit);
  }
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - lo) / span) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {limit !== undefined && <line x1={0} x2={width} y1={height - 2 - ((limit - lo) / span) * (height - 4)} y2={height - 2 - ((limit - lo) / span) * (height - 4)} stroke={TOKENS.nogo} strokeDasharray="3 3" strokeWidth={1} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
