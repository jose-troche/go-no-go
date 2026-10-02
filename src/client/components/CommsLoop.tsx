import { useEffect, useRef, useState } from "react";
import { formatClock } from "../../shared/phases";
import { STATION_NAMES, type Station } from "../../shared/roles";
import { LIMITS } from "../../shared/protocol";
import { StatusLamp } from "./graphics/StatusLamp";
import { LensNote, useRoomCtx } from "./context";

const label = (s: Station | "SYS") => (s === "SYS" ? "Launch control" : STATION_NAMES[s]);

export function CommsLoop({ title = "Comms loop", publicMode = false }: { title?: string; publicMode?: boolean }) {
  const { state, ask } = useRoomCtx();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const items = state?.callouts ?? [];
  const answers = state?.answers ?? [];
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, answers.length, answers.at(-1)?.text]);
  if (!state) return null;
  const poll = state.poll;
  const agentName = state.you.role === "PUBLIC" ? "the public affairs agent" : `your ${STATION_NAMES[state.you.role as Station]} agent`;

  return (
    <section className="panel grid-bg comms" aria-label={title}>
      <h3>{title}</h3>
      {poll && !publicMode && (
        <div className="card" style={{ padding: 8, marginBottom: 8 }} aria-label="Go/no-go poll">
          <div className="small muted">Go/no-go poll {poll.state === "open" ? "in progress" : poll.result === "ALL_GO" ? "· all GO" : "· not GO"}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            {poll.calls.map((c) => (
              <span key={c.station} className="small" title={c.note}>
                {STATION_NAMES[c.station]}{" "}
                {c.answer ? <StatusLamp status={c.answer === "NO_GO" ? "NO_GO" : c.answer === "GO" ? "GO" : "STANDBY"} size={11} /> : <span className="muted">{c.state === "awaiting_human" ? "awaiting human…" : c.state === "calling" ? "calling…" : "·"}</span>}
                {c.by === "human" && <span className="muted"> (human)</span>}
              </span>
            ))}
          </div>
          <LensNote topic="poll">A coordinated decision: every station answers from its own evidence, and a seated human must confirm a GO.</LensNote>
        </div>
      )}
      <div className="comms-list" ref={listRef} aria-live="polite">
        {items.map((c) => (
          <div key={c.id} className="callout">
            <span className="t">{formatClock(c.simTime)}</span>
            <span className="st">{label(c.station)}</span>
            {c.text}
          </div>
        ))}
        {answers.map((a) => (
          <div key={a.id} className="qa">
            {a.question && <div className="q">You asked: {a.question}</div>}
            <div>{a.text ?? <span className="muted">Thinking…</span>}</div>
            {a.text && <div className="small muted">{a.source === "llm" ? "Answered by the LLM from facts visible to you" : "Template answer from facts visible to you"}</div>}
          </div>
        ))}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          const q = text.trim();
          if (!q) return;
          ask(q);
          setText("");
        }}
      >
        <input className="input" value={text} maxLength={LIMITS.question} onChange={(e) => setText(e.target.value)} placeholder={`Ask ${agentName}…`} aria-label={`Ask ${agentName}`} />
        <button className="btn" type="submit" disabled={!text.trim()}>Ask</button>
      </form>
      {state.you.role === "PUBLIC" && (
        <LensNote topic="injection">The public agent only ever receives public facts, so even a clever prompt cannot reveal restricted data: it was never in the prompt.</LensNote>
      )}
    </section>
  );
}
