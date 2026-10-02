import { PHASE_LABELS, formatDuration, ANOMALY_IDS, SCENARIO_LABELS } from "../../shared/phases";
import { ROLE_NAMES } from "../../shared/roles";
import { MissionClock } from "./graphics/MissionClock";
import { LensNote, useRoomCtx } from "./context";

export function MissionStrip({ lens, setLens }: { lens: boolean; setLens(v: boolean): void }) {
  const { state, pub, send, connected } = useRoomCtx();
  if (!state) return null;
  const you = state.you;
  const counting = state.phase !== "ASCENT" && state.phase !== "ENDED" && state.phase !== "LOBBY";
  return (
    <div className="mission-strip">
      <div className="group">
        <span className="chip" title="Room code">Room <b className="num">{state.code}</b></span>
        <MissionClock simTime={state.simTime} phase={state.phase} timescale={state.timescale} receivedAt={state.receivedAt} />
        <span className="phase">{PHASE_LABELS[state.phase]}</span>
        {counting && (
          <span className={`chip ${state.windowRemaining < 0 ? "lamp NO_GO" : ""}`}>
            Window {state.windowRemaining < 0 ? "missed" : `${formatDuration(state.windowRemaining)} slack`}
          </span>
        )}
        <span className="chip">{state.timescale}x</span>
        {!connected && <span className="chip lamp WATCH">Reconnecting…</span>}
      </div>
      <div className="group" style={{ marginLeft: "auto" }}>
        <span>
          You: <b>{you.role === "PUBLIC" ? "Spectator" : ROLE_NAMES[you.role]}</b> <span className="muted">({you.nick})</span>
        </span>
        <span className="hidden-counter" title="Facts in the shared ledger that the policy filter removed before they reached you">
          <span className="small muted">Hidden from you</span> <b>{state.hiddenCount}</b>
        </span>
        <label className="toggle small">
          <input type="checkbox" checked={lens} onChange={(e) => setLens(e.target.checked)} /> Concept lens
        </label>
        {you.creator && counting && (
          <select
            className="input"
            style={{ width: "auto", minHeight: 30, padding: "2px 6px" }}
            aria-label="Sim director: inject anomaly"
            value=""
            onChange={(e) => {
              if (e.target.value) send({ type: "sim.inject", scenario: e.target.value as (typeof ANOMALY_IDS)[number] });
            }}
          >
            <option value="">Sim director: inject…</option>
            {ANOMALY_IDS.map((id) => (
              <option key={id} value={id} disabled={state.scenarioActive?.includes(id)}>
                {id} {SCENARIO_LABELS[id]}
              </option>
            ))}
          </select>
        )}
        {pub && <span className="small muted">{pub.spectators} watching</span>}
      </div>
      {lens && (
        <div style={{ flexBasis: "100%" }}>
          <LensNote topic="hidden">
            The policy filter removed {state.hiddenCount} facts before they reached you. Every console sees a different slice of the same shared memory.
          </LensNote>
        </div>
      )}
    </div>
  );
}
