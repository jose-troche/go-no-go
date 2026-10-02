// Seeded, reproducible pseudo-random numbers (spec 7.1).

/** FNV-1a string hash to a 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for jitter. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stateless noise: a deterministic value in [-1, 1] for (seed, stream, step).
 * Stateless so telemetry at any sim second can be recomputed without replaying RNG draws.
 */
export function noise(seed: number, stream: string, step: number): number {
  const h = hashSeed(`${seed}:${stream}:${Math.floor(step)}`);
  return mulberry32(h)() * 2 - 1;
}

/** Smooth noise: linear blend between integer-spaced noise samples every `period` steps. */
export function smoothNoise(seed: number, stream: string, t: number, period: number): number {
  const k = Math.floor(t / period);
  const f = t / period - k;
  const a = noise(seed, stream, k);
  const b = noise(seed, stream, k + 1);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
