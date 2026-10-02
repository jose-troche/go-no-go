import { TOKENS } from "../../../shared/tokens";
import { Restricted } from "./Restricted";

/** Vertical thermometer-style gauge. */
export function LinearGauge({ value, min, max, nominalMax, limitMax, unit, label, digits = 1, restricted }: {
  value: number | undefined; min: number; max: number; nominalMax?: number; limitMax?: number; unit: string; label: string; digits?: number; restricted?: boolean;
}) {
  if (restricted) return <Restricted label={`${label}: outside your console's view`} />;
  const y = (v: number) => 100 - (90 * (Math.max(min, Math.min(max, v)) - min)) / (max - min);
  const over = value !== undefined && limitMax !== undefined && value > limitMax;
  const warn = value !== undefined && nominalMax !== undefined && value > nominalMax;
  const fill = over ? TOKENS.nogo : warn ? TOKENS.watch : TOKENS.lox;
  return (
    <figure style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }} aria-label={`${label}: ${value === undefined ? "no data" : `${value.toFixed(digits)} ${unit}`}`}>
      <svg viewBox="0 0 40 120" width="40" height="120" aria-hidden="true">
        <rect x="14" y="8" width="12" height="94" rx="6" fill="none" stroke={TOKENS.line} />
        {value !== undefined && <rect x="16" y={y(value)} width="8" height={102 - y(value)} rx="4" fill={fill} />}
        <circle cx="20" cy="108" r="9" fill={fill} stroke={TOKENS.line} />
        {limitMax !== undefined && <line x1="8" x2="32" y1={y(limitMax)} y2={y(limitMax)} stroke={TOKENS.nogo} strokeDasharray="3 2" />}
        {nominalMax !== undefined && <line x1="10" x2="30" y1={y(nominalMax)} y2={y(nominalMax)} stroke={TOKENS.watch} strokeDasharray="2 2" />}
      </svg>
      <figcaption>
        <div className="small muted">{label}</div>
        <div className="readout" style={{ fontSize: 24 }}>{value === undefined ? "—" : value.toFixed(digits)} <span className="small muted">{unit}</span></div>
      </figcaption>
    </figure>
  );
}
