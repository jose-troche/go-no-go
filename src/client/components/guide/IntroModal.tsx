// First-visit intro (and on demand from Help): what this is, what it illustrates, and how to use it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SCENARIO_LABELS, type ScenarioSetting } from "../../../shared/phases";
import { INDUSTRIES, SCENARIO_GUIDE } from "../../content/guide";
import { StatusLamp } from "../graphics/StatusLamp";
import { useGuide } from "../context";

const AGENTS: Array<[string, string]> = [
  ["Flight Director", "Runs the countdown and makes the final call"],
  ["Weather", "Winds, lightning, clouds"],
  ["Propulsion", "Fuel, tank pressure, engines"],
  ["Guidance", "Navigation and the flight path's safety margin"],
  ["Range Safety", "The offshore danger zone and tracking"],
];

function SameEventDifferentViews() {
  return (
    <div className="intro-views" aria-label="One event seen by three roles">
      <div className="intro-event">Event: upper-level winds rise</div>
      <div className="intro-view">
        <div className="small muted">Weather sees</div>
        <div className="num big">Shear 0.74</div>
        <div className="small">Limit 0.70 · <StatusLamp status="NO_GO" size={11} /></div>
      </div>
      <div className="intro-view">
        <div className="small muted">Guidance sees</div>
        <div className="num big">Margin 13%</div>
        <div className="small">Computed from Weather's signal. Weather: NO-GO <span className="muted">(summary only)</span></div>
      </div>
      <div className="intro-view">
        <div className="small muted">The public sees</div>
        <div className="big-quote">“The team is holding the count while they work an issue.”</div>
        <div className="small muted">14 facts hidden</div>
      </div>
    </div>
  );
}

function Timeline({ scenario }: { scenario: ScenarioSetting }) {
  return (
    <div className="intro-timeline" aria-hidden="true">
      <div className="bar">
        <span style={{ left: "0%" }}>T-15:00<br /><b>Fueling</b></span>
        <span style={{ left: "38%" }} className="event">Problem<br /><b>Agents flag it</b></span>
        <span style={{ left: "73%" }}>T-04:00<br /><b>Hold and poll</b></span>
        <span style={{ left: "100%" }}>T-0<br /><b>Go or no go</b></span>
      </div>
      <p className="small intro-today">
        Today's scenario: <b>{SCENARIO_LABELS[scenario]}</b>. {SCENARIO_GUIDE[scenario].oneLiner}
      </p>
    </div>
  );
}

export function IntroModal({ scenario }: { scenario: ScenarioSetting }) {
  const { introOpen, closeIntro, startTour } = useGuide();
  const [i, setI] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (introOpen) setI(0);
  }, [introOpen]);
  useEffect(() => {
    if (!introOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeIntro();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [introOpen, closeIntro]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(".intro-actions .primary")?.focus();
  }, [i, introOpen]);

  const slides: Array<{ title: string; body: ReactNode }> = [
    {
      title: "A launch control room run by a team of AI agents",
      body: (
        <>
          <p className="lede">
            Go/No-Go simulates the last 15 minutes before a rocket launch. Five AI agents each own one part of it and share what the others need to know, but not everything.
          </p>
          <div className="intro-agents">
            {AGENTS.map(([n, d]) => (
              <div key={n} className="intro-agent">
                <b>{n}</b>
                <span className="small muted">{d}</span>
              </div>
            ))}
          </div>
          <p className="small muted">The rocket is just a vivid example. The patterns apply to any team of AI agents working for different roles in a company.</p>
        </>
      ),
    },
    {
      title: "Same event, different views",
      body: (
        <>
          <p className="lede">
            When something happens, every role sees the slice it needs. Access is decided by role on the server, so information never leaks to a screen that should not have it.
          </p>
          <SameEventDifferentViews />
          <p className="small intro-today intro-why">
            <b>Why it matters:</b> agents on a team have to share information to work together, but sharing everything turns a helpful assistant into a data leak. An HR agent can tell a manager's agent that a new hire fits the budget without revealing anyone's salary. Getting the right level of detail to each role is what makes multi-agent systems safe to deploy.
          </p>
        </>
      ),
    },
    {
      title: "The mission: go or no go?",
      body: (
        <>
          <p className="lede">
            A timed countdown. Along the way something goes wrong, like a storm, a sensor glitch, or a boat in the danger zone. Agents flag it, the Flight Director holds and polls every station. The goal: launch inside the window, or scrub safely.
          </p>
          <Timeline scenario={scenario} />
        </>
      ),
    },
    {
      title: "You are in the loop",
      body: (
        <ul className="intro-list">
          <li><b>Watch any console.</b> Switch roles to see what each one sees. The agent stays in charge.</li>
          <li><b>Take control.</b> Confirm GO calls, resolve sensor conflicts, request waivers. As Flight Director: hold, resume, scrub, approve waivers.</li>
          <li><b>Rules decide, AI explains.</b> Each status comes from fixed launch rules, so nobody can simply overrule a NO-GO. You act within your role's authority, and some rules can be waived with a human Flight Director's approval.</li>
          <li><b>Stopping is easy, going needs a human.</b> Any agent can halt the count on its own. When a person staffs a console, their GO must be confirmed by them.</li>
          <li><b>Ask your agent.</b> It answers only from facts your role is allowed to see.</li>
        </ul>
      ),
    },
    {
      title: "The same pattern at work",
      body: (
        <>
          <p className="lede">Wherever several specialists must agree before something goes, the same ideas apply:</p>
          <div className="intro-industries">
            {INDUSTRIES.map((x) => (
              <div key={x.title} className="intro-industry">
                <b>{x.title}</b>
                <span className="small">{x.agents}</span>
                <span className="small">Decision: {x.decision}</span>
                <span className="small muted">{x.publicView}</span>
              </div>
            ))}
          </div>
          <p className="small muted">Ask yourself: who owns which data, who needs only the conclusion, who has authority to decide, and what must the outside world never see?</p>
        </>
      ),
    },
  ];
  if (!introOpen) return null;
  const last = i === slides.length - 1;
  const s = slides[i];
  return (
    <div className="modal-backdrop" data-guide-ui="" onClick={(e) => e.target === e.currentTarget && closeIntro()}>
      <div className="modal intro" role="dialog" aria-modal="true" aria-labelledby="intro-title" ref={dialog}>
        <button className="btn link modal-close" onClick={closeIntro} aria-label="Close the introduction">Close</button>
        <div className="intro-dots" aria-hidden="true">
          {slides.map((_, k) => <button key={k} className={k === i ? "on" : ""} tabIndex={-1} onClick={() => setI(k)} />)}
        </div>
        <h2 id="intro-title">{s.title}</h2>
        <div className="intro-body">{s.body}</div>
        <div className="intro-actions">
          <span className="small muted">{i + 1} of {slides.length}</span>
          <span className="spacer" />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          {last ? (
            <>
              <button className="btn" onClick={closeIntro}>Explore on my own</button>
              <button className="btn primary" onClick={() => { closeIntro(); startTour(); }}>Take the 1-minute tour</button>
            </>
          ) : (
            <button className="btn primary" onClick={() => setI(i + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
