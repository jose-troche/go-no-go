import { useEffect, useMemo, useRef, useState } from "react";
import { LIMITS } from "../../shared/protocol";
import { ApiError, clearToken, introSeen, joinRoom, loadNick, loadToken, markIntroSeen, saveNick, saveToken } from "../api";
import { GuideCtx, LensCtx, RoomCtx, type Guide } from "../components/context";
import { ControlBar } from "../components/ControlBar";
import { RoleBar } from "../components/RoleBar";
import { IntroModal } from "../components/guide/IntroModal";
import { Tour } from "../components/guide/Tour";
import { ExplainLayer } from "../components/guide/ExplainLayer";
import { Toasts } from "../components/Prompts";
import { TelemetryCtx } from "../hooks/useInterpolated";
import { useRoom } from "../hooks/useRoom";
import { navigate } from "../router";
import { isStation } from "../../shared/roles";
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

export function ConnectedRoom({ code, token, report, demo = false, onExpired }: { code: string; token: string; report: boolean; demo?: boolean; onExpired(): void }) {
  const handle = useRoom(code, token);
  const [explain, setExplain] = useState(false);
  const [introOpen, setIntroOpen] = useState(() => !introSeen());
  const [tourOpen, setTourOpen] = useState(false);
  const [localReport, setLocalReport] = useState(false);
  const autoSeated = useRef(false);
  const booted = useRef(false);
  const autoPaused = useRef(false);
  const { state, pub, closedReason, send } = handle;
  const showReport = report || localReport;

  const guide: Guide = useMemo(
    () => ({
      explain,
      setExplain: (v: boolean) => {
        setExplain(v);
        if (v) setTourOpen(false);
      },
      introOpen,
      openIntro: () => {
        setTourOpen(false);
        setIntroOpen(true);
      },
      closeIntro: () => {
        markIntroSeen();
        setIntroOpen(false);
      },
      tourOpen,
      startTour: () => {
        setExplain(false);
        setIntroOpen(false);
        setLocalReport(false);
        setTourOpen(true);
      },
      endTour: () => setTourOpen(false),
    }),
    [explain, introOpen, tourOpen],
  );

  // "Seat me as Flight Director" from the multiplayer form (solo mode).
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

  // Demo: skip the lobby. Watch the Flight Director (it sees the whole picture) and start the countdown;
  // a returning visitor whose mission already ended gets a fresh run.
  useEffect(() => {
    if (!demo || !state || booted.current || !state.you.creator) return;
    booted.current = true;
    if (state.phase === "LOBBY") {
      if (state.you.role === "PUBLIC") send({ type: "room.observe", station: "FD" });
      send({ type: "room.start" });
    } else if (state.phase === "ENDED") {
      send({ type: "room.reset" });
    }
  }, [demo, state, send]);

  useEffect(() => {
    if (demo && closedReason) onExpired();
  }, [demo, closedReason, onExpired]);

  // Freeze the mission while the intro or tour is open, so nothing is missed. Only when nobody else is in the room.
  const running = !!state && state.phase !== "LOBBY" && state.phase !== "ENDED";
  // Watchers of a console are not counted anywhere public, so a solo watcher sees zero others.
  const others = pub && state ? Object.keys(pub.seats).length - (state.you.seated ? 1 : 0) + pub.spectators - (state.you.role === "PUBLIC" ? 1 : 0) : 0;
  const canAutoPause = !!state?.you.creator && (demo || others <= 0);
  const overlay = introOpen || tourOpen;
  const paused = !!pub?.paused;
  useEffect(() => {
    if (overlay && running && canAutoPause && !paused && !autoPaused.current) {
      autoPaused.current = true;
      send({ type: "room.pause", paused: true });
    } else if (!overlay && autoPaused.current) {
      autoPaused.current = false;
      if (paused) send({ type: "room.pause", paused: false });
    }
  }, [overlay, running, canAutoPause, paused, send]);

  let body;
  if (closedReason && !demo) {
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
  } else if (!state || (demo && state.phase === "LOBBY")) {
    body = <main className="lobby"><p className="muted">Opening the control room…</p></main>;
  } else if (showReport || state.phase === "ENDED") {
    body = <AfterAction />;
  } else if (state.phase === "LOBBY") {
    body = <Lobby />;
  } else if (state.you.role === "PUBLIC") {
    body = <PublicView />;
  } else {
    body = <Console />;
  }

  return (
    <RoomCtx.Provider value={handle}>
      <TelemetryCtx.Provider value={handle.telemetry}>
        <LensCtx.Provider value={explain}>
          <GuideCtx.Provider value={guide}>
            <div className="room">
              <ControlBar
                report={showReport}
                onToggleReport={() => (demo ? setLocalReport((v) => !v) : navigate(report ? `/r/${code}` : `/r/${code}/report`))}
              />
              {running && !showReport && <RoleBar />}
              {body}
            </div>
            <Toasts />
            <IntroModal scenario={pub?.scenario ?? "S1"} />
            <Tour />
            <ExplainLayer />
          </GuideCtx.Provider>
        </LensCtx.Provider>
      </TelemetryCtx.Provider>
    </RoomCtx.Provider>
  );
}
