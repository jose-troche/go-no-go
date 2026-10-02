import { useState } from "react";
import { SCENARIO_IDS, SCENARIO_LABELS, TIMESCALES, type ScenarioSetting } from "../../shared/phases";
import { STATIONS, STATION_NAMES } from "../../shared/roles";
import { useRoomCtx } from "../components/context";

const DUTIES: Record<string, string> = {
  FD: "Runs the countdown and the poll. Only one who can hold, resume, or scrub.",
  WX: "Winds, lightning, clouds. Publishes the upper-winds signal.",
  PROP: "Propellant, tank pressures, engines. Owns the dual pressure sensors.",
  GNC: "Inertial alignment, GPS, trajectory margin from upper winds.",
  RSO: "Hazard area, flight termination, tracking.",
};

export function Lobby() {
  const { state, pub, send } = useRoomCtx();
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const you = state.you;
  const link = `${location.origin}/r/${state.code}`;
  return (
    <main className="lobby">
      <section className="card" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div>
          <div className="small muted">Room code</div>
          <div className="code-big">{state.code}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
        </div>
        <p className="muted small" style={{ flexBasis: "100%", margin: 0 }}>
          Share the code. Everyone starts as a spectator and can take any free console. Empty consoles are run by agents, so you can launch solo.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 24, marginBottom: 10 }}>Consoles</h2>
        <div className="seat-map">
          {STATIONS.map((s) => {
            const seat = state.seats[s];
            const mine = you.role === s;
            return (
              <div key={s} className={`seat ${mine ? "mine" : ""}`}>
                <h3 style={{ fontSize: 20 }}>{STATION_NAMES[s]}</h3>
                <div className="small muted">{DUTIES[s]}</div>
                <div>{seat ? <b>{seat.nick}{mine ? " (you)" : ""}</b> : <span className="muted">Agent</span>}</div>
                {mine ? (
                  <button className="btn small" onClick={() => send({ type: "seat.release" })}>Release</button>
                ) : (
                  <button className="btn small" disabled={!!seat} onClick={() => send({ type: "seat.claim", station: s })}>{seat ? "Taken" : "Take this console"}</button>
                )}
              </div>
            );
          })}
        </div>
        <p className="small muted">{pub?.spectators ?? 0} spectator{pub?.spectators === 1 ? "" : "s"} watching the public view.</p>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 22, marginBottom: 10 }}>Mission setup</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="lobby-scenario">Scenario</label>
            <select id="lobby-scenario" className="input" disabled={!you.creator} value={pub?.scenario ?? "S0"} onChange={(e) => send({ type: "room.configure", scenario: e.target.value as ScenarioSetting })}>
              {SCENARIO_IDS.map((s) => <option key={s} value={s}>{SCENARIO_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lobby-ts">Timescale</label>
            <select id="lobby-ts" className="input" disabled={!you.creator} value={pub?.timescale ?? 4} onChange={(e) => send({ type: "room.configure", timescale: Number(e.target.value) })}>
              {TIMESCALES.map((t) => <option key={t} value={t}>{t}x {t === 4 ? "(fueling takes about 3 minutes)" : ""}</option>)}
            </select>
          </div>
          {you.creator ? (
            <button className="btn primary" onClick={() => send({ type: "room.start" })}>Start countdown</button>
          ) : (
            <p className="muted small">Waiting for {pub?.creatorNick ?? "the sim director"} to start the countdown.</p>
          )}
        </div>
        {you.creator && <p className="small muted" style={{ marginBottom: 0 }}>You are the sim director: you start the countdown and can inject anomalies during the mission.</p>}
      </section>
    </main>
  );
}
