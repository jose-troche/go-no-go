import type { WhyNode } from "../../shared/protocol";
import { formatClock } from "../../shared/phases";
import { LensNote } from "./context";

export function WhyChain({ chain, onClose }: { chain: WhyNode[]; onClose(): void }) {
  return (
    <div className="why" role="dialog" aria-label="Why? provenance chain">
      <div className="panel-title">
        <span>Why? Provenance chain</span>
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
      {chain.length === 0 && <p className="muted">That fact is not visible to you.</p>}
      {chain.map((n, i) => (
        <div key={i} className="why-node" style={{ paddingLeft: n.depth * 18 }}>
          {"hidden" in n ? (
            <span className="why-hidden">
              {n.count === 1 ? "1 source hidden from you" : `${n.count} sources hidden from you`}
            </span>
          ) : (
            <span>
              {n.depth > 0 && "↳ "}
              <span className="num muted">{n.fact.id}</span> {n.fact.summary_text}{" "}
              <span className="small muted">
                {formatClock(n.fact.sim_time)} · {n.fact.kind}
                {n.fact.level === "FULL" ? ` · ${n.fact.source_type} · asserted by ${n.fact.asserted_by.replace(/^human:.*/, "a human operator")}` : " · summary only"}
              </span>
            </span>
          )}
        </div>
      ))}
      {chain.some((n) => "hidden" in n) && (
        <LensNote topic="provenance">Provenance is projected through your permissions: you can see that sources exist, never what they say.</LensNote>
      )}
    </div>
  );
}
