// One lock's water, gates and paddles, and the rules that keep them honest:
// water runs in through the top paddles and out through the bottom ones, a
// gate won't open against a difference in level or close on a boat, and the
// next job a tidy boater would do can be worked out from any state. Places in
// a lock are measured from its middle, positive towards the top gate.

import { approach, clamp } from '../core/math';

/** The gates sit this far either side of a lock's middle. */
export const CHAMBER_HALF = 72;
/** Where a boat ties up to wait for a lock, measured from its middle. */
export const LANDING_GAP = 205;
/** How close the water must be to a level to count as level with it. */
export const LEVEL_TOLERANCE = 0.025;
/** Water through one paddle wound right up takes the lock from one level to the other in about 20 seconds. */
const PADDLE_FLOW = 0.1;
/** How fast water rushes through an open gate to match the level beyond it. */
const GATE_FLOW = 3;

export type GatePart = 'bottomGates' | 'topGates';
export type PaddlePart = 'bottomPaddle' | 'topPaddle';
export type Part = GatePart | PaddlePart;

/** The water each pair of gates sweeps as it swings, so a boat there stops it closing. */
export const GATE_SWING: Readonly<Record<GatePart, readonly [number, number]>> = {
  bottomGates: [-CHAMBER_HALF - 2, -CHAMBER_HALF + 14],
  topGates: [CHAMBER_HALF - 2, CHAMBER_HALF + 20],
};

export interface LockState {
  /** Water in the chamber: 0 level with below the lock, 1 level with above. */
  water: number;
  /** How far open each end's gates are, 0 shut to 1 open. The bottom pair moves together. */
  bottomGates: number;
  topGates: number;
  /** How far each end's paddles are wound up, 0 right down to 1 fully up. */
  bottomPaddle: number;
  topPaddle: number;
  /** Parts a crew has set moving, and where to. */
  moving: Partial<Record<Part, { readonly to: number; readonly rate: number }>>;
  /** How hard water is running in through the top paddle and out through the bottom one, 0 to 1. */
  flowIn: number;
  flowOut: number;
}

export function newLock(water: number): LockState {
  return { water, bottomGates: 0, topGates: 0, bottomPaddle: 0, topPaddle: 0, moving: {}, flowIn: 0, flowOut: 0 };
}

/** The stretch of a lock a boat takes up, measured from the lock's middle. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

export const isGate = (part: Part): part is GatePart => part === 'bottomGates' || part === 'topGates';
export const isShut = (value: number): boolean => value < 0.02;
export const isOpen = (value: number): boolean => value >= 0.95;
export const busy = (lock: LockState): boolean => Object.keys(lock.moving).length > 0;

/** The level beyond a pair of gates: 0 below the lock, 1 above. */
const levelBeyond = (gate: GatePart): number => (gate === 'topGates' ? 1 : 0);

export const levelsMatch = (lock: LockState, gate: GatePart): boolean => Math.abs(lock.water - levelBeyond(gate)) <= LEVEL_TOLERANCE;

export const inGateway = (gate: GatePart, spans: readonly Span[]): boolean =>
  spans.some((s) => s.to > GATE_SWING[gate][0] && s.from < GATE_SWING[gate][1]);

/** What stops a gate moving: the weight of uneven water, or a boat in its way. */
export type GateHeld = 'water' | 'boat';

/** Why a gate can't move from where it is towards `to`, or null if it can. */
export function gateHeld(lock: LockState, gate: GatePart, to: number, spans: readonly Span[]): GateHeld | null {
  const now = lock[gate];
  if (to > now && isShut(now) && !levelsMatch(lock, gate)) return 'water';
  if (to < now && inGateway(gate, spans)) return 'boat';
  return null;
}

function swingGate(lock: LockState, gate: GatePart, to: number, spans: readonly Span[]): GateHeld | null {
  const held = gateHeld(lock, gate, to, spans);
  if (held) return held;
  // A gate only starts to open once the levels match, so the last of the difference goes with it.
  if (to > lock[gate] && isShut(lock[gate])) lock.water = levelBeyond(gate);
  lock[gate] = clamp(to, 0, 1);
  return null;
}

/** Pushes a gate to `to` by hand, if the rules allow, and says what held it if not. */
export function pushGate(lock: LockState, gate: GatePart, to: number, spans: readonly Span[]): GateHeld | null {
  delete lock.moving[gate];
  return swingGate(lock, gate, to, spans);
}

/** Winds a paddle to `to` by hand. */
export function windPaddle(lock: LockState, paddle: PaddlePart, to: number): void {
  delete lock.moving[paddle];
  lock[paddle] = clamp(to, 0, 1);
}

export type LockEvent = { readonly kind: 'held'; readonly gate: GatePart; readonly why: GateHeld } | { readonly kind: 'level'; readonly full: boolean };

/** Moves the lock on by `dt` seconds: parts a crew set moving, and the water. */
export function stepLock(lock: LockState, dt: number, spans: readonly Span[]): LockEvent[] {
  const events: LockEvent[] = [];
  for (const part of Object.keys(lock.moving) as Part[]) {
    const move = lock.moving[part];
    if (!move) continue;
    const next = approach(lock[part], move.to, move.rate * dt);
    if (isGate(part)) {
      const held = swingGate(lock, part, next, spans);
      if (held) {
        delete lock.moving[part];
        events.push({ kind: 'held', gate: part, why: held });
        continue;
      }
    } else {
      lock[part] = next;
    }
    if (next === move.to) delete lock.moving[part];
  }

  const before = lock.water;
  const into = lock.topPaddle * Math.sqrt(Math.max(0, 1 - lock.water));
  const out = lock.bottomPaddle * Math.sqrt(Math.max(0, lock.water));
  let change = PADDLE_FLOW * (into - out);
  if (!isShut(lock.bottomGates)) change -= GATE_FLOW * lock.bottomGates * lock.water;
  if (!isShut(lock.topGates)) change += GATE_FLOW * lock.topGates * (1 - lock.water);
  lock.water = clamp(lock.water + change * dt, 0, 1);
  const shut = isShut(lock.bottomGates) && isShut(lock.topGates);
  lock.flowIn = shut ? into : 0;
  lock.flowOut = shut ? out : 0;
  if (shut && before < 1 - LEVEL_TOLERANCE && lock.water >= 1 - LEVEL_TOLERANCE) events.push({ kind: 'level', full: true });
  if (shut && before > LEVEL_TOLERANCE && lock.water <= LEVEL_TOLERANCE) events.push({ kind: 'level', full: false });
  return events;
}

/** Where a boat is on its way through a lock. */
export type Where = 'before' | 'in' | 'after';

export function whereIs(span: Span, goingUp: boolean): Where {
  const bottom = GATE_SWING.bottomGates;
  const top = GATE_SWING.topGates;
  if (goingUp) return span.from < bottom[1] ? 'before' : span.from >= top[1] ? 'after' : 'in';
  return span.to > top[0] ? 'before' : span.to <= bottom[0] ? 'after' : 'in';
}

/** The gates and paddles a boat comes in by and leaves by, and the levels at each end. */
export function lockEnds(goingUp: boolean) {
  return goingUp
    ? { entryGate: 'bottomGates', exitGate: 'topGates', entryPaddle: 'bottomPaddle', exitPaddle: 'topPaddle', entryLevel: 0, exitLevel: 1 } as const
    : { entryGate: 'topGates', exitGate: 'bottomGates', entryPaddle: 'topPaddle', exitPaddle: 'bottomPaddle', entryLevel: 1, exitLevel: 0 } as const;
}

export type Job =
  | { readonly kind: 'raise' | 'wait-water'; readonly part: PaddlePart; readonly fill: boolean }
  | { readonly kind: 'lower'; readonly part: PaddlePart }
  | { readonly kind: 'open' | 'close'; readonly part: GatePart }
  | { readonly kind: 'boat-in' | 'boat-out' | 'done' };

/**
 * The next job a tidy boater would do, from whatever state the lock is in.
 * `leaveOpen` leaves the gates open behind the boat, for a boat waiting to come in.
 */
export function nextJob(lock: LockState, goingUp: boolean, where: Where, leaveOpen = false): Job {
  const e = lockEnds(goingUp);
  const level = (part: PaddlePart, to: number): Job => ({ kind: lock[part] >= 0.98 ? 'wait-water' : 'raise', part, fill: to === 1 });
  const offLevel = (to: number) => Math.abs(lock.water - to) > LEVEL_TOLERANCE;
  if (where === 'before') {
    if (!isShut(lock[e.exitGate])) return { kind: 'close', part: e.exitGate };
    if (lock[e.exitPaddle] > 0.02) return { kind: 'lower', part: e.exitPaddle };
    if (offLevel(e.entryLevel) && isShut(lock[e.entryGate])) return level(e.entryPaddle, e.entryLevel);
    if (!isOpen(lock[e.entryGate])) return { kind: 'open', part: e.entryGate };
    return { kind: 'boat-in' };
  }
  if (where === 'in') {
    if (isOpen(lock[e.exitGate])) return { kind: 'boat-out' };
    if (!isShut(lock[e.entryGate])) return { kind: 'close', part: e.entryGate };
    if (lock[e.entryPaddle] > 0.02) return { kind: 'lower', part: e.entryPaddle };
    if (offLevel(e.exitLevel)) return level(e.exitPaddle, e.exitLevel);
    return { kind: 'open', part: e.exitGate };
  }
  if (!leaveOpen && !isShut(lock[e.exitGate])) return { kind: 'close', part: e.exitGate };
  if (lock[e.exitPaddle] > 0.02) return { kind: 'lower', part: e.exitPaddle };
  return { kind: 'done' };
}

/**
 * The part to go to next and which way to work it. While the water moves it is
 * the gates that open next, and while the boat comes in it is the gates behind
 * it, so you can see them hold until it's time.
 */
export function nextPart(lock: LockState, goingUp: boolean, where: Where): { readonly part: Part; readonly target: 0 | 1 } | null {
  const job = nextJob(lock, goingUp, where);
  const e = lockEnds(goingUp);
  switch (job.kind) {
    case 'raise':
    case 'open':
      return { part: job.part, target: 1 };
    case 'lower':
    case 'close':
      return { part: job.part, target: 0 };
    case 'wait-water':
      return { part: where === 'before' ? e.entryGate : e.exitGate, target: 1 };
    case 'boat-in':
      return { part: e.entryGate, target: 0 };
    default:
      return null;
  }
}

/** How fast a crew works: paddles and gates per second, and a breather between jobs. */
export interface CrewPace {
  readonly paddle: number;
  readonly gate: number;
  readonly rest: number;
}

export const CREW_PACE: CrewPace = { paddle: 1 / 5, gate: 1 / 8, rest: 1.5 };

/** Someone working a lock one job at a time, for a boat going up or down. */
export interface Crew {
  readonly goingUp: boolean;
  readonly pace: CrewPace;
  /** Leave the gates open behind the boat, for one waiting to come in. */
  readonly leaveOpen: boolean;
  rest: number;
  done: boolean;
}

export function newCrew(goingUp: boolean, leaveOpen = false, pace: CrewPace = CREW_PACE): Crew {
  return { goingUp, pace, leaveOpen, rest: pace.rest, done: false };
}

/** Sets a job going, if it is one a crew does with its hands. */
export function startJob(lock: LockState, job: Job, pace: CrewPace): boolean {
  if (job.kind === 'raise' || job.kind === 'lower') lock.moving[job.part] = { to: job.kind === 'raise' ? 1 : 0, rate: pace.paddle };
  else if (job.kind === 'open' || job.kind === 'close') lock.moving[job.part] = { to: job.kind === 'open' ? 1 : 0, rate: pace.gate };
  else return false;
  return true;
}

/** One step of a crew at work: when the last job has finished and they've had a breather, they start the next. */
export function crewStep(lock: LockState, crew: Crew, where: Where, dt: number): Job | null {
  if (busy(lock)) {
    crew.rest = crew.pace.rest;
    return null;
  }
  const job = nextJob(lock, crew.goingUp, where, crew.leaveOpen);
  if (job.kind === 'done') crew.done = true;
  if (crew.rest > 0) {
    crew.rest -= dt;
    return null;
  }
  if (!startJob(lock, job, crew.pace)) return null;
  crew.rest = crew.pace.rest;
  return job;
}
