// The landing page is the product: a live solo mission (all consoles on autopilot) the visitor can watch,
// pause, switch roles in, and take over. The room is reused across visits while its token is valid.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, clearDemo, createRoom, loadDemo, loadNick, saveDemo, saveToken, type DemoSession } from "../api";
import { RocketScene } from "../components/graphics/RocketScene";
import { useFrame } from "../hooks/motion";
import { navigate } from "../router";
import { ConnectedRoom } from "./RoomPage";

const DEMO_SCENARIO = "S1";

function IdleScene() {
  const now = useFrame(10);
  return <RocketScene phase="FUELING" clock={-600 + (now / 1000) % 60} tags={[]} windKt={10} ceilingFt={7600} fueling={55} dawn showLabels={false} />;
}

export function DemoHome() {
  const [session, setSession] = useState<DemoSession | null>(() => loadDemo());
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);

  const create = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    setError(null);
    try {
      const r = await createRoom({ scenario: DEMO_SCENARIO, timescale: 4, nickname: loadNick() || "Visitor", demo: true });
      saveDemo(r.code, r.token);
      saveToken(r.code, r.token);
      setSession(loadDemo());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open a control room.");
    } finally {
      creating.current = false;
    }
  }, []);

  useEffect(() => {
    if (!session && !error) void create();
  }, [session, error, create]);

  const expired = useCallback(() => {
    clearDemo();
    setSession(null);
  }, []);

  if (session) return <ConnectedRoom key={session.code} code={session.code} token={session.token} report={false} demo onExpired={expired} />;

  return (
    <main className="demo-wait">
      <div className="scene"><IdleScene /></div>
      <div className="card demo-wait-card">
        <div className="brand">Go/No-Go</div>
        <h1>A launch control room run by a team of AI agents</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <div className="row">
              <button className="btn primary" onClick={() => void create()}>Try again</button>
              <button className="btn" onClick={() => navigate("/learn")}>Read how it works</button>
            </div>
          </>
        ) : (
          <p className="muted">Opening your control room…</p>
        )}
      </div>
    </main>
  );
}
