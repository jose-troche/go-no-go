import { PHASE_LABELS, formatDuration } from "../../shared/phases";
import { MissionClock } from "./graphics/MissionClock";
import { LensNote, useRoomCtx } from "./context";

export function MissionStrip() {
  const { state, pub, connected } = useRoomCtx();
  if (!state) return null;
  const counting = state.phase !== "ASCENT" && state.phase !== "ENDED" && state.phase !== "LOBBY";
  const paused = !!pub?.paused;
  return (
    <div className="mission-strip">
      <div className="group" data-explain="clock">
        <MissionClock simTime={state.simTime} phase={state.phase} timescale={state.timescale} receivedAt={state.receivedAt} paused={paused} />
        <span className="phase">{PHASE_LABELS[state.phase]}</span>
        {paused && <span className="chip lamp WATCH">Paused</span>}
        <span className="chip">{state.timescale}x</span>
        {!connected && <span className="chip lamp WATCH">Reconnecting…</span>}
      </div>
      {counting && (
        <span data-explain="window" className={`chip window-chip ${state.windowRemaining < 0 ? "lamp NO_GO" : ""}`}>
          Launch window: {state.windowRemaining < 0 ? "missed" : `${formatDuration(state.windowRemaining)} to spare`}
        </span>
      )}
      <div className="group" style={{ marginLeft: "auto" }}>
        <span className="hidden-counter" data-explain="hidden" title="Facts in the shared ledger that the policy filter removed before they reached you">
          <span className="small muted">Hidden from you</span> <b>{state.hiddenCount}</b> <span className="small muted">facts</span>
        </span>
        <span className="chip" title="Room code: others can join with it">Room <b className="num">{state.code}</b></span>
        {pub && pub.spectators > 0 && <span className="small muted">{pub.spectators} on the public view</span>}
      </div>
      <div style={{ flexBasis: "100%" }}>
        <LensNote topic="hidden">
          The policy filter removed {state.hiddenCount} facts before they reached you. Every console sees a different slice of the same shared memory.
        </LensNote>
      </div>
    </div>
  );
}
