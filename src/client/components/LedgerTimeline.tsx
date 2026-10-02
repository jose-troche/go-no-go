import { useMemo, useState } from "react";
import { formatClock } from "../../shared/phases";
import { STATION_NAMES } from "../../shared/roles";
import type { FactProjection } from "../../shared/protocol";
import { WhyChain } from "./WhyChain";
import { useRoomCtx } from "./context";

const KINDS = ["all", "status", "decision", "observation", "assessment", "conflict", "waiver", "statement", "event"] as const;

export function FactRow({ f, onWhy }: { f: FactProjection; onWhy?: (id: string) => void }) {
  return (
    <div className={`fact ${f.level === "SUMMARY" ? "summary" : ""}`}>
      <span className="id">{f.id}</span>
      <span className="kind chip">{f.kind}</span>
      <span className="text">
        {f.summary_text}
        {f.level === "SUMMARY" && <span className="small muted"> · summary only</span>}
      </span>
      {onWhy ? (
        <button className="btn link" onClick={() => onWhy(f.id)} aria-label={`Why? for ${f.id}`}>Why?</button>
      ) : (
        <span />
      )}
      <span className="meta">
        {formatClock(f.sim_time)} · {f.station === "SYS" ? "system" : STATION_NAMES[f.station]}
        {f.level === "FULL" && (
          <>
            {" "}· {f.source_type}
            {f.confidence < 1 ? ` · confidence ${f.confidence}` : ""}
            {f.derived_from.length ? ` · from ${f.derived_from.length} source${f.derived_from.length > 1 ? "s" : ""}` : ""}
            {f.promoted_by ? " · promoted by template" : ""}
            {f.supersedes ? ` · supersedes ${f.supersedes}` : ""}
          </>
        )}
      </span>
    </div>
  );
}

export function LedgerTimeline() {
  const { state, send, closeWhy } = useRoomCtx();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const facts = useMemo(() => {
    const list = (state?.facts ?? []).filter((f) => kind === "all" || f.kind === kind);
    return [...list].reverse();
  }, [state?.facts, kind]);
  if (!state) return null;
  return (
    <section className="panel grid-bg" aria-label="Ledger timeline">
      <div className="panel-title">
        <span>Ledger: facts visible to you <span className="small muted">({state.facts.length} visible, {state.hiddenCount} hidden)</span></span>
        <select className="input" style={{ width: "auto", minHeight: 30, padding: "2px 6px" }} value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} aria-label="Filter by kind">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      {state.why && <WhyChain chain={state.why.chain} onClose={closeWhy} />}
      <div className="ledger-list">
        {facts.map((f) => <FactRow key={f.id} f={f} onWhy={(id) => send({ type: "why", factId: id })} />)}
        {!facts.length && <p className="muted">No facts yet.</p>}
      </div>
    </section>
  );
}
