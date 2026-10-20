// A stretch of canal, stored the way the map generator will make it: canals as
// points to pass through, a branch that leaves its parent at one of those
// points, and everything else placed by distance along a canal. The seed
// drives the scenery, so the same stretch always looks the same.

import { buildTrack, distanceTo, nearestDistance, poseAt } from '../core/track';
import type { Point, Track } from '../core/track';
import { BOAT_LENGTH } from './dimensions';

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

export interface BasinData extends FeatureBase {
  readonly kind: 'basin';
  readonly area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly boats: readonly BasinBoatData[];
}

export type FeatureData = BridgeData | FootbridgeData | LockData | MooringsData | BasinData;

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
    /** The waterways the trip follows, each a branch of the one before. */
    readonly route: readonly string[];
    /** The feature the trip ends at. */
    readonly to: string;
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
  /** Distance along the route, where the route turns onto the branch. */
  readonly s: number;
  readonly branch: WaterwayData;
}

/** A stretch ready to play: every curve built and every feature placed on the route. */
export interface Stretch {
  readonly data: StretchData;
  readonly waterways: ReadonlyMap<string, Track>;
  readonly roads: ReadonlyMap<string, Track>;
  /** The path the boat follows through the day. */
  readonly route: Track;
  readonly onRoute: readonly RouteFeature[];
  readonly junctions: readonly Junction[];
  readonly start: number;
  readonly end: number;
}

/** How near a feature must be to the route's curve to count as on it. */
const ON_ROUTE = 8;

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

/** The route's points: along the first waterway, then into each branch where it leaves. */
function routePoints(data: StretchData): Point[] {
  const [first, ...rest] = data.trip.route.map((id) => findWaterway(data, id));
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

/** Where a place on a waterway falls along the route, or null if the route doesn't pass it. */
export function routeDistance(stretch: Pick<Stretch, 'data' | 'waterways' | 'route'>, waterway: string, at: number): number | null {
  const track = stretch.waterways.get(waterway);
  if (!track || !stretch.data.trip.route.includes(waterway)) return null;
  const p = poseAt(track, at);
  const point: Point = [p.x, p.y];
  return distanceTo(stretch.route, point) <= ON_ROUTE ? nearestDistance(stretch.route, point) : null;
}

export function resolveStretch(data: StretchData): Stretch {
  const problems = checkStretch(data);
  if (problems.length) throw new Error(`The stretch ${data.id} has problems:\n${problems.join('\n')}`);

  const waterways = new Map(data.waterways.map((w) => [w.id, curveTrack(data, w)]));
  const roads = new Map(data.roads.map((r) => [r.id, buildTrack(r.points, 10)]));
  const first = findWaterway(data, data.trip.route[0]);
  const route = buildTrack(routePoints(data), 5, waterwayCurve(data, first).before);

  const toRoute = (waterway: string, at: number) => routeDistance({ data, waterways, route }, waterway, at);

  const onRoute: RouteFeature[] = [];
  for (const feature of data.features) {
    const s = toRoute(feature.waterway, feature.at);
    if (s !== null) onRoute.push({ feature, s });
  }
  onRoute.sort((a, b) => a.s - b.s);

  const junctions: Junction[] = [];
  for (const id of data.trip.route) {
    const branch = findWaterway(data, id);
    if (!branch.leaves) continue;
    const point = waterwayCurve(data, branch).points[0];
    junctions.push({ name: branch.leaves.junction, point, s: nearestDistance(route, point), branch });
  }

  const start = toRoute(data.trip.from.waterway, data.trip.from.at);
  const endFeature = onRoute.find((f) => f.feature.id === data.trip.to);
  if (start === null || !endFeature) throw new Error(`The trip on ${data.id} does not start and end on its route`);
  return { data, waterways, roads, route, onRoute, junctions, start, end: Math.min(endFeature.s, route.length) };
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
  for (const w of data.waterways) lengths.set(w.id, curveTrack(data, w).length);

  for (const f of data.features) {
    const length = lengths.get(f.waterway);
    if (length === undefined) problems.push(`${f.id} is on ${f.waterway}, which doesn't exist`);
    else if (f.at < 0 || f.at > length + 0.5) problems.push(`${f.id} is ${Math.round(f.at)} along ${f.waterway}, which is only ${Math.round(length)} long`);
    if (f.kind === 'bridge' && !roadIds.has(f.road)) problems.push(`${f.id} carries ${f.road}, which doesn't exist`);
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

  for (const id of data.trip.route) if (!waterwayIds.has(id)) problems.push(`the trip follows ${id}, which doesn't exist`);
  if (!ids.includes(data.trip.to)) problems.push(`the trip ends at ${data.trip.to}, which doesn't exist`);
  if (!data.trip.route.includes(data.trip.from.waterway)) problems.push('the trip starts off its route');
  return problems;
}
