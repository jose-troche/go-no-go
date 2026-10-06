// Room header: scenario, simulation controls, help, and sharing. Sim director controls appear only for the room creator.
import { useState } from "react";
import { ANOMALY_IDS, SCENARIO_IDS, SCENARIO_LABELS, TIMESCALES, type ScenarioSetting } from "../../shared/phases";
import { navigate } from "../router";
import { useGuide, useRoomCtx } from "./context";

const scenarioName = (s: ScenarioSetting) => (s === "S0" || s === "SURPRISE" ? SCENARIO_LABELS[s] : `${SCENARIO_LABELS[s]}`);

export function ControlBar({ report, onToggleReport }: { report: boolean; onToggleReport(): void }) {
  const { state, pub, send } = useRoomCtx();
  const { explain, setExplain, openIntro, startTour } = useGuide();
  const [copied, setCopied] = useState(false);
  const director = !!state?.you.creator;
  const phase = state?.phase ?? "LOBBY";
  const started = phase !== "LOBBY";
  const running = started && phase !== "ENDED";
  const counting = running && phase !== "ASCENT" && phase !== "SCRUB";
  const scenario = pub?.scenario ?? "S0";
  const paused = !!pub?.paused;

  return (
    <header className="topbar">
      <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4l4 10v10h-8V14z" fill="#DCE6EE" /><path d="M13 25h6l-3 5z" fill="#FF8A3D" /></svg>
        Go/No-Go
      </a>

      {state && started && (
        <div className="bar-group" data-explain="scenario">
          <label htmlFor="bar-scenario" className="small muted">Scenario</label>
          {director ? (
            <select
              id="bar-scenario"
              className="input compact"
              value={scenario}
              onChange={(e) => send({ type: "room.reset", scenario: e.target.value as ScenarioSetting })}
              title="Changing the scenario restarts the countdown"
            >
              {SCENARIO_IDS.map((s) => <option key={s} value={s}>{scenarioName(s)}</option>)}
            </select>
          ) : (
            <b id="bar-scenario">{scenarioName(scenario)}</b>
          )}
        </div>
      )}

      {state && director && started && (
        <div className="bar-group" data-explain="sim-controls">
          {running && (
            <button className="btn small" onClick={() => send({ type: "room.pause", paused: !paused })} aria-pressed={paused}>
              {paused ? "▶ Resume" : "❚❚ Pause"}
            </button>
          )}
          <button className="btn small" onClick={() => send({ type: "room.reset" })} title="Restart this scenario from T-15:00">↻ Restart</button>
          <select
            className="input compact"
            aria-label="Simulation speed"
            value={pub?.timescale ?? 4}
            onChange={(e) => send({ type: "room.configure", timescale: Number(e.target.value) })}
            disabled={!running}
          >
            {TIMESCALES.map((t) => <option key={t} value={t}>{t}x speed</option>)}
          </select>
        </div>
      )}

      {state && director && counting && (
        <div className="bar-group" data-explain="inject">
          <select
            className="input compact"
            aria-label="Add a problem"
            value=""
            onChange={(e) => {
              if (e.target.value) send({ type: "sim.inject", scenario: e.target.value as (typeof ANOMALY_IDS)[number] });
            }}
          >
            <option value="">+ Add a problem…</option>
            {ANOMALY_IDS.map((id) => (
              <option key={id} value={id} disabled={state.scenarioActive?.includes(id)}>{SCENARIO_LABELS[id]}</option>
            ))}
          </select>
        </div>
      )}

      <span className="spacer" />

      <div className="bar-group" data-explain="help">
        <button className={`btn small ${explain ? "primary" : ""}`} aria-pressed={explain} onClick={() => setExplain(!explain)} title="Outline and explain every part of the screen">
          {explain ? "Explaining…" : "Explain this screen"}
        </button>
        <button className="btn small" onClick={startTour} disabled={!state || !started}>Tour</button>
        <button className="btn small" onClick={openIntro}>About</button>
      </div>
      {state && started && (
        <div className="bar-group">
          <button className="btn small" onClick={onToggleReport}>{report ? "Back to the room" : "Report"}</button>
          <button
            className="btn small"
            title="Copy a link others can use to join this room"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${location.origin}/r/${state.code}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {copied ? "Link copied" : "Invite"}
          </button>
        </div>
      )}
    </header>
  );
}
