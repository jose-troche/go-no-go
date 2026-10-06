// Scenario brief plus a live narration line: the latest callout and the team-agent idea it illustrates.
import { useState } from "react";
import { SCENARIO_LABELS, formatClock } from "../../shared/phases";
import { STATION_NAMES } from "../../shared/roles";
import { CALLOUT_CONCEPTS, SCENARIO_GUIDE } from "../content/guide";
import { useRoomCtx } from "./context";

const KEY = "gng:brief-collapsed";
/** Collapsed on phones unless the visitor opened it before; the live line stays visible either way. */
function loadCollapsed() {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return v === "1";
  } catch {
    /* ignore */
  }
  return typeof matchMedia !== "undefined" && matchMedia("(max-width: 760px)").matches;
}

export function MissionBrief() {
  const { state, pub } = useRoomCtx();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  if (!state || !pub) return null;
  const g = SCENARIO_GUIDE[pub.scenario];
  const last = state.callouts.at(-1);
  const concept = last ? CALLOUT_CONCEPTS.find(([re]) => re.test(last.text))?.[1] : undefined;
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(KEY, collapsed ? "0" : "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <section className={`brief ${collapsed ? "collapsed" : ""}`} aria-label="Mission brief">
      <div className="brief-scenario" data-explain="brief">
        <div className="brief-head">
          <span className="chip">Scenario</span>
          <b>{SCENARIO_LABELS[pub.scenario]}</b>
          <span className="muted">{g.oneLiner}</span>
          <button className="btn link" onClick={toggle} aria-expanded={!collapsed}>{collapsed ? "Show brief" : "Hide"}</button>
        </div>
        {!collapsed && (
          <>
            <p className="small brief-story">{g.story}</p>
            <div className="brief-watch small">
              <span className="muted">Watch for:</span>
              {g.watch.map((w) => <span key={w} className="watch-item">{w}</span>)}
            </div>
            <p className="small muted brief-concept">
              <b>Idea:</b> {g.concept}. <b>At work:</b> {g.atWork}
            </p>
          </>
        )}
      </div>
      <div className="brief-now" data-explain="now" aria-live="polite">
        <span className="chip now-chip">{pub.paused ? "Paused" : "Now"}</span>
        {last ? (
          <div>
            <div>
              <span className="num muted">{formatClock(last.simTime)}</span>{" "}
              <b>{last.station === "SYS" ? "Launch control" : STATION_NAMES[last.station]}:</b> {last.text}
            </div>
            {concept && <div className="small now-concept">{concept}</div>}
          </div>
        ) : (
          <span className="muted">Waiting for the countdown to start.</span>
        )}
      </div>
    </section>
  );
}
