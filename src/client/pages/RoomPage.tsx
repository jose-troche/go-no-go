import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../../shared/protocol";
import { ApiError, clearToken, joinRoom, loadNick, loadToken, saveNick, saveToken } from "../api";
import { LensCtx, RoomCtx } from "../components/context";
import { Toasts } from "../components/Prompts";
import { TelemetryCtx } from "../hooks/useInterpolated";
import { useRoom } from "../hooks/useRoom";
import { navigate } from "../router";
import { isStation, ROLE_NAMES } from "../../shared/roles";
import { AfterAction } from "./AfterAction";
import { Console } from "./Console";
import { Lobby } from "./Lobby";
import { PublicView } from "./PublicView";

function JoinGate({ code, onJoined }: { code: string; onJoined(token: string): void }) {
  const [nick, setNick] = useState(loadNick());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="lobby" style={{ maxWidth: 520 }}>
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="brand">Go/No-Go</a>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await joinRoom(code, nick.trim());
            saveNick(nick.trim());
            saveToken(code, r.token);
            onJoined(r.token);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not join.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 style={{ fontSize: 28 }}>Join room <span className="num">{code}</span></h1>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="gate-nick">Your nickname</label>
          <input id="gate-nick" className="input" autoFocus required maxLength={LIMITS.nickname} value={nick} onChange={(e) => setNick(e.target.value)} />
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={busy || !nick.trim()}>{busy ? "Joining…" : "Join the control room"}</button>
        {error && <p role="alert" className="lamp NO_GO">{error}</p>}
      </form>
    </main>
  );
}

export function RoomPage({ code, report }: { code: string; report: boolean }) {
  const [token, setToken] = useState<string | null>(() => loadToken(code));
  if (!token) return <JoinGate code={code} onJoined={setToken} />;
  return (
    <ConnectedRoom
      code={code}
      token={token}
      report={report}
      onExpired={() => {
        clearToken(code);
        setToken(null);
      }}
    />
  );
}

function ConnectedRoom({ code, token, report, onExpired }: { code: string; token: string; report: boolean; onExpired(): void }) {
  const handle = useRoom(code, token);
  const [lens, setLens] = useState(false);
  const [viewPublic, setViewPublic] = useState(false);
  const autoSeated = useRef(false);
  const { state, closedReason, send } = handle;

  // "Seat me as Flight Director" from the landing page (solo mode).
  useEffect(() => {
    if (!state || autoSeated.current) return;
    autoSeated.current = true;
    let seat: string | null = null;
    try {
      seat = sessionStorage.getItem(`gng:autoseat:${code}`);
      sessionStorage.removeItem(`gng:autoseat:${code}`);
    } catch {
      /* ignore */
    }
    if (seat && isStation(seat) && !state.seats[seat]) send({ type: "seat.claim", station: seat });
  }, [state, code, send]);

  let body;
  if (closedReason) {
    body = (
      <main className="lobby" style={{ maxWidth: 560 }}>
        <div className="card">
          <h1 style={{ fontSize: 26 }}>{closedReason}</h1>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onExpired}>Join again</button>
            <button className="btn" onClick={() => navigate("/")}>Home</button>
          </div>
        </div>
      </main>
    );
  } else if (!state) {
    body = <main className="lobby"><p className="muted">Connecting to the control room…</p></main>;
  } else if (report) {
    body = <AfterAction />;
  } else if (state.phase === "LOBBY") {
    body = <Lobby />;
  } else if (state.phase === "ENDED") {
    body = <AfterAction />;
  } else if (state.you.role === "PUBLIC" || viewPublic) {
    body = <PublicView lens={lens} setLens={setLens} />;
  } else {
    body = <Console lens={lens} setLens={setLens} />;
  }

  return (
    <RoomCtx.Provider value={handle}>
      <TelemetryCtx.Provider value={handle.telemetry}>
        <LensCtx.Provider value={lens}>
          <div className="room">
            <header className="topbar">
              <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Go/No-Go</a>
              <span className="spacer" />
              {state && state.phase !== "LOBBY" && (
                <>
                  {report || state.phase === "ENDED" ? (
                    state.phase !== "ENDED" && <button className="btn small" onClick={() => navigate(`/r/${code}`)}>Back to the room</button>
                  ) : (
                    <button className="btn small" onClick={() => navigate(`/r/${code}/report`)}>After-action report</button>
                  )}
                  {state.you.role !== "PUBLIC" && state.phase !== "ENDED" && !report && (
                    <button className="btn small" onClick={() => setViewPublic((v) => !v)}>{viewPublic ? "Back to my console" : "Public view"}</button>
                  )}
                  {state.you.role !== "PUBLIC" && state.phase !== "ENDED" && (
                    <button className="btn small" onClick={() => send({ type: "seat.release" })}>Leave {ROLE_NAMES[state.you.role]} console</button>
                  )}
                </>
              )}
            </header>
            {body}
          </div>
          <Toasts />
        </LensCtx.Provider>
      </TelemetryCtx.Provider>
    </RoomCtx.Provider>
  );
}
