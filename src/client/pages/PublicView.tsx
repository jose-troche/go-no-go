import { PHASE_LABELS } from "../../shared/phases";
import { MissionClock } from "../components/graphics/MissionClock";
import { LiveScene } from "../components/LiveScene";
import { CommsLoop } from "../components/CommsLoop";
import { MissionBrief } from "../components/MissionBrief";
import { LensNote, useRoomCtx } from "../components/context";
import { useInterpolated } from "../hooks/useInterpolated";

export function PublicView() {
  const { state, pub } = useRoomCtx();
  const alt = useInterpolated("asc.altitude", 10);
  const vel = useInterpolated("asc.velocity", 10);
  if (!state) return null;
  const statements = state.facts.filter((f) => f.kind === "statement");
  const latest = statements.at(-1);
  const weather = [...statements].reverse().find((f) => /weather/i.test(f.summary_text));
  const t = state.telemetry;
  return (
    <div className="public">
      <div className="mission-strip">
        <span className="phase">Kestrel-2 · Aurora-3 · Cape Meridian</span>
        {pub?.paused && <span className="chip lamp WATCH">Paused</span>}
        <span style={{ marginLeft: "auto" }} className="hidden-counter" data-explain="hidden" title="Facts in the ledger the public cannot see">
          <b>{state.hiddenCount}</b> <span className="small muted">facts hidden from the public</span>
        </span>
        <span className="chip">Room <b className="num">{state.code}</b></span>
      </div>
      <MissionBrief />
      <div className="public-scene" data-explain="scene">
        <LiveScene />
        <div className="public-overlay">
          <div data-explain="clock" style={{ alignSelf: "flex-start" }}>
            <MissionClock simTime={state.simTime} phase={state.phase} timescale={state.timescale} receivedAt={state.receivedAt} paused={!!pub?.paused} className="clock public-clock" />
            <div className="phase" style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>{PHASE_LABELS[state.phase]}</div>
            {state.phase === "ASCENT" && (
              <div className="readouts" style={{ maxWidth: 360, marginTop: 10 }}>
                <div className="readout-box" style={{ background: "rgba(13,35,60,0.8)" }}><div className="label">Altitude</div><div className="value">{alt?.toFixed(1) ?? "—"} <span className="small muted">km</span></div></div>
                <div className="readout-box" style={{ background: "rgba(13,35,60,0.8)" }}><div className="label">Velocity</div><div className="value">{vel ? Math.round(vel).toLocaleString() : "—"} <span className="small muted">m/s</span></div></div>
              </div>
            )}
          </div>
          {latest && (
            <div className="lower-third" aria-live="polite" data-explain="public-statement">
              {latest.summary_text}
              <LensNote topic="public">Promoted by an approved template. The public never sees raw values or internal details.</LensNote>
            </div>
          )}
        </div>
      </div>
      <div className="public-bar">
        <section className="panel grid-bg" data-explain="public-weather">
          <h3>Weather at the Cape</h3>
          <div className="readouts">
            <div className="readout-box"><div className="label">Temperature</div><div className="value">{typeof t["wx.temp"] === "number" ? Math.round(t["wx.temp"] as number) : "—"} <span className="small muted">°C</span></div></div>
            <div className="readout-box"><div className="label">Surface wind</div><div className="value">{typeof t["wx.surface_wind"] === "number" ? Math.round(t["wx.surface_wind"] as number) : "—"} <span className="small muted">kt</span></div></div>
          </div>
          <p className="small">{t["pub.lightning"] === "nearby" ? "Lightning has been reported in the area." : "No lightning in the area."} {weather ? weather.summary_text : ""}</p>
        </section>
        {state.phase === "FUELING" && (
          <section className="panel grid-bg">
            <h3>Propellant loading</h3>
            <div className="readout-box"><div className="label">Fueling</div><div className="value">{t["pub.fueling"] as number ?? 0}%</div></div>
          </section>
        )}
        <section className="panel grid-bg">
          <h3>What the public cannot see</h3>
          <p className="small" style={{ marginTop: 0 }}>
            No station statuses, no sensor readings, no internal decisions: only approved statements. Pick a console under “View as” to see the same moment from inside the control room.
          </p>
        </section>
        <div style={{ minHeight: 300 }} data-explain="comms">
          <CommsLoop title="Ask the public affairs agent" publicMode />
        </div>
      </div>
    </div>
  );
}
