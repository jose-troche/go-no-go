import type { ScenarioSetting } from "../../shared/phases";

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("network", "Could not reach the control room. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? "error", data.message ?? "Something went wrong.");
  return data;
}

export function createRoom(input: { scenario: ScenarioSetting; timescale: number; nickname: string }) {
  return post<{ code: string; token: string }>("/api/rooms", input);
}

export function joinRoom(code: string, nickname: string) {
  return post<{ token: string }>(`/api/rooms/${code}/join`, { nickname });
}

const key = (code: string) => `gng:token:${code}`;
export function saveToken(code: string, token: string) {
  try {
    sessionStorage.setItem(key(code), token);
  } catch {
    /* storage unavailable: the token lives only in memory for this tab */
  }
}
export function loadToken(code: string): string | null {
  try {
    return sessionStorage.getItem(key(code));
  } catch {
    return null;
  }
}
export function clearToken(code: string) {
  try {
    sessionStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}
export function saveNick(nick: string) {
  try {
    localStorage.setItem("gng:nick", nick);
  } catch {
    /* ignore */
  }
}
export function loadNick(): string {
  try {
    return localStorage.getItem("gng:nick") ?? "";
  } catch {
    return "";
  }
}
