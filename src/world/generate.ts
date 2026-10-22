// A canal made from a seed, in the same shape as the hand-made stretch. The
// seed alone settles the day's shape: none to three junctions, some of them
// three-way with branches north and south; none to four locks, and one more
// above each mooring below a lock; and the kind of mooring each way ends at.
// Each try then lays it out on rolling land: the main line wanders west to
// east, branches turn off it to end in a basin or at a lane, or run on off the
// map as other canals, and the locks go where the land rises, each on a
// straight reach. Roads cross square at their bridges and run out to the
// edge, or stop at a farm short of another canal. Villages, pubs, woods and
// farms go where there's room for them. A try with no room for something is
// thrown away; whether a canal makes a playable day is for the game's own
// rules to say. A canal's next day is another stretch made the same way, which
// starts at the bank or basin where the boat moored, with the boats there, and
// carries on along the canal it was on.

import { clamp, seededRandom, wrapAngle } from '../core/math';
import { buildTrack, distanceTo, nearestDistance, poseAt } from '../core/track';
import type { Point, Pose, Track } from '../core/track';
import { BRIDGE_DECK, CANAL_WIDTH, TOWPATH_OFFSET } from './dimensions';
import { BANK_SPOTS, FAR_ENDS, LANE_WORDS, LOCK_WORDS, POND_WORDS, PUBS, WOOD_KINDS, namer } from './names';
import type { AreaData, BankData, BasinBoatData, BasinData, FarmData, FeatureData, PubData, RoadData, Stretch, StretchData, VillageData, WaterwayData, WayData } from './stretch';
import { towpathRuns } from './towpath';
import type { TowpathRun } from './towpath';

/** How big a made canal's world is: a little bigger than Hallam, for the branches. */
export const MADE_SIZE = { width: 6400, height: 4000 } as const;
const W = MADE_SIZE.width;
const H = MADE_SIZE.height;

/** How likely a day is to have each number of junctions, and each number of locks besides those above a mooring. */
export const JUNCTION_ODDS: readonly (readonly [number, number])[] = [[0, 15], [1, 35], [2, 32], [3, 18]];
export const LOCK_ODDS: readonly (readonly [number, number])[] = [[0, 10], [1, 30], [2, 30], [3, 20], [4, 10]];
/** How likely a junction is to send branches both ways, north and south. */
export const THREE_WAY = 0.35;

/** The kinds of mooring a way can end at for the night. */
export type EndKind = 'pub-basin' | 'wharf' | 'quiet-bank' | 'village' | 'pub-bank' | 'lock-moorings';
/** How often each kind ends a branch, and the main line, which always runs on, so ends on a bank. */
const BRANCH_ENDS: readonly (readonly [EndKind, number])[] = [['pub-basin', 2], ['wharf', 1.2], ['quiet-bank', 2], ['village', 1.6], ['pub-bank', 1.2], ['lock-moorings', 1.2]];
const MAIN_ENDS: readonly (readonly [EndKind, number])[] = [['quiet-bank', 2], ['village', 1.6], ['pub-bank', 1.2], ['lock-moorings', 1.2]];
/** True for the kinds of mooring at the end of an arm, in a basin. */
const inBasin = (kind: EndKind): boolean => kind === 'pub-basin' || kind === 'wharf';
/** How likely a branch that ends at a bank is to run on off the map as another canal. */
const RUNS_ON = 0.45;

/** Where the day starts, along the main line. */
const START_AT = 322;
/** Where a day that starts in a basin starts, along the main line leaving it, and how far in from the map's west edge that canal begins. */
const BASIN_START = 100;
const BASIN_X = 300;
/** How near a mooring's spots a pub must be to be the pub it's by. */
const PUB_BY = 250;
/** How long the day aims to be along each way, in world units: about 11 to 17 minutes at cruising speed. */
const WAY_LENGTH = { min: 4300, max: 6700 };
/** How far either side of a lock its canal runs straight, through the lock and past its landings. */
const STRAIGHT_REACH = 270;
/** How much cruising a lock's worth in a day's time, in world units: about two and a half minutes. */
const LOCK_WORTH = 900;
/** How far a lock is ahead of the mooring below it, so its landing is clear of the last spot. */
const LOCK_ABOVE = 600;
/** How far either side of a feature others keep clear, along its canal. The footbridges at a junction keep within its room. */
const KEEP = { lock: 330, junction: 450, bridge: 200, moorings: 300, bank: 240, basin: 300, start: 300 } as const;

/** A try that ran out of room for something, and why. */
export class NoRoom extends Error {}

function noRoom(why: string): never {
  throw new NoRoom(why);
}

/** Mixes numbers into one 32-bit seed. */
const mix = (...ns: number[]): number => ns.reduce((h, n) => Math.imul(h ^ (n | 0), 0x9e3779b1) ^ (h >>> 15), 0x2545f491) | 0;

/** Where a day moored, for the next day to start from: a bank, or a basin with the boats moored in it and the pub beside it, if there's one. */
export interface StartPlace {
  readonly kind: 'bank' | 'basin';
  readonly name: string;
  readonly about: string;
  /** The canal it's on, which the next day carries on along. */
  readonly canal: string;
  /** The paint scheme of each boat moored there. */
  readonly boats: readonly number[];
  readonly pub: string | null;
}

/** Where a day on a stretch moors down one of its ways, for the next day to start from. */
export function mooredAt(stretch: Stretch, way: string): StartPlace {
  const { mooring, spots } = stretch.ways.find((w) => w.id === way) ?? stretch.ways[0];
  const { data } = stretch;
  const canal = data.waterways.find((w) => w.id === mooring.waterway)?.name ?? data.waterways[0].name;
  if (mooring.kind === 'bank') return { kind: 'bank', name: mooring.name, about: mooring.about, canal, boats: [], pub: null };
  const pub = data.pubs.find((p) => spots.some((s) => Math.hypot(p.at[0] - s.x, p.at[1] - s.y) < PUB_BY));
  return { kind: 'basin', name: mooring.name, about: mooring.about, canal, boats: mooring.boats.map((b) => b.livery), pub: pub?.name ?? null };
}

/** The seed for a canal's next day: from the canal's own seed, the day's number, and where the boat moored. */
export function daySeed(canal: number, day: number, from: StartPlace): number {
  return mix(canal, day, ...[...`${from.canal}\n${from.name}`].map((c) => c.codePointAt(0) ?? 0)) >>> 0;
}

/** One of some choices, each as likely as its weight. */
function weighted<T>(r: () => number, choices: readonly (readonly [T, number])[]): T {
  let x = r() * choices.reduce((a, c) => a + c[1], 0);
  for (const [value, weight] of choices) {
    x -= weight;
    if (x <= 0) return value;
  }
  return choices[0][0];
}

/** Smooth rolling land, about 0 to 1 high, a few thousand units from hill to hill, with a gentle tilt. */
function landHeight(seed: number): (x: number, y: number) => number {
  const r = seededRandom(mix(seed, 0x1a4d));
  const cells = 8;
  const cell = 1200;
  const grid = Array.from({ length: cells + 1 }, () => Array.from({ length: cells + 1 }, () => r()));
  const tilt = [r() - 0.5, r() - 0.5];
  return (x, y) => {
    const gx = clamp((x + 600) / cell, 0, cells - 0.001);
    const gy = clamp((y + 600) / cell, 0, cells - 0.001);
    const [i, j] = [Math.floor(gx), Math.floor(gy)];
    const [u, v] = [(gx - i) * (gx - i) * (3 - 2 * (gx - i)), (gy - j) * (gy - j) * (3 - 2 * (gy - j))];
    const a = grid[j][i] + (grid[j][i + 1] - grid[j][i]) * u;
    const b = grid[j + 1][i] + (grid[j + 1][i + 1] - grid[j + 1][i]) * u;
    return a + (b - a) * v + (tilt[0] * x + tilt[1] * y) / 9000;
  };
}

/** The shape of the day, which the seed alone settles, so trying again for room never makes a day simpler. */
export interface DayShape {
  /** Each junction, in order along the main line: true if it sends branches both ways. */
  readonly junctions: readonly boolean[];
  readonly locks: number;
  /** Where the main line's way ends, then each branch's in order. */
  readonly ends: readonly EndKind[];
  /** For each branch in order, whether it runs on off the map if it ends at a bank. */
  readonly runsOn: readonly boolean[];
}

export function dayShape(seed: number): DayShape {
  const r = seededRandom(mix(seed, 0x5a9e));
  const count = weighted(r, JUNCTION_ODDS);
  const threeWay = [0, 1, 2].map(() => r() < THREE_WAY);
  const locks = weighted(r, LOCK_ODDS);
  const ends = [weighted(r, MAIN_ENDS), ...[0, 1, 2, 3, 4, 5].map(() => weighted(r, BRANCH_ENDS))];
  const runsOn = [0, 1, 2, 3, 4, 5].map(() => r() < RUNS_ON);
  return { junctions: threeWay.slice(0, count), locks, ends, runsOn };
}

/** One step of a canal's line: how far, and how much it turns first. */
interface Step {
  readonly length: number;
  readonly turn: number;
}

/**
 * Points from a start, each a step on from the last, turning as it goes, but
 * not at the steps asked to run straight, so a lock can go there. `steer`
 * nudges the heading, as away from the map's edge, and `done` says when to stop.
 */
function walk(start: Point, heading: number, steps: readonly Step[], straight: ReadonlySet<number>, steer: (p: Point, h: number) => number, done: (p: Point, length: number) => boolean): Point[] {
  let h = heading;
  let p = start;
  let length = 0;
  const points: Point[] = [start];
  for (let k = 1; k <= steps.length; k++) {
    const step = steps[k - 1];
    if (!straight.has(k)) h = steer(p, h + step.turn);
    p = [p[0] + Math.cos(h) * step.length, p[1] + Math.sin(h) * step.length];
    points.push(p);
    length += step.length;
    if (done(p, length)) break;
  }
  return points;
}

/** The steps that must run straight for a lock at a point: so the two points either side of it are in line, and its reach is straight from one side to the other. */
const straightFor = (point: number): number[] => [point, point + 1, point + 2];

const inMap = ([x, y]: Point, margin: number): boolean => x > margin && x < W - margin && y > margin && y < H - margin;
const rounded = (points: readonly Point[]): Point[] => points.map(([x, y]) => [Math.round(x), Math.round(y)]);
const round = Math.round;

/** A branch as the generator plans it, before it has its features. */
interface Branch {
  readonly id: string;
  /** Which way it turns off: 1 to the right of the main line, -1 to the left. */
  readonly side: 1 | -1;
  readonly junction: number;
  readonly kind: EndKind;
  readonly runsOn: boolean;
  /** How far along it the day aims to arrive at its mooring. */
  readonly need: number;
  readonly turnOff: number;
  readonly drift: number;
  readonly steps: readonly Step[];
}

/** Where along each canal something already is, so others keep clear of it. */
class Busy {
  private readonly taken = new Map<string, { s: number; gap: number }[]>();

  free(waterway: string, s: number, gap: number): boolean {
    return (this.taken.get(waterway) ?? []).every((b) => Math.abs(b.s - s) >= Math.max(gap, b.gap));
  }

  take(waterway: string, s: number, gap: number): void {
    this.taken.set(waterway, [...(this.taken.get(waterway) ?? []), { s, gap }]);
  }
}

/** Lays out one try of a seed's canal, starting where the boat moored the day before if it did. Throws NoRoom when something doesn't fit. */
export function generateStretch(seed: number, attempt = 0, from: StartPlace | null = null): StretchData {
  const shape = dayShape(seed);
  const r = seededRandom(mix(seed, attempt, 0x2e7));
  const names = namer(seededRandom(mix(seed, attempt, 0x6a3)));
  const land = landHeight(seed);

  // ---- The line of every canal, first without locks, then straightened where they go.
  const mainSteps = Array.from({ length: 24 }, (): Step => ({ length: 380 + 60 * r(), turn: (r() - 0.5) * 0.6 }));
  // Out of a basin, the main line starts on the map and leaves it level, heading east, straight on past its mouth.
  const startsInBasin = from?.kind === 'basin';
  const startAt = startsInBasin ? BASIN_START : START_AT;
  const mainStart: Point = [startsInBasin ? BASIN_X : -200, H * (0.3 + 0.4 * r())];
  const heading = (r() - 0.5) * 0.6;
  const mainHeading = startsInBasin ? 0 : heading;
  // Heading east, turning back from the top and bottom of the map.
  const steerMain = ([, y]: Point, h: number) => h + clamp(clamp(h, y < 1300 ? 0.25 : -0.7, y > H - 1300 ? -0.25 : 0.7) - h, -0.35, 0.35);
  const layMain = (straight: ReadonlySet<number>) => walk(mainStart, mainHeading, mainSteps, startsInBasin ? new Set([...straight, 1, 2]) : straight, steerMain, ([x]) => x > W + 200);

  const firstMain = layMain(new Set());
  const firstTrack = buildTrack(firstMain, 5);
  const pointAt = firstMain.map((p) => nearestDistance(firstTrack, p));
  // Junctions at the main line's own points, well apart, with room before and after.
  const candidates = pointAt.map((s, i) => ({ s, i })).filter(({ s, i }) => i >= 2 && i <= firstMain.length - 5 && s > 1300 && s < firstTrack.length - 2200);
  const junctions: { s: number; i: number }[] = [];
  for (const c of candidates.map((c) => ({ c, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.c)) {
    if (junctions.length < shape.junctions.length && junctions.every((o) => Math.abs(o.i - c.i) >= 2 && Math.abs(o.s - c.s) > 950)) junctions.push(c);
  }
  if (junctions.length < shape.junctions.length) noRoom('no room for the junctions');
  junctions.sort((a, b) => a.s - b.s);
  // The three-way junctions go where there's most room both sides, nearest the middle of the map.
  const middling = (j: { i: number }) => Math.abs(firstMain[j.i][1] - H / 2);
  const threeWay = new Set([...junctions].sort((a, b) => middling(a) - middling(b)).slice(0, shape.junctions.filter(Boolean).length));
  /** How far a junction's branch could go to one side before it reaches the edge of the map. */
  const room = (j: { i: number }, side: 1 | -1) => {
    const p = poseAt(firstTrack, pointAt[j.i]);
    const [nx, ny] = [p.nx * side, p.ny * side];
    return Math.min(nx > 0 ? (W - p.x) / nx : nx < 0 ? -p.x / nx : Infinity, ny > 0 ? (H - p.y) / ny : ny < 0 ? -p.y / ny : Infinity);
  };

  const wayLength = () => WAY_LENGTH.min + r() * (WAY_LENGTH.max - WAY_LENGTH.min);
  const planned: Omit<Branch, 'drift'>[] = [];
  junctions.forEach((j, n) => {
    // A branch on its own turns off whichever way, unless there's much more room the other.
    const either: 1 | -1 = r() < 0.5 ? 1 : -1;
    const sides: (1 | -1)[] = threeWay.has(j) ? [1, -1] : [room(j, either) < 1600 && room(j, -either as 1 | -1) > room(j, either) ? (-either as 1 | -1) : either];
    for (const side of sides) {
      const k = planned.length;
      const kind = shape.ends[1 + k];
      const basin = inBasin(kind);
      planned.push({
        id: `branch-${k + 1}`,
        side,
        junction: n,
        kind,
        runsOn: !basin && (kind === 'lock-moorings' || shape.runsOn[k]),
        need: clamp(wayLength() - (j.s - startAt), 1000, basin || !shape.runsOn[k] ? 3400 : 4800),
        turnOff: 1.0 + 0.35 * r(),
        steps: Array.from({ length: 40 }, (): Step => ({ length: 290 + 40 * r(), turn: (r() - 0.5) * 0.24 })),
      });
    }
  });
  // Branches on the same side fan out, so they don't run into each other: the first bends back west, the last runs on east.
  const branches: Branch[] = planned.map((b) => {
    const same = planned.filter((o) => o.side === b.side);
    const q = same.indexOf(b);
    const drift = same.length === 1 ? 0.3 + 1.0 * r() : 2.2 - (1.8 * q) / (same.length - 1) + (r() - 0.5) * 0.3;
    return { ...b, drift };
  });
  const mainEndAim = startAt + wayLength();

  /** A branch's points, from its junction on the main line. */
  const layBranch = (b: Branch, main: readonly Point[], laid: readonly (readonly Point[])[], straight: ReadonlySet<number>): Point[] => {
    const at = main[junctions[b.junction].i];
    const across = Math.atan2(main[junctions[b.junction].i + 1][1] - main[junctions[b.junction].i - 1][1], main[junctions[b.junction].i + 1][0] - main[junctions[b.junction].i - 1][0]);
    const toward = across + b.side * b.drift;
    // Away from the main line and the branches already laid, and from the edges unless it runs on off them.
    const others = [buildTrack(main, 10), ...laid.map((points) => buildTrack(points, 10))];
    // About how far it has gone, counting the steps it steers on.
    let gone = 0;
    const steer = (p: Point, h: number) => {
      gone += 300;
      let [vx, vy] = [Math.cos(toward), Math.sin(toward)];
      const away = (ax: number, ay: number, weight: number) => {
        const l = Math.hypot(ax, ay) || 1;
        vx += (ax / l) * weight;
        vy += (ay / l) * weight;
      };
      if (gone > 400) {
        for (const t of others) {
          const q = poseAt(t, nearestDistance(t, p));
          const d = Math.hypot(p[0] - q.x, p[1] - q.y);
          if (d < 900) away(p[0] - q.x, p[1] - q.y, 2 * (1 - d / 900));
        }
      }
      if (!b.runsOn) {
        const [x, y] = p;
        const edge = (d: number) => 3 * clamp(1 - d / 1100, 0, 1);
        away(1, 0, edge(x));
        away(-1, 0, edge(W - x));
        away(0, 1, edge(y));
        away(0, -1, edge(H - y));
      }
      const want = h + wrapAngle(Math.atan2(vy, vx) - h);
      return h + clamp(want - h, -0.32, 0.32);
    };
    const reach = b.runsOn ? Infinity : inBasin(b.kind) ? b.need - 420 : b.need + 420;
    const points = walk(at, across + b.side * b.turnOff, b.steps, straight, steer, (p, length) => (b.runsOn ? !inMap(p, -150) : length >= reach || !inMap(p, inBasin(b.kind) ? 750 : 450)));
    if (b.runsOn && inMap(points[points.length - 1], -150)) noRoom('a branch never leaves the map');
    if (!inBasin(b.kind)) return points;
    // Into the basin level: bend round to run east or west, then two steps straight in.
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    let h = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
    // Away from the nearer side of the map.
    const level = last[0] > W - 1500 ? Math.PI : last[0] < 1500 ? 0 : Math.cos(h) >= 0 ? 0 : Math.PI;
    let p = last;
    for (let k = 0; k < 4 && Math.abs(wrapAngle(level - h)) > 0.01; k++) {
      h += clamp(wrapAngle(level - h), -0.6, 0.6);
      p = [p[0] + Math.cos(h) * 170, p[1] + Math.sin(h) * 170];
      points.push(p);
    }
    for (const length of [180, 220]) {
      p = [p[0] + Math.cos(level) * length, p[1]];
      points.push(p);
    }
    return points;
  };

  // Locks go where the land rises most, on any canal, at points with room for a straight reach either side.
  const layBranches = (main: readonly Point[], straight: (b: Branch) => ReadonlySet<number>) => {
    const laid: Point[][] = [];
    for (const b of branches) laid.push(layBranch(b, main, laid, straight(b)));
    return laid;
  };
  const firstBranches = layBranches(firstMain, () => new Set());
  const lockPoints = new Map<string, number[]>([['main', []], ...branches.map((b): [string, number[]] => [b.id, []])]);
  const pointNear = (points: readonly Point[], track: Track, s: number) => points.reduce((best, p, i) => (Math.abs(nearestDistance(track, p) - s) < Math.abs(nearestDistance(track, points[best]) - s) ? i : best), 0);
  const lastJunction = junctions[junctions.length - 1]?.s ?? 0;
  const mainEnd = Math.min(firstTrack.length - 900, Math.max(mainEndAim, lastJunction + 1300));
  // A lock just above each mooring below one, first, where the canal goes on far enough past it to be straight.
  const above = (waterway: string, points: readonly Point[], s: number, offset: number) => {
    const j = pointNear(points, buildTrack(points, 5), s);
    if (j >= 2 && j < points.length - 4) lockPoints.get(waterway)?.push(j - offset);
  };
  if (shape.ends[0] === 'lock-moorings') above('main', firstMain, mainEnd + LOCK_ABOVE, 0);
  branches.forEach((b, k) => {
    if (b.kind === 'lock-moorings') above(b.id, [firstMain[junctions[b.junction].i], ...firstBranches[k].slice(1)], b.need + LOCK_ABOVE, 1);
  });
  const rises: { waterway: string; point: number; rise: number }[] = [];
  const consider = (waterway: string, points: readonly Point[], from: number, to: number, offset: number) => {
    const track = buildTrack(points, 5);
    for (let j = 2; j < points.length - 4; j++) {
      const s = nearestDistance(track, points[j]);
      if (s < from || s > to || !inMap(points[j], 800)) continue;
      rises.push({ waterway, point: j - offset, rise: Math.abs(land(...points[j + 1]) - land(...points[j - 1])) });
    }
  };
  consider('main', firstMain, 1100, mainEnd - 500, 0);
  branches.forEach((b, k) => consider(b.id, [firstMain[junctions[b.junction].i], ...firstBranches[k].slice(1)], 650, b.need - 1000, 1));
  rises.sort((a, b) => b.rise - a.rise);
  const mainAt = (j: number) => pointAt[j] ?? Infinity;
  let placed = 0;
  for (const c of rises) {
    if (placed >= shape.locks) break;
    const others = lockPoints.get(c.waterway) ?? [];
    if (others.some((o) => Math.abs(o - c.point) < 2)) continue;
    if (c.waterway === 'main' && junctions.some((j) => Math.abs(mainAt(c.point) - j.s) < 750 || Math.abs(c.point - j.i) < 2)) continue;
    others.push(c.point);
    placed++;
  }
  if (placed < shape.locks) noRoom('no room for the locks');

  // ---- The canals, laid out for good.
  const straightOf = (id: string, offset: number) => new Set((lockPoints.get(id) ?? []).flatMap((j) => straightFor(j + offset)));
  const mainPoints = layMain(straightOf('main', 0));
  const branchPoints = layBranches(mainPoints, (b) => straightOf(b.id, 1)).map((points) => points.slice(1));
  const main = buildTrack(mainPoints, 5);
  for (let s = 0; s < main.length; s += 50) {
    const p = poseAt(main, s);
    if (p.x > 0 && p.x < W && !inMap([W / 2, p.y], 450)) noRoom('the main line runs off the map');
  }
  const mainS = mainPoints.map((p) => nearestDistance(main, p));
  const junctionS = junctions.map((j) => mainS[j.i]);
  const waterways: WaterwayData[] = [];
  const tracks = new Map<string, Track>([['main', main]]);
  const canalName = from ? from.canal : `${names.place()} Canal`;
  waterways.push({ id: 'main', name: canalName, points: rounded(mainPoints), label: { at: 560, side: 1 } });
  const junctionNames = junctions.map(() => `${names.place()} Junction`);
  const branchNames = new Map<string, string>();
  branches.forEach((b, k) => {
    const points = rounded(branchPoints[k]);
    const at = junctions[b.junction].i;
    const track = buildTrack([rounded(mainPoints)[at], ...points], 5, rounded(mainPoints)[at - 1]);
    if (points.length < 3) noRoom('a branch has no room');
    // A basin has its own room to find; a lane over the end of a branch has to be on the map.
    if (!b.runsOn && !inBasin(b.kind) && !inMap(points[points.length - 1], 150)) noRoom('a branch ends off the map');
    for (let s = 650; s < track.length; s += 20) {
      const p = poseAt(track, s);
      if (!inMap([p.x, p.y], -100)) break;
      if (distanceTo(main, [p.x, p.y]) < 280) noRoom('a branch comes back to the main line');
      for (const [id, other] of tracks) if (id !== 'main' && distanceTo(other, [p.x, p.y]) < 380) noRoom('two branches come too close');
    }
    const place = names.place();
    const name = b.runsOn ? `${place} Canal` : `${place} ${inBasin(b.kind) || r() < 0.6 ? 'Arm' : 'Branch'}`;
    branchNames.set(b.id, place);
    waterways.push({ id: b.id, name, points, leaves: { waterway: 'main', atPoint: at, junction: junctionNames[b.junction] }, label: { at: 420, side: b.side > 0 ? -1 : 1 } });
    tracks.set(b.id, track);
  });
  const canals = () => [...tracks.values()];

  const busy = new Busy();
  busy.take('main', startAt, KEEP.start);
  junctionS.forEach((s) => busy.take('main', s, KEEP.junction));
  for (const b of branches) busy.take(b.id, 0, KEEP.junction);
  const features: FeatureData[] = [];
  const roads: RoadData[] = [];
  const roadTracks: Track[] = [];
  const villages: VillageData[] = [];
  const pubs: PubData[] = [];
  const farms: FarmData[] = [];
  const woods: AreaData[] = [];
  const ponds: AreaData[] = [];
  const mapNotes: { text: string; at: Point }[] = [];
  const liveries = [0, 1, 2, 3, 4, 5].map((l) => ({ l, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.l);

  // ---- Footbridges, where the towpath crosses at each junction.
  for (const b of branches) {
    // A branch to the right leaves on the main line's towpath side, so the towpath crosses the branch by its mouth; one to the left, the main line just before.
    if (b.side > 0) features.push({ kind: 'footbridge', id: `${b.id}-footbridge`, name: 'Footbridge', waterway: b.id, at: 110 });
    else if (!features.some((f) => f.id === `junction-${b.junction + 1}-footbridge`)) features.push({ kind: 'footbridge', id: `junction-${b.junction + 1}-footbridge`, name: 'Footbridge', waterway: 'main', at: round(junctionS[b.junction] - 110) });
  }

  // ---- Locks.
  const lockAt = new Map<string, { waterway: string; s: number }>();
  const lockNames = new Map<string, string>();
  let lockNumber = 0;
  for (const [waterway, points] of lockPoints) {
    const track = tracks.get(waterway);
    const own = waterway === 'main' ? mainPoints : branchPoints[branches.findIndex((b) => b.id === waterway)];
    if (!track || !own) continue;
    for (const j of points) {
      const p = own[j];
      if (!p) noRoom('a lock fell off its canal');
      const s = nearestDistance(track, p);
      // The canal must be straight through the lock and past its landings, which a branch that stopped short of its straight won't be.
      const c = poseAt(track, s);
      for (let x = -STRAIGHT_REACH; x <= STRAIGHT_REACH; x += 10) {
        const q = poseAt(track, s + x);
        if (Math.abs((q.x - c.x) * c.nx + (q.y - c.y) * c.ny) > 2) noRoom('a lock is not on a straight reach');
      }
      const ahead = poseAt(track, s + 200);
      const behind = poseAt(track, s - 200);
      const id = `lock-${++lockNumber}`;
      const name = `${names.word(LOCK_WORDS)} Lock`;
      lockNames.set(id, name);
      lockAt.set(id, { waterway, s });
      features.push({ kind: 'lock', id, name, waterway, at: round(s), uphill: land(ahead.x, ahead.y) >= land(behind.x, behind.y) ? 1 : -1, labelSide: -1 });
      busy.take(waterway, s, KEEP.lock);
    }
  }
  const lockAbove = (waterway: string, near: number) => [...lockAt].find(([, l]) => l.waterway === waterway && Math.abs(l.s - near - LOCK_ABOVE) < 450);

  // ---- Where each way ends, and how far along its canal it arrives.
  interface Ending {
    readonly way: string;
    readonly waterway: string;
    kind: EndKind;
    end: number;
    readonly runsOn: boolean;
  }
  const endings: Ending[] = [{ way: 'main', waterway: 'main', kind: shape.ends[0], end: Math.min(main.length - 900, Math.max(mainEndAim, (junctionS[junctionS.length - 1] ?? 0) + 1300)), runsOn: true }];
  branches.forEach((b) => {
    const track = tracks.get(b.id);
    if (!track) return;
    const basin = inBasin(b.kind);
    let end = basin ? track.length - 40 : b.runsOn ? b.need : track.length - 420;
    if (b.runsOn) {
      // Moor on the map, well before the branch leaves it.
      let inside = 0;
      for (let s = 0; s < track.length; s += 20) if (inMap([poseAt(track, s).x, poseAt(track, s).y], 250)) inside = s;
      end = Math.min(end, inside - 340);
    }
    endings.push({ way: b.id, waterway: b.id, kind: b.kind, end, runsOn: b.runsOn });
  });
  for (const e of endings) {
    if (e.kind !== 'lock-moorings') continue;
    const above = lockAbove(e.waterway, e.end);
    // Moor below the lock, wherever it went on the straight.
    if (above) e.end = above[1].s - LOCK_ABOVE;
    else e.kind = 'quiet-bank';
  }
  for (const e of endings) {
    if (e.end < 700) noRoom('a way ends too soon');
    // About as far as a day's cruising, counting each lock on the way as a stretch of it, or the day would be too short.
    const branch = branches.find((b) => b.id === e.waterway);
    const along = branch ? junctionS[branch.junction] : e.end;
    const locks = [...lockAt.values()].filter((l) => (l.waterway === 'main' && l.s < along) || (l.waterway === e.waterway && l.s < e.end)).length;
    if (along + (branch ? e.end : 0) - startAt + locks * LOCK_WORTH < WAY_LENGTH.min - 300) noRoom('a way is too short for a day');
    const gap = inBasin(e.kind) ? KEEP.basin : KEEP.bank;
    const at = inBasin(e.kind) ? e.end : e.end + 150;
    if (!busy.free(e.waterway, at, gap)) noRoom('a mooring lands on a lock or a junction');
    busy.take(e.waterway, at, gap);
  }

  // ---- Roads, square across a canal at a bridge, out to the map's edges or to a farm short of another canal.
  const nearOwn = (p: Point, c: Pose) => Math.hypot(p[0] - c.x, p[1] - c.y) < 220;
  const roadClear = (q: Point, c: Pose, gap: number) =>
    canals().every((t) => nearOwn(q, c) || distanceTo(t, q) > gap) &&
    pubs.every((pub) => Math.abs(q[0] - pub.at[0] - 55) > 190 || Math.abs(q[1] - pub.at[1] - 10) > 110) &&
    features.every((f) => f.kind !== 'basin' || q[0] < f.area.x - 90 || q[0] > f.area.x + f.area.width + 90 || q[1] < f.area.y - 90 || q[1] > f.area.y + f.area.height + 90) &&
    [...lockAt.values()].every((l) => {
      const lp = poseAt(tracks.get(l.waterway) ?? main, l.s);
      return Math.hypot(q[0] - lp.x, q[1] - lp.y) > 230;
    });
  const layRoad = (waterway: string, s: number, word: string): string | null => {
    const track = tracks.get(waterway);
    if (!track) return null;
    const c = poseAt(track, s);
    if (roadTracks.some((t) => distanceTo(t, [c.x, c.y]) < 520)) return null;
    const ends: Point[] = [];
    const half = (sign: 1 | -1): Point[] => {
      const out: Point[] = [];
      let at: Point = [c.x, c.y];
      let h = Math.atan2(c.ny * sign, c.nx * sign);
      for (const length of [260, 260, 600, 700, 800, 800, 900, 900, 900]) {
        if (out.length >= 2) h += (r() - 0.5) * 0.5;
        const next: Point = [at[0] + Math.cos(h) * length, at[1] + Math.sin(h) * length];
        let clear = true;
        for (let u = 0.05; u <= 1; u += 0.05) if (!roadClear([at[0] + (next[0] - at[0]) * u, at[1] + (next[1] - at[1]) * u], c, 110)) clear = false;
        if (!clear) {
          ends.push(at);
          break;
        }
        out.push(next);
        at = next;
        if (!inMap(at, -150)) break;
      }
      return out;
    };
    const one = half(1);
    const other = half(-1);
    if (one.length < 2 || other.length < 2) return null;
    const id = `road-${roads.length + 1}`;
    const points = rounded([...other.reverse(), [c.x, c.y], ...one]);
    const roadTrack = buildTrack(points, 10);
    roads.push({ id, name: `${word} ${r() < 0.6 ? 'Lane' : 'Road'}`, points });
    roadTracks.push(roadTrack);
    // A lane that stops short of another canal ends at a farm.
    for (const e of ends) {
      const at = nearestDistance(roadTrack, e);
      farms.push({ road: id, at: round(at < roadTrack.length / 2 ? at + 150 : at - 150), side: r() < 0.5 ? 1 : -1 });
    }
    return id;
  };
  const bridge = (waterway: string, s: number, own = false): string | null => {
    if (!own && !busy.free(waterway, s, KEEP.bridge)) return null;
    const word = names.word(LANE_WORDS);
    const road = layRoad(waterway, s, word);
    if (!road) return null;
    features.push({ kind: 'bridge', id: `bridge-${roads.length}`, name: `${word} Bridge`, waterway, at: round(s), road, labelSide: r() < 0.5 ? 1 : -1 });
    busy.take(waterway, s, KEEP.bridge);
    return road;
  };

  // ---- Where the day starts: the bank or basin the boat moored at last night, with the boats moored there and the pub beside it.
  if (from?.kind === 'bank') {
    features.push({ kind: 'bank', id: 'start', name: from.name, waterway: 'main', at: startAt - 100, labelSide: 1, about: from.about, spots: [{ name: 'Where you tied up last night', at: startAt }] });
  } else if (from) {
    // Laid out as a basin at the end of an arm coming in from the east, with the pub on the side there's room for.
    const [x, y] = rounded(mainPoints)[0];
    const fits = (vs: 1 | -1) => {
      const area = { x: x - 196, y: vs > 0 ? y - 129 : y - 60, width: 420, height: 189 };
      const pub: Point = [x + 6, vs > 0 ? y + 131 : y - 155];
      const corners: Point[] = [[area.x, area.y], [area.x + area.width, area.y + area.height], [pub[0] - 90, pub[1] - 45], [pub[0] + 200, pub[1] + 65]];
      return corners.every((q) => inMap(q, 60)) ? { area, pub } : null;
    };
    const vs: 1 | -1 = fits(1) ? 1 : -1;
    const room = fits(vs) ?? noRoom('no room for the basin the day starts in');
    const berths: BasinBoatData[] = [
      { at: [x + 76, y - vs * 96], angle: 0, livery: 0 },
      { at: [x - 34, y - vs * 96], angle: Math.PI, livery: 0 },
      { at: [x - 152, y - vs * 41], angle: Math.PI / 2, livery: 0 },
    ];
    features.push({
      kind: 'basin',
      id: 'start',
      name: from.name,
      waterway: 'main',
      at: 0,
      area: room.area,
      boats: from.boats.slice(0, berths.length).map((livery, i) => ({ ...berths[i], livery })),
      about: from.about,
      spots: [{ name: 'Where you tied up last night', at: [x - 100, y + vs * 33], angle: 0 }],
    });
    if (from.pub) pubs.push({ name: from.pub, at: room.pub });
    // A basin with no pub is an old wharf, and its lane comes down over a bridge at its mouth, where the towpath ends.
    else if (!bridge('main', 324, true)) noRoom('no room for the lane to the wharf');
  }

  // ---- The moorings at the end of each way.
  const clearArea = (centre: Point, radius: Point, gap: number): boolean => {
    const reach = Math.max(...radius);
    return (
      inMap(centre, reach * 0.6 + 100) &&
      canals().every((t) => distanceTo(t, centre) > reach + gap) &&
      roadTracks.every((t) => distanceTo(t, centre) > reach + 60) &&
      features.every((f) => f.kind !== 'basin' || Math.hypot(centre[0] - f.area.x - f.area.width / 2, centre[1] - f.area.y - f.area.height / 2) > reach + 380) &&
      pubs.every((p) => Math.hypot(centre[0] - p.at[0] - 55, centre[1] - p.at[1]) > reach + 260) &&
      villages.every((v) => Math.hypot(v.label[0] - centre[0], v.label[1] - centre[1]) > reach + 520) &&
      farms.every((f) => {
        const road = roadTracks[roads.findIndex((rd) => rd.id === f.road)];
        const p = road ? poseAt(road, f.at) : null;
        return !p || Math.hypot(p.x - centre[0], p.y - centre[1]) > reach + 200;
      }) &&
      [...woods, ...ponds].every((w) => Math.hypot(w.centre[0] - centre[0], w.centre[1] - centre[1]) > Math.max(...w.radius) + reach + 120)
    );
  };
  const woodBy = (pose: Pose, name: string): boolean => {
    for (const side of [-1, 1]) {
      for (const k of [1, 0.75, 0.55]) {
        const radius: Point = [round((320 + r() * 140) * k), round((190 + r() * 70) * k)];
        const centre: Point = [round(pose.x + pose.nx * side * (radius[1] + 240)), round(pose.y + pose.ny * side * (radius[1] + 240))];
        if (clearArea(centre, radius, 100)) {
          woods.push({ name, centre, radius });
          return true;
        }
      }
    }
    return false;
  };
  /** A village along a road either side of where it crosses a canal; the houses keep off the water as they're drawn. */
  const village = (road: string, crossing: Pose, name: string) => {
    const track = roadTracks[roads.findIndex((rd) => rd.id === road)];
    const houses = 16 + Math.floor(r() * 6);
    const at = nearestDistance(track, [crossing.x, crossing.y]);
    const label = poseAt(track, clamp(at + 520, 0, track.length), 160);
    villages.push({ name, road, from: round(clamp(at - houses * 26, 0, Math.max(0, track.length - houses * 52))), houses, label: [round(label.x), round(label.y)] });
  };

  for (const e of endings) {
    const track = tracks.get(e.waterway);
    if (!track) continue;
    const id = `end-${e.way}`;
    if (inBasin(e.kind)) {
      const points = waterways.find((w) => w.id === e.waterway)?.points ?? [];
      const [ex, ey] = points[points.length - 1];
      const dir = ex >= points[points.length - 2][0] ? 1 : -1;
      const fits = (vs: 1 | -1) => {
        const area = { x: dir > 0 ? ex - 224 : ex - 196, y: vs > 0 ? ey - 129 : ey - 60, width: 420, height: 189 };
        const pub: Point = [dir > 0 ? ex - 116 : ex + 6, vs > 0 ? ey + 131 : ey - 155];
        const corners: Point[] = [[area.x, area.y], [area.x + area.width, area.y], [area.x, area.y + area.height], [area.x + area.width, area.y + area.height]];
        const garden: Point[] = [[pub[0] - 90, pub[1] - 45], [pub[0] + 200, pub[1] - 45], [pub[0] - 90, pub[1] + 65], [pub[0] + 200, pub[1] + 65]];
        const others = canals().filter((t) => t !== track);
        const ok = corners.every((q) => inMap(q, 150) && others.every((t) => distanceTo(t, q) > 260)) && (e.kind === 'wharf' || garden.every((q) => inMap(q, 60) && canals().every((t) => distanceTo(t, q) > 80)));
        return ok ? { area, pub } : null;
      };
      const vs: 1 | -1 = fits(1) ? 1 : -1;
      const room = fits(vs);
      if (!room) noRoom('no room for a basin');
      const place = branchNames.get(e.waterway) ?? names.place();
      const pubName = names.word(PUBS);
      const wharf = e.kind === 'wharf';
      const facing = dir > 0 ? 0 : Math.PI;
      const basin: BasinData = {
        kind: 'basin',
        id,
        name: wharf ? `${place} Wharf` : `${place} Basin`,
        waterway: e.waterway,
        at: round(e.end),
        area: room.area,
        boats: [
          { at: [ex - dir * 76, ey - vs * 96], angle: Math.PI - facing, livery: liveries[3] },
          { at: [ex + dir * 34, ey - vs * 96], angle: facing, livery: liveries[4] },
          ...(wharf ? [] : [{ at: [ex + dir * 152, ey - vs * 41] as Point, angle: Math.PI / 2, livery: liveries[5] }]),
        ],
        about: wharf ? 'at the old wharf, by the lane' : `by ${pubName}${pubName.endsWith('Inn') ? '' : ' pub'}`,
        spots: [
          { name: wharf ? 'By the wharf steps' : 'By the pub garden', at: [ex - dir * 134, ey + vs * 33], angle: facing },
          { name: `Along the ${vs > 0 ? 'south' : 'north'} wall`, at: [ex - dir * 10, ey + vs * 33], angle: facing },
          { name: 'In the far corner', at: [ex + dir * 110, ey + vs * 35], angle: facing },
        ],
      };
      features.push(basin);
      if (wharf) {
        // A lane comes down to the wharf over a bridge at its mouth, where the towpath ends.
        if (!bridge(e.waterway, track.length - 224 - 100, true)) noRoom('no room for the lane to the wharf');
      } else pubs.push({ name: pubName, at: room.pub });
      continue;
    }

    // A bank with mooring rings, and a lane over the canal's end beyond it if it doesn't run on.
    const endRoad = e.runsOn ? null : bridge(e.waterway, track.length - 30, true);
    if (!e.runsOn && !endRoad) noRoom('no room for the lane at the end of a branch');
    const by = poseAt(track, e.end + 180);
    let name = '';
    let about = '';
    let spots = [names.pick(BANK_SPOTS), 'By the bench', names.pick(FAR_ENDS)];
    if (e.kind === 'village') {
      const road = endRoad ?? bridge(e.waterway, e.end - 170, true);
      if (road) {
        const v = branchNames.get(e.waterway) ?? names.place();
        village(road, poseAt(track, endRoad ? track.length - 30 : e.end - 170), v);
        name = `${v} moorings`;
        about = `in ${v}, by the church`;
        spots = ['Opposite the church', 'By the bench', 'Below the cottage gardens'];
      } else e.kind = 'quiet-bank';
    }
    if (e.kind === 'pub-bank') {
      const pubName = names.word(PUBS);
      // On the towpath's side, so you step off the boat into its garden.
      const side = e.waterway === 'main' ? 1 : branches.find((b) => b.id === e.waterway)?.side ?? 1;
      const at = (() => {
        for (const off of [215, 270, 330]) {
          const p = poseAt(track, e.end + 170, side * off);
          const pub: Point = [round(p.x - 55), round(p.y - 10)];
          const garden: Point[] = [[pub[0] - 90, pub[1] - 45], [pub[0] + 200, pub[1] - 45], [pub[0] - 90, pub[1] + 65], [pub[0] + 200, pub[1] + 65], [pub[0] + 55, pub[1] + 10]];
          if (garden.every((q) => inMap(q, 80) && canals().every((t) => distanceTo(t, q) > 70) && roadTracks.every((t) => distanceTo(t, q) > 60))) return pub;
        }
        return null;
      })();
      if (at) {
        pubs.push({ name: pubName, at });
        name = `${pubName.replace(/^The /, '')} moorings`;
        about = `outside ${pubName}`;
        spots = ['Outside the pub', 'By the bench', 'Along from the beer garden'];
      } else e.kind = 'quiet-bank';
    }
    if (e.kind === 'lock-moorings') {
      const lock = lockAbove(e.waterway, e.end);
      const lockName = lock ? (lockNames.get(lock[0]) ?? 'the lock') : 'the lock';
      name = `Below ${lockName}`;
      about = 'below the lock, by the lock cottage';
      spots = ['At the back of the line', 'By the bench', 'Nearest the lock'];
    }
    if (e.kind === 'quiet-bank') {
      const wood = `${names.place()} ${names.pick(WOOD_KINDS)}`;
      if (woodBy(by, wood)) {
        name = `${wood} bank`;
        about = `a quiet bank by ${wood}`;
      } else {
        name = `${names.place()} bank`;
        about = 'a quiet bank looking over the fields';
      }
    }
    const bank: BankData = {
      kind: 'bank',
      id,
      name,
      waterway: e.waterway,
      at: round(e.end),
      labelSide: 1,
      about,
      spots: spots.map((spot, i) => ({ name: spot, at: round(e.end + [75, 185, 300][i]) })),
    };
    features.push(bank);
  }

  // ---- Visitor moorings on the main line, early on, if there's room.
  const moorFrom = 950 + r() * 350;
  const boats = [moorFrom, moorFrom + 119, moorFrom + 238];
  if (busy.free('main', boats[1], KEEP.moorings) && features.every((f) => f.waterway !== 'main' || boats.every((b) => Math.abs(f.at - b) > 130))) {
    features.push({ kind: 'moorings', id: 'visitor-moorings', name: 'Visitor moorings', waterway: 'main', at: round(boats[1]), labelSide: 1, boats: boats.map((b, i) => ({ at: round(b), facing: r() < 0.5 ? 1 : -1, livery: liveries[i] })) });
    busy.take('main', boats[1], KEEP.moorings);
  }

  // ---- More bridges: one soon after the start, a couple further on, and one on some branches.
  for (const s of [650 + r() * 300, ...[0, 1].map(() => 1300 + r() * (main.length - 2300))]) bridge('main', s);
  for (const b of branches) {
    const track = tracks.get(b.id);
    if (track && r() < 0.5) bridge(b.id, 500 + r() * Math.max(100, track.length - 1100));
  }

  // ---- A village where a lane crosses the main line, if there's none yet; farms, woods and a pond.
  if (!villages.length) {
    const crossing = features.find((f) => f.kind === 'bridge' && f.waterway === 'main');
    if (crossing?.kind === 'bridge') village(crossing.road, poseAt(main, crossing.at), names.place());
  }
  for (const [i, road] of roads.entries()) {
    if (r() < 0.55) farms.push({ road: road.id, at: round(r() < 0.5 ? 300 : roadTracks[i].length - 500), side: r() < 0.5 ? 1 : -1 });
  }
  // A farmhouse sits off its road with its barn beside it: keep both well clear of the water and the village.
  for (let i = farms.length - 1; i >= 0; i--) {
    const road = roadTracks[roads.findIndex((rd) => rd.id === farms[i].road)];
    const p = poseAt(road, farms[i].at, farms[i].side * 70);
    const spots: Point[] = [[p.x, p.y], [p.x + 70, p.y + 20]];
    const inVillage = villages.some((v) => v.road === farms[i].road && farms[i].at > v.from - 150 && farms[i].at < v.from + v.houses * 52 + 150);
    if (inVillage || spots.some((q) => !inMap(q, 40) || canals().some((t) => distanceTo(t, q) < 160) || roadTracks.some((t, k) => k !== roads.findIndex((rd) => rd.id === farms[i].road) && distanceTo(t, q) < 80))) farms.splice(i, 1);
  }
  for (let i = 0, want = 2 + Math.floor(r() * 3) + endings.length; i < 60 && woods.length < want; i++) {
    const radius: Point = [round(260 + r() * 300), round(170 + r() * 110)];
    const centre: Point = [round(300 + r() * (W - 600)), round(300 + r() * (H - 600))];
    if (clearArea(centre, radius, 150)) woods.push({ name: `${names.place()} ${names.pick(WOOD_KINDS)}`, centre, radius });
  }
  if (r() < 0.7) {
    for (let i = 0; i < 30 && !ponds.length; i++) {
      const radius: Point = [round(110 + r() * 60), round(65 + r() * 25)];
      const centre: Point = [round(500 + r() * (W - 1000)), round(400 + r() * (H - 800))];
      if (clearArea(centre, radius, 260)) ponds.push({ name: `${names.pick(POND_WORDS)} Pond`, centre, radius });
    }
  }

  // ---- Words on the map for where the canals go beyond it.
  // A day that carries on from where the boat moored starts there, and the canal behind it is yesterday's.
  const fromName = from ? from.name : names.place();
  const startNote = poseAt(main, startAt + 120, 170);
  if (!from) mapNotes.push({ text: `from ${fromName}`, at: [round(startNote.x), round(startNote.y)] });
  let lastInside = 0;
  for (let s = 0; s < main.length; s += 20) if (inMap([poseAt(main, s).x, poseAt(main, s).y], 200)) lastInside = s;
  const endNote = poseAt(main, lastInside - 150, -150);
  mapNotes.push({ text: `to ${names.place()}`, at: [round(endNote.x), round(endNote.y)] });
  for (const b of branches) {
    const track = tracks.get(b.id);
    if (!b.runsOn || !track) continue;
    let inside = 0;
    for (let s = 0; s < track.length; s += 20) if (inMap([poseAt(track, s).x, poseAt(track, s).y], 200)) inside = s;
    const note = poseAt(track, inside - 120, b.side > 0 ? 130 : -130);
    if (inMap([note.x, note.y], 80)) mapNotes.push({ text: `on to ${names.place()}`, at: [round(note.x), round(note.y)] });
  }

  const ways: WayData[] = endings.map((e) => ({ id: e.way, route: e.way === 'main' ? ['main'] : ['main', e.waterway], to: `end-${e.way}` }));
  return {
    id: `made-${seed}`,
    name: `The ${canalName} at ${villages[0]?.name ?? fromName}`,
    seed,
    size: { width: W, height: H },
    waterways,
    roads,
    features,
    woods,
    ponds,
    villages,
    farms,
    pubs,
    mapNotes,
    trip: { from: { name: fromName, waterway: 'main', at: startAt }, ways },
  };
}

/** How near a towpath's end must be to what it joins: a bridge's or footbridge's foot, or a lock's stonework. */
const JOINS = 130;
/** How far off square a road may meet its bridge, as the sine of the angle. */
const SQUARE = 0.02;

/**
 * Where a stretch breaks the two rules for crossings. Roads cross a canal
 * only at their bridges, and square, so a bridge meets its road on both
 * banks. And every towpath ends where it joins something: a bridge, a
 * footbridge, a lock, another towpath, the pub by a basin, or the edge.
 */
export function crossingProblems(stretch: Stretch, runs: readonly TowpathRun[] = towpathRuns(stretch)): string[] {
  const { data } = stretch;
  const problems: string[] = [];
  const canalAt = (f: { waterway: string; at: number }, offset = 0) => {
    const track = stretch.waterways.get(f.waterway);
    if (!track) throw new Error(`No curve for ${f.waterway}`);
    return poseAt(track, f.at, offset);
  };
  const bridges = data.features.filter((f) => f.kind === 'bridge');
  for (const f of bridges) {
    const road = stretch.roads.get(f.road);
    if (!road) continue;
    const c = canalAt(f);
    for (const d of [-BRIDGE_DECK, 0, BRIDGE_DECK]) {
      const end: Point = [c.x + c.nx * d, c.y + c.ny * d];
      const p = poseAt(road, nearestDistance(road, end));
      const off = Math.abs((end[0] - p.x) * p.nx + (end[1] - p.y) * p.ny);
      if (off > 1 || Math.abs(Math.cos(p.angle) * c.ny - Math.sin(p.angle) * c.nx) > SQUARE) {
        problems.push(`${f.name} doesn't meet ${f.road} square`);
        break;
      }
    }
  }
  for (const [id, road] of stretch.roads) {
    const own = bridges.filter((f) => f.road === id).map((f) => canalAt(f));
    // Every 20 units finds any crossing of a canal 44 wide.
    for (let s = 0; s <= road.length; s += 20) {
      const p = poseAt(road, s);
      if (own.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < BRIDGE_DECK + 20)) continue;
      if ([...stretch.waterways.values()].some((t) => distanceTo(t, [p.x, p.y]) < CANAL_WIDTH / 2 + 12)) {
        problems.push(`${id} crosses a canal without a bridge`);
        break;
      }
    }
  }

  const feet = data.features.flatMap((f) => (f.kind === 'bridge' || f.kind === 'footbridge' ? [canalAt(f, TOWPATH_OFFSET), canalAt(f, -TOWPATH_OFFSET)] : f.kind === 'lock' ? [canalAt(f)] : []));
  for (const run of runs) {
    for (const s of [0, run.track.length]) {
      const p = poseAt(run.track, s);
      const offEdge = p.x < 0 || p.y < 0 || p.x > data.size.width || p.y > data.size.height;
      const joins = feet.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < JOINS);
      const onAnother = runs.some((other) => other !== run && distanceTo(other.track, [p.x, p.y]) < 4);
      const atPub = data.pubs.some((pub) => Math.hypot(p.x - pub.at[0], p.y - pub.at[1]) < 60);
      if (!offEdge && !joins && !onAnother && !atPub) problems.push(`a towpath ends in the open at ${Math.round(p.x)}, ${Math.round(p.y)}`);
    }
  }
  return problems;
}
