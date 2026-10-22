// The towpath runs along the right-hand bank of the first way. Where that way
// turns off along a branch, the towpath crosses the branch on the footbridge
// by the junction and carries on along the main line, which the other ways
// follow, and another run goes on down the branch from the footbridge's foot.
// At a basin it goes on round the quay to the pub beside it. People come onto
// it and leave it at its ends, where one run joins another, and where a
// bridge crosses it.

import { buildTrack, distanceTo, nearestDistance, poseAt } from '../core/track';
import type { Point, Track } from '../core/track';
import { BASIN_CORNER, CANAL_WIDTH, TOWPATH_OFFSET } from './dimensions';
import { routeDistance } from './stretch';
import type { BasinData, Stretch } from './stretch';

/** One unbroken length of towpath, drawn along its own middle from one end to the other. */
export interface TowpathRun {
  readonly track: Track;
  /** Where people come onto it and leave it, by distance along it, in order. */
  readonly exits: readonly number[];
}

/** How far apart the points along the towpath's middle are. */
const STEP = 10;
/** How near a bridge's foot must be to a run to cross it. */
const CROSSES = 8;
/** How far the towpath's middle is outside a basin's water, as it is from a canal's. */
const QUAY = TOWPATH_OFFSET - CANAL_WIDTH / 2;
/** How near a basin a pub must be for the towpath to go round to it. */
const PUB_REACH = 300;

/** Points along a bank of a curve, -1 the left and 1 the right, from one distance to another, either way. */
function bank(track: Track, side: 1 | -1, from: number, to: number): Point[] {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / STEP));
  return Array.from({ length: n + 1 }, (_, i): Point => {
    const p = poseAt(track, from + ((to - from) * i) / n, side * TOWPATH_OFFSET);
    return [p.x, p.y];
  });
}

/** Points moved out of the water where they're nearer another canal's middle than the towpath should be, as where two canals part. */
function ashore(points: readonly Point[], water: readonly Track[]): Point[] {
  return points.map((p) => {
    let at = p;
    for (const track of water) {
      if (distanceTo(track, at) >= TOWPATH_OFFSET - 0.5) continue;
      const q = poseAt(track, nearestDistance(track, at));
      const d = Math.hypot(at[0] - q.x, at[1] - q.y) || 1;
      at = [q.x + ((at[0] - q.x) * TOWPATH_OFFSET) / d, q.y + ((at[1] - q.y) * TOWPATH_OFFSET) / d];
    }
    return at;
  });
}

/** Points straight across a canal from its right bank to its left, square to it, as a footbridge goes. */
function across(track: Track, at: number): Point[] {
  const n = Math.ceil((2 * TOWPATH_OFFSET) / STEP);
  const p = poseAt(track, at);
  return Array.from({ length: n + 1 }, (_, i): Point => {
    const d = TOWPATH_OFFSET * (1 - (2 * i) / n);
    return [p.x + p.nx * d, p.y + p.ny * d];
  });
}

/** Points all the way round a basin's water at the towpath's distance from it, clockwise from the top left. */
function quay(area: BasinData['area']): Point[] {
  const r = BASIN_CORNER + QUAY;
  const [x0, y0, x1, y1] = [area.x + BASIN_CORNER, area.y + BASIN_CORNER, area.x + area.width - BASIN_CORNER, area.y + area.height - BASIN_CORNER];
  // Each corner's middle, and the angle its curve starts at.
  const corners: [number, number, number][] = [[x0, y0, Math.PI], [x1, y0, -Math.PI / 2], [x1, y1, 0], [x0, y1, Math.PI / 2]];
  const points: Point[] = [];
  corners.forEach(([cx, cy, a], i) => {
    const n = Math.ceil((r * Math.PI) / 2 / STEP);
    for (let k = 0; k <= n; k++) points.push([cx + r * Math.cos(a + (k / n) * (Math.PI / 2)), cy + r * Math.sin(a + (k / n) * (Math.PI / 2))]);
    // Then along the side to the next corner.
    const [nx, ny, na] = corners[(i + 1) % corners.length];
    const [from, to] = [points[points.length - 1], [nx + r * Math.cos(na), ny + r * Math.sin(na)]];
    const m = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / STEP);
    for (let k = 1; k < m; k++) points.push([from[0] + ((to[0] - from[0]) * k) / m, from[1] + ((to[1] - from[1]) * k) / m]);
  });
  return points;
}

/** Points round a loop from the point nearest one place to the point nearest another, the shorter way. */
function roundLoop(loop: readonly Point[], from: Point, to: Point): Point[] {
  const nearest = (p: Point) => loop.reduce((best, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(loop[best][0] - p[0], loop[best][1] - p[1]) ? i : best), 0);
  const [i, j] = [nearest(from), nearest(to)];
  const n = loop.length;
  const ahead = (j - i + n) % n;
  const [step, count] = ahead <= n - ahead ? [1, ahead] : [-1, n - ahead];
  return Array.from({ length: count + 1 }, (_, k) => loop[(i + step * k + n) % n]);
}

/** Evenly spaced points on the straight between two points, leaving out both ends. */
function between(a: Point, b: Point): Point[] {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP);
  return Array.from({ length: Math.max(0, n - 1) }, (_, i): Point => [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);
}

/** Points with the corner at one of them rounded off, by evening out each point with its neighbours, within some points of it. */
function smooth(points: readonly Point[], at: number, reach: number): Point[] {
  let out = [...points];
  const [lo, hi] = [Math.max(1, at - reach), Math.min(points.length - 2, at + reach)];
  for (let pass = 0; pass < reach * 2; pass++) {
    const last = out;
    out = last.map((p, i): Point => (i < lo || i > hi ? p : [(last[i - 1][0] + 2 * p[0] + last[i + 1][0]) / 4, (last[i - 1][1] + 2 * p[1] + last[i + 1][1]) / 4]));
  }
  return out;
}

/** How far a point is outside a basin's water. */
const outside = (area: BasinData['area'], [x, y]: Point): number =>
  Math.hypot(Math.max(area.x - x, 0, x - area.x - area.width), Math.max(area.y - y, 0, y - area.y - area.height));

/** A run through some points, with its ways on and off at its ends and its bridges, but not the footbridge it crosses on. */
function run(stretch: Stretch, points: readonly Point[], crossing?: string): TowpathRun {
  // Pieces of bank share their ends.
  const line = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1);
  const track = buildTrack(line, 5);
  const exits = [0, track.length];
  for (const f of stretch.data.features) {
    if ((f.kind !== 'bridge' && f.kind !== 'footbridge') || f.id === crossing) continue;
    const canal = stretch.waterways.get(f.waterway);
    if (!canal) continue;
    for (const foot of [poseAt(canal, f.at, TOWPATH_OFFSET), poseAt(canal, f.at, -TOWPATH_OFFSET)]) {
      if (distanceTo(track, [foot.x, foot.y]) > CROSSES) continue;
      const s = nearestDistance(track, [foot.x, foot.y]);
      if (s > 20 && s < track.length - 20) exits.push(s);
    }
  }
  return { track, exits: exits.sort((a, b) => a - b) };
}

/** The runs, each with a way on and off where another run's end joins it. */
function joined(runs: readonly TowpathRun[]): TowpathRun[] {
  return runs.map((run) => {
    const exits = [...run.exits];
    for (const other of runs) {
      if (other === run) continue;
      for (const end of [poseAt(other.track, 0), poseAt(other.track, other.track.length)]) {
        if (distanceTo(run.track, [end.x, end.y]) > CROSSES) continue;
        const s = nearestDistance(run.track, [end.x, end.y]);
        if (s > 20 && s < run.track.length - 20) exits.push(s);
      }
    }
    return { ...run, exits: exits.sort((a, b) => a - b) };
  });
}

export function towpathRuns(stretch: Stretch): TowpathRun[] {
  const [first] = stretch.ways;
  const runs: TowpathRun[] = [];
  // Every canal's water as drawn, which the banks keep clear of.
  const water = [...stretch.waterways.values(), ...stretch.ways.map((w) => w.route)];
  const along = (track: Track, side: 1 | -1, from: number, to: number) => ashore(bank(track, side, from, to), water);
  // Where along the first way the run being made begins.
  let from = 0;
  for (const j of first.junctions) {
    if (!j.turns) continue;
    const parent = stretch.waterways.get(j.branch.leaves?.waterway ?? '');
    const branch = stretch.waterways.get(j.branch.id);
    const footbridge = stretch.data.features.filter((f) => f.kind === 'footbridge' && f.waterway === j.branch.id).sort((a, b) => a.at - b.at)[0];
    const at = footbridge ? routeDistance(stretch, first, footbridge.waterway, footbridge.at) : null;
    if (!parent || !branch || !footbridge || at === null) throw new Error(`No footbridge carries the towpath over ${j.branch.id}`);
    // Back up the branch's far bank from the footbridge, to where it meets the main line's towpath.
    let corner = footbridge.at;
    for (; corner > 0; corner -= STEP) {
      const p = poseAt(branch, corner - STEP, -TOWPATH_OFFSET);
      if (distanceTo(parent, [p.x, p.y]) <= TOWPATH_OFFSET) break;
    }
    const c = poseAt(branch, corner, -TOWPATH_OFFSET);
    const onParent = nearestDistance(parent, [c.x, c.y]) + STEP;
    runs.push(run(stretch, [...along(first.route, 1, from, at), ...across(branch, footbridge.at), ...along(branch, -1, footbridge.at, corner), ...along(parent, 1, onParent, parent.length)], footbridge.id));
    from = at;
  }
  const { mooring } = first;
  if (mooring.kind !== 'basin') {
    runs.push(run(stretch, along(first.route, 1, from, first.route.length)));
    return joined(runs);
  }
  // Down to the basin's quay, then round it to the pub, if there's one by it, and off the quay into the pub garden.
  const area = mooring.area;
  const down = along(first.route, 1, from, first.end);
  const onQuay = down.findIndex((p) => outside(area, p) <= QUAY);
  const reached = onQuay < 0 ? down : down.slice(0, Math.max(1, onQuay));
  const there = reached[reached.length - 1];
  const pub = stretch.data.pubs.find((p) => outside(area, p.at) < PUB_REACH);
  const round = roundLoop(quay(area), there, pub?.at ?? there);
  const into = pub ? between(round[round.length - 1], pub.at).slice(0, 2) : [];
  const onto = [...reached, ...between(there, round[0])];
  const points = smooth([...onto, ...round, ...into], onto.length, 8);
  runs.push(run(stretch, smooth(points, onto.length + round.length - 1, 2)));
  return joined(runs);
}
