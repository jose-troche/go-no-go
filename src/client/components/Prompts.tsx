import { useState } from "react";
import { STATION_NAMES } from "../../shared/roles";
import { LIMITS, type PromptView } from "../../shared/protocol";
import { useFrame } from "../hooks/motion";
import { TOKENS } from "../../shared/tokens";
import { LensNote, useRoomCtx } from "./context";
import { promptId } from "../hooks/useRoom";

function CountdownRing({ total, deadline }: { total: number; deadline: number }) {
  const now = useFrame(15);
  const left = Math.max(0, deadline - now);
  const f = total > 0 ? left / total : 0;
  const c = 2 * Math.PI * 16;
  return (
    <svg width={40} height={40} viewBox="0 0 40 40" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <circle cx={20} cy={20} r={16} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={4} />
      <circle cx={20} cy={20} r={16} fill="none" stroke="#1a1208" strokeWidth={4} strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 20 20)" />
      <text x={20} y={25} textAnchor="middle" fontSize={13} fill="#1a1208" fontFamily="Barlow Condensed" fontWeight={600}>{Math.ceil(left / 1000)}</text>
    </svg>
  );
}

function PollConfirm({ p, at }: { p: Extract<PromptView, { kind: "poll_confirm" }>; at: number }) {
  const { send } = useRoomCtx();
  const deadline = at + p.data.deadlineMs;
  return (
    <div className="prompt" role="alertdialog" aria-label="Confirm your poll answer">
      <h4>Flight Director: "{STATION_NAMES[p.data.station]}?"</h4>
      <p className="small" style={{ marginTop: 0 }}>Your station reads GO. Confirm within {p.data.seconds} seconds or the poll records STANDBY.</p>
      <button className="btn primary confirm-btn" autoFocus onClick={() => send({ type: "poll.confirm", pollId: p.data.pollId })}>
        <CountdownRing total={p.data.deadlineMs} deadline={deadline} />
        {STATION_NAMES[p.data.station]} is GO
      </button>
      <LensNote topic="hitl">Fail-safe asymmetry: an agent may stop the count on its own, but a seated human must confirm a GO.</LensNote>
    </div>
  );
}

function ConflictCard({ p }: { p: Extract<PromptView, { kind: "conflict" }> }) {
  const { send } = useRoomCtx();
  const [reason, setReason] = useState("");
  const c = p.data;
  const remaining = Math.max(0, c.graceSeconds - c.ageSeconds);
  return (
    <div className="prompt" role="alertdialog" aria-label="Sensor conflict">
      <h4>{c.title}</h4>
      <div className="readouts">
        {c.sources?.map((s) => (
          <div key={s.label} className="readout-box"><div className="label">{s.label}</div><div className="value">{s.value.toFixed(1)} <span className="small muted">{s.unit}</span></div></div>
        ))}
        {c.corroborating?.map((s) => (
          <div key={s.label} className="readout-box"><div className="label">{s.label} (corroborating)</div><div className="value" style={{ color: s.nominal ? TOKENS.go : TOKENS.watch }}>{s.value.toFixed(1)} <span className="small muted">{s.unit}</span></div></div>
        ))}
      </div>
      <p className="small">{remaining > 0 ? `Propulsion goes NO-GO in ${Math.ceil(remaining)} sim seconds if unresolved.` : "Unresolved past the grace period: Propulsion is NO-GO."}</p>
      <div className="field">
        <label htmlFor="conflict-reason">Reason (recorded with your name)</label>
        <input id="conflict-reason" className="input" maxLength={LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="options">
        {c.options?.map((o) => (
          <div key={o.choice} className="option">
            <button className={`btn ${o.choice === "trust_a" ? "" : "primary"}`} disabled={!o.allowed || (o.choice === "trust_a" && !reason.trim())} onClick={() => send({ type: "conflict.resolve", conflictId: c.id, choice: o.choice, reason })}>
              {o.label}
            </button>
            <p className="small" style={{ margin: "6px 0 0" }}>{o.consequence}</p>
            {!o.allowed && o.why && <p className="small muted" style={{ margin: 0 }}>{o.why}</p>}
            {o.allowed && o.choice === "trust_a" && !reason.trim() && <p className="small muted" style={{ margin: 0 }}>Enter a reason to trust sensor A.</p>}
          </div>
        ))}
      </div>
      <LensNote topic="conflicts">Two sources disagree. The system refuses to guess: no averaging, no silent pick.</LensNote>
    </div>
  );
}

function WaiverDecision({ p }: { p: Extract<PromptView, { kind: "waiver_decision" }> }) {
  const { send } = useRoomCtx();
  const [reason, setReason] = useState("");
  const w = p.data;
  return (
    <div className="prompt" role="alertdialog" aria-label="Waiver decision">
      <h4>Waiver request: {w.lccId}</h4>
      <p className="small" style={{ marginTop: 0 }}>{w.lccLabel}. Requested by {w.requestedBy} ({STATION_NAMES[w.station]}): "{w.reason}"</p>
      <div className="field">
        <label htmlFor="waiver-reason">Your reason</label>
        <input id="waiver-reason" className="input" maxLength={LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => send({ type: "waiver.decide", waiverId: w.id, approve: true, reason })}>Approve</button>
        <button className="btn danger" onClick={() => send({ type: "waiver.decide", waiverId: w.id, approve: false, reason })}>Deny</button>
      </div>
      <LensNote topic="authority">Only a human Flight Director can approve this. The FD agent never approves waivers.</LensNote>
    </div>
  );
}

export function Prompts() {
  const { state } = useRoomCtx();
  if (!state || !state.prompts.length) return null;
  return (
    <div className="prompt-layer">
      {state.prompts.map((p) =>
        p.kind === "poll_confirm" ? (
          <PollConfirm key={`pc${promptId(p)}`} p={p} at={p.at} />
        ) : p.kind === "conflict" ? (
          <ConflictCard key={`c${promptId(p)}`} p={p} />
        ) : (
          <WaiverDecision key={`w${promptId(p)}`} p={p} />
        ),
      )}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useRoomCtx();
  if (!toasts.length) return null;
  return (
    <div className="toast-layer" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span>{t.text}</span>
          <button className="btn link" onClick={() => dismissToast(t.id)} aria-label="Dismiss">Dismiss</button>
        </div>
      ))}
    </div>
  );
}
