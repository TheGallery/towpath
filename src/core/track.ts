// A track is a smooth curve through hand-placed points (a Catmull-Rom spline),
// sampled densely so anything can be placed by its distance along it.

export type Point = readonly [number, number];

export interface Track {
  /** The control points the curve passes through. */
  readonly points: readonly Point[];
  /** The point before the first, if one shaped the curve's start. */
  readonly before?: Point;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** Distance along the track at each sample. */
  readonly ss: readonly number[];
  /** Heading at each sample, unwrapped so neighbours never jump by a full turn. */
  readonly headings: readonly number[];
  readonly length: number;
}

/**
 * Where something sits on a track. The normal points to the right-hand side
 * when facing along the track (screen coordinates, y down), so a positive
 * offset is on the right.
 */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly nx: number;
  readonly ny: number;
}

/**
 * The four points that shape the curve between points i and i + 1. `before`
 * is an optional point ahead of the first one that bends the curve's start,
 * so a branch can leave its parent canal smoothly.
 */
export function segmentControls(points: readonly Point[], i: number, before?: Point): [Point, Point, Point, Point] {
  const n = points.length;
  const p0 = i === 0 && before ? before : points[Math.max(0, i - 1)];
  return [p0, points[i], points[i + 1], points[Math.min(n - 1, i + 2)]];
}

export function buildTrack(points: readonly Point[], step = 5, before?: Point): Track {
  if (points.length < 2) throw new Error('A track needs at least two points');
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = segmentControls(points, i, before);
    const m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < m; j++) {
      const t = j / m;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      xs.push(f(p0[0], p1[0], p2[0], p3[0]));
      ys.push(f(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const last = points[points.length - 1];
  xs.push(last[0]);
  ys.push(last[1]);

  const ss = [0];
  for (let i = 1; i < xs.length; i++) ss.push(ss[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));

  const headings: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(xs.length - 1, i + 1);
    let h = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
    if (i > 0) {
      const prev = headings[i - 1];
      while (h - prev > Math.PI) h -= 2 * Math.PI;
      while (h - prev < -Math.PI) h += 2 * Math.PI;
    }
    headings.push(h);
  }
  return { points, before, xs, ys, ss, headings, length: ss[ss.length - 1] };
}

/** The index of the last sample at or before distance `s` (already clamped). */
function sampleBefore(track: Track, s: number): number {
  let lo = 0;
  let hi = track.ss.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.ss[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function poseAt(track: Track, s: number, offset = 0): Pose {
  const d = Math.max(0, Math.min(track.length, s));
  const lo = sampleBefore(track, d);
  const hi = Math.min(lo + 1, track.ss.length - 1);
  const t = (d - track.ss[lo]) / (track.ss[hi] - track.ss[lo] || 1);
  const dx = track.xs[hi] - track.xs[lo];
  const dy = track.ys[hi] - track.ys[lo];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  return {
    x: track.xs[lo] + dx * t + nx * offset,
    y: track.ys[lo] + dy * t + ny * offset,
    angle: Math.atan2(dy, dx),
    nx,
    ny,
  };
}

/**
 * How sharply the track bends at distance `s`: the change in heading per unit
 * of distance. Positive bends to the right on screen (clockwise).
 */
export function curvatureAt(track: Track, s: number, span = 12): number {
  const a = Math.max(0, s - span);
  const b = Math.min(track.length, s + span);
  if (b - a < 1e-6) return 0;
  return (headingAt(track, b) - headingAt(track, a)) / (b - a);
}

/** The unwrapped heading at distance `s`, interpolated between samples. */
export function headingAt(track: Track, s: number): number {
  const d = Math.max(0, Math.min(track.length, s));
  const lo = sampleBefore(track, d);
  const hi = Math.min(lo + 1, track.ss.length - 1);
  const t = (d - track.ss[lo]) / (track.ss[hi] - track.ss[lo] || 1);
  return track.headings[lo] + (track.headings[hi] - track.headings[lo]) * t;
}

/** The distance along the track of the sample nearest to a point. */
export function nearestDistance(track: Track, point: Point): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < track.xs.length; i++) {
    const d = Math.hypot(track.xs[i] - point[0], track.ys[i] - point[1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return track.ss[best];
}

/** How far a point is from the track, to within the sample spacing. */
export function distanceTo(track: Track, point: Point): number {
  let best = Infinity;
  for (let i = 0; i < track.xs.length; i++) best = Math.min(best, Math.hypot(track.xs[i] - point[0], track.ys[i] - point[1]));
  return best;
}
