// Small numeric helpers shared by the game rules and the drawing.

export const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0 below `edge0`, 1 above `edge1`, and a smooth S-curve between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** An angle folded into (-π, π]. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Moves `value` towards `target` by at most `maxStep`. */
export function approach(value: number, target: number, maxStep: number): number {
  if (value < target) return Math.min(target, value + maxStep);
  return Math.max(target, value - maxStep);
}

/** A small, fast seeded random number generator (mulberry32): the same seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
