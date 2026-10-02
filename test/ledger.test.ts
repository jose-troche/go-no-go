import { describe, expect, it } from "vitest";
import { Ledger } from "../src/server/ledger/ledger";
import { runHeadless, viewer } from "../src/server/room/headless";
import { VIS } from "../src/server/policy/policy";

const clock = { simTime: -100, absTime: 800, now: 1 };

describe("ledger", () => {
  it("supersedes the current fact for the same entity and attribute", () => {
    const l = new Ledger();
    const a = l.append({ kind: "observation", domain: "wx", entity: "sensor:x", attribute: "value_band", value: 1, summary_text: "a", source_type: "sensor", asserted_by: "sensor", station: "WX" }, clock);
    const b = l.append({ kind: "observation", domain: "wx", entity: "sensor:x", attribute: "value_band", value: 2, summary_text: "b", source_type: "sensor", asserted_by: "sensor", station: "WX" }, clock);
    expect(b.supersedes).toBe(a.id);
    expect(l.currentFact("sensor:x", "value_band")?.id).toBe(b.id);
    expect(l.isSuperseded(a.id)).toBe(true);
  });
  it("expires perishable facts", () => {
    const l = new Ledger();
    l.append({ kind: "observation", domain: "wx", entity: "sensor:l", attribute: "b", value: 1, summary_text: "l", source_type: "sensor", asserted_by: "sensor", station: "WX", valid_until: 900 }, clock);
    expect(l.currentFact("sensor:l", "b", 899)).toBeDefined();
    expect(l.currentFact("sensor:l", "b", 901)).toBeUndefined();
  });
  it("intersects parents' visibility for derived facts, and promotion widens it", () => {
    const l = new Ledger();
    const wx = l.append({ kind: "observation", domain: "wx", entity: "sensor:wx.upper_shear", attribute: "v", value: 1, summary_text: "s", source_type: "sensor", asserted_by: "sensor", station: "WX" }, clock);
    const d = l.append({ kind: "assessment", domain: "gnc", entity: "derived", attribute: "a", value: 1, summary_text: "d", source_type: "agent", asserted_by: "agent:gnc", station: "GNC", derived_from: [wx.id] }, clock);
    expect(d.visibility.full).not.toContain("PROP");
    const p = l.append({ kind: "statement", domain: "sys", entity: "pub", attribute: "t", value: 1, summary_text: "p", source_type: "template", asserted_by: "agent:wx", station: "SYS", derived_from: [d.id], promotion: { template: "tpl.x", by: "agent:wx", visibility: VIS.everyone() } }, clock);
    expect(p.visibility.full).toContain("PUBLIC");
    expect(p.promoted_by).toBe("agent:wx:tpl.x");
  });
  it("reuses restored rows on replay instead of writing duplicates", () => {
    const writes: string[] = [];
    const l1 = new Ledger((f) => writes.push(f.id));
    const f = l1.append({ kind: "event", domain: "sys", entity: "e", attribute: "a", value: 1, summary_text: "e", source_type: "rule", asserted_by: "rule", station: "SYS" }, clock);
    const l2 = new Ledger((x) => writes.push(`dup:${x.id}`));
    l2.restore([f]);
    l2.append({ kind: "event", domain: "sys", entity: "e", attribute: "a", value: 1, summary_text: "e", source_type: "rule", asserted_by: "rule", station: "SYS" }, { ...clock, now: 999 });
    expect(writes).toEqual([f.id]);
    expect(l2.all()[0].created_at).toBe(1);
  });
});

describe("AC-06: why-chain hides WX parents from PROP", () => {
  it("shows GNC's status, then hidden sources", () => {
    const r = runHeadless({ scenario: "S1" });
    const status = r.room.ledger.all().find((f) => f.kind === "status" && f.station === "GNC" && (f.value as { status: string }).status === "NO_GO")!;
    expect(status).toBeDefined();
    const chain = r.room.ledger.whyChain(viewer("PROP"), status.id);
    expect("fact" in chain[0] && chain[0].fact.id).toBe(status.id);
    expect(chain.some((n) => "hidden" in n)).toBe(true);
    for (const n of chain) if ("fact" in n) expect(n.fact.station === "WX" && n.fact.level === "FULL").toBe(false);
    // FD sees the whole chain, including WX facts.
    const fd = r.room.ledger.whyChain(viewer("FD"), status.id);
    expect(fd.some((n) => "fact" in n && n.fact.station === "WX")).toBe(true);
    expect(fd.some((n) => "hidden" in n)).toBe(false);
  });
});
