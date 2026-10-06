import { useMissionTime } from "./graphics/MissionClock";
import { RocketScene } from "./graphics/RocketScene";
import { useInterpolated } from "../hooks/useInterpolated";
import { useRoomCtx } from "./context";

/** The rocket scene bound to role-filtered live data. */
export function LiveScene() {
  const { state, pub } = useRoomCtx();
  const wind = useInterpolated("wx.surface_wind", 10);
  const alt = useInterpolated("asc.altitude", 60);
  const clock = useMissionTime(state?.simTime ?? 0, state?.phase ?? "LOBBY", state?.timescale ?? 1, state?.receivedAt ?? 0, !!pub?.paused);
  if (!state) return null;
  const t = state.telemetry;
  const fueling = typeof t["prop.lox_load"] === "number" ? (t["prop.lox_load"] as number) : (t["pub.fueling"] as number | undefined);
  return (
    <RocketScene
      phase={state.phase}
      clock={clock}
      tags={state.tags}
      milestone={state.milestone}
      windKt={wind}
      ceilingFt={t["wx.cloud_ceiling"] as number | undefined}
      fueling={fueling}
      lightning={t["pub.lightning"] === "nearby"}
      altitudeKm={alt ?? (state.phase === "ENDED" ? 160 : 0)}
    />
  );
}
