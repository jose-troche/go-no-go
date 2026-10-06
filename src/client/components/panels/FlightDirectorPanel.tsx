import { useState } from "react";
import { POLLED_STATIONS, STATION_NAMES } from "../../../shared/roles";
import { StatusLamp } from "../graphics/StatusLamp";
import { WindowBar } from "../graphics/WindowBar";
import { LensNote, useRoomCtx } from "../context";
import { Panel } from "./common";
import { WeatherPanel } from "./WeatherPanel";
import { PropulsionPanel } from "./PropulsionPanel";
import { GuidancePanel } from "./GuidancePanel";
import { RangePanel } from "./RangePanel";

type Act = "poll" | "hold" | "resume" | "recycle" | "scrub";

function availability(state: NonNullable<ReturnType<typeof useRoomCtx>["state"]>): Record<Act, string | null> {
  const ph = state.phase;
  const counting = ph === "FUELING" || ph === "TERMINAL_COUNT" || (ph === "AUTO_SEQUENCE" && state.simTime < -3);
  const holding = ph === "BUILT_IN_HOLD" || ph === "HOLD";
  const nogo = POLLED_STATIONS.filter((s) => state.statuses[s]?.status === "NO_GO");
  const pollOpen = state.poll?.state === "open";
  const pollPassed = state.poll?.state === "closed" && state.poll.result === "ALL_GO";
  const needsPoll = ph === "BUILT_IN_HOLD" || (ph === "HOLD" && state.simTime >= -240);
  return {
    poll: !holding ? "Polls run during a hold" : pollOpen ? "A poll is in progress" : null,
    hold: counting ? null : holding ? "Already holding" : "The count is not running",
    resume: !holding
      ? "The count is not holding"
      : nogo.length
        ? `${nogo.map((s) => STATION_NAMES[s]).join(", ")} NO-GO`
        : needsPoll && !pollPassed
          ? "Needs an all-GO poll first"
          : null,
    recycle: ph === "PAD_ABORT" || (ph === "HOLD" && state.simTime > -240) ? null : "Only after a pad abort or a terminal-count hold",
    scrub: counting || holding || ph === "PAD_ABORT" ? null : "Nothing to scrub",
  };
}

export function FlightDirectorPanel() {
  const { state, send } = useRoomCtx();
  const [tab, setTab] = useState<"overview" | "WX" | "PROP" | "GNC" | "RSO">("overview");
  if (!state) return null;
  const avail = availability(state);
  const isHuman = state.you.role === "FD" && state.you.seated;
  const labels: Record<Act, string> = { poll: "Start poll", hold: "Hold", resume: "Resume", recycle: "Recycle", scrub: "Scrub" };
  const pending = state.waivers.filter((w) => w.state === "requested");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="tabs" role="tablist">
        {(["overview", "WX", "PROP", "GNC", "RSO"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "overview" ? "Overview" : STATION_NAMES[t]}
          </button>
        ))}
      </div>
      {tab === "WX" && <WeatherPanel />}
      {tab === "PROP" && <PropulsionPanel />}
      {tab === "GNC" && <GuidancePanel />}
      {tab === "RSO" && <RangePanel />}
      {tab === "overview" && (
        <div className="station-panel">
          <Panel title="Stations">
            <div style={{ display: "grid", gap: 8 }}>
              {POLLED_STATIONS.map((s) => {
                const v = state.statuses[s];
                return (
                  <div key={s} style={{ display: "grid", gridTemplateColumns: "110px auto", gap: 4 }} title={v?.reasons.join("; ")}>
                    <b style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{STATION_NAMES[s]}</b>
                    {v && <StatusLamp status={v.status} size={18} />}
                    {v?.reasons[0] && <span className="small muted" style={{ gridColumn: "1 / -1" }}>{v.reasons[0]}</span>}
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Launch window">
            <WindowBar windowRemaining={state.windowRemaining} />
            <LensNote topic="window">While the count holds, the clock freezes but the window keeps closing. Long holds lead to scrubs.</LensNote>
          </Panel>
          <div data-explain="fd-actions" className="panel-slot">
          <Panel title={isHuman ? "Your actions" : "Flight Director actions"}>
            {state.advice && <div className="advice" style={{ marginBottom: 10 }}><b>FD agent advises:</b> {state.advice}</div>}
            <div className="fd-actions">
              {(Object.keys(labels) as Act[]).map((a) => (
                <div key={a} className="act">
                  <button className={`btn ${a === "scrub" ? "danger" : a === "resume" ? "primary" : ""}`} disabled={!isHuman || !!avail[a]} onClick={() => send({ type: "fd.action", action: a })}>
                    {labels[a]}
                  </button>
                  {avail[a] && <span className="why-disabled">{avail[a]}</span>}
                </div>
              ))}
            </div>
            {!isHuman && <p className="small muted">The FD agent runs the count. Choose “Take control” above to make these calls yourself.</p>}
            <LensNote topic="authority">Only the Flight Director can hold, resume, recycle, or scrub. Anyone else is refused, and the attempt is logged.</LensNote>
          </Panel>
          </div>
          <Panel title="Waivers and conflicts">
            {!state.waivers.length && !state.conflicts.length && <p className="small muted">None.</p>}
            {state.waivers.map((w) => (
              <div key={w.id} className="small">
                <span className="num">{w.lccId}</span> · {STATION_NAMES[w.station]} · <span className="chip">{w.state}</span> <span className="muted">"{w.reason}"</span>
              </div>
            ))}
            {pending.length > 0 && !isHuman && <p className="small muted">Waiting for a human Flight Director.</p>}
            {state.conflicts.map((c) => (
              <div key={c.id} className="small">
                {c.title} · <span className="chip">{c.state}</span> {c.resolution && <span className="muted">· {c.resolution}</span>}
              </div>
            ))}
          </Panel>
        </div>
      )}
    </div>
  );
}
