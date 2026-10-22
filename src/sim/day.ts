// One day on the canal, morning to morning. The boat is moored at dawn and
// calls you to cast off. It cruises by itself and calls you when it needs you:
// at each lock, before each junction where the ways still open part, to choose
// one, and at dusk when it reaches the mooring at the end of the way you've
// chosen, to choose a spot to tie up. If you don't come, it waits. Once it's
// tied up, evening falls, then night, then morning.

import { clamp, lerp, smoothstep } from '../core/math';
import { poseAt } from '../core/track';
import { BOAT_LENGTH } from '../world/dimensions';
import type { Spot, Stretch } from '../world/stretch';
import { CRUISE_SPEED } from './boat';
import { answer, newCallBook, remind, ring } from './calls';
import type { CallBook, CallKind } from './calls';
import { CHAMBER_HALF, LANDING_GAP } from './lock';
import { newLogbook, noteEvents } from './logbook';
import type { Logbook } from './logbook';
import type { OtherWay } from './otherboat';
import { NO_CONTROLS, castOff, lockForYou, newTrip, planTrip, stepTrip, switchWay } from './trip';
import type { Controls, RouteLock, Trip, TripEvent, TripPlan } from './trip';

export type DayPhase = 'morning' | 'underway' | 'dusk' | 'tying-up' | 'evening' | 'night' | 'dawn' | 'over';

/** How long the evening, the night and the dawn last, in seconds. */
export const EVENING_TIME = 60;
export const NIGHT_TIME = 100;
export const DAWN_TIME = 30;
/** How far before a junction the boat waits for you to choose a way. */
export const HOLD_GAP = 230;
/** How far before it waits the junction call rings, about 75 seconds at cruising speed. */
export const CALL_AHEAD = 490;
/** How far past a lock's gates the boat must be before it can wait for a junction. */
const LOCK_CLEARANCE = 30;
/** How far from the mooring the light begins to go. */
export const DUSK_FROM = 1100;

export interface DayPlan {
  /** The trip along each way the day can go. The boat follows the first until you choose. */
  readonly ways: readonly TripPlan[];
  /** Every lock on any of the ways, once each. */
  readonly locks: readonly RouteLock[];
}

export function planDay(stretch: Stretch): DayPlan {
  const ways = stretch.ways.map((w) => planTrip(stretch, w));
  const locks = new Map(ways.flatMap((w) => w.locks.map((l) => [l.id, l] as const)));
  return { ways, locks: [...locks.values()] };
}

/**
 * Where the ways still open part next: the junction, where along the boat's
 * route the call rings and the boat waits, and the choices, each the ways
 * that go on together the same way from there.
 */
export interface Fork {
  readonly name: string;
  readonly s: number;
  readonly ring: number;
  readonly hold: number;
  readonly options: readonly (readonly TripPlan[])[];
}

/** The next junction where the ways the day can still go part, if they do. */
export function forkAhead(day: Pick<Day, 'ways' | 'plan'>, plan: DayPlan): Fork | null {
  const open = plan.ways.filter((w) => day.ways.includes(w.way));
  if (open.length < 2) return null;
  for (const j of day.plan.junctions) {
    const options = new Map<string, TripPlan[]>();
    for (const w of open) {
      const onto = w.junctions.find((k) => k.name === j.name)?.onto ?? '';
      options.set(onto, [...(options.get(onto) ?? []), w]);
    }
    if (options.size > 1) {
      const hold = holdClearOfLocks(day.plan, j.s);
      return { name: j.name, s: j.s, hold, ring: hold - CALL_AHEAD, options: [...options.values()] };
    }
  }
  return null;
}

/**
 * Where the boat waits for a junction: never inside a lock, but past one it
 * would still be working through, or below it where past it would be too near
 * the junction.
 */
function holdClearOfLocks(route: TripPlan, junction: number): number {
  const clear = (l: RouteLock) => l.s + CHAMBER_HALF + BOAT_LENGTH / 2 + LOCK_CLEARANCE;
  const spanning = (s: number) => route.locks.find((l) => l.s - LANDING_GAP < s && clear(l) > s);
  let hold = junction - HOLD_GAP;
  const lock = spanning(hold);
  if (!lock) return hold;
  const past = clear(lock);
  if (past + BOAT_LENGTH / 2 + LOCK_CLEARANCE < junction && !spanning(past)) return past;
  for (let l: RouteLock | undefined = lock; l; l = spanning(hold)) hold = l.s - LANDING_GAP - LOCK_CLEARANCE;
  return hold;
}

/** A pose on the water: where the boat is, and which way it points. */
export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** The boat easing from where it arrived into the spot it ties up at. */
export interface Glide {
  readonly from: Placed;
  readonly to: Placed;
  /** Seconds the whole glide takes. */
  readonly time: number;
  t: number;
}

export interface Day {
  /** Which day this is, counting from 1. */
  readonly number: number;
  /** Seconds since the day began. */
  time: number;
  phase: DayPhase;
  /** Seconds since the phase began. */
  phaseTime: number;
  /** The trip the boat is following: the first way still open until you've chosen one. */
  plan: TripPlan;
  /** The ways the day can still go, by id: all of them at first, then only those down each way you choose. */
  ways: readonly string[];
  trip: Trip;
  calls: CallBook;
  /** True once the boat has stopped before the next junction to wait for you. */
  held: boolean;
  spot: Spot | null;
  glide: Glide | null;
  readonly log: Logbook;
}

export interface DayOptions {
  /** Which way the other boat goes through the lock. */
  readonly other?: OtherWay | null;
  /** Locks are worked for you, as when timing the day. */
  readonly crewed?: boolean;
  /** Which day this is, counting from 1. */
  readonly number?: number;
}

export type DayEvent =
  | TripEvent
  /** A call rings, or rings again because you haven't come. */
  | { readonly kind: 'call'; readonly call: CallKind; readonly place?: string; readonly again: boolean }
  | { readonly kind: 'answered'; readonly call: CallKind; readonly place?: string }
  | { readonly kind: 'phase'; readonly phase: DayPhase }
  /** The boat has stopped before a junction, waiting for you to choose. */
  | { readonly kind: 'held'; readonly junction: string }
  | { readonly kind: 'chose-way'; readonly way: string; readonly junction: string }
  | { readonly kind: 'tied-up'; readonly spot: string };

export function newDay(plan: DayPlan, options: DayOptions = {}): Day {
  const first = plan.ways[0];
  const day: Day = {
    number: options.number ?? 1,
    time: 0,
    phase: 'morning',
    phaseTime: 0,
    plan: first,
    ways: plan.ways.map((w) => w.way),
    trip: newTrip(first, { other: options.other, crewed: options.crewed, locks: plan.locks }),
    calls: newCallBook(),
    held: false,
    spot: null,
    glide: null,
    log: newLogbook(),
  };
  waitAtFork(day, plan);
  return day;
}

/** Tells the boat to wait before the next junction where the ways part, if there is one. Where that's already behind it, it waits where it is. */
function waitAtFork(day: Day, plan: DayPlan): void {
  const fork = forkAhead(day, plan);
  day.trip.hold = fork ? Math.max(fork.hold, day.trip.boat.s) : null;
}

/** Notes what happened in the day's logbook, and passes the events on. */
function noted(day: Day, events: DayEvent[]): DayEvent[] {
  noteEvents(day, events);
  return events;
}

function enter(day: Day, phase: DayPhase, events: DayEvent[]): void {
  day.phase = phase;
  day.phaseTime = 0;
  events.push({ kind: 'phase', phase });
}

function answered(day: Day, kind: CallKind, events: DayEvent[], place?: string): void {
  if (answer(day.calls, kind, place)) events.push(place === undefined ? { kind: 'answered', call: kind } : { kind: 'answered', call: kind, place });
}

export function castOffDay(day: Day): DayEvent[] {
  if (day.phase !== 'morning') return [];
  const events: DayEvent[] = [...castOff(day.trip)];
  answered(day, 'cast-off', events);
  enter(day, 'underway', events);
  return noted(day, events);
}

/** You've come to the lock: its call is answered. */
export function answerLock(day: Day): DayEvent[] {
  const events: DayEvent[] = [];
  const yours = lockForYou(day.trip);
  if (yours) answered(day, 'lock', events, yours.lock.id);
  return noted(day, events);
}

/** True while you can still choose a way at the next fork: the boat hasn't reached its junction. */
export function canChooseWay(day: Day, plan: DayPlan): boolean {
  return forkAhead(day, plan) !== null && day.phase === 'underway' && day.trip.hold !== null && day.trip.boat.s <= day.trip.hold + 1;
}

/**
 * Choose which way to go at the next fork, by the id of a way down it. The
 * boat carries on along it, and the day can now go only the ways down it,
 * waiting again before the next junction where those part.
 */
export function chooseWay(day: Day, plan: DayPlan, way: string): DayEvent[] {
  const fork = forkAhead(day, plan);
  const option = fork?.options.find((o) => o.some((w) => w.way === way));
  const next = option?.find((w) => w.way === way);
  if (!fork || !option || !next || !canChooseWay(day, plan)) return [];
  const events: DayEvent[] = [];
  if (next !== day.plan) switchWay(day.trip, day.plan, next);
  day.plan = next;
  day.ways = option.map((w) => w.way);
  day.held = false;
  waitAtFork(day, plan);
  events.push({ kind: 'chose-way', way, junction: fork.name });
  answered(day, 'junction', events, fork.name);
  return noted(day, events);
}

/** Where the boat is on the water. */
export function boatPose(day: Day): Placed {
  if (day.glide) return glidePose(day.glide);
  const { boat } = day.trip;
  const p = poseAt(day.plan.route, boat.s, boat.d);
  return { x: p.x, y: p.y, angle: p.angle + boat.psi };
}

/** A smooth curve from one pose to another, leaving and arriving pointing the right way, eased at both ends. */
export function glidePose(glide: Glide): Placed {
  const { from: a, to: b } = glide;
  const t = smoothstep(0, 1, glide.t);
  const reach = Math.hypot(b.x - a.x, b.y - a.y) / 3;
  const p1 = { x: a.x + Math.cos(a.angle) * reach, y: a.y + Math.sin(a.angle) * reach };
  const p2 = { x: b.x - Math.cos(b.angle) * reach, y: b.y - Math.sin(b.angle) * reach };
  const u = 1 - t;
  const x = u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x;
  const y = u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y;
  const dx = 3 * u * u * (p1.x - a.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (b.x - p2.x);
  const dy = 3 * u * u * (p1.y - a.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (b.y - p2.y);
  // At the very ends the curve's direction can vanish, so keep the pose's own heading there.
  const angle = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : t < 0.5 ? a.angle : b.angle;
  return { x, y, angle };
}

/** How long a glide takes so the boat never goes faster than a little under cruising speed. */
function glideTime(glide: Glide): number {
  const steps = 80;
  let fastest = 0;
  let last = glide.from;
  for (let i = 1; i <= steps; i++) {
    const p = glidePose({ ...glide, t: i / steps });
    fastest = Math.max(fastest, Math.hypot(p.x - last.x, p.y - last.y) * steps);
    last = p;
  }
  return Math.max(4, fastest / (0.9 * CRUISE_SPEED));
}

/** Choose where to tie up for the night, by the spot's place in the plan's list. The boat glides into it. */
export function chooseSpot(day: Day, index: number): DayEvent[] {
  const spot = day.plan.spots[index];
  if (day.phase !== 'dusk' || !spot) return [];
  const events: DayEvent[] = [];
  const glide = { from: boatPose(day), to: spot, time: 0, t: 0 };
  glide.time = glideTime(glide);
  day.spot = spot;
  day.glide = glide;
  answered(day, 'dusk', events);
  enter(day, 'tying-up', events);
  return noted(day, events);
}

/** What the boat is waiting for you to do, if anything. */
export type Need = 'cast-off' | 'lock' | 'way' | 'spot';

export function needsYou(day: Day, plan: DayPlan): Need | null {
  if (day.phase === 'morning') return 'cast-off';
  if (day.phase === 'dusk') return 'spot';
  if (day.phase !== 'underway') return null;
  if (lockForYou(day.trip)?.next) return 'lock';
  if (canChooseWay(day, plan) && day.calls.open?.kind === 'junction') return 'way';
  return null;
}

export function stepDay(day: Day, plan: DayPlan, controls: Controls, dt: number): DayEvent[] {
  const events: DayEvent[] = [];
  day.time += dt;
  day.phaseTime += dt;
  const ringing = (kind: CallKind, place?: string) => {
    if (ring(day.calls, kind, day.time, place)) events.push(place === undefined ? { kind: 'call', call: kind, again: false } : { kind: 'call', call: kind, place, again: false });
  };

  for (const e of stepTrip(day.trip, day.plan, controls, dt)) {
    events.push(e);
    if (e.kind === 'lock-yours' && !day.trip.crewed) ringing('lock', e.lock);
    if (e.kind === 'arrived') {
      enter(day, 'dusk', events);
      ringing('dusk');
    }
  }

  const fork = forkAhead(day, plan);
  if (day.phase === 'morning') ringing('cast-off');
  if (fork && day.phase === 'underway') {
    const { boat } = day.trip;
    if (boat.s >= fork.ring) ringing('junction', fork.name);
    if (!day.held && boat.s >= (day.trip.hold ?? fork.hold) - 0.6 && Math.abs(boat.v) < 0.3) {
      day.held = true;
      events.push({ kind: 'held', junction: fork.name });
    }
  }

  if (day.phase === 'tying-up' && day.glide) {
    day.glide.t = clamp(day.glide.t + dt / day.glide.time, 0, 1);
    if (day.glide.t >= 1) {
      events.push({ kind: 'tied-up', spot: day.spot?.name ?? '' });
      enter(day, 'evening', events);
    }
  } else if (day.phase === 'evening' && day.phaseTime >= EVENING_TIME) enter(day, 'night', events);
  else if (day.phase === 'night' && day.phaseTime >= NIGHT_TIME) enter(day, 'dawn', events);
  else if (day.phase === 'dawn' && day.phaseTime >= DAWN_TIME) enter(day, 'over', events);

  const open = day.calls.open;
  if (open && remind(day.calls, day.time)) events.push(open.place === undefined ? { kind: 'call', call: open.kind, again: true } : { kind: 'call', call: open.kind, place: open.place, again: true });
  return noted(day, events);
}

/** When the evening began, from when the walkers head home, or null before it. Evening, night and dawn each last a set time. */
export function eveningBegan(day: Day): number | null {
  const before: Partial<Record<DayPhase, number>> = { evening: 0, night: EVENING_TIME, dawn: EVENING_TIME + NIGHT_TIME, over: EVENING_TIME + NIGHT_TIME + DAWN_TIME };
  const since = before[day.phase];
  return since === undefined ? null : day.time - day.phaseTime - since;
}

/**
 * The light over the canal: how warm the sky's colour is (morning and dusk),
 * how dark it is, and how far the lamps in the boat and the pub are lit, each
 * from 0 to 1.
 */
export interface Light {
  readonly warm: number;
  readonly dark: number;
  readonly lamps: number;
}

const MORNING: Light = { warm: 0.35, dark: 0.05, lamps: 0 };
const DUSK: Light = { warm: 0.8, dark: 0.25, lamps: 0.3 };
const EVENING: Light = { warm: 0.2, dark: 0.7, lamps: 1 };
const NIGHT: Light = { warm: 0, dark: 0.8, lamps: 1 };
const DAY: Light = { warm: 0, dark: 0, lamps: 0 };

const mixLight = (a: Light, b: Light, t: number): Light => ({ warm: lerp(a.warm, b.warm, t), dark: lerp(a.dark, b.dark, t), lamps: lerp(a.lamps, b.lamps, t) });

export function lightAt(day: Day): Light {
  const k = (time: number) => smoothstep(0, 1, day.phaseTime / time);
  switch (day.phase) {
    case 'morning':
    case 'over':
      return MORNING;
    case 'underway': {
      // The morning glow fades as the boat sets out, and the light goes as it nears the mooring.
      const morning = mixLight(MORNING, DAY, smoothstep(0, 90, day.phaseTime));
      const remaining = day.plan.end - day.trip.boat.s;
      return mixLight(morning, DUSK, day.ways.length === 1 ? smoothstep(DUSK_FROM, 0, remaining) : 0);
    }
    case 'dusk':
    case 'tying-up':
      return DUSK;
    case 'evening':
      return mixLight(DUSK, EVENING, k(EVENING_TIME));
    case 'night':
      return mixLight(EVENING, NIGHT, k(NIGHT_TIME / 3));
    case 'dawn':
      return mixLight(NIGHT, MORNING, k(DAWN_TIME));
  }
}

/** When each call rang, and when the day ended, with the locks worked for you and every call answered at once: for timing the day. */
export function dayTimeline(plan: DayPlan, way: string, other: OtherWay | null = 'down', step = 0.25): { calls: { call: CallKind; place?: string; at: number }[]; end: number } {
  const day = newDay(plan, { other, crewed: true });
  const calls: { call: CallKind; place?: string; at: number }[] = [];
  while (day.phase !== 'over' && day.time < 4 * 60 * 60) {
    for (const e of stepDay(day, plan, NO_CONTROLS, step)) {
      if (e.kind !== 'call' || e.again) continue;
      calls.push(e.place === undefined ? { call: e.call, at: day.time } : { call: e.call, place: e.place, at: day.time });
      if (e.call === 'cast-off') castOffDay(day);
      if (e.call === 'junction') chooseWay(day, plan, way);
      if (e.call === 'dusk') chooseSpot(day, 0);
    }
  }
  return { calls, end: day.time };
}
