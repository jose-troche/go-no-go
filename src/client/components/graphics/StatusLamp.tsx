import { STATUS_LABELS, type Status } from "../../../shared/roles";
import { TOKENS } from "../../../shared/tokens";

const COLOR: Record<Status, string> = { GO: TOKENS.go, NO_GO: TOKENS.nogo, WATCH: TOKENS.watch, STANDBY: TOKENS.standby };

/** Status is never color alone: each lamp has a label and a distinct shape (spec 16.1). */
export function LampShape({ status, size = 14 }: { status: Status; size?: number }) {
  const c = COLOR[status];
  const r = size / 2 - 1.5;
  const m = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {status === "GO" && <circle cx={m} cy={m} r={r} fill={c} />}
      {status === "WATCH" && <circle cx={m} cy={m} r={r - 0.5} fill="none" stroke={c} strokeWidth={2.5} />}
      {status === "NO_GO" && <polygon points={`${m},1.5 ${size - 1.5},${size - 1.5} 1.5,${size - 1.5}`} fill={c} />}
      {status === "STANDBY" && <circle cx={m} cy={m} r={r - 0.5} fill="none" stroke={c} strokeWidth={2} strokeDasharray="3 2.5" />}
    </svg>
  );
}

export function StatusLamp({ status, size = 14, label = true, className = "" }: { status: Status; size?: number; label?: boolean; className?: string }) {
  return (
    <span className={`lamp ${status} ${className}`} role="img" aria-label={`Status ${STATUS_LABELS[status]}`}>
      <LampShape status={status} size={size} />
      {label && <span>{STATUS_LABELS[status]}</span>}
    </span>
  );
}
