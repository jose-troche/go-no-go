// Headless runner: npm run sim -- --scenario S2 --seed 42 --role PUBLIC [--quiet]
import { runHeadless } from "../src/server/room/headless";
import { formatClock, SCENARIO_IDS, type ScenarioSetting } from "../src/shared/phases";
import { ROLES, type Role } from "../src/shared/roles";

const args = process.argv.slice(2);
const get = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const scenario = get("scenario", "S0") as ScenarioSetting;
const role = get("role", "FD") as Role;
const seed = Number(get("seed", "42"));
const timescale = Number(get("timescale", "4"));
const quiet = args.includes("--quiet");
if (!SCENARIO_IDS.includes(scenario) || !ROLES.includes(role)) {
  console.error(`usage: npm run sim -- --scenario ${SCENARIO_IDS.join("|")} --role ${ROLES.join("|")} [--seed N] [--quiet]`);
  process.exit(1);
}

const { room, messages } = runHeadless({ scenario, seed, timescale, viewers: [role] });
for (const m of messages[role]) {
  if (quiet && m.type === "tick") continue;
  if (m.type === "tick") console.log(JSON.stringify({ type: "tick", t: formatClock(m.simTime), phase: m.phase, telemetry: m.telemetry, statuses: Object.fromEntries(Object.entries(m.statuses).map(([k, v]) => [k, v?.status])), hidden: m.hiddenCount }));
  else console.log(JSON.stringify(m));
}
console.error(`\n${scenario} seed=${seed} as ${role}: ended in ${room.phase} at ${formatClock(room.clock)} after ${room.ticks} ticks, ${room.ledger.size()} facts, ${messages[role].length} messages`);
