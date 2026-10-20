// A day's trip along the route: the boat casts off, cruises by itself, slows
// past moored boats, goes through each lock and moors at the end. You can take
// the tiller whenever you like, and the boat takes it back when you let go.

import { clamp } from '../core/math';
import { headingAt } from '../core/track';
import type { Track } from '../core/track';
import { BOAT_LENGTH, MOORED_OFFSET, unitsPerSecond } from '../world/dimensions';
import { routeDistance } from '../world/stretch';
import type { FeatureData, Stretch } from '../world/stretch';
import { ASTERN_SPEED, CRUISE_SPEED, TOP_SPEED, moveBoat } from './boat';
import type { Boat, Bump, Helm, Obstacle } from './boat';

/** What you're pressing: the tiller left or right, and the throttle ahead or astern. */
export interface Controls {
  readonly rudder: -1 | 0 | 1;
  readonly throttle: -1 | 0 | 1;
}

export const NO_CONTROLS: Controls = { rudder: 0, throttle: 0 };

export const PASSING_SPEED = unitsPerSecond(1.8);
export const JUNCTION_SPEED = unitsPerSecond(2.2);
export const LOCK_SPEED = unitsPerSecond(1.5);

/** Seconds without touching the controls before the boat steers itself again. */
export const HAND_BACK_AFTER = 3;
/** How fast the throttle changes the speed you've set while a key is held, per second. */
const THROTTLE_RATE = 2.5;
/** How gently the boat plans to slow down, in units per second per second. */
const EASE_OFF = 0.45;

export const GATE_TIME = 12;
export const LEVEL_TIME = 42;
const TIE_UP_TIME = 3;
/** The gates sit this far either side of a lock's middle. */
export const CHAMBER_HALF = 72;
/** Where the boat ties up before a lock, measured from its middle. */
export const LANDING_GAP = 205;

const HALF_LENGTH = BOAT_LENGTH / 2;
/** How far to keep left of the centre line when passing moored boats. */
const PASSING_LINE = -6;

export type LockStage =
  | 'tying-up'
  | 'levelling-for-you'
  | 'opening-entry'
  | 'entering'
  | 'closing-entry'
  | 'levelling'
  | 'opening-exit'
  | 'leaving';

/** The state of one lock's water and gates. */
export interface LockWork {
  /** Water in the chamber: 0 at the lower level, 1 at the upper. */
  water: number;
  /** How far open each pair of gates is, 0 to 1. */
  bottomGates: number;
  topGates: number;
  /** Set once a boat has left, so the gates swing shut behind it. */
  closeBehind: 'bottom' | 'top' | null;
}

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
}

export function planTrip(stretch: Stretch): TripPlan {
  const { data, route } = stretch;
  const locks: RouteLock[] = [];
  const moorings: { name: string; from: number; to: number }[] = [];
  const obstacles: Obstacle[] = [];
  let endName = data.trip.to;
  for (const { feature, s } of stretch.onRoute) {
    if (feature.kind === 'lock') locks.push({ id: feature.id, name: feature.name, s, goingUp: feature.uphill > 0 });
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
  return { route, start: stretch.start, end: stretch.end, startName: data.trip.from.name, endName, legs, locks, moorings, obstacles, junctions, places };
}

export type TripPhase = 'moored' | 'cruising' | 'in-lock' | 'arrived';

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
  locks: Map<string, LockWork>;
  /** The lock the boat is working through, and how far it has got. */
  stage: { lock: RouteLock; name: LockStage; time: number } | null;
  lastBump: number;
}

export type TripEvent =
  | { readonly kind: 'cast-off' }
  | { readonly kind: 'took-helm' }
  | { readonly kind: 'handed-back' }
  | { readonly kind: 'helm-taken'; readonly reason: 'lock' | 'junction' | 'mooring' }
  | { readonly kind: 'bump'; readonly what: Bump }
  | { readonly kind: 'lock-stage'; readonly lock: string; readonly stage: LockStage }
  | { readonly kind: 'cleared-lock'; readonly lock: string }
  | { readonly kind: 'arrived' };

export function newTrip(plan: TripPlan): Trip {
  return {
    time: 0,
    phase: 'moored',
    boat: { s: plan.start, d: MOORED_OFFSET, psi: 0, v: 0, turn: 0 },
    helm: 'auto',
    idle: 0,
    throttle: 0,
    locks: new Map(plan.locks.map((l) => [l.id, { water: 0, bottomGates: 0, topGates: 0, closeBehind: null }])),
    stage: null,
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

/** Which line on the water the boat keeps to by itself. */
function autoLine(plan: TripPlan, s: number): number {
  return plan.moorings.some((m) => s > m.from - 40 && s < m.to) ? PASSING_LINE : 0;
}

/** Moves a value towards 0 or 1 over `seconds`. Returns true once it gets there. */
function towards(value: number, target: number, seconds: number, dt: number, set: (v: number) => void): boolean {
  const next = target > value ? Math.min(target, value + dt / seconds) : Math.max(target, value - dt / seconds);
  set(next);
  return next === target;
}

export function stepTrip(trip: Trip, plan: TripPlan, controls: Controls, dt: number): TripEvent[] {
  const events: TripEvent[] = [];
  trip.time += dt;
  const boat = trip.boat;

  // Gates left open behind a boat swing shut by themselves.
  for (const work of trip.locks.values()) {
    if (work.closeBehind === 'top' && towards(work.topGates, 0, GATE_TIME, dt, (v) => (work.topGates = v))) work.closeBehind = null;
    if (work.closeBehind === 'bottom' && towards(work.bottomGates, 0, GATE_TIME, dt, (v) => (work.bottomGates = v))) work.closeBehind = null;
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
  } else if (trip.phase === 'in-lock' && trip.stage) {
    const { speed, stop } = lockSpeed(trip.stage.lock, trip.stage.name, boat.s);
    stopAt = stop;
    helm = { kind: 'auto', line: 0, speed };
  } else {
    helm = { kind: 'auto', line: autoLine(plan, boat.s), speed: plannedSpeed(plan, boat.s) };
    const landing = plan.locks.find((l) => boat.s <= l.s - LANDING_GAP + 0.5);
    stopAt = Math.min(landing ? landing.s - LANDING_GAP : Infinity, plan.end);
  }

  const bump = moveBoat(boat, plan.route, helm, dt, plan.obstacles);
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
      trip.stage = { lock: landing, name: 'tying-up', time: 0 };
      events.push({ kind: 'lock-stage', lock: landing.id, stage: 'tying-up' });
    } else if (boat.s >= plan.end - 0.6 && boat.v < 0.3) {
      trip.phase = 'arrived';
      boat.v = 0;
      events.push({ kind: 'arrived' });
    }
  } else if (trip.phase === 'in-lock' && trip.stage) {
    workLock(trip, dt, events);
  }
  return events;
}

/** How the boat moves during each part of going through a lock. */
function lockSpeed(lock: RouteLock, stage: LockStage, s: number): { speed: number; stop: number | null } {
  if (stage === 'entering') return { speed: Math.min(LOCK_SPEED, stoppingSpeed(lock.s - s)), stop: lock.s };
  if (stage === 'leaving') return { speed: LOCK_SPEED, stop: null };
  return { speed: 0, stop: s };
}

/** The lock's side of things: gates and water, one job at a time, done for you for now. */
function workLock(trip: Trip, dt: number, events: TripEvent[]): void {
  const stage = trip.stage;
  if (!stage) return;
  const work = trip.locks.get(stage.lock.id);
  if (!work) return;
  stage.time += dt;
  const up = stage.lock.goingUp;
  const entryLevel = up ? 0 : 1;
  const exitLevel = 1 - entryLevel;
  const entryGate = up ? 'bottomGates' : 'topGates';
  const exitGate = up ? 'topGates' : 'bottomGates';
  const next = (name: LockStage) => {
    stage.name = name;
    stage.time = 0;
    events.push({ kind: 'lock-stage', lock: stage.lock.id, stage: name });
  };
  const boat = trip.boat;

  switch (stage.name) {
    case 'tying-up':
      if (stage.time >= TIE_UP_TIME) next(work.water === entryLevel ? 'opening-entry' : 'levelling-for-you');
      break;
    case 'levelling-for-you':
      if (towards(work.water, entryLevel, LEVEL_TIME, dt, (v) => (work.water = v))) next('opening-entry');
      break;
    case 'opening-entry':
      if (towards(work[entryGate], 1, GATE_TIME, dt, (v) => (work[entryGate] = v))) next('entering');
      break;
    case 'entering':
      if (Math.abs(boat.s - stage.lock.s) < 0.6 && boat.v < 0.3) next('closing-entry');
      break;
    case 'closing-entry':
      if (towards(work[entryGate], 0, GATE_TIME, dt, (v) => (work[entryGate] = v))) next('levelling');
      break;
    case 'levelling':
      if (towards(work.water, exitLevel, LEVEL_TIME, dt, (v) => (work.water = v))) next('opening-exit');
      break;
    case 'opening-exit':
      if (towards(work[exitGate], 1, GATE_TIME, dt, (v) => (work[exitGate] = v))) next('leaving');
      break;
    case 'leaving':
      if (boat.s - HALF_LENGTH > stage.lock.s + CHAMBER_HALF + 8) {
        work.closeBehind = up ? 'top' : 'bottom';
        events.push({ kind: 'cleared-lock', lock: stage.lock.id });
        trip.stage = null;
        trip.phase = 'cruising';
      }
      break;
  }
}

/** How long the trip takes if you leave the boat to it, in seconds. */
export function tripDuration(plan: TripPlan, step = 0.25): number {
  const trip = newTrip(plan);
  castOff(trip);
  while (trip.phase !== 'arrived' && trip.time < 4 * 60 * 60) stepTrip(trip, plan, NO_CONTROLS, step);
  return trip.time;
}
