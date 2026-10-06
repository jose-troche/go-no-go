// "View as": switch which console's view you receive, and whether you watch it or operate it.
import { STATIONS, STATION_NAMES, type Role, type Station } from "../../shared/roles";
import { CONTROL_HELP, ROLE_VIEW } from "../content/guide";
import { StatusLamp } from "./graphics/StatusLamp";
import { useRoomCtx } from "./context";

const SHORT: Record<Role, string> = { PUBLIC: "Public", FD: "Flight Director", WX: "Weather", PROP: "Propulsion", GNC: "Guidance", RSO: "Range Safety" };

export function RoleBar() {
  const { state, send } = useRoomCtx();
  if (!state) return null;
  const { role, seated } = state.you;
  const takenBy = (s: Station) => {
    const seat = state.seats[s];
    return seat && !(seated && role === s) ? seat.nick : null;
  };
  const choose = (r: Role) => {
    if (r === role) return;
    send({ type: "room.observe", station: r === "PUBLIC" ? null : r });
  };
  return (
    <div className="role-bar">
      <div className="role-pick" data-explain="role-bar">
        <span className="small muted">View as</span>
        <div className="segmented" role="radiogroup" aria-label="View the mission as">
          {(["PUBLIC", ...STATIONS] as Role[]).map((r) => {
            const holder = r === "PUBLIC" ? null : takenBy(r);
            const st = r === "PUBLIC" ? undefined : state.statuses[r];
            return (
              <button
                key={r}
                role="radio"
                aria-checked={role === r}
                className={role === r ? "on" : ""}
                disabled={!!holder}
                title={holder ? `${holder} is operating this console` : ROLE_VIEW[r]}
                onClick={() => choose(r)}
              >
                {st && <StatusLamp status={st.status} size={9} label={false} />}
                {SHORT[r]}
                {holder && <span className="small muted"> · {holder}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {role !== "PUBLIC" && (
        <div className="role-mode" data-explain="control-mode">
          <div className="segmented" role="radiogroup" aria-label={`How you use the ${STATION_NAMES[role]} console`}>
            <button role="radio" aria-checked={!seated} className={!seated ? "on" : ""} onClick={() => seated && send({ type: "room.observe", station: role })}>
              Watch the agent
            </button>
            <button role="radio" aria-checked={seated} className={seated ? "on control" : ""} onClick={() => !seated && send({ type: "seat.claim", station: role })}>
              Take control
            </button>
          </div>
        </div>
      )}
      <p className="role-caption small">
        {seated && role !== "PUBLIC" ? (
          <>
            <b>You operate {STATION_NAMES[role]}.</b> {CONTROL_HELP[role]} The rules still set the status: you act within your authority, you cannot overrule them.
          </>
        ) : (
          <>
            <b>{role === "PUBLIC" ? "Public view." : `${STATION_NAMES[role]} view, agent in control.`}</b> {ROLE_VIEW[role]}
          </>
        )}
      </p>
    </div>
  );
}
