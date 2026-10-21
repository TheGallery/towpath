// Keeping your place: the whole day written down as plain data, so closing
// the tab or reloading it carries on where you were. A kept place says which
// version of the format it is and which stretch it's on. One from another
// version or another stretch, or broken in any way, is set aside, and a fresh
// day starts instead.

import type { StretchData } from '../world/stretch';
import type { Call, CallKind } from './calls';
import type { Day, DayPhase, DayPlan, Glide, Placed } from './day';
import type { LogEntry, Logbook } from './logbook';
import type { Crew, LockState, Part } from './lock';
import type { OtherBoat, OtherWay } from './otherboat';
import type { Passage, Trip, TripPhase, TripPlan } from './trip';

/** Bump this whenever the shape of a kept place changes, so older ones are set aside. */
export const SAVE_VERSION = 1;

/** Everything kept between visits: the day, how the next day's lock will be, and whether the bell is on. */
export interface Kept {
  readonly day: Day;
  /** Which way the other boat went through the lock today; the next day gets the other. */
  readonly other: OtherWay;
  readonly bell: boolean;
}

/** The kept place as text, for browser storage. */
export function saveGame(kept: Kept, stretch: StretchData): string {
  const { day } = kept;
  const { trip } = day;
  const spot = day.spot ? day.plan.spots.indexOf(day.spot) : -1;
  return JSON.stringify({
    version: SAVE_VERSION,
    stretch: stretch.id,
    seed: stretch.seed,
    other: kept.other,
    bell: kept.bell,
    day: {
      number: day.number,
      time: day.time,
      phase: day.phase,
      phaseTime: day.phaseTime,
      way: day.plan.way,
      chosen: day.chosen,
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
const oneOf = <T extends string>(v: unknown, values: readonly T[], what: string): T => (values.includes(v as T) ? (v as T) : fail(what));
const orNull = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === null ? null : read(v));

const DAY_PHASES: readonly DayPhase[] = ['morning', 'underway', 'dusk', 'tying-up', 'evening', 'night', 'dawn', 'over'];
const TRIP_PHASES: readonly TripPhase[] = ['moored', 'cruising', 'in-lock', 'arrived'];
const CALLS: readonly CallKind[] = ['cast-off', 'lock', 'junction', 'dusk'];
const OTHER_WAYS: readonly OtherWay[] = ['down', 'up'];
const PARTS: readonly Part[] = ['bottomGates', 'topGates', 'bottomPaddle', 'topPaddle'];

/**
 * Reads a kept place back for this stretch and its day plan, or null if
 * there's none, or it's from another version or stretch, or it's broken.
 */
export function loadGame(text: string | null, plan: DayPlan, stretch: StretchData): Kept | null {
  if (!text) return null;
  try {
    const raw = record(JSON.parse(text), 'save');
    if (raw.version !== SAVE_VERSION || raw.stretch !== stretch.id || raw.seed !== stretch.seed) return null;
    return { day: readDay(record(raw.day, 'day'), plan), other: oneOf(raw.other, OTHER_WAYS, 'other'), bell: bool(raw.bell, 'bell') };
  } catch (e) {
    if (e instanceof BadSave || e instanceof SyntaxError || e instanceof TypeError || e instanceof RangeError) return null;
    throw e;
  }
}

function readDay(raw: Raw, plan: DayPlan): Day {
  const way = plan.ways.find((w) => w.way === raw.way) ?? fail('way');
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
    chosen: bool(raw.chosen, 'chosen'),
    held: bool(raw.held, 'held'),
    spot,
    glide,
    calls: {
      open: orNull(callsRaw.open, readCall),
      answered: new Set(list(callsRaw.answered, 'answered').map((k) => oneOf(k, CALLS, 'answered'))),
    },
    trip: readTrip(record(raw.trip, 'trip'), way),
    log: readLog(record(raw.log, 'log')),
  };
}

function readPlaced(v: unknown): Placed {
  const raw = record(v, 'pose');
  return { x: num(raw.x, 'x'), y: num(raw.y, 'y'), angle: num(raw.angle, 'angle') };
}

function readCall(v: unknown): Call {
  const raw = record(v, 'call');
  return { kind: oneOf(raw.kind, CALLS, 'call'), since: num(raw.since, 'since', 0), rang: num(raw.rang, 'rang', 0), reminders: int(raw.reminders, 'reminders', 0) };
}

function readTrip(raw: Raw, plan: TripPlan): Trip {
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
    // Every lock on the way, and no others.
    locks: new Map(plan.locks.map((l) => [l.id, readLock(locksRaw[l.id])])),
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
  const times = (v: unknown, what: string): Partial<Record<CallKind, number>> => {
    const r = record(v, what);
    const out: Partial<Record<CallKind, number>> = {};
    for (const [k, t] of Object.entries(r)) out[oneOf(k, CALLS, what)] = num(t, what);
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
