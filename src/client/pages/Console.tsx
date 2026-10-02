import { useState } from "react";
import { MissionStrip } from "../components/MissionStrip";
import { StatusBoard } from "../components/StatusBoard";
import { CommsLoop } from "../components/CommsLoop";
import { LedgerTimeline } from "../components/LedgerTimeline";
import { Prompts } from "../components/Prompts";
import { LiveScene } from "../components/LiveScene";
import { LccList } from "../components/panels/common";
import { WeatherPanel } from "../components/panels/WeatherPanel";
import { PropulsionPanel } from "../components/panels/PropulsionPanel";
import { GuidancePanel } from "../components/panels/GuidancePanel";
import { RangePanel } from "../components/panels/RangePanel";
import { FlightDirectorPanel } from "../components/panels/FlightDirectorPanel";
import { useRoomCtx } from "../components/context";

export function Console({ lens, setLens }: { lens: boolean; setLens(v: boolean): void }) {
  const { state } = useRoomCtx();
  const [tab, setTab] = useState<"comms" | "ledger">("comms");
  if (!state) return null;
  const role = state.you.role;
  return (
    <>
      <MissionStrip lens={lens} setLens={setLens} />
      <div className={`console-grid ${tab === "ledger" ? "tab-ledger" : ""}`}>
        <aside className="area-board"><StatusBoard /></aside>
        <div className="area-main">
          <div className="scene-wrap"><LiveScene /></div>
          {role === "WX" && <WeatherPanel />}
          {role === "PROP" && <PropulsionPanel />}
          {role === "GNC" && <GuidancePanel />}
          {role === "RSO" && <RangePanel />}
          {role === "FD" && <FlightDirectorPanel />}
          <LccList />
        </div>
        <div className="mobile-tabs tabs" role="tablist">
          <button role="tab" aria-selected={tab === "comms"} onClick={() => setTab("comms")}>Comms</button>
          <button role="tab" aria-selected={tab === "ledger"} onClick={() => setTab("ledger")}>Ledger</button>
        </div>
        <div className="area-comms"><CommsLoop /></div>
        <div className="area-ledger"><LedgerTimeline /></div>
      </div>
      <Prompts />
    </>
  );
}
