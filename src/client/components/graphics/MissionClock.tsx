import { formatClock, type Phase } from "../../../shared/phases";
import { useFrame } from "../../hooks/motion";

const RUNNING: Phase[] = ["FUELING", "TERMINAL_COUNT", "AUTO_SEQUENCE", "ASCENT"];

/** Local clock: last server simTime plus elapsed real time times timescale, corrected every tick (guide 8.2). */
export function useMissionTime(simTime: number, phase: Phase, timescale: number, receivedAt: number): number {
  const now = useFrame(10);
  if (!RUNNING.includes(phase) || !receivedAt) return simTime;
  const dt = Math.min(2.5, Math.max(0, (now - receivedAt) / 1000));
  return simTime + dt * timescale;
}

export function MissionClock({ simTime, phase, timescale, receivedAt, className = "clock" }: { simTime: number; phase: Phase; timescale: number; receivedAt: number; className?: string }) {
  const t = useMissionTime(simTime, phase, timescale, receivedAt);
  return (
    <span className={className} aria-live="off" aria-label={`Mission clock ${formatClock(t)}`}>
      {formatClock(t)}
    </span>
  );
}
