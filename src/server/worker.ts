// Worker entry (implementation guide 7.1). Keep /api handlers thin: real work happens inside Durable Objects.
import { getAgentByName, routeAgentRequest } from "agents";
import { CreateRoomBody, JoinRoomBody, cleanText } from "../shared/protocol";
import { TIMESCALES } from "../shared/phases";
import { cleanNickname, hashIp, mintToken, newSessionId } from "./auth";
import { agentCard } from "./stations";

export { LaunchRoom } from "./room/LaunchRoom";
export { Registry } from "./registry";

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const MAX_BODY = 2048;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const fail = (status: number, code: string, message: string) => json({ error: code, message }, status);

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error("too large");
  return JSON.parse(text);
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/rooms" && req.method === "POST") {
    let body;
    try {
      body = CreateRoomBody.safeParse(await readJson(req));
    } catch {
      return fail(400, "bad_request", "Invalid request.");
    }
    if (!body.success) return fail(400, "bad_request", "Pick a scenario, a timescale, and a nickname.");
    const nickname = cleanNickname(body.data.nickname, cleanText);
    if (!nickname) return fail(400, "bad_nickname", "Please choose a different nickname.");
    if (!(TIMESCALES as readonly number[]).includes(body.data.timescale)) return fail(400, "bad_timescale", "Unsupported timescale.");
    const ip = req.headers.get("CF-Connecting-IP") ?? "local";
    const registry = env.Registry.getByName("global");
    const demo = body.data.demo === true;
    const reserved = await registry.reserveRoom(await hashIp(ip, env.SESSION_SECRET), demo);
    if (!reserved.ok) {
      if (reserved.error === "busy") return fail(503, "busy", "Every control room is in use right now. Try again in a few minutes.");
      return demo
        ? fail(429, "rate_limited", "This network has opened many demo rooms in the last hour. Try again in a little while.")
        : fail(429, "rate_limited", "You have created several rooms recently. Try again later, or join an existing room.");
    }
    const sid = newSessionId();
    const room = await getAgentByName(env.LaunchRoom, reserved.code);
    await room.initRoom({ code: reserved.code, scenario: body.data.scenario, timescale: body.data.timescale, creatorSid: sid, creatorNick: nickname });
    const token = await mintToken(env.SESSION_SECRET, reserved.code, sid, nickname);
    return json({ code: reserved.code, token });
  }

  const join = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})\/join$/);
  if (join && req.method === "POST") {
    const code = join[1].toUpperCase();
    if (!CODE_RE.test(code)) return fail(404, "not_found", "No room with that code.");
    let body;
    try {
      body = JoinRoomBody.safeParse(await readJson(req));
    } catch {
      return fail(400, "bad_request", "Invalid request.");
    }
    if (!body.success) return fail(400, "bad_request", "Choose a nickname.");
    const nickname = cleanNickname(body.data.nickname, cleanText);
    if (!nickname) return fail(400, "bad_nickname", "Please choose a different nickname.");
    const room = await getAgentByName(env.LaunchRoom, code);
    const can = await room.canJoin();
    if (!can.ok) {
      if (can.error === "full") return fail(409, "room_full", "This control room is full.");
      return fail(404, "not_found", "No room with that code.");
    }
    const token = await mintToken(env.SESSION_SECRET, code, newSessionId(), nickname);
    return json({ token });
  }

  const card = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})\/agents\/([A-Za-z]+)\/card\.json$/);
  if (card && req.method === "GET") {
    const c = agentCard(card[2].toUpperCase());
    return c ? json(c) : fail(404, "not_found", "No such station.");
  }

  if (path === "/api/admin/stats" && req.method === "GET") {
    const auth = req.headers.get("Authorization") ?? "";
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return fail(401, "unauthorized", "Unauthorized.");
    return json(await env.Registry.getByName("global").stats());
  }

  return fail(404, "not_found", "Not found.");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
      // Only the LaunchRoom agent is reachable from browsers; the Registry is internal.
      if (url.pathname.startsWith("/agents/launch-room/")) {
        return (await routeAgentRequest(req, env)) ?? new Response("Not found", { status: 404 });
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "worker.error", path: url.pathname, error: String(e) }));
      return fail(500, "internal", "Something went wrong.");
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
