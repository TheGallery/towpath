// Keeping your place: the game written down as plain data, so closing the tab
// or reloading it carries on where you were. A kept place says which version
// of the format it is, and keeps the canal's number and its whole stretch as
// well as the day, so a change to how canals are made never moves the map
// under a kept boat. One from an older or newer version, or broken in any
// way, is set aside, and a new game starts instead; only a day on the Hallam
// Canal kept before canals had numbers is read back, to finish it.

import type { Point } from '../core/track';
import { HALLAM } from '../world/hallam';
import { resolveStretch } from '../world/stretch';
import type { AreaData, BankSpotData, BasinBoatData, BasinSpotData, FeatureData, MooredBoatData, Stretch, StretchData, WaterwayData, WayData } from '../world/stretch';
import { towpathRuns } from '../world/towpath';
import { callKey } from './calls';
import type { Call, CallKind } from './calls';
import { planDay } from './day';
import type { Day, DayPhase, DayPlan, Glide, Placed } from './day';
import type { LogEntry, Logbook } from './logbook';
import type { Crew, LockState, Part } from './lock';
import type { OtherBoat, OtherWay } from './otherboat';
import { MAX_SEED } from './playable';
import type { Passage, Trip, TripPhase, TripPlan } from './trip';

/** Bump this whenever the shape of a kept place changes, or where its places fall along the ways, so older ones are set aside. */
export const SAVE_VERSION = 4;
/** The version before canals had numbers, when every kept place was on the Hallam Canal or made from `?seed=`. A day on the Hallam Canal kept then is read back to finish it. */
export const HALLAM_SAVE_VERSION = 3;

/** The canal a game is played on: the number it was made from, or null for the Hallam Canal, and its whole stretch. */
export interface Canal {
  readonly number: number | null;
  readonly data: StretchData;
}

/** Everything kept between visits: the canal, the day, how the next day's lock will be, and whether the bell is on. */
export interface Kept {
  readonly canal: Canal;
  readonly day: Day;
  /** Which way the other boat went through the lock today; the next day gets the other. */
  readonly other: OtherWay;
  readonly bell: boolean;
}

/** A kept place read back, with the stretch and day plan its day was read against, ready to play. */
export interface Loaded extends Kept {
  readonly stretch: Stretch;
  readonly plan: DayPlan;
}

/** The kept place as text, for browser storage. */
export function saveGame(kept: Kept): string {
  const { day } = kept;
  const { trip } = day;
  const spot = day.spot ? day.plan.spots.indexOf(day.spot) : -1;
  return JSON.stringify({
    version: SAVE_VERSION,
    canal: kept.canal.number,
    stretch: kept.canal.data,
    other: kept.other,
    bell: kept.bell,
    day: {
      number: day.number,
      time: day.time,
      phase: day.phase,
      phaseTime: day.phaseTime,
      way: day.plan.way,
      ways: day.ways,
      held: day.held,
      spot: spot >= 0 ? spot : null,
      glide: day.glide ? { from: day.glide.from, time: day.glide.time, t: day.glide.t } : null,
      calls: { open: day.calls.open, answered: [...day.calls.answered] },
      trip: {
        time: trip.time,
        phase: trip.phase,
        boat: trip.boat,
        helm: trip.helm,
        idle: trip.idle,
        throttle: trip.throttle,
        locks: Object.fromEntries(trip.locks),
        passage: trip.passage ? { lock: trip.passage.lock.id, yours: trip.passage.yours, crew: trip.passage.crew } : null,
        tidying: trip.tidying.map((t) => ({ lock: t.lock.id, crew: t.crew })),
        other: trip.other,
        crewed: trip.crewed,
        // A boat that has never bumped anything bumped at minus infinity, which JSON can't write.
        lastBump: Number.isFinite(trip.lastBump) ? trip.lastBump : null,
        hold: trip.hold,
      },
      log: day.log,
    },
  });
}

/** Why a kept place was set aside. */
class BadSave extends Error {}

function fail(what: string): never {
  throw new BadSave(what);
}

type Raw = Record<string, unknown>;

const record = (v: unknown, what: string): Raw => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : fail(what));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(what));
const num = (v: unknown, what: string, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(what));
const int = (v: unknown, what: string, lo = -Infinity, hi = Infinity): number => (Number.isInteger(v) ? num(v, what, lo, hi) : fail(what));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(what));
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(what));
const oneOf = <T extends string | number>(v: unknown, values: readonly T[], what: string): T => (values.includes(v as T) ? (v as T) : fail(what));
const orNull = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === null ? null : read(v));

const DAY_PHASES: readonly DayPhase[] = ['morning', 'underway', 'dusk', 'tying-up', 'evening', 'night', 'dawn', 'over'];
const TRIP_PHASES: readonly TripPhase[] = ['moored', 'cruising', 'in-lock', 'arrived'];
const CALLS: readonly CallKind[] = ['cast-off', 'lock', 'junction', 'dusk'];

/** A call's key, with its kind checked. */
const readKey = (v: unknown, what: string): string => {
  const key = str(v, what);
  oneOf(key.split(':')[0], CALLS, what);
  return key;
};

const OTHER_WAYS: readonly OtherWay[] = ['down', 'up'];
const PARTS: readonly Part[] = ['bottomGates', 'topGates', 'bottomPaddle', 'topPaddle'];

/**
 * Reads a kept place back, with its canal ready to play, or null if there's
 * none, or it's from another version, or it's broken.
 */
export function loadGame(text: string | null): Loaded | null {
  if (!text) return null;
  try {
    const raw = record(JSON.parse(text), 'save');
    let canal: Canal;
    if (raw.version === SAVE_VERSION) canal = { number: orNull(raw.canal, (v) => int(v, 'canal', 0, MAX_SEED)), data: readStretch(raw.stretch) };
    // A day on the Hallam Canal from before canals had numbers, kept in the same shape, finishes there.
    else if (raw.version === HALLAM_SAVE_VERSION && raw.stretch === HALLAM.id && raw.seed === HALLAM.seed) canal = { number: null, data: HALLAM };
    else return null;
    const { stretch, plan } = playable(canal.data);
    return { canal, stretch, plan, day: readDay(record(raw.day, 'day'), plan), other: oneOf(raw.other, OTHER_WAYS, 'other'), bell: bool(raw.bell, 'bell') };
  } catch (e) {
    if (e instanceof BadSave || e instanceof SyntaxError || e instanceof TypeError || e instanceof RangeError) return null;
    throw e;
  }
}

/** A kept stretch made ready to play, as the game makes it before it starts: one that won't is set aside. */
function playable(data: StretchData): { stretch: Stretch; plan: DayPlan } {
  try {
    const stretch = resolveStretch(data);
    towpathRuns(stretch);
    return { stretch, plan: planDay(stretch) };
  } catch (e) {
    // Its curves, ways and towpaths throw plain errors when a kept stretch doesn't fit together.
    if (e instanceof Error) fail(`stretch: ${e.message}`);
    throw e;
  }
}

/** The most points a canal or road may have, and things of any one kind a stretch may hold, so a broken one can't take forever to lay out. */
const MAX_POINTS = 400;
const MAX_THINGS = 200;
/** How big a stretch may be, and how far beyond its edges a canal or road may run. */
const MAX_SIZE = 20000;
const BEYOND = 4000;
/** The furthest anything may be placed along a canal or road. */
const MAX_ALONG = 100000;
const SIDES: readonly (1 | -1)[] = [1, -1];

const things = <T>(v: unknown, what: string, read: (v: unknown) => T): T[] => {
  const items = list(v, what);
  return items.length <= MAX_THINGS ? items.map(read) : fail(what);
};

/** The whole stretch a kept place is on, every value checked, as the generator or the hand-made stretch wrote it. */
function readStretch(v: unknown): StretchData {
  const raw = record(v, 'stretch');
  const sizeRaw = record(raw.size, 'size');
  const size = { width: num(sizeRaw.width, 'width', 1, MAX_SIZE), height: num(sizeRaw.height, 'height', 1, MAX_SIZE) };
  const point = (p: unknown, what: string): Point => {
    const xy = list(p, what);
    if (xy.length !== 2) fail(what);
    return [num(xy[0], what, -BEYOND, size.width + BEYOND), num(xy[1], what, -BEYOND, size.height + BEYOND)];
  };
  const points = (p: unknown, what: string): Point[] => {
    const all = list(p, what);
    return all.length <= MAX_POINTS ? all.map((q) => point(q, what)) : fail(what);
  };
  const along = (p: unknown, what: string) => num(p, what, 0, MAX_ALONG);
  const area = (a: unknown): AreaData => {
    const ar = record(a, 'area');
    const radius = point(ar.radius, 'radius');
    if (radius[0] < 0 || radius[1] < 0) fail('radius');
    return { name: str(ar.name, 'area name'), centre: point(ar.centre, 'centre'), radius };
  };
  const tripRaw = record(raw.trip, 'trip');
  const fromRaw = record(tripRaw.from, 'from');
  return {
    id: str(raw.id, 'id'),
    name: str(raw.name, 'name'),
    seed: int(raw.seed, 'seed', 0, MAX_SEED),
    size,
    waterways: things(raw.waterways, 'waterways', (w): WaterwayData => {
      const wr = record(w, 'waterway');
      const leaves = wr.leaves === undefined ? undefined : record(wr.leaves, 'leaves');
      const label = wr.label === undefined ? undefined : record(wr.label, 'label');
      return {
        id: str(wr.id, 'waterway id'),
        name: str(wr.name, 'waterway name'),
        points: points(wr.points, 'waterway points'),
        ...(leaves && { leaves: { waterway: str(leaves.waterway, 'leaves'), atPoint: int(leaves.atPoint, 'at point', 0, MAX_POINTS), junction: str(leaves.junction, 'junction') } }),
        ...(label && { label: { at: along(label.at, 'label at'), side: oneOf(label.side, SIDES, 'label side') } }),
      };
    }),
    roads: things(raw.roads, 'roads', (r) => {
      const rr = record(r, 'road');
      return { id: str(rr.id, 'road id'), name: str(rr.name, 'road name'), points: points(rr.points, 'road points') };
    }),
    features: things(raw.features, 'features', (f) => readFeature(record(f, 'feature'), point, along)),
    woods: things(raw.woods, 'woods', area),
    ponds: things(raw.ponds, 'ponds', area),
    villages: things(raw.villages, 'villages', (x) => {
      const vr = record(x, 'village');
      return { name: str(vr.name, 'village name'), road: str(vr.road, 'village road'), from: along(vr.from, 'village from'), houses: int(vr.houses, 'houses', 0, MAX_THINGS), label: point(vr.label, 'village label') };
    }),
    farms: things(raw.farms, 'farms', (x) => {
      const fr = record(x, 'farm');
      return { road: str(fr.road, 'farm road'), at: along(fr.at, 'farm at'), side: oneOf(fr.side, SIDES, 'farm side') };
    }),
    pubs: things(raw.pubs, 'pubs', (x) => {
      const pr = record(x, 'pub');
      return { name: str(pr.name, 'pub name'), at: point(pr.at, 'pub at') };
    }),
    mapNotes: things(raw.mapNotes, 'map notes', (x) => {
      const nr = record(x, 'map note');
      return { text: str(nr.text, 'map note'), at: point(nr.at, 'map note at') };
    }),
    trip: {
      from: { name: str(fromRaw.name, 'from'), waterway: str(fromRaw.waterway, 'from waterway'), at: along(fromRaw.at, 'from at') },
      ways: things(tripRaw.ways, 'trip ways', (w): WayData => {
        const wr = record(w, 'trip way');
        return { id: str(wr.id, 'trip way id'), route: things(wr.route, 'route', (id) => str(id, 'route')), to: str(wr.to, 'to') };
      }),
    },
  };
}

function readFeature(raw: Raw, point: (v: unknown, what: string) => Point, along: (v: unknown, what: string) => number): FeatureData {
  const base = {
    id: str(raw.id, 'feature id'),
    name: str(raw.name, 'feature name'),
    waterway: str(raw.waterway, 'feature waterway'),
    at: along(raw.at, 'feature at'),
    ...(raw.labelSide !== undefined && { labelSide: oneOf(raw.labelSide, SIDES, 'label side') }),
  };
  const livery = (v: unknown) => int(v, 'livery', 0, MAX_THINGS);
  const angle = (v: unknown) => num(v, 'angle', -2 * Math.PI, 2 * Math.PI);
  switch (raw.kind) {
    case 'bridge':
      return { kind: 'bridge', ...base, road: str(raw.road, 'bridge road') };
    case 'footbridge':
      return { kind: 'footbridge', ...base };
    case 'lock':
      return { kind: 'lock', ...base, uphill: oneOf(raw.uphill, SIDES, 'uphill') };
    case 'moorings':
      return {
        kind: 'moorings',
        ...base,
        boats: things(raw.boats, 'boats', (b): MooredBoatData => {
          const br = record(b, 'boat');
          return { at: along(br.at, 'boat at'), facing: oneOf(br.facing, SIDES, 'facing'), livery: livery(br.livery) };
        }),
      };
    case 'basin': {
      const ar = record(raw.area, 'basin area');
      const corner = point([ar.x, ar.y], 'basin area');
      const far = point([num(ar.x, 'basin area') + num(ar.width, 'basin width', 0), num(ar.y, 'basin area') + num(ar.height, 'basin height', 0)], 'basin area');
      return {
        kind: 'basin',
        ...base,
        area: { x: corner[0], y: corner[1], width: far[0] - corner[0], height: far[1] - corner[1] },
        boats: things(raw.boats, 'boats', (b): BasinBoatData => {
          const br = record(b, 'boat');
          return { at: point(br.at, 'boat at'), angle: angle(br.angle), livery: livery(br.livery) };
        }),
        about: str(raw.about, 'about'),
        spots: things(raw.spots, 'spots', (p): BasinSpotData => {
          const pr = record(p, 'spot');
          return { name: str(pr.name, 'spot name'), at: point(pr.at, 'spot at'), angle: angle(pr.angle) };
        }),
      };
    }
    case 'bank':
      return {
        kind: 'bank',
        ...base,
        about: str(raw.about, 'about'),
        spots: things(raw.spots, 'spots', (p): BankSpotData => {
          const pr = record(p, 'spot');
          return { name: str(pr.name, 'spot name'), at: along(pr.at, 'spot at') };
        }),
      };
    default:
      return fail('feature kind');
  }
}

function readDay(raw: Raw, plan: DayPlan): Day {
  const way = plan.ways.find((w) => w.way === raw.way) ?? fail('way');
  const all = plan.ways.map((w) => w.way);
  const ways = list(raw.ways, 'ways').map((w) => oneOf(str(w, 'ways'), all, 'ways'));
  if (!ways.includes(way.way)) fail('way not among the ways');
  const spotIndex = orNull(raw.spot, (v) => int(v, 'spot', 0, way.spots.length - 1));
  const spot = spotIndex === null ? null : way.spots[spotIndex];
  const glideRaw = orNull(raw.glide, (v) => record(v, 'glide'));
  let glide: Glide | null = null;
  if (glideRaw) {
    if (!spot) fail('glide without a spot');
    glide = { from: readPlaced(glideRaw.from), to: spot, time: num(glideRaw.time, 'glide time', 0.001), t: num(glideRaw.t, 'glide t', 0, 1) };
  }
  const phase = oneOf(raw.phase, DAY_PHASES, 'phase');
  if (phase === 'tying-up' && !glide) fail('tying up without a glide');
  const callsRaw = record(raw.calls, 'calls');
  return {
    number: int(raw.number, 'number', 1),
    time: num(raw.time, 'time', 0),
    phase,
    phaseTime: num(raw.phaseTime, 'phase time', 0),
    plan: way,
    ways,
    held: bool(raw.held, 'held'),
    spot,
    glide,
    calls: {
      open: orNull(callsRaw.open, readCall),
      answered: new Set(list(callsRaw.answered, 'answered').map((k) => readKey(k, 'answered'))),
    },
    trip: readTrip(record(raw.trip, 'trip'), way, plan),
    log: readLog(record(raw.log, 'log')),
  };
}

function readPlaced(v: unknown): Placed {
  const raw = record(v, 'pose');
  return { x: num(raw.x, 'x'), y: num(raw.y, 'y'), angle: num(raw.angle, 'angle') };
}

function readCall(v: unknown): Call {
  const raw = record(v, 'call');
  const kind = oneOf(raw.kind, CALLS, 'call');
  // A call's place is the rest of its key after the kind.
  const key = raw.place === undefined ? kind : callKey(kind, str(raw.place, 'place'));
  const place = key === kind ? undefined : key.slice(kind.length + 1);
  const times = { since: num(raw.since, 'since', 0), rang: num(raw.rang, 'rang', 0), reminders: int(raw.reminders, 'reminders', 0) };
  return place === undefined ? { kind, ...times } : { kind, place, ...times };
}

function readTrip(raw: Raw, plan: TripPlan, day: DayPlan): Trip {
  const boatRaw = record(raw.boat, 'boat');
  const locksRaw = record(raw.locks, 'locks');
  const lockFor = (id: unknown) => plan.locks.find((l) => l.id === id) ?? fail('lock');
  const passageRaw = orNull(raw.passage, (v) => record(v, 'passage'));
  const passage: Passage | null = passageRaw ? { lock: lockFor(passageRaw.lock), yours: bool(passageRaw.yours, 'yours'), crew: orNull(passageRaw.crew, readCrew) } : null;
  const phase = oneOf(raw.phase, TRIP_PHASES, 'trip phase');
  if ((phase === 'in-lock') !== (passage !== null)) fail('passage');
  const other = orNull(raw.other, readOther);
  if (other && !plan.other) fail('other boat');
  return {
    time: num(raw.time, 'trip time', 0),
    phase,
    boat: {
      s: num(boatRaw.s, 's', 0, plan.route.length),
      d: num(boatRaw.d, 'd', -100, 100),
      psi: num(boatRaw.psi, 'psi', -Math.PI, Math.PI),
      v: num(boatRaw.v, 'v', -20, 20),
      turn: num(boatRaw.turn, 'turn', -1, 1),
    },
    helm: oneOf(raw.helm, ['auto', 'you'] as const, 'helm'),
    idle: num(raw.idle, 'idle', 0),
    throttle: num(raw.throttle, 'throttle', -20, 20),
    // Every lock the day can pass, on any way, and no others.
    locks: new Map(day.locks.map((l) => [l.id, readLock(locksRaw[l.id])])),
    passage,
    tidying: list(raw.tidying, 'tidying').map((t) => {
      const tr = record(t, 'tidying');
      return { lock: lockFor(tr.lock), crew: readCrew(tr.crew) };
    }),
    other,
    crewed: bool(raw.crewed, 'crewed'),
    lastBump: raw.lastBump === null ? -Infinity : num(raw.lastBump, 'last bump'),
    hold: orNull(raw.hold, (v) => num(v, 'hold', 0, plan.route.length)),
  };
}

function readLock(v: unknown): LockState {
  const raw = record(v, 'lock');
  const unit = (key: string) => num(raw[key], key, 0, 1);
  const movingRaw = record(raw.moving, 'moving');
  const moving: LockState['moving'] = {};
  for (const [part, m] of Object.entries(movingRaw)) {
    const mr = record(m, 'moving part');
    moving[oneOf(part, PARTS, 'moving part')] = { to: num(mr.to, 'to', 0, 1), rate: num(mr.rate, 'rate', 0) };
  }
  return { water: unit('water'), bottomGates: unit('bottomGates'), topGates: unit('topGates'), bottomPaddle: unit('bottomPaddle'), topPaddle: unit('topPaddle'), moving, flowIn: unit('flowIn'), flowOut: unit('flowOut') };
}

function readCrew(v: unknown): Crew {
  const raw = record(v, 'crew');
  const pace = record(raw.pace, 'pace');
  return {
    goingUp: bool(raw.goingUp, 'going up'),
    pace: { paddle: num(pace.paddle, 'paddle pace', 0.001), gate: num(pace.gate, 'gate pace', 0.001), rest: num(pace.rest, 'rest pace', 0) },
    leaveOpen: bool(raw.leaveOpen, 'leave open'),
    rest: num(raw.rest, 'rest'),
    done: bool(raw.done, 'done'),
  };
}

function readOther(v: unknown): OtherBoat {
  const raw = record(v, 'other boat');
  return {
    way: oneOf(raw.way, OTHER_WAYS, 'other way'),
    x: num(raw.x, 'other x', -10000, 10000),
    d: num(raw.d, 'other d', -100, 100),
    v: num(raw.v, 'other v', -20, 20),
    yaw: num(raw.yaw, 'other yaw', -Math.PI, Math.PI),
    phase: oneOf(raw.phase, ['waiting', 'working', 'away', 'gone'] as const, 'other phase'),
    crew: readCrew(raw.crew),
  };
}

function readLog(raw: Raw): Logbook {
  const times = (v: unknown, what: string): Record<string, number> => {
    const r = record(v, what);
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(r)) out[readKey(k, what)] = num(t, what);
    return out;
  };
  return { entries: list(raw.entries, 'entries').map(readEntry), waiting: times(raw.waiting, 'waiting'), waited: times(raw.waited, 'waited'), written: bool(raw.written, 'written') };
}

function readEntry(v: unknown): LogEntry {
  const raw = record(v, 'entry');
  const at = num(raw.at, 'at', 0);
  const time = (key: string) => orNull(raw[key], (t) => num(t, key, 0));
  switch (raw.kind) {
    case 'set-out':
      return { kind: 'set-out', at, from: str(raw.from, 'from'), along: str(raw.along, 'along') };
    case 'lock':
      return {
        kind: 'lock',
        at,
        id: str(raw.id, 'lock id'),
        lock: str(raw.lock, 'lock'),
        goingUp: bool(raw.goingUp, 'going up'),
        other: orNull(raw.other, (w) => oneOf(w, OTHER_WAYS, 'other')),
        ready: orNull(raw.ready, (r) => bool(r, 'ready')),
        yours: time('yours'),
        cleared: time('cleared'),
      };
    case 'way':
      return { kind: 'way', at, junction: str(raw.junction, 'junction'), turn: oneOf(raw.turn, ['left', 'right', 'straight'] as const, 'turn'), onto: str(raw.onto, 'onto'), to: str(raw.to, 'to') };
    case 'moored':
      return { kind: 'moored', at, spot: str(raw.spot, 'spot'), mooring: str(raw.mooring, 'mooring'), about: str(raw.about, 'about') };
    case 'evening':
      return { kind: 'evening', at, miles: num(raw.miles, 'miles', 0), locks: int(raw.locks, 'locks', 0) };
    default:
      return fail('entry kind');
  }
}
