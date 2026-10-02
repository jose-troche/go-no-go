import { useRoomCtx, LensNote } from "../context";
import { RangeMap, type VesselView } from "../graphics/RangeMap";
import { StatusLamp } from "../graphics/StatusLamp";
import { Panel, parseJson } from "./common";

export function RangePanel() {
  const { state, send } = useRoomCtx();
  if (!state) return null;
  const t = state.telemetry;
  const vessels = parseJson<VesselView[]>(t["rso.vessels"]);
  const intrusions = t["rso.hazard_intrusions"] as number | undefined;
  const fts = t["rso.fts"] as string | undefined;
  const tracking = t["rso.tracking"] as string | undefined;
  const canContact = state.you.role === "RSO" && (intrusions ?? 0) > 0;
  return (
    <div className="station-panel">
      <Panel title="Range map" extra={canContact ? <button className="btn primary small" onClick={() => send({ type: "station.action", action: "contact_vessel" })}>Contact vessel</button> : undefined}>
        <RangeMap vessels={vessels} intrusions={intrusions} tracking={tracking} ascending={state.phase === "ASCENT"} altitude={t["asc.altitude"] as number | undefined} />
        {(intrusions ?? 0) > 0 && <p className="small"><span className="lamp NO_GO">Hazard area not clear</span> · {intrusions} intrusion{intrusions === 1 ? "" : "s"}</p>}
        <LensNote topic="public">The public only hears "the range is not yet clear". Vessel details never leave the Range console.</LensNote>
      </Panel>
      <Panel title="Flight safety">
        {fts === undefined ? (
          <p className="muted small">Outside your console's view</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div>Flight termination system <StatusLamp status={fts === "ready" ? "GO" : "NO_GO"} /> <span className="small muted">{fts}</span></div>
            <div>Tracking stations <StatusLamp status={tracking === "locked" ? "GO" : "WATCH"} /> <span className="small muted">{tracking}</span></div>
          </div>
        )}
      </Panel>
    </div>
  );
}
