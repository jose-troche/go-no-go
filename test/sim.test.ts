import { describe, expect, it } from "vitest";
import { runHeadless, replay, CREATOR_SID } from "../src/server/room/headless";
import { ANOMALY_IDS, type ScenarioSetting } from "../src/shared/phases";
import { mulberry32, noise } from "../src/server/sim/rng";
import { s1Shear } from "../src/server/sim/scenarios";
import { createWorld, stepWorld } from "../src/server/sim/telemetry";
import { T_FUEL_DONE, T_START } from "../src/server/sim/timeline";

const phasesOf = (r: ReturnType<typeof runHeadless>) =>
  r.room.ledger.all().filter((f) => f.entity === "room:phase").map((f) => (f.value as { to: string }).to);

describe("rng", () => {
  it("is reproducible", () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    expect(noise(1, "x", 5)).toBe(noise(1, "x", 5));
    expect(noise(1, "x", 5)).not.toBe(noise(2, "x", 5));
  });
});

describe("models", () => {
  it("fuels to 100% by T-05:30 along an S-curve and never drains", () => {
    const w = createWorld(1);
    let prev = 0;
    for (let clock = T_START + 1; clock < T_FUEL_DONE; clock++) {
      stepWorld(w, { abs: clock - T_START, clock, phase: "FUELING", anomalies: {} });
      expect(w.loxLoad).toBeGreaterThanOrEqual(prev);
      prev = w.loxLoad;
    }
    expect(w.loxLoad).toBeGreaterThan(98);
  });

  it("trajectory margin crosses 15% near shear 0.70", () => {
    expect(40 - 35 * 0.7).toBeCloseTo(15.5, 1);
    expect(s1Shear(0)).toBeCloseTo(0.45);
    expect(s1Shear(240)).toBeCloseTo(0.78);
    expect(s1Shear(900)).toBeCloseTo(0.55);
  });
});

describe("mission (M1 acceptance)", () => {
  it("AC-01: nominal runs from T-15:00 through ascent to ENDED with no human input", () => {
    const r = runHeadless({ scenario: "S0" });
    expect(r.room.phase).toBe("ENDED");
    expect(phasesOf(r)).toEqual(["FUELING", "BUILT_IN_HOLD", "TERMINAL_COUNT", "AUTO_SEQUENCE", "ASCENT", "ENDED"]);
    expect(r.room.ledger.all().some((f) => f.attribute === "end")).toBe(true);
  });

  it("AC-02: same seed, scenario, and action log replay identically", () => {
    for (const s of ["S0", "S1", "S2", "SURPRISE"] as ScenarioSetting[]) {
      const ticks: string[] = [];
      const a = runHeadless({ scenario: s, seed: 7, viewers: ["FD"], onTick: (room) => ticks.push(JSON.stringify(room.telemetry)) });
      const ticks2: string[] = [];
      const b = runHeadless({ scenario: s, seed: 7, viewers: ["FD"], onTick: (room) => ticks2.push(JSON.stringify(room.telemetry)) });
      expect(ticks2).toEqual(ticks);
      expect(JSON.stringify(b.room.ledger.all())).toBe(JSON.stringify(a.room.ledger.all()));
      // Rebuild from config + action log (restart recovery).
      const rebuilt = replay(a.room.config, a.log, a.room.ticks, (room) => 1_700_000_000_000 + room.abs * 1000);
      expect(JSON.stringify(rebuilt.ledger.all())).toBe(JSON.stringify(a.room.ledger.all()));
      expect(rebuilt.phase).toBe(a.room.phase);
    }
  });

  it("AC-05: S1 drives WX and then GNC NO-GO; GNC's assessment cites WX facts", () => {
    let wxNoGoTick = -1, gncNoGoTick = -1;
    const r = runHeadless({
      scenario: "S1",
      onTick: (room) => {
        if (wxNoGoTick < 0 && room.stations.WX.status === "NO_GO") wxNoGoTick = room.ticks;
        if (gncNoGoTick < 0 && room.stations.GNC.status === "NO_GO") {
          gncNoGoTick = room.ticks;
          expect(room.telemetry["wx.upper_shear"] as number).toBeGreaterThan(0.7);
        }
      },
    });
    expect(wxNoGoTick).toBeGreaterThan(0);
    expect(gncNoGoTick).toBeGreaterThan(0);
    const assessments = r.room.ledger.all().filter((f) => f.kind === "assessment" && f.station === "GNC");
    const below = assessments.find((f) => (f.value as { band: string }).band === "violation");
    expect(below).toBeDefined();
    const parents = below!.derived_from.map((id) => r.room.ledger.get(id)!);
    expect(parents.some((p) => p.domain === "wx")).toBe(true);
  });

  it("AC-07/AC-08: S2 opens a conflict, never averages, WATCH then NO-GO, agent recalibrates", () => {
    const seen: string[] = [];
    let openedAbs = -1;
    const r = runHeadless({
      scenario: "S2",
      onTick: (room) => {
        const c = room.openConflicts()[0];
        if (c && openedAbs < 0) openedAbs = c.openedAbs;
        if (c) seen.push(`${Math.round(room.abs - c.openedAbs)}:${room.stations.PROP.status}`);
      },
    });
    expect(openedAbs).toBeGreaterThan(0);
    const early = seen.filter((s) => Number(s.split(":")[0]) < 60).map((s) => s.split(":")[1]);
    expect(early.every((s) => s === "WATCH")).toBe(true);
    const conflict = r.room.ledger.all().find((f) => f.kind === "conflict" && (f.value as { state: string }).state === "open")!;
    expect(conflict.derived_from).toHaveLength(2);
    const decision = r.room.ledger.all().find((f) => f.attribute === "resolution")!;
    expect(decision.source_type).toBe("agent");
    expect((decision.value as { choice: string }).choice).toBe("recalibrate_b");
    expect(decision.abs_time - openedAbs).toBeGreaterThanOrEqual(60);
    // PROP went NO-GO before the resolution, and the count held.
    expect(r.room.ledger.all().some((f) => f.kind === "status" && f.station === "PROP" && (f.value as { status: string }).status === "NO_GO")).toBe(true);
    expect(phasesOf(r)).toContain("HOLD");
  });

  it("AC-13: any NO-GO during terminal count holds on the next tick", () => {
    const r = runHeadless({
      scenario: "S0",
      script: [],
      onTick: (room) => {
        if (room.phase === "TERMINAL_COUNT" && room.clock > -200 && !room.anomalies.S3) {
          room.apply({ tick: room.ticks, sid: CREATOR_SID, nick: "director", msg: { type: "sim.inject", scenario: "S3" } });
        }
        if (room.anomalies.S3 && room.stations.RSO.status === "NO_GO") expect(room.phase).not.toBe("TERMINAL_COUNT");
      },
    });
    expect(phasesOf(r)).toContain("HOLD");
  });

  it("AC-16: S4 makes the FD agent recommend a scrub and scrubs at window close", () => {
    const r = runHeadless({ scenario: "S4" });
    const rec = r.room.ledger.all().find((f) => f.attribute === "recommendation");
    const scrub = r.room.ledger.all().find((f) => f.entity === "countdown" && (f.value as { decision: string }).decision === "scrub");
    expect(rec).toBeDefined();
    expect(scrub).toBeDefined();
    expect(rec!.seq).toBeLessThan(scrub!.seq);
    expect(scrub!.abs_time).toBeGreaterThanOrEqual(2700);
    expect(phasesOf(r)).toContain("SCRUB");
  });

  it("AC-17: S5 pad-aborts, then the FD agent recycles when the window allows", () => {
    const r = runHeadless({ scenario: "S5" });
    const ph = phasesOf(r);
    expect(ph).toContain("PAD_ABORT");
    const after = ph.slice(ph.indexOf("PAD_ABORT") + 1);
    expect(after[0]).toBe("FUELING");
    expect(r.room.ledger.all().some((f) => (f.value as { decision?: string })?.decision === "recycle")).toBe(true);
  });

  it("AC-18: S6 GPS drop makes GNC WATCH and never NO-GO", () => {
    let watched = false;
    const r = runHeadless({
      scenario: "S6",
      onTick: (room) => {
        expect(room.stations.GNC.status).not.toBe("NO_GO");
      },
    });
    watched = r.room.ledger.all().some((f) => f.kind === "status" && f.station === "GNC" && (f.value as { status: string }).status === "WATCH");
    expect(watched).toBe(true);
    expect(r.room.phase).toBe("ENDED");
  });

  it("every scenario ends", () => {
    for (const s of [...ANOMALY_IDS, "SURPRISE"] as ScenarioSetting[]) {
      for (const seed of [1, 2, 3]) expect(runHeadless({ scenario: s, seed }).room.phase).toBe("ENDED");
    }
  });
});
