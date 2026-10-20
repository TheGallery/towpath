// A day's trip along the route: the boat casts off, cruises by itself, slows
// past moored boats, ties up at each lock for you to work it, and moors at the
// end. You can take the tiller whenever you like, and the boat takes it back
// when you let go. Another boat uses the first lock just before you.

import { clamp } from '../core/math';
import { headingAt } from '../core/track';
import type { Track } from '../core/track';
import { BOAT_LENGTH, MOORED_OFFSET, unitsPerSecond } from '../world/dimensions';
import { routeDistance } from '../world/stretch';
import type { FeatureData, Stretch } from '../world/stretch';
import { ASTERN_SPEED, CRUISE_SPEED, LOCK_SPEED, PASSING_SPEED, TOP_SPEED, moveBoat } from './boat';
import type { Boat, Bump, Helm, Obstacle } from './boat';
import { CHAMBER_HALF, LANDING_GAP, LEVEL_TOLERANCE, crewStep, isOpen, lockEnds, newCrew, newLock, nextJob, nextPart, stepLock, whereIs } from './lock';
import type { Crew, Job, LockEvent, LockState, Part, Span, Where } from './lock';
import { KEEP_RIGHT, lockWaterFor, newOtherBoat, otherSpan, stepOther } from './otherboat';
import type { OtherBoat, OtherBoatPlan, OtherEvent, OtherWay } from './otherboat';

/** What you're pressing: the tiller left or right, and the throttle ahead or astern. */
export interface Controls {
  readonly rudder: -1 | 0 | 1;
  readonly throttle: -1 | 0 | 1;
}

export const NO_CONTROLS: Controls = { rudder: 0, throttle: 0 };

export const JUNCTION_SPEED = unitsPerSecond(2.2);

/** Seconds without touching the controls before the boat steers itself again. */
export const HAND_BACK_AFTER = 3;
/** How fast the throttle changes the speed you've set while a key is held, per second. */
const THROTTLE_RATE = 2.5;
/** How gently the boat plans to slow down, in units per second per second. */
const EASE_OFF = 0.45;
/** The other boat sets off when you are this far below the lock's landing, so it meets you there. */
const OTHER_BOAT_LEAD: Readonly<Record<OtherWay, number>> = { down: 650, up: 150 };

const HALF_LENGTH = BOAT_LENGTH / 2;
/** How far to keep left of the centre line when passing moored boats. */
const PASSING_LINE = -6;

/** One lock on the route, as the trip meets it. */
export interface RouteLock {
  readonly id: string;
  readonly name: string;
  readonly s: number;
  readonly goingUp: boolean;
}

export interface RouteJunction {
  readonly name: string;
  readonly s: number;
  readonly branch: string;
  readonly turn: 'left' | 'right';
}

/** Everything about the route the trip's rules need, worked out once. */
export interface TripPlan {
  readonly route: Track;
  readonly start: number;
  readonly end: number;
  readonly startName: string;
  readonly endName: string;
  /** Which waterway the route follows from each distance on. */
  readonly legs: readonly { readonly from: number; readonly name: string }[];
  readonly locks: readonly RouteLock[];
  readonly moorings: readonly { readonly name: string; readonly from: number; readonly to: number }[];
  readonly obstacles: readonly Obstacle[];
  readonly junctions: readonly RouteJunction[];
  /** Every named place along the route, in order. */
  readonly places: readonly { readonly name: string; readonly s: number }[];
  /** The other boat's canal and the lock it uses, the first on the route. */
  readonly other: OtherBoatPlan | null;
}

export function planTrip(stretch: Stretch): TripPlan {
  const { data, route } = stretch;
  const locks: RouteLock[] = [];
  const moorings: { name: string; from: number; to: number }[] = [];
  const obstacles: Obstacle[] = [];
  let endName = data.trip.to;
  let other: OtherBoatPlan | null = null;
  for (const { feature, s } of stretch.onRoute) {
    if (feature.kind === 'lock') {
      locks.push({ id: feature.id, name: feature.name, s, goingUp: feature.uphill > 0 });
      const track = stretch.waterways.get(feature.waterway);
      if (track && !other) {
        const slow = data.features.flatMap((f) =>
          f.kind === 'moorings' && f.waterway === feature.waterway ? [{ from: Math.min(...f.boats.map((b) => b.at)) - HALF_LENGTH, to: Math.max(...f.boats.map((b) => b.at)) + HALF_LENGTH }] : [],
        );
        other = { track, lock: { id: feature.id, at: feature.at, uphill: feature.uphill }, slow, trigger: { down: s - LANDING_GAP - OTHER_BOAT_LEAD.down, up: s - LANDING_GAP - OTHER_BOAT_LEAD.up } };
      }
    }
    if (feature.kind === 'moorings') {
      const at = feature.boats.map((b) => routeDistance(stretch, feature.waterway, b.at) ?? s);
      for (const bs of at) obstacles.push({ s: bs, d: MOORED_OFFSET });
      moorings.push({ name: feature.name, from: Math.min(...at) - HALF_LENGTH - 70, to: Math.max(...at) + HALF_LENGTH + 40 });
    }
    if (feature.id === data.trip.to) endName = feature.name;
  }
  const junctions = stretch.junctions.map((j) => ({
    name: j.name,
    s: j.s,
    branch: j.branch.name,
    turn: headingAt(route, j.s + 120) > headingAt(route, j.s - 120) ? ('right' as const) : ('left' as const),
  }));
  const names = new Map(data.waterways.map((w) => [w.id, w.name]));
  const legs = [{ from: 0, name: names.get(data.trip.route[0]) ?? '' }, ...junctions.map((j) => ({ from: j.s, name: j.branch }))];
  // Moorings count as reached where the moored boats begin.
  const placeAt = (f: FeatureData, s: number) => (f.kind === 'moorings' ? (moorings.find((m) => m.name === f.name)?.from ?? s) : s);
  const places = [...stretch.onRoute.map(({ feature, s }) => ({ name: feature.name, s: placeAt(feature, s) })), ...junctions].sort((a, b) => a.s - b.s);
  return { route, start: stretch.start, end: stretch.end, startName: data.trip.from.name, endName, legs, locks, moorings, obstacles, junctions, places, other };
}

export type TripPhase = 'moored' | 'cruising' | 'in-lock' | 'arrived';

/** Your boat's way through the lock it has tied up at. */
export interface Passage {
  readonly lock: RouteLock;
  /** Set once no other boat is using the lock, so it's yours to work. */
  yours: boolean;
  /** Works the lock for you, on a crewed trip. */
  readonly crew: Crew | null;
}

export interface Trip {
  /** Seconds since the day began. */
  time: number;
  phase: TripPhase;
  boat: Boat;
  /** Who is steering: the boat by itself, or you at the tiller. */
  helm: 'auto' | 'you';
  /** Seconds since you last touched the controls. */
  idle: number;
  /** The speed you've set, while you have the tiller. */
  throttle: number;
  locks: Map<string, LockState>;
  passage: Passage | null;
  /** Locks being closed up behind your boat once it has left. */
  tidying: { readonly lock: RouteLock; readonly crew: Crew }[];
  other: OtherBoat | null;
  /** Locks are worked for you, as when timing the trip, rather than by hand. */
  readonly crewed: boolean;
  lastBump: number;
}

export interface TripOptions {
  /** Which way the other boat goes through the first lock, if there is one. */
  readonly other?: OtherWay | null;
  readonly crewed?: boolean;
}

export type TripEvent =
  | { readonly kind: 'cast-off' }
  | { readonly kind: 'took-helm' }
  | { readonly kind: 'handed-back' }
  | { readonly kind: 'helm-taken'; readonly reason: 'lock' | 'junction' | 'mooring' }
  | { readonly kind: 'bump'; readonly what: Bump }
  | { readonly kind: 'reached-lock'; readonly lock: string; readonly waiting: boolean }
  | { readonly kind: 'lock-yours'; readonly lock: string; readonly ready: boolean }
  | { readonly kind: 'lock'; readonly lock: string; readonly event: LockEvent }
  | { readonly kind: 'cleared-lock'; readonly lock: string }
  | { readonly kind: 'other-boat'; readonly event: OtherEvent['kind'] }
  | { readonly kind: 'arrived' };

export function newTrip(plan: TripPlan, options: TripOptions = {}): Trip {
  const other = plan.other && options.other ? newOtherBoat(options.other) : null;
  const locks = new Map(plan.locks.map((l) => [l.id, newLock(0)]));
  if (other && plan.other) locks.set(plan.other.lock.id, newLock(lockWaterFor(other.way)));
  return {
    time: 0,
    phase: 'moored',
    boat: { s: plan.start, d: MOORED_OFFSET, psi: 0, v: 0, turn: 0 },
    helm: 'auto',
    idle: 0,
    throttle: 0,
    locks,
    passage: null,
    tidying: [],
    other,
    crewed: options.crewed ?? false,
    lastBump: -Infinity,
  };
}

export function castOff(trip: Trip): TripEvent[] {
  if (trip.phase !== 'moored') return [];
  trip.phase = 'cruising';
  return [{ kind: 'cast-off' }];
}

/** Why the boat insists on steering itself here, if it does. */
export function steersItselfHere(plan: TripPlan, s: number): 'lock' | 'junction' | 'mooring' | null {
  for (const l of plan.locks) if (s > l.s - LANDING_GAP - 250 && s < l.s + CHAMBER_HALF + HALF_LENGTH + 60) return 'lock';
  for (const j of plan.junctions) if (Math.abs(s - j.s) < 150) return 'junction';
  if (s > plan.end - 250) return 'mooring';
  return null;
}

/** The fastest the boat can go and still stop gently in `distance`. */
const stoppingSpeed = (distance: number): number => (distance <= 0.3 ? 0 : Math.max(0.5, Math.sqrt(2 * EASE_OFF * distance)));

/** The speed the boat chooses for itself at this point, slowing ahead of time for what's coming. */
export function plannedSpeed(plan: TripPlan, s: number): number {
  let want = CRUISE_SPEED;
  const zones = [
    ...plan.moorings.map((m) => ({ from: m.from, to: m.to, speed: PASSING_SPEED })),
    ...plan.junctions.map((j) => ({ from: j.s - 150, to: j.s + 150, speed: JUNCTION_SPEED })),
  ];
  for (const z of zones) {
    if (s > z.to) continue;
    const ahead = Math.max(0, z.from - s);
    want = Math.min(want, Math.sqrt(z.speed * z.speed + 2 * EASE_OFF * ahead));
  }
  for (const l of plan.locks) {
    const landing = l.s - LANDING_GAP;
    if (s <= landing + 0.5) want = Math.min(want, stoppingSpeed(landing - s));
  }
  return Math.min(want, stoppingSpeed(plan.end - s));
}

/** Where the other boat is along your route, if it's on the stretch you share. */
function otherOnRoute(trip: Trip, plan: TripPlan): { s: number; d: number; oncoming: boolean } | null {
  const o = trip.other;
  const lock = plan.locks.find((l) => l.id === plan.other?.lock.id);
  if (!o || !lock || o.phase === 'gone') return null;
  const s = lock.s + (lock.goingUp ? o.x : -o.x);
  if (s > (plan.junctions[0]?.s ?? Infinity) - 40) return null;
  return { s, d: o.d, oncoming: (o.way === 'up') !== lock.goingUp };
}

/** Which line on the water the boat keeps to by itself. */
function autoLine(trip: Trip, plan: TripPlan, s: number): number {
  const other = otherOnRoute(trip, plan);
  const meeting = other !== null && other.oncoming && other.s > s && other.s - s < 300;
  if (plan.moorings.some((m) => s > m.from - 40 && s < m.to)) return meeting ? 0 : PASSING_LINE;
  // Tie up on the towpath side below a lock, keeping clear of a boat coming out.
  if (meeting || plan.locks.some((l) => s > l.s - LANDING_GAP - 300 && s < l.s - LANDING_GAP + 1)) return KEEP_RIGHT;
  return 0;
}

/** The stretch of a lock your boat takes up, measured from its middle towards the top gate. */
export function yourSpan(boat: Boat, lock: RouteLock): Span {
  const x = (boat.s - lock.s) * (lock.goingUp ? 1 : -1);
  return { from: x - HALF_LENGTH, to: x + HALF_LENGTH };
}

/** Every boat in or near a lock, which its gates must not close on. */
export function boatsAt(trip: Trip, plan: TripPlan, lock: RouteLock): Span[] {
  const spans: Span[] = [];
  const yours = yourSpan(trip.boat, lock);
  if (Math.abs(yours.from) < 600) spans.push(yours);
  if (trip.other && trip.other.phase !== 'gone' && plan.other?.lock.id === lock.id) spans.push(otherSpan(trip.other));
  return spans;
}

/** True when no other boat is using the lock or in the way of yours. */
function lockFree(trip: Trip, plan: TripPlan, lock: RouteLock): boolean {
  const o = trip.other;
  if (!o || plan.other?.lock.id !== lock.id || o.phase === 'gone') return true;
  if (o.phase !== 'away' || !o.crew.done) return false;
  const yours = yourSpan(trip.boat, lock);
  const theirs = otherSpan(o);
  return theirs.to < Math.min(yours.from, -CHAMBER_HALF - 20) - 10 || theirs.from > Math.max(yours.to, CHAMBER_HALF + 20) + 10;
}

/** How the boat moves on its way through a lock: it waits until the gates ahead of it are open. */
function passageMove(trip: Trip, passage: Passage): { speed: number; line: number; stop: number | null } {
  const { boat } = trip;
  const { lock } = passage;
  const state = trip.locks.get(lock.id);
  const hold = { speed: 0, line: KEEP_RIGHT, stop: boat.s };
  if (!passage.yours || !state) return hold;
  const e = lockEnds(lock.goingUp);
  const toMiddle = { speed: Math.min(LOCK_SPEED, stoppingSpeed(lock.s - boat.s)), line: 0, stop: lock.s };
  const where = whereIs(yourSpan(boat, lock), lock.goingUp);
  if (where === 'before') return isOpen(state[e.entryGate]) ? toMiddle : hold;
  if (where === 'in' && !isOpen(state[e.exitGate])) return toMiddle;
  return { speed: LOCK_SPEED, line: 0, stop: null };
}

export function stepTrip(trip: Trip, plan: TripPlan, controls: Controls, dt: number): TripEvent[] {
  const events: TripEvent[] = [];
  trip.time += dt;
  const boat = trip.boat;

  // The other boat, and closing up behind your boat at locks it has left.
  const otherLock = plan.other && trip.locks.get(plan.other.lock.id);
  if (trip.other && plan.other && otherLock) {
    for (const e of stepOther(trip.other, plan.other, otherLock, dt, trip.phase === 'moored' ? -Infinity : boat.s)) events.push({ kind: 'other-boat', event: e.kind });
  }
  trip.tidying = trip.tidying.filter(({ lock, crew }) => {
    const state = trip.locks.get(lock.id);
    if (state) crewStep(state, crew, 'after', dt);
    return !crew.done;
  });
  for (const l of plan.locks) {
    const state = trip.locks.get(l.id);
    if (!state) continue;
    const happened = stepLock(state, dt, boatsAt(trip, plan, l));
    if (trip.passage?.lock.id === l.id && trip.passage.yours) for (const event of happened) events.push({ kind: 'lock', lock: l.id, event });
  }

  if (trip.phase === 'moored' || trip.phase === 'arrived') {
    trip.idle += dt;
    return events;
  }

  // Who has the helm.
  const forced = trip.phase === 'in-lock' ? 'lock' : steersItselfHere(plan, boat.s);
  const touching = controls.rudder !== 0 || controls.throttle !== 0;
  if (touching) trip.idle = 0;
  else trip.idle += dt;
  if (trip.helm === 'auto' && touching && !forced) {
    trip.helm = 'you';
    trip.throttle = clamp(boat.v, 0, TOP_SPEED);
    events.push({ kind: 'took-helm' });
  } else if (trip.helm === 'you' && forced) {
    trip.helm = 'auto';
    events.push({ kind: 'helm-taken', reason: forced });
  } else if (trip.helm === 'you' && trip.idle >= HAND_BACK_AFTER) {
    trip.helm = 'auto';
    events.push({ kind: 'handed-back' });
  }

  let helm: Helm;
  let stopAt: number | null = null;
  if (trip.helm === 'you') {
    trip.throttle = clamp(trip.throttle + controls.throttle * THROTTLE_RATE * dt, ASTERN_SPEED, TOP_SPEED);
    helm = { kind: 'tiller', rudder: controls.rudder, speed: trip.throttle };
  } else if (trip.phase === 'in-lock' && trip.passage) {
    const move = passageMove(trip, trip.passage);
    stopAt = move.stop;
    helm = { kind: 'auto', line: move.line, speed: move.speed };
  } else {
    helm = { kind: 'auto', line: autoLine(trip, plan, boat.s), speed: plannedSpeed(plan, boat.s) };
    const landing = plan.locks.find((l) => boat.s <= l.s - LANDING_GAP + 0.5);
    stopAt = Math.min(landing ? landing.s - LANDING_GAP : Infinity, plan.end);
  }

  const other = otherOnRoute(trip, plan);
  const obstacles = other ? [...plan.obstacles, { s: other.s, d: other.d }] : plan.obstacles;
  const bump = moveBoat(boat, plan.route, helm, dt, obstacles);
  if (stopAt !== null && boat.s > stopAt) {
    boat.s = stopAt;
    boat.v = 0;
  }
  // Going astern stops where the day began: the stretch behind is off the map.
  if (boat.s < plan.start) {
    boat.s = plan.start;
    boat.v = Math.max(0, boat.v);
  }
  if (bump && trip.time - trip.lastBump > 1.5) events.push({ kind: 'bump', what: bump });
  if (bump) trip.lastBump = trip.time;

  if (trip.phase === 'cruising' && trip.helm === 'auto') {
    const landing = plan.locks.find((l) => Math.abs(boat.s - (l.s - LANDING_GAP)) < 0.6);
    if (landing && boat.v < 0.3) {
      trip.phase = 'in-lock';
      trip.passage = { lock: landing, yours: false, crew: trip.crewed ? newCrew(landing.goingUp) : null };
      events.push({ kind: 'reached-lock', lock: landing.id, waiting: !lockFree(trip, plan, landing) });
    } else if (boat.s >= plan.end - 0.6 && boat.v < 0.3) {
      trip.phase = 'arrived';
      boat.v = 0;
      events.push({ kind: 'arrived' });
    }
  } else if (trip.phase === 'in-lock' && trip.passage) {
    workPassage(trip, plan, trip.passage, dt, events);
  }
  return events;
}

/** Your side of the lock: waiting for it to be free, the crew's work on a crewed trip, and leaving. */
function workPassage(trip: Trip, plan: TripPlan, passage: Passage, dt: number, events: TripEvent[]): void {
  const state = trip.locks.get(passage.lock.id);
  if (!state) return;
  const { lock } = passage;
  if (!passage.yours) {
    if (!lockFree(trip, plan, lock)) return;
    passage.yours = true;
    const entryLevel = lockEnds(lock.goingUp).entryLevel;
    events.push({ kind: 'lock-yours', lock: lock.id, ready: Math.abs(state.water - entryLevel) <= LEVEL_TOLERANCE });
  }
  const where = whereIs(yourSpan(trip.boat, lock), lock.goingUp);
  if (passage.crew && where !== 'after') crewStep(state, passage.crew, where, dt);
  if (where === 'after') {
    trip.tidying.push({ lock, crew: newCrew(lock.goingUp) });
    events.push({ kind: 'cleared-lock', lock: lock.id });
    trip.passage = null;
    trip.phase = 'cruising';
  }
}

/** The lock that's waiting for you to work it, and its next job and part, if there is one. */
export function lockForYou(
  trip: Trip,
): { readonly lock: RouteLock; readonly state: LockState; readonly where: Where; readonly job: Job; readonly next: { readonly part: Part; readonly target: 0 | 1 } | null } | null {
  const passage = trip.passage;
  if (!passage?.yours || passage.crew) return null;
  const state = trip.locks.get(passage.lock.id);
  if (!state) return null;
  const where = whereIs(yourSpan(trip.boat, passage.lock), passage.lock.goingUp);
  if (where === 'after') return null;
  return { lock: passage.lock, state, where, job: nextJob(state, passage.lock.goingUp, where), next: nextPart(state, passage.lock.goingUp, where) };
}

/** How long the trip takes with the locks worked for you, in seconds. */
export function tripDuration(plan: TripPlan, step = 0.25, other: OtherWay | null = 'down'): number {
  const trip = newTrip(plan, { other, crewed: true });
  castOff(trip);
  while (trip.phase !== 'arrived' && trip.time < 4 * 60 * 60) stepTrip(trip, plan, NO_CONTROLS, step);
  return trip.time;
}
