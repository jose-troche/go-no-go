import { TOKENS } from "../../../shared/tokens";
import { useInterpolated } from "../../hooks/useInterpolated";
import { RadialGauge } from "../graphics/RadialGauge";
import { RadarScope, type StrikeView } from "../graphics/RadarScope";
import { Restricted } from "../graphics/Restricted";
import { LensNote, useRoomCtx } from "../context";
import { Panel, Readout, parseJson } from "./common";

const BANDS = [
  { alt: "40,000 ft", base: 38 },
  { alt: "33,000 ft", base: 62 },
  { alt: "26,000 ft", base: 74 },
  { alt: "18,000 ft", base: 55 },
  { alt: "10,000 ft", base: 30 },
];

function UpperWinds({ shear }: { shear: number | undefined }) {
  if (shear === undefined) return <Restricted label="Upper-level winds: outside your console's view" height={150} />;
  const color = shear > 0.7 ? TOKENS.nogo : shear > 0.6 ? TOKENS.watch : TOKENS.line;
  return (
    <figure style={{ margin: 0 }} aria-label={`Upper-level wind shear index ${shear.toFixed(2)}`}>
      <svg viewBox="0 0 240 130" width="100%" aria-hidden="true">
        {BANDS.map((b, i) => {
          const speed = b.base * (0.55 + shear * 1.3) * (1 + (i % 2 ? 0.15 : -0.1) * shear);
          return (
            <g key={b.alt} transform={`translate(0 ${8 + i * 24})`}>
              <text x={0} y={13} fill={TOKENS.muted} fontSize={12}>{b.alt}</text>
              <rect x={70} y={2} width={Math.min(130, speed * 1.1)} height={14} fill={color} opacity={0.8} />
              <text x={76 + Math.min(130, speed * 1.1)} y={14} fill={TOKENS.line} fontSize={13} fontFamily="Barlow Condensed">{Math.round(speed)} kt</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="small">Shear index <b className="num" style={{ color }}>{shear.toFixed(2)}</b> <span className="muted">(watch 0.60, limit 0.70)</span></figcaption>
    </figure>
  );
}

export function WeatherPanel() {
  const { state } = useRoomCtx();
  const wind = useInterpolated("wx.surface_wind");
  const shear = useInterpolated("wx.upper_shear");
  if (!state) return null;
  const t = state.telemetry;
  const strikes = parseJson<StrikeView[]>(t["wx.strikes"]);
  const full = state.you.role === "WX" || state.you.role === "FD";
  const windStatus = (wind ?? 0) > 25 ? "NO_GO" : (wind ?? 0) > 14 ? "WATCH" : "GO";
  return (
    <div className="station-panel">
      <Panel title="Surface wind">
        <RadialGauge value={wind} min={0} max={40} nominal={[0, 14]} limit={[0, 25]} unit="kt" label="Surface wind" status={windStatus} digits={0} />
        {!full && <p className="small muted">Rounded public value.</p>}
      </Panel>
      <Panel title="Upper-level winds">
        <UpperWinds shear={shear} />
        {state.you.role === "GNC" && <LensNote topic="signals">You see this because Guidance subscribes to Weather's upper-winds signal.</LensNote>}
      </Panel>
      <Panel title="Lightning radar">
        <RadarScope strikes={full ? strikes : undefined} ruleRemaining={t["wx.lightning_clock"] as number | undefined} restricted={!full} />
      </Panel>
      <Panel title="Clouds and temperature">
        <div className="readouts">
          <Readout channel="wx.cloud_ceiling" limit={4000} />
          <Readout channel="wx.temp" />
        </div>
      </Panel>
    </div>
  );
}
