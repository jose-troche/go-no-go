# Go/No-Go

Multiplayer launch control room that teaches enterprise team-agent concepts.

- Product spec: docs/specs.md (behavior source of truth)
- Platform guide: docs/deploy.md (Cloudflare mechanics source of truth)

## Non-negotiable rules
- Deterministic code decides status; the LLM only answers questions and writes narratives.
- Role/principal is always resolved server-side from the seat map. Never accept a role from the client.
- Agent setState is public. Put only PublicRoomState in it.
- All role-sensitive output goes through src/server/policy/policy.ts (via src/server/room/egress.ts).
- Never import src/server from src/client (enforced by `npm run lint`).
- Free tier: no per-tick storage writes; telemetry stays in memory.

## Layout
- src/shared: protocol (Zod), roles, phases, channels, tokens, geo. No thresholds or scripts.
- src/server/sim: pure deterministic models, scenarios, LCC engine, timeline.
- src/server/stations: station agents and the Flight Director policy.
- src/server/room/runtime.ts: the pure Room model (ticks, actions, poll, waivers, conflicts). headless.ts drives it for tests and `npm run sim`.
- src/server/room/LaunchRoom.ts: the Durable Object shell (connections, persistence, replay, fan-out).

## Workflow
- `npm test` (Vitest), `npm run typecheck`, `npm run lint`, `npm run sim -- --scenario S2 --role PUBLIC`.
- `npm run dev` for local Workers + Vite; `.dev.vars` sets LLM_PROVIDER=template so local dev spends no Neurons.
- Check current Agents SDK and Durable Objects docs when an API in the guide doesn't match.
- Ask before adding new dependencies.
