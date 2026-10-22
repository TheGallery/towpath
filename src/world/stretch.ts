// A stretch of canal, stored the way the map generator will make it: canals as
// points to pass through, a branch that leaves its parent at one of those
// points, and everything else placed by distance along a canal. The seed
// drives the scenery, so the same stretch always looks the same.

import { clamp, lerp } from '../core/math';
import { buildTrack, distanceTo, nearestDistance, poseAt } from '../core/track';
import type { Point, Track } from '../core/track';
import { BOAT_LENGTH, BRIDGE_DECK, MOORED_OFFSET } from './dimensions';

export interface WaterwayData {
  readonly id: string;
  readonly name: string;
  /** Points the canal's centre line passes through, in world units. */
  readonly points: readonly Point[];
  /** For a branch: where it leaves its parent canal. Its curve starts at that point. */
  readonly leaves?: { readonly waterway: string; readonly atPoint: number; readonly junction: string };
  /** Where the canal's name goes on the map: a distance along it, and which side. */
  readonly label?: { readonly at: number; readonly side: 1 | -1 };
}

export interface RoadData {
  readonly id: string;
  readonly name: string;
  readonly points: readonly Point[];
}

/** A boat tied to the bank, placed by distance along its canal. */
export interface MooredBoatData {
  readonly at: number;
  /** Which way it points: 1 along the canal, -1 back the other way. */
  readonly facing: 1 | -1;
  /** Which paint scheme it wears. */
  readonly livery: number;
}

/** A boat in a basin, placed freely. */
export interface BasinBoatData {
  readonly at: Point;
  readonly angle: number;
  readonly livery: number;
}

interface FeatureBase {
  readonly id: string;
  readonly name: string;
  readonly waterway: string;
  /** Distance along the waterway. */
  readonly at: number;
  /** Which side of the canal its name goes on the map; no name if left out. */
  readonly labelSide?: 1 | -1;
}

export interface BridgeData extends FeatureBase {
  readonly kind: 'bridge';
  readonly road: string;
}

export interface FootbridgeData extends FeatureBase {
  readonly kind: 'footbridge';
}

export interface LockData extends FeatureBase {
  readonly kind: 'lock';
  /** 1 if the water level rises going along the waterway, -1 if it falls. */
  readonly uphill: 1 | -1;
}

export interface MooringsData extends FeatureBase {
  readonly kind: 'moorings';
  readonly boats: readonly MooredBoatData[];
}

/** A place in a basin to tie up for the night, placed freely. */
export interface BasinSpotData {
  readonly name: string;
  readonly at: Point;
  readonly angle: number;
}

export interface BasinData extends FeatureBase {
  readonly kind: 'basin';
  readonly area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly boats: readonly BasinBoatData[];
  /** What it's like to moor here, in a few words. */
  readonly about: string;
  readonly spots: readonly BasinSpotData[];
}

/** A place on a bank to tie up for the night, by distance along the canal. */
export interface BankSpotData {
  readonly name: string;
  readonly at: number;
}

/** A stretch of towpath bank with mooring rings, where a boat can stop for the night. */
export interface BankData extends FeatureBase {
  readonly kind: 'bank';
  readonly about: string;
  /** Where boats tie up, ahead of where they arrive at the bank's `at`. */
  readonly spots: readonly BankSpotData[];
}

export type FeatureData = BridgeData | FootbridgeData | LockData | MooringsData | BasinData | BankData;

/** A feature a day can end at, mooring for the night. */
export type MooringData = BasinData | BankData;

/** One way the day can go: the waterways it follows, each a branch of the one before, and where it moors. */
export interface WayData {
  readonly id: string;
  readonly route: readonly string[];
  /** The mooring the way ends at. */
  readonly to: string;
}

export interface AreaData {
  readonly name: string;
  readonly centre: Point;
  readonly radius: Point;
}

export interface VillageData {
  readonly name: string;
  /** Houses line this road, starting this far along it. */
  readonly road: string;
  readonly from: number;
  readonly houses: number;
  readonly label: Point;
}

/** A farmhouse and barn beside a road. */
export interface FarmData {
  readonly road: string;
  readonly at: number;
  readonly side: 1 | -1;
}

export interface PubData {
  readonly name: string;
  readonly at: Point;
}

export interface StretchData {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly size: { readonly width: number; readonly height: number };
  readonly waterways: readonly WaterwayData[];
  readonly roads: readonly RoadData[];
  readonly features: readonly FeatureData[];
  readonly woods: readonly AreaData[];
  readonly ponds: readonly AreaData[];
  readonly villages: readonly VillageData[];
  readonly farms: readonly FarmData[];
  readonly pubs: readonly PubData[];
  /** Words on the map for places beyond the edges of the stretch. */
  readonly mapNotes: readonly { readonly text: string; readonly at: Point }[];
  readonly trip: {
    /** Where the boat starts the day, moored. */
    readonly from: { readonly name: string; readonly waterway: string; readonly at: number };
    /** The ways the day can go, which part at a junction. The boat follows the first until you choose. */
    readonly ways: readonly WayData[];
  };
}

/** A feature that lies on the trip's route, with its distance along the route. */
export interface RouteFeature {
  readonly feature: FeatureData;
  readonly s: number;
}

export interface Junction {
  readonly name: string;
  readonly point: Point;
  /** Distance along the route, where the branch leaves it. */
  readonly s: number;
  readonly branch: WaterwayData;
  /** True if the route turns onto the branch, false if it carries straight on. */
  readonly turns: boolean;
}

/** A place to tie up for the night, where the boat lies when moored there. */
export interface Spot {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** One way the day can go, ready to play. */
export interface Way {
  readonly id: string;
  /** The ids of the waterways it follows. */
  readonly follows: readonly string[];
  /** The path the boat follows. */
  readonly route: Track;
  readonly onRoute: readonly RouteFeature[];
  /** Every junction the route passes, whether it turns there or not. */
  readonly junctions: readonly Junction[];
  /** Where the boat arrives at the mooring. */
  readonly end: number;
  readonly mooring: MooringData;
  readonly spots: readonly Spot[];
}

/** A stretch ready to play: every curve built, and every feature placed along each way. */
export interface Stretch {
  readonly data: StretchData;
  readonly waterways: ReadonlyMap<string, Track>;
  readonly roads: ReadonlyMap<string, Track>;
  readonly ways: readonly Way[];
  /** Where the day begins, the same distance along every way. */
  readonly start: number;
}

/** How near a feature must be to the route's curve to count as on it. */
const ON_ROUTE = 8;

/** How far apart a road's points are where it's bent to cross a canal square. Half a deck, so the deck's ends fall on points. */
const ROAD_STEP = BRIDGE_DECK / 2;
/** How far either side of a canal a road runs straight and square to it: over its bridge and one step beyond. */
const SQUARE_TO = BRIDGE_DECK + ROAD_STEP;
/** How far from the canal a road has bent back to its own way. */
const BENT_BY = SQUARE_TO + 340;
/** How near its canal's bridge a road must pass to be the road it carries. */
const ROAD_AT_BRIDGE = 40;

/** How near the junction a footbridge must cross a branch the towpath turns along, so the towpath can carry on along the main line too. */
const ROVING_REACH = 200;

/**
 * The points a waterway's curve passes through, and for a branch the point
 * before the junction on its parent, which shapes how smoothly it turns off.
 */
export function waterwayCurve(data: StretchData, waterway: WaterwayData): { points: Point[]; before?: Point } {
  if (!waterway.leaves) return { points: [...waterway.points] };
  const parent = waterwayCurve(data, findWaterway(data, waterway.leaves.waterway));
  // The parent's own points start after its junction point, if it is a branch itself.
  const at = waterway.leaves.atPoint + (parent.points.length - findWaterway(data, waterway.leaves.waterway).points.length);
  return { points: [parent.points[at], ...waterway.points], before: parent.points[at - 1] };
}

const curveTrack = (data: StretchData, waterway: WaterwayData): Track => {
  const { points, before } = waterwayCurve(data, waterway);
  return buildTrack(points, 5, before);
};

function findWaterway(data: StretchData, id: string): WaterwayData {
  const found = data.waterways.find((w) => w.id === id);
  if (!found) throw new Error(`No waterway called ${id}`);
  return found;
}

/** A way's points: along the first waterway, then into each branch where it leaves. */
function routePoints(data: StretchData, way: WayData): Point[] {
  const [first, ...rest] = way.route.map((id) => findWaterway(data, id));
  let points = waterwayCurve(data, first).points;
  // Where the current waterway's own points begin in `points`.
  let ownStart = first.leaves ? 1 : 0;
  let parent = first;
  for (const branch of rest) {
    if (branch.leaves?.waterway !== parent.id) throw new Error(`${branch.id} does not leave ${parent.id}`);
    const turn = ownStart + branch.leaves.atPoint;
    points = [...points.slice(0, turn + 1), ...branch.points];
    ownStart = turn + 1;
    parent = branch;
  }
  return points;
}

/** Where a place on a waterway falls along a way, or null if the way doesn't pass it. */
export function routeDistance(stretch: Pick<Stretch, 'waterways'>, way: Pick<Way, 'follows' | 'route'>, waterway: string, at: number): number | null {
  const track = stretch.waterways.get(waterway);
  if (!track || !way.follows.includes(waterway)) return null;
  const p = poseAt(track, at);
  const point: Point = [p.x, p.y];
  return distanceTo(way.route, point) <= ON_ROUTE ? nearestDistance(way.route, point) : null;
}

/** Where the boat lies at each spot of a mooring. */
function spotsAt(waterways: ReadonlyMap<string, Track>, mooring: MooringData): Spot[] {
  if (mooring.kind === 'basin') return mooring.spots.map((s) => ({ name: s.name, x: s.at[0], y: s.at[1], angle: s.angle }));
  const track = waterways.get(mooring.waterway);
  if (!track) return [];
  return mooring.spots.map((s) => {
    const p = poseAt(track, s.at, MOORED_OFFSET);
    return { name: s.name, x: p.x, y: p.y, angle: p.angle };
  });
}

/**
 * A road's points, bent to cross each canal square where a bridge carries it,
 * as English roads do: straight over the bridge, so the deck meets the road on
 * both banks, then bending smoothly back to its way.
 */
function roadPoints(data: StretchData, waterways: ReadonlyMap<string, Track>, road: RoadData): Point[] {
  let points: Point[] = [...road.points];
  for (const f of data.features) {
    const canal = f.kind === 'bridge' && f.road === road.id ? waterways.get(f.waterway) : undefined;
    if (!canal) continue;
    const c = poseAt(canal, f.at);
    const track = buildTrack(points, 10);
    const s = nearestDistance(track, [c.x, c.y]);
    const heading = poseAt(track, s).angle;
    // Which way across the canal the road goes.
    const k = Math.cos(heading) * c.nx + Math.sin(heading) * c.ny < 0 ? -1 : 1;
    // Evenly spaced points along the road, one on the crossing, so the curve through them stays smooth.
    const first = -Math.floor(s / ROAD_STEP);
    const last = Math.floor((track.length - s) / ROAD_STEP);
    const bent: Point[] = [];
    for (let i = first; i <= last; i++) {
      const d = i * ROAD_STEP;
      const p = poseAt(track, s + d);
      const t = clamp((Math.abs(d) - SQUARE_TO) / (BENT_BY - SQUARE_TO), 0, 1);
      const w = t * t * (3 - 2 * t);
      bent.push([lerp(c.x + c.nx * d * k, p.x, w), lerp(c.y + c.ny * d * k, p.y, w)]);
    }
    // The road still starts and ends where it did.
    const ends = [points[0], points[points.length - 1]];
    points = [ends[0], ...bent.filter((p) => ends.every((e) => Math.hypot(p[0] - e[0], p[1] - e[1]) > ROAD_STEP / 2)), ends[1]];
  }
  return points;
}

export function resolveStretch(data: StretchData): Stretch {
  const problems = checkStretch(data);
  if (problems.length) throw new Error(`The stretch ${data.id} has problems:\n${problems.join('\n')}`);

  const waterways = new Map(data.waterways.map((w) => [w.id, curveTrack(data, w)]));
  const roads = new Map(data.roads.map((r) => [r.id, buildTrack(roadPoints(data, waterways, r), 10)]));

  const ways = data.trip.ways.map((w): Way => {
    const first = findWaterway(data, w.route[0]);
    const route = buildTrack(routePoints(data, w), 5, waterwayCurve(data, first).before);
    const place = { follows: w.route, route };

    const onRoute: RouteFeature[] = [];
    for (const feature of data.features) {
      const s = routeDistance({ waterways }, place, feature.waterway, feature.at);
      if (s !== null) onRoute.push({ feature, s });
    }
    onRoute.sort((a, b) => a.s - b.s);

    // Every branch leaving a waterway the way follows, where the way passes it.
    const junctions: Junction[] = [];
    for (const branch of data.waterways) {
      if (!branch.leaves || !w.route.includes(branch.leaves.waterway)) continue;
      const point = waterwayCurve(data, branch).points[0];
      if (distanceTo(route, point) > ON_ROUTE) continue;
      junctions.push({ name: branch.leaves.junction, point, s: nearestDistance(route, point), branch, turns: w.route.includes(branch.id) });
    }
    junctions.sort((a, b) => a.s - b.s);

    const end = onRoute.find((f) => f.feature.id === w.to);
    if (end?.feature.kind !== 'basin' && end?.feature.kind !== 'bank') throw new Error(`The way ${w.id} on ${data.id} does not end at a mooring on its route`);
    return { id: w.id, follows: w.route, route, onRoute, junctions, end: Math.min(end.s, route.length), mooring: end.feature, spots: spotsAt(waterways, end.feature) };
  });

  const starts = ways.map((w) => routeDistance({ waterways }, w, data.trip.from.waterway, data.trip.from.at));
  const start = starts[0];
  if (start === null || start === undefined || starts.some((s) => s === null || Math.abs(s - start) > 1)) throw new Error(`The day on ${data.id} does not start on every way`);
  return { data, waterways, roads, ways, start };
}

/** Everything wrong with a stretch's data, in plain words. Empty when it's sound. */
export function checkStretch(data: StretchData): string[] {
  const problems: string[] = [];
  const waterwayIds = new Set(data.waterways.map((w) => w.id));
  const roadIds = new Set(data.roads.map((r) => r.id));

  const lengths = new Map<string, number>();
  for (const w of data.waterways) {
    if (w.leaves) {
      const parent = data.waterways.find((p) => p.id === w.leaves?.waterway);
      if (!parent) {
        problems.push(`${w.id} leaves ${w.leaves.waterway}, which doesn't exist`);
        continue;
      }
      if (w.leaves.atPoint < 1 || w.leaves.atPoint >= parent.points.length - 1) problems.push(`${w.id} leaves ${parent.id} at point ${w.leaves.atPoint}, which isn't an inside point`);
    }
    if (w.points.length < 2 && !w.leaves) problems.push(`${w.id} needs at least two points`);
  }
  if (problems.length) return problems;
  const curves = new Map(data.waterways.map((w) => [w.id, curveTrack(data, w)]));
  for (const [id, track] of curves) lengths.set(id, track.length);

  for (const f of data.features) {
    const length = lengths.get(f.waterway);
    if (length === undefined) problems.push(`${f.id} is on ${f.waterway}, which doesn't exist`);
    else if (f.at < 0 || f.at > length + 0.5) problems.push(`${f.id} is ${Math.round(f.at)} along ${f.waterway}, which is only ${Math.round(length)} long`);
    if (f.kind === 'bank' && length !== undefined && f.spots.some((s) => s.at > length)) problems.push(`a spot at ${f.id} is beyond the end of ${f.waterway}`);
    if (f.kind === 'bridge' && !roadIds.has(f.road)) problems.push(`${f.id} carries ${f.road}, which doesn't exist`);
    if (f.kind === 'bridge' && length !== undefined && roadIds.has(f.road)) {
      const road = data.roads.find((r) => r.id === f.road);
      const canal = curves.get(f.waterway);
      const p = canal ? poseAt(canal, f.at) : null;
      if (road && p && distanceTo(buildTrack(road.points, 10), [p.x, p.y]) > ROAD_AT_BRIDGE) problems.push(`${f.id} isn't where ${f.road} crosses ${f.waterway}`);
    }
    if (f.kind === 'moorings') {
      const ats = f.boats.map((b) => b.at).sort((a, b) => a - b);
      for (let i = 1; i < ats.length; i++) if (ats[i] - ats[i - 1] < BOAT_LENGTH + 10) problems.push(`two boats at ${f.id} overlap`);
    }
  }
  const ids = data.features.map((f) => f.id);
  if (new Set(ids).size !== ids.length) problems.push('two features share an id');

  // Moored boats keep clear of bridges, locks and junctions, so there's room to pass.
  for (const m of data.features) {
    if (m.kind !== 'moorings') continue;
    for (const b of m.boats) {
      for (const f of data.features) {
        if (f.waterway !== m.waterway || f.kind === 'moorings' || f.kind === 'basin') continue;
        if (Math.abs(f.at - b.at) < BOAT_LENGTH + 40) problems.push(`a boat at ${m.id} is moored too close to ${f.id}`);
      }
    }
  }

  if (data.trip.ways.length === 0) problems.push('the trip has no way to go');
  for (const way of data.trip.ways) {
    for (const id of way.route) if (!waterwayIds.has(id)) problems.push(`the way ${way.id} follows ${id}, which doesn't exist`);
    const to = data.features.find((f) => f.id === way.to);
    if (!to) problems.push(`the way ${way.id} ends at ${way.to}, which doesn't exist`);
    else if (to.kind !== 'basin' && to.kind !== 'bank') problems.push(`the way ${way.id} ends at ${way.to}, which isn't a place to moor`);
    if (way.route[0] !== data.trip.from.waterway) problems.push(`the way ${way.id} starts off the waterway the day begins on`);
  }

  // Where the towpath turns off along a branch, a footbridge near the junction carries it over, so it can carry on along the main line too.
  for (const id of data.trip.ways[0]?.route.slice(1) ?? []) {
    if (!data.features.some((f) => f.kind === 'footbridge' && f.waterway === id && f.at <= ROVING_REACH)) problems.push(`no footbridge carries the towpath over ${id} by its junction`);
  }

  // Spots to moor at keep clear of each other, and of the boats already there.
  for (const f of data.features) {
    if (f.kind === 'basin') {
      const a = f.area;
      const points = [...f.spots.map((s) => s.at), ...f.boats.map((b) => b.at)];
      for (const s of f.spots) {
        if (s.at[0] < a.x || s.at[0] > a.x + a.width || s.at[1] < a.y || s.at[1] > a.y + a.height) problems.push(`the spot ${s.name} at ${f.id} is outside the basin`);
      }
      for (let i = 0; i < f.spots.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const [p, q] = [points[i], points[j]];
          if (Math.hypot(p[0] - q[0], p[1] - q[1]) < BOAT_LENGTH / 2 + 20) problems.push(`the spot ${f.spots[i].name} at ${f.id} is too close to another boat`);
        }
      }
    }
    if (f.kind === 'bank') {
      const ats = f.spots.map((s) => s.at).sort((a, b) => a - b);
      if (ats[0] < f.at + BOAT_LENGTH / 2) problems.push(`the first spot at ${f.id} is behind where a boat arrives`);
      for (let i = 1; i < ats.length; i++) if (ats[i] - ats[i - 1] < BOAT_LENGTH + 10) problems.push(`two spots at ${f.id} overlap`);
    }
    if ((f.kind === 'basin' || f.kind === 'bank') && f.spots.length === 0) problems.push(`${f.id} has nowhere to moor`);
  }
  return problems;
}
