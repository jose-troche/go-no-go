import { useInterpolated } from "../../hooks/useInterpolated";
import { AttitudeIndicator } from "../graphics/AttitudeIndicator";
import { GpsConstellation, TrajectoryPlot } from "../graphics/TrajectoryPlot";
import { LensNote, useRoomCtx } from "../context";
import { Panel } from "./common";

export function GuidancePanel() {
  const { state } = useRoomCtx();
  const drift = useInterpolated("gnc.imu_drift", 10);
  const margin = useInterpolated("gnc.traj_margin");
  const shear = useInterpolated("wx.upper_shear");
  if (!state) return null;
  const gps = state.telemetry["gnc.gps_lock"];
  return (
    <div className="station-panel">
      <Panel title="Attitude">
        <AttitudeIndicator drift={drift} />
      </Panel>
      <Panel title="Trajectory">
        <TrajectoryPlot margin={margin} shear={shear} />
        <LensNote topic="signals">Margin = 40 − 35 × upper-level shear. Weather's data drives Guidance's status: a cross-role signal.</LensNote>
      </Panel>
      <Panel title="GPS constellation">
        <GpsConstellation locked={typeof gps === "boolean" ? gps : undefined} />
        <LensNote topic="glitch">GPS lock must be lost for 10 sim seconds before NO-GO. Agents should not overreact to transient glitches.</LensNote>
      </Panel>
    </div>
  );
}
