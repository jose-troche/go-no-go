// Append-only fact ledger with provenance (spec 11). In-memory; persistence is a hook.
import type { Fact, FactKind, SourceType, Visibility, WhyNode } from "../../shared/protocol";
import type { Domain } from "../../shared/channels";
import type { Station } from "../../shared/roles";
import { defaultVisibility, intersectVisibility, project, type Principal, type LedgerView } from "../policy/policy";
import type { FactRow } from "./schema";

export interface FactDraft {
  kind: FactKind;
  domain: Domain;
  entity: string;
  attribute: string;
  value: unknown;
  summary_text: string;
  source_type: SourceType;
  source_ref?: string | null;
  asserted_by: string;
  station: Station | "SYS";
  confidence?: number;
  derived_from?: string[];
  /** Explicit visibility (for example FD-only denial logs or director events). */
  visibility?: Visibility;
  /** Promotion template id: the template defines visibility and promoted_by is set (spec 11.4). */
  promotion?: { template: string; by: string; visibility: Visibility };
  valid_until?: number | null;
  /** Defaults to true: a new fact supersedes the current fact for its entity and attribute. */
  supersede?: boolean;
}

export interface Clock {
  simTime: number;
  absTime: number;
  now: number;
}

export const WHY_DEPTH_LIMIT = 6;

export class Ledger implements LedgerView {
  private facts: Fact[] = [];
  private byId = new Map<string, Fact>();
  private current = new Map<string, string>();
  private superseded = new Set<string>();
  private seq = 0;
  /** Facts already persisted (restored on restart); appends with these seqs reuse the stored row. */
  private restored = new Map<number, Fact>();

  constructor(private onAppend?: (f: Fact) => void) {}

  setPersistHook(fn: ((f: Fact) => void) | undefined) {
    this.onAppend = fn;
  }

  /** Loads persisted facts so a deterministic replay can match them instead of writing duplicates. */
  restore(facts: Fact[]) {
    for (const f of facts) this.restored.set(f.seq, f);
  }

  all(): readonly Fact[] {
    return this.facts;
  }
  get(id: string): Fact | undefined {
    return this.byId.get(id);
  }
  size(): number {
    return this.facts.length;
  }

  append(d: FactDraft, clock: Clock): Fact {
    const seq = ++this.seq;
    const id = `f_${String(seq).padStart(4, "0")}`;
    const derived = (d.derived_from ?? []).filter((x) => this.byId.has(x));
    let visibility: Visibility;
    let promoted_by: string | null = null;
    if (d.promotion) {
      visibility = d.promotion.visibility;
      promoted_by = `${d.promotion.by}:${d.promotion.template}`;
    } else if (d.visibility) {
      visibility = d.visibility;
    } else if (derived.length) {
      visibility = intersectVisibility(derived.map((x) => this.byId.get(x)!.visibility));
    } else {
      visibility = defaultVisibility(d.kind, d.domain, d.station, d.entity);
    }
    const key = `${d.entity}|${d.attribute}`;
    const prev = d.supersede === false ? undefined : this.current.get(key);
    const restored = this.restored.get(seq);
    const fact: Fact = {
      id,
      seq,
      sim_time: Math.round(clock.simTime * 10) / 10,
      abs_time: Math.round(clock.absTime * 10) / 10,
      created_at: restored?.created_at ?? clock.now,
      kind: d.kind,
      domain: d.domain,
      entity: d.entity,
      attribute: d.attribute,
      value: d.value ?? null,
      summary_text: d.summary_text,
      source_type: d.source_type,
      source_ref: d.source_ref ?? null,
      asserted_by: d.asserted_by,
      station: d.station,
      confidence: d.confidence ?? (d.source_type === "agent" ? 0.9 : 1),
      visibility,
      derived_from: derived,
      supersedes: prev ?? null,
      valid_until: d.valid_until ?? null,
      promoted_by,
    };
    this.facts.push(fact);
    this.byId.set(id, fact);
    if (prev) this.superseded.add(prev);
    if (d.supersede !== false) this.current.set(key, id);
    if (restored) this.restored.delete(seq);
    else this.onAppend?.(fact);
    return fact;
  }

  /** Current state for an entity and attribute: newest fact not superseded and not expired. */
  currentFact(entity: string, attribute: string, absTime?: number): Fact | undefined {
    const id = this.current.get(`${entity}|${attribute}`);
    if (!id) return undefined;
    const f = this.byId.get(id)!;
    if (absTime !== undefined && f.valid_until !== null && absTime > f.valid_until) return undefined;
    return f;
  }

  isSuperseded(id: string): boolean {
    return this.superseded.has(id);
  }

  /** Walks derived_from, projecting every node through the viewer's principal (spec 11.3, 12.5). */
  whyChain(p: Principal, factId: string): WhyNode[] {
    const out: WhyNode[] = [];
    const root = this.byId.get(factId);
    if (!root) return out;
    const rootProj = project(p, root);
    if (!rootProj) return out;
    out.push({ depth: 0, fact: rootProj });
    const seen = new Set<string>([factId]);
    const walk = (f: typeof root, depth: number) => {
      if (depth > WHY_DEPTH_LIMIT) return;
      let hidden = 0;
      for (const pid of f.derived_from) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const parent = this.byId.get(pid);
        if (!parent) continue;
        const proj = project(p, parent);
        if (!proj) {
          hidden++;
          continue;
        }
        out.push({ depth, fact: proj });
        walk(parent, depth + 1);
      }
      if (hidden) out.push({ depth, hidden: true, count: hidden });
    };
    walk(root, 1);
    return out;
  }
}

export function factToRow(f: Fact): FactRow {
  return {
    id: f.id,
    seq: f.seq,
    sim_time: f.sim_time,
    abs_time: f.abs_time,
    created_at: f.created_at,
    kind: f.kind,
    domain: f.domain,
    entity: f.entity,
    attribute: f.attribute,
    value: JSON.stringify(f.value ?? null),
    summary_text: f.summary_text,
    source_type: f.source_type,
    source_ref: f.source_ref,
    asserted_by: f.asserted_by,
    station: f.station,
    confidence: f.confidence,
    vis_full: JSON.stringify(f.visibility.full),
    vis_summary: JSON.stringify(f.visibility.summary),
    derived_from: JSON.stringify(f.derived_from),
    supersedes: f.supersedes,
    valid_until: f.valid_until,
    promoted_by: f.promoted_by,
  };
}

export function rowToFact(r: FactRow): Fact {
  return {
    id: r.id,
    seq: r.seq,
    sim_time: r.sim_time,
    abs_time: r.abs_time,
    created_at: r.created_at,
    kind: r.kind as Fact["kind"],
    domain: r.domain as Fact["domain"],
    entity: r.entity,
    attribute: r.attribute,
    value: JSON.parse(r.value),
    summary_text: r.summary_text,
    source_type: r.source_type as Fact["source_type"],
    source_ref: r.source_ref,
    asserted_by: r.asserted_by,
    station: r.station as Fact["station"],
    confidence: r.confidence,
    visibility: { full: JSON.parse(r.vis_full), summary: JSON.parse(r.vis_summary) },
    derived_from: JSON.parse(r.derived_from),
    supersedes: r.supersedes,
    valid_until: r.valid_until,
    promoted_by: r.promoted_by,
  };
}
