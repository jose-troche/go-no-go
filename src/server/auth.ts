// Session tokens (implementation guide 7.2): base64url(payload).base64url(HMAC-SHA256). No role inside.
export interface TokenClaims {
  v: 1;
  room: string;
  sid: string;
  nick: string;
  exp: number;
}

export const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function newSessionId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `s_${b64url(b)}`;
}

export async function mintToken(secret: string, room: string, sid: string, nick: string, now = Date.now()): Promise<string> {
  const claims: TokenClaims = { v: 1, room, sid, nick, exp: now + TOKEN_TTL_MS };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** Verifies signature (constant time via crypto.subtle.verify), expiry, and room binding. */
export async function verifyToken(token: string | null | undefined, secret: string, room: string, now = Date.now()): Promise<TokenClaims | null> {
  if (!token || token.length > 1024) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as TokenClaims;
    if (claims.v !== 1 || claims.room !== room || typeof claims.sid !== "string" || claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${ip}`));
  return b64url(new Uint8Array(d)).slice(0, 22);
}

const BLOCKED = ["fuck", "shit", "cunt", "bitch", "nigg", "fag", "retard", "whore", "slut", "dick", "cock", "pussy", "rape"];

/** Cleans a nickname; returns null when empty or obviously profane (spec 18). */
export function cleanNickname(raw: string, clean: (s: string, n: number) => string): string | null {
  const nick = clean(raw, 24);
  if (!nick) return null;
  const flat = nick.toLowerCase().replace(/[^a-z]/g, "").replace(/0/g, "o");
  if (BLOCKED.some((w) => flat.includes(w))) return null;
  return nick;
}
