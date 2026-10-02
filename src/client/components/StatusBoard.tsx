import { STATIONS, STATION_NAMES, type Station } from "../../shared/roles";
import { StatusLamp } from "./graphics/StatusLamp";
import { LensNote, useRoomCtx } from "./context";

export function StatusBoard({ compact = false }: { compact?: boolean }) {
  const { state } = useRoomCtx();
  if (!state) return null;
  if (state.you.role === "PUBLIC") return null;
  return (
    <section className="status-board" aria-label="Team status board">
      <h3 className="panel-title" style={{ fontSize: 17 }}>Team status</h3>
      {STATIONS.map((s) => {
        const v = state.statuses[s];
        if (!v) return null;
        const derivedFromWx = s === "GNC" && v.status === "NO_GO" && v.reasons.some((r) => /trajectory/i.test(r));
        return (
          <div key={s} className={`status-row ${state.you.role === s ? "me" : ""}`}>
            <b style={{ fontFamily: "var(--font-display)" }}>{STATION_NAMES[s as Station]}</b>
            <StatusLamp status={v.status} />
            <span className="who">{v.operator === "human" ? `Human: ${v.nick}` : "Agent"}</span>
            {!compact && v.reasons[0] && <span className="reason">{v.reasons[0]}</span>}
            {derivedFromWx && (
              <LensNote topic="signals">Derived from Weather facts via the upper-winds signal: a cross-role signal.</LensNote>
            )}
          </div>
        );
      })}
    </section>
  );
}
