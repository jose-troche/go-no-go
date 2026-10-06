import { describe, expect, it } from "vitest";
import { runHeadless, viewer } from "../src/server/room/headless";
import { buildSnapshot } from "../src/server/room/egress";
import { ANOMALY_IDS, type ScenarioSetting } from "../src/shared/phases";
import { STATIONS, type Role } from "../src/shared/roles";
import { defaultVisibility, intersectVisibility, leaks, levelForVisibility, projectSignal, projectTelemetry, telemetryLevel } from "../src/server/policy/policy";
import { CHANNELS } from "../src/shared/channels";

const FORBIDDEN = /"(prop\.|gnc\.|rso\.|wx\.upper)[a-z_]*"\s*:/;

describe("visibility matrix (spec 12.3)", () => {
  const domainRows = [
    ["wx", "WX"],
    ["prop", "PROP"],
    ["gnc", "GNC"],
    ["rso", "RSO"],
  ] as const;
  it.each(domainRows)("%s observations: FD and owner FULL, other stations SUMMARY, public NONE", (domain, owner) => {
    const v = defaultVisibility("observation", domain, owner, `sensor:${domain}.x`);
    for (const r of [...STATIONS, "PUBLIC"] as Role[]) {
      const lvl = levelForVisibility({ sid: "x", nick: "x", role: r, creator: false, seated: false }, v);
      expect(lvl).toBe(r === "FD" || r === owner ? "FULL" : r === "PUBLIC" ? "NONE" : "SUMMARY");
    }
  });
  it("station status and decisions are FULL to all stations and NONE to public", () => {
    for (const k of ["status", "decision"] as const) {
      const v = defaultVisibility(k, "fd", "FD", "x");
      expect(v.full.sort()).toEqual([...STATIONS].sort());
      expect(v.full).not.toContain("PUBLIC");
    }
  });
  it("waivers and conflicts: FD plus own station only", () => {
    expect(defaultVisibility("waiver", "wx", "WX", "w").full.sort()).toEqual(["FD", "WX"]);
    expect(defaultVisibility("conflict", "prop", "PROP", "c").full.sort()).toEqual(["FD", "PROP"]);
  });
  it("upper shear is shared with GNC (signal subscriber) and hidden from others", () => {
    const v = defaultVisibility("observation", "wx", "WX", "sensor:wx.upper_shear");
    expect(v.full).toContain("GNC");
    expect(v.summary).toEqual([]);
  });
  it("sim director events are creator-only", () => {
    const v = { full: ["DIRECTOR" as const], summary: [] };
    expect(levelForVisibility({ sid: "a", nick: "a", role: "FD", creator: false, seated: false }, v)).toBe("NONE");
    expect(levelForVisibility({ sid: "a", nick: "a", role: "PUBLIC", creator: true, seated: false }, v)).toBe("FULL");
  });
  it("derived visibility is the per-role minimum of parents", () => {
    const a = defaultVisibility("observation", "wx", "WX", "sensor:wx.upper_shear");
    const b = defaultVisibility("observation", "gnc", "GNC", "sensor:gnc.traj_margin");
    const d = intersectVisibility([a, b]);
    expect(d.full.sort()).toEqual(["FD", "GNC"]);
    expect(d.summary).toContain("WX");
    expect(d.summary).not.toContain("PROP");
  });
});

describe("telemetry and signals", () => {
  it("public receives only public-tier channels", () => {
    const p = viewer("PUBLIC");
    for (const c of CHANNELS) {
      const lvl = telemetryLevel(p, c);
      if (c.startsWith("prop.") || c.startsWith("gnc.") || c.startsWith("rso.") || c === "wx.upper_shear") expect(lvl).toBe("NONE");
    }
    const t = projectTelemetry(p, { "wx.surface_wind": 11.6, "prop.lox_psi_a": 52 });
    expect(t).toEqual({ "wx.surface_wind": 12 });
  });
  it("GNC gets upper shear at full detail", () => {
    expect(telemetryLevel(viewer("GNC"), "wx.upper_shear")).toBe("FULL");
    expect(telemetryLevel(viewer("PROP"), "wx.upper_shear")).toBe("NONE");
  });
  it("signal payloads are filtered per subscriber", () => {
    expect(projectSignal(viewer("PROP"), "wx.upper_winds", { shear: 0.7 })).toBeNull();
    expect(projectSignal(viewer("GNC"), "wx.upper_winds", { shear: 0.7 })).toEqual({ shear: 0.7 });
    expect(projectSignal(viewer("PUBLIC"), "rso.range_status", { clear: false, intrusions: 1 })).toEqual({ clear: false });
  });
  it("leak guard flags forbidden keys only for public", () => {
    expect(leaks(viewer("PUBLIC"), JSON.stringify({ "prop.lox_psi_a": 1 }))).toBe(true);
    expect(leaks(viewer("FD"), JSON.stringify({ "prop.lox_psi_a": 1 }))).toBe(false);
  });
});

describe("AC-03: spectator invariant across every scenario", () => {
  it.each([...ANOMALY_IDS, "S0", "SURPRISE"] as ScenarioSetting[])("%s", (scenario) => {
    const r = runHeadless({ scenario, viewers: ["PUBLIC"] });
    for (const m of r.messages.PUBLIC) {
      const s = JSON.stringify(m);
      expect(s).not.toMatch(FORBIDDEN);
      if (m.type === "fact") expect(m.fact.station === "SYS" || m.fact.kind === "statement" || m.fact.kind === "event").toBe(true);
    }
    const snap = JSON.stringify(buildSnapshot(r.room, viewer("PUBLIC")));
    expect(snap).not.toMatch(FORBIDDEN);
    const statuses = r.messages.PUBLIC.filter((m) => m.type === "tick").map((m) => (m.type === "tick" ? m.statuses : {}));
    expect(statuses.every((s) => Object.keys(s).length === 0)).toBe(true);
  });
});

describe("AC-04: WX sees PROP status but no pressure values during S2", () => {
  it("receives summaries only", () => {
    const r = runHeadless({ scenario: "S2", viewers: ["WX"] });
    let sawPropStatus = false;
    for (const m of r.messages.WX) {
      const s = JSON.stringify(m);
      expect(s).not.toMatch(/prop\.lox_psi|"psi"/);
      if (m.type === "tick" && m.statuses.PROP) sawPropStatus = true;
      if (m.type === "fact" && m.fact.station === "PROP" && m.fact.kind === "observation") expect(m.fact.level).toBe("SUMMARY");
      if (m.type === "fact" && m.fact.kind === "conflict") throw new Error("WX must not see conflicts");
    }
    expect(sawPropStatus).toBe(true);
  });
});

describe("AC-14: public lower third during S3", () => {
  it("shows a promoted range statement with no vessel details", () => {
    const r = runHeadless({ scenario: "S3", viewers: ["PUBLIC"] });
    const statements = r.messages.PUBLIC.filter((m) => m.type === "fact" && m.fact.kind === "statement");
    const range = statements.find((m) => m.type === "fact" && m.fact.summary_text === "The range is not yet clear.");
    expect(range).toBeDefined();
    if (range?.type === "fact" && range.fact.level === "FULL") expect(range.fact.promoted_by).toContain("tpl.public.range");
    for (const m of r.messages.PUBLIC) expect(JSON.stringify(m)).not.toMatch(/vessel|rso\.vessels/i);
  });
});
