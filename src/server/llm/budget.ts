// LLM budgets (implementation guide 7.8): per-session rate limits, per-room cap, daily budget via the Registry.
export const QUESTION_INTERVAL_MS = 15_000;
export const QUESTIONS_PER_SESSION = 6;

export class SessionLimiter {
  private bySid = new Map<string, { last: number; count: number }>();

  /** Returns a user-facing message when the asker is rate limited, otherwise records the question. */
  take(sid: string, now: number): string | null {
    const s = this.bySid.get(sid) ?? { last: 0, count: 0 };
    if (s.count >= QUESTIONS_PER_SESSION) return `You have used all ${QUESTIONS_PER_SESSION} questions for this room.`;
    if (now - s.last < QUESTION_INTERVAL_MS) return "One question every 15 seconds, please.";
    s.last = now;
    s.count++;
    this.bySid.set(sid, s);
    return null;
  }
}
