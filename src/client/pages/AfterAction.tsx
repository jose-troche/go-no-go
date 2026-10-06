import { useMemo, useState } from "react";
import { PHASE_LABELS, SCENARIO_IDS, SCENARIO_LABELS, formatClock } from "../../shared/phases";
import { ROLE_NAMES } from "../../shared/roles";
import { FactRow } from "../components/LedgerTimeline";
import { WhyChain } from "../components/WhyChain";
import { LensNote, useRoomCtx } from "../components/context";

const KEY_KINDS = new Set(["decision", "conflict", "waiver", "status", "statement", "event", "assessment"]);

export function AfterAction() {
  const { state, send, closeWhy } = useRoomCtx();
  const [copied, setCopied] = useState(false);
  const [requested, setRequested] = useState(false);
  const facts = useMemo(() => (state?.facts ?? []).filter((f) => KEY_KINDS.has(f.kind)), [state?.facts]);
  if (!state) return null;
  const polls = facts.filter((f) => f.level === "FULL" && f.entity.startsWith("poll:") && f.attribute === "state" && (f.value as { state?: string })?.state === "closed");
  // Public summary: built only from facts visible to the public (promoted statements).
  const publicSummary = state.facts.filter((f) => f.kind === "statement").map((f) => `${formatClock(f.sim_time)}  ${f.summary_text}`).join("\n");

  return (
    <main className="aar">
      <div>
        <h1 style={{ fontSize: 34 }}>After-action report</h1>
        <p className="muted" style={{ margin: 0 }}>
          Room {state.code} · {PHASE_LABELS[state.phase]} · as seen from {state.you.role === "PUBLIC" ? "the public view" : `the ${ROLE_NAMES[state.you.role]} console`} · {state.hiddenCount} facts hidden from you
        </p>
        <LensNote topic="provenance">This report is projected through your permissions. Another console reading the same mission sees a different report.</LensNote>
      </div>

      {state.you.creator && state.phase === "ENDED" && (
        <section className="card next-card">
          <div>
            <h2 style={{ fontSize: 22 }}>Run it again</h2>
            <p className="small muted" style={{ margin: "4px 0 0" }}>Each scenario shows a different team-agent pattern. Try another one, or switch roles mid-run to compare views.</p>
          </div>
          <div className="next-actions">
            {SCENARIO_IDS.map((s) => (
              <button key={s} className="btn small" onClick={() => send({ type: "room.reset", scenario: s })}>
                {SCENARIO_LABELS[s]}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel grid-bg">
        <div className="panel-title">
          <span>Narrative</span>
          {!state.aar && (
            <button className="btn small" disabled={requested} onClick={() => { setRequested(true); send({ type: "aar.request" }); }}>
              {requested ? "Writing…" : "Write the narrative"}
            </button>
          )}
        </div>
        {state.aar ? (
          <>
            <p style={{ margin: 0 }}>{state.aar.narrative}</p>
            <p className="small muted">{state.aar.source === "llm" ? "Written by the LLM from facts visible to you." : "Template summary from facts visible to you."}</p>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>A short summary written only from the facts you can see.</p>
        )}
      </section>

      {polls.length > 0 && (
        <section className="panel grid-bg">
          <h3>Polls</h3>
          {polls.map((p) => {
            const v = p.level === "FULL" ? (p.value as { result: string; answers: Array<{ station: string; answer: string | null; by: string | null }> }) : null;
            return (
              <div key={p.id} className="small" style={{ marginBottom: 6 }}>
                <b className="num">{formatClock(p.sim_time)}</b> {v?.result === "ALL_GO" ? "All stations GO" : "Not GO"}:{" "}
                {v?.answers.map((a) => `${a.station} ${a.answer ?? "none"}${a.by === "human" ? " (human)" : ""}`).join(", ")}
              </div>
            );
          })}
        </section>
      )}

      <section className="panel grid-bg">
        <div className="panel-title">
          <span>Timeline</span>
          <button
            className="btn small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`Kestrel-2 / Aurora-3 launch, room ${state.code}\n${publicSummary}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {copied ? "Copied" : "Copy public summary"}
          </button>
        </div>
        {state.why && <WhyChain chain={state.why.chain} onClose={closeWhy} />}
        <div className="timeline">
          {facts.map((f) => <FactRow key={f.id} f={f} onWhy={(id) => send({ type: "why", factId: id })} />)}
          {!facts.length && <p className="muted">No events yet.</p>}
        </div>
      </section>
    </main>
  );
}
