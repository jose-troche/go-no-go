import { TOKENS } from "../../../shared/tokens";
import { useInterpolated } from "../../hooks/useInterpolated";
import { EngineCluster } from "../graphics/EngineCluster";
import { LinearGauge } from "../graphics/LinearGauge";
import { RadialGauge } from "../graphics/RadialGauge";
import { TankGauge } from "../graphics/TankGauge";
import { LensNote, useRoomCtx } from "../context";
import { Panel } from "./common";

export function PropulsionPanel() {
  const { state } = useRoomCtx();
  const lox = useInterpolated("prop.lox_load");
  const fuel = useInterpolated("prop.fuel_load");
  const a = useInterpolated("prop.lox_psi_a");
  const b = useInterpolated("prop.lox_psi_b");
  const fpsi = useInterpolated("prop.fuel_psi");
  const temp = useInterpolated("prop.lox_temp");
  if (!state) return null;
  const t = state.telemetry;
  const bOffline = t["prop.lox_psi_b"] === "offline";
  const conflict = state.conflicts.find((c) => c.state === "open");
  const readiness = typeof t["prop.engine_readiness"] === "string" ? (t["prop.engine_readiness"] as string).split(",").map(Number) : undefined;
  const restricted = a === undefined;
  const band = (v: number | undefined, nom: [number, number], lim: [number, number]) =>
    v === undefined ? "GO" : v < lim[0] || v > lim[1] ? "NO_GO" : v < nom[0] || v > nom[1] ? "WATCH" : "GO";
  const status = (v: number | undefined) => band(v, [50, 54], [48, 56]);
  return (
    <div className="station-panel">
      <Panel title="Propellant loading">
        <TankGauge lox={lox} fuel={fuel} restricted={lox === undefined} />
      </Panel>
      <Panel title="LOX tank pressure sensors" extra={conflict ? <span className="lamp WATCH small">Conflict open</span> : undefined}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, position: "relative" }}>
          <RadialGauge value={a} min={44} max={60} nominal={[50, 54]} limit={[48, 56]} unit="psi" label="Sensor A" status={status(a)} restricted={restricted} />
          <RadialGauge value={typeof b === "number" ? b : undefined} offline={bOffline} min={44} max={60} nominal={[50, 54]} limit={[48, 56]} unit="psi" label="Sensor B" status={status(b)} restricted={restricted} />
        </div>
        {conflict && a !== undefined && typeof b === "number" && (
          <svg viewBox="0 0 200 22" width="100%" aria-label={`Sensors differ by ${Math.abs(b - a).toFixed(1)} psi`}>
            <path d="M 50 2 L 50 10 L 150 10 L 150 2" stroke={TOKENS.watch} fill="none" strokeWidth={1.5} />
            <text x={100} y={21} textAnchor="middle" fill={TOKENS.watch} fontSize={11} fontFamily="Barlow Condensed">Δ {Math.abs(b - a).toFixed(1)} psi</text>
          </svg>
        )}
        {bOffline && <p className="small" style={{ color: TOKENS.watch }}>Sensor B is recalibrating.</p>}
        <LensNote topic="conflicts">Two sources report the same quantity. Past 3 psi apart, the system opens a conflict instead of averaging.</LensNote>
      </Panel>
      <Panel title="Fuel pressure and LOX temperature">
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
          <RadialGauge value={fpsi} min={34} max={50} nominal={[40, 44]} limit={[38, 46]} unit="psi" label="Fuel pressure" status={band(fpsi, [40, 44], [38, 46])} restricted={fpsi === undefined} />
          <LinearGauge value={temp} min={84} max={96} nominalMax={90} limitMax={92} unit="K" label="LOX temp" restricted={temp === undefined} />
        </div>
      </Panel>
      <Panel title="Engine cluster">
        <EngineCluster readiness={readiness} restricted={!readiness} />
      </Panel>
    </div>
  );
}
