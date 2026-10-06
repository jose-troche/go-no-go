import { useState } from "react";
import { SCENARIO_IDS, SCENARIO_LABELS, TIMESCALES, type ScenarioSetting } from "../../shared/phases";
import { LIMITS } from "../../shared/protocol";
import { ApiError, createRoom, joinRoom, loadNick, saveNick, saveToken } from "../api";
import { RocketScene } from "../components/graphics/RocketScene";
import { useFrame } from "../hooks/motion";
import { navigate } from "../router";

const CONCEPTS: Array<[string, string, string]> = [
  ["Each team has its own specialist", "One AI agent per console, each responsible for its own area: weather, engines, guidance, range safety", "Sales, Legal, Security, and Support each have their own assistant"],
  ["One shared memory, with receipts", "Every event lands in a shared ledger, and every entry can answer “Why?” by pointing to its sources", "A shared customer history where every note says where it came from"],
  ["Need-to-know views", "Consoles see different slices of the same events; the public sees a cleaned-up feed", "Staff see internal details; customers see a status page"],
  ["Clear authority", "Only the Flight Director can hold, resume, or scrub the launch", "Only certain roles can approve a change or a refund"],
  ["Signals between teams", "Rising upper winds automatically shrink Guidance's safety margin", "A spike in support tickets flags risk to a sales deal"],
  ["Disagreements are surfaced, not hidden", "When two pressure sensors disagree, the system refuses to quietly pick one", "When the CRM and billing disagree, someone has to decide"],
  ["Decisions are made together", "The go/no-go poll asks every station before the count resumes", "A release readiness review or change board"],
  ["People stay in charge", "Humans can take any console, confirm GO calls, and approve exceptions", "Approvals, sign-offs, and exceptions"],
  ["Rules decide, AI explains", "A fixed rulebook sets every status; the AI answers questions and narrates", "Policy engines make the call; copilots explain it"],
];

const EXPLAINERS: Array<[string, string, string]> = [
  ["hidden", "The hidden-from-you counter", "Every console shows how many facts in the shared ledger it cannot see. Only a number: no hints about what they are. The policy filter removes them before anything reaches your screen."],
  ["signals", "Cross-role signals", "Weather publishes an upper-winds signal. Guidance subscribes, and its trajectory margin is computed from it. When winds rise, Guidance goes NO-GO too, and its assessment cites Weather's facts."],
  ["conflicts", "Conflict surfacing", "Two LOX pressure sensors should agree. When they drift apart, a conflict opens. Nothing averages them or picks one silently; the Propulsion owner must choose, and that choice is recorded."],
  ["authority", "Action authority", "Each action has an owner. Only the Flight Director can change the count; only a human Flight Director can approve a waiver. Refused attempts are logged where the FD can see them."],
  ["poll", "The go/no-go poll", "Before the count resumes, the Flight Director asks every station in turn. A single NO-GO, or a seated human who does not confirm, keeps the count holding."],
  ["hitl", "Fail-safe asymmetry", "Stopping is easy: any agent can trigger a hold. Going needs a human when one is present: a seated operator must confirm their station's GO."],
  ["provenance", "Provenance you can check", "“Why?” walks a fact back through everything it was derived from. Sources you are not allowed to see appear only as “hidden from you”."],
  ["public", "A sanitized public view", "The livestream audience hears approved statements built from deterministic templates, like “the range is not yet clear”, never the raw details."],
  ["injection", "Prompt injection, defused", "The public agent's prompt contains only public facts. Asking it to ignore its instructions cannot reveal sensor readings, because they were never there."],
  ["window", "Window pressure", "The launch window keeps closing during a hold. If liftoff can no longer fit, the Flight Director agent recommends a scrub, and the system scrubs when the window closes."],
  ["glitch", "Not overreacting", "A short GPS dropout makes Guidance watch, not panic. A 10-second debounce separates glitches from real problems."],
];

function HeroScene() {
  const now = useFrame(10);
  return <RocketScene phase="FUELING" clock={-600 + (now / 1000) % 60} tags={[]} windKt={10} ceilingFt={7600} fueling={55} dawn showLabels={false} />;
}

export function Landing() {
  const [nickname, setNickname] = useState(loadNick());
  const [scenario, setScenario] = useState<ScenarioSetting>("SURPRISE");
  const [timescale, setTimescale] = useState(4);
  const [seatFd, setSeatFd] = useState(false);
  const [code, setCode] = useState("");
  const [joinNick, setJoinNick] = useState(loadNick());
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const r = await createRoom({ scenario, timescale, nickname: nickname.trim() });
      saveNick(nickname.trim());
      saveToken(r.code, r.token);
      if (seatFd) sessionStorage.setItem(`gng:autoseat:${r.code}`, "FD");
      navigate(`/r/${r.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create a room.");
    } finally {
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    setBusy("join");
    setError(null);
    try {
      const r = await joinRoom(c, joinNick.trim());
      saveNick(joinNick.trim());
      saveToken(c, r.token);
      navigate(`/r/${c}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join that room.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <section className="landing-hero">
        <div>
          <div className="brand">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4l4 10v10h-8V14z" fill="#DCE6EE" /><path d="M13 25h6l-3 5z" fill="#FF8A3D" /></svg>
            Go/No-Go
          </div>
          <h1 className="hero-title">Launch control, shared with AI</h1>
          <p className="hero-lede">A launch control room where AI agents and people share a mission, but not every secret.</p>
          <div className="hero-actions">
            <form className="card" onSubmit={start}>
              <h2 style={{ fontSize: 22, marginBottom: 10 }}>Start a launch</h2>
              <div className="row">
                <div className="field">
                  <label htmlFor="nick">Your nickname</label>
                  <input id="nick" className="input" required maxLength={LIMITS.nickname} value={nickname} onChange={(e) => setNickname(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="scenario">Scenario</label>
                  <select id="scenario" className="input" value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioSetting)}>
                    {SCENARIO_IDS.map((s) => <option key={s} value={s}>{s === "SURPRISE" || s === "S0" ? SCENARIO_LABELS[s] : `${s}: ${SCENARIO_LABELS[s]}`}</option>)}
                  </select>
                </div>
                <div className="field" style={{ flex: "0 0 90px" }}>
                  <label htmlFor="ts">Speed</label>
                  <select id="ts" className="input" value={timescale} onChange={(e) => setTimescale(Number(e.target.value))}>
                    {TIMESCALES.map((t) => <option key={t} value={t}>{t}x</option>)}
                  </select>
                </div>
              </div>
              <label className="toggle small" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={seatFd} onChange={(e) => setSeatFd(e.target.checked)} /> Seat me as Flight Director
              </label>
              <div style={{ marginTop: 12 }}>
                <button className="btn primary" disabled={busy !== null || !nickname.trim()}>{busy === "create" ? "Opening the control room…" : "Start a launch"}</button>
              </div>
            </form>
            <form className="card" onSubmit={join}>
              <h2 style={{ fontSize: 22, marginBottom: 10 }}>Join with a code</h2>
              <div className="row">
                <div className="field">
                  <label htmlFor="code">Room code</label>
                  <input id="code" className="input num" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: "0.15em" }} autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="jnick">Your nickname</label>
                  <input id="jnick" className="input" required maxLength={LIMITS.nickname} value={joinNick} onChange={(e) => setJoinNick(e.target.value)} />
                </div>
                <button className="btn" disabled={busy !== null || code.trim().length !== 6 || !joinNick.trim()}>{busy === "join" ? "Joining…" : "Join"}</button>
              </div>
            </form>
            {error && <p role="alert" className="lamp NO_GO">{error}</p>}
          </div>
        </div>
        <div className="scene" aria-hidden="false">
          <HeroScene />
        </div>
      </section>

      <section className="section">
        <h2>What you are looking at</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Five consoles run a fictional rocket launch: Weather, Propulsion, Guidance, Range Safety, and the Flight Director. Each is staffed by an AI agent until a person takes it over. Open several tabs, take different consoles, start the countdown, and watch one problem ripple across the room, each console seeing a different slice of the same event.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="concept-table">
            <thead><tr><th>The idea</th><th>In the control room</th><th>At work</th></tr></thead>
            <tbody>
              {CONCEPTS.map(([a, b, c]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td><td className="muted">{c}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Concept lens explainers</h2>
        <p className="muted">Turn on the concept lens inside a room to see these notes appear as things happen.</p>
        <div className="explainers">
          {EXPLAINERS.map(([id, title, body]) => (
            <article key={id} id={`lens-${id}`} className="card">
              <h3 style={{ fontSize: 19, marginBottom: 6 }}>{title}</h3>
              <p style={{ margin: 0 }}>{body}</p>
            </article>
          ))}
        </div>
      </section>
      <footer className="footer">
        Everything here is fictional: Kestrel-2, Aurora-3, Cape Meridian, and every number and procedure. Nicknames only; room data is deleted when the room expires.
      </footer>
    </main>
  );
}
