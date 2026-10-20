import { describe, expect, it } from 'vitest';
import {
  CHAMBER_HALF,
  LANDING_GAP,
  crewStep,
  gateHeld,
  newCrew,
  newLock,
  nextJob,
  nextPart,
  pushGate,
  stepLock,
  whereIs,
  windPaddle,
} from '../src/sim/lock';
import type { Job, LockEvent, LockState, Span } from '../src/sim/lock';

const STEP = 1 / 30;
const HALF = 37;
const span = (x: number): Span => ({ from: x - HALF, to: x + HALF });

function run(lock: LockState, seconds: number, spans: Span[] = []): LockEvent[] {
  const events: LockEvent[] = [];
  for (let t = 0; t < seconds; t += STEP) events.push(...stepLock(lock, STEP, spans));
  return events;
}

/**
 * Takes a boat through a lock with a crew doing every job, gliding in and out
 * as the gates allow, and lists the jobs in the order they were started.
 */
function passage(goingUp: boolean, water: number, leaveOpen = false): { jobs: Job['kind'][]; parts: string[]; lock: LockState } {
  const lock = newLock(water);
  const crew = newCrew(goingUp, leaveOpen);
  const way = goingUp ? 1 : -1;
  let x = -way * LANDING_GAP;
  const jobs: Job['kind'][] = [];
  const parts: string[] = [];
  for (let t = 0; t < 600 && !crew.done; t += STEP) {
    const where = whereIs(span(x), goingUp);
    const job = crewStep(lock, crew, where, STEP);
    if (job) {
      jobs.push(job.kind);
      if ('part' in job) parts.push(job.part);
    }
    stepLock(lock, STEP, [span(x)]);
    const next = nextJob(lock, goingUp, where);
    if (next.kind === 'boat-in') x = way > 0 ? Math.min(0, x + 3) : Math.max(0, x - 3);
    else if (next.kind === 'boat-out' || where === 'after') x += way * 3;
  }
  expect(crew.done).toBe(true);
  return { jobs, parts, lock };
}

describe('the water in a lock', () => {
  it('fills through the top paddle and empties through the bottom one, in about twenty seconds', () => {
    const lock = newLock(0);
    windPaddle(lock, 'topPaddle', 1);
    const filled = run(lock, 21);
    expect(lock.water).toBeGreaterThan(0.975);
    expect(filled).toContainEqual({ kind: 'level', full: true });
    windPaddle(lock, 'topPaddle', 0);
    windPaddle(lock, 'bottomPaddle', 1);
    run(lock, 1);
    expect(lock.flowOut).toBeGreaterThan(0.5);
    expect(lock.flowIn).toBe(0);
    const emptied = run(lock, 21);
    expect(lock.water).toBeLessThan(0.025);
    expect(emptied).toContainEqual({ kind: 'level', full: false });
  });

  it('runs as fast as the paddle is open', () => {
    const half = newLock(0);
    const full = newLock(0);
    windPaddle(half, 'topPaddle', 0.5);
    windPaddle(full, 'topPaddle', 1);
    run(half, 5);
    run(full, 5);
    expect(half.water).toBeGreaterThan(0);
    expect(half.water).toBeLessThan(full.water * 0.6);
  });

  it('stays put with the paddles down', () => {
    const lock = newLock(0.4);
    run(lock, 30);
    expect(lock.water).toBe(0.4);
  });
});

describe('the gates', () => {
  it("won't open against a difference in the water", () => {
    const lock = newLock(1);
    expect(pushGate(lock, 'bottomGates', 0.3, [])).toBe('water');
    expect(lock.bottomGates).toBe(0);
    expect(pushGate(lock, 'topGates', 0.3, [])).toBeNull();
    expect(lock.topGates).toBe(0.3);
  });

  it('open once the levels match, taking the last of the difference with them', () => {
    const lock = newLock(0.02);
    expect(pushGate(lock, 'bottomGates', 0.1, [])).toBeNull();
    expect(lock.water).toBe(0);
  });

  it("won't close on a boat in their way", () => {
    const lock = newLock(0);
    pushGate(lock, 'bottomGates', 1, []);
    const inTheGateway = span(-CHAMBER_HALF + 10);
    expect(gateHeld(lock, 'bottomGates', 0.5, [inTheGateway])).toBe('boat');
    expect(pushGate(lock, 'bottomGates', 0.5, [inTheGateway])).toBe('boat');
    expect(lock.bottomGates).toBe(1);
    // Right in the lock, the boat is clear of the gates.
    expect(pushGate(lock, 'bottomGates', 0, [span(0)])).toBeNull();
    expect(lock.bottomGates).toBe(0);
  });

  it('hold a crew back the same way, and say why', () => {
    const lock = newLock(1);
    lock.moving.bottomGates = { to: 1, rate: 0.2 };
    const events = run(lock, 1);
    expect(events).toContainEqual({ kind: 'held', gate: 'bottomGates', why: 'water' });
    expect(lock.bottomGates).toBe(0);
    expect(lock.moving.bottomGates).toBeUndefined();
  });

  it('let the water through when they open, so the lock matches the level beyond', () => {
    const lock = newLock(1);
    pushGate(lock, 'topGates', 1, []);
    windPaddle(lock, 'bottomPaddle', 1);
    run(lock, 5);
    expect(lock.water).toBeGreaterThan(0.95);
  });
});

describe('where a boat is in a lock', () => {
  it('is before, in or after, by which gates it has passed', () => {
    expect(whereIs(span(-LANDING_GAP), true)).toBe('before');
    expect(whereIs(span(0), true)).toBe('in');
    expect(whereIs(span(CHAMBER_HALF + 20 + HALF), true)).toBe('after');
    expect(whereIs(span(LANDING_GAP), false)).toBe('before');
    expect(whereIs(span(0), false)).toBe('in');
    expect(whereIs(span(-CHAMBER_HALF - HALF - 3), false)).toBe('after');
  });
});

describe('the next job, from any state', () => {
  it('goes up through a lock that is ready in four jobs, and closes up after', () => {
    const { jobs, parts, lock } = passage(true, 0);
    expect(jobs).toEqual(['open', 'close', 'raise', 'open', 'close', 'lower']);
    expect(parts).toEqual(['bottomGates', 'bottomGates', 'topPaddle', 'topGates', 'topGates', 'topPaddle']);
    expect(lock).toMatchObject({ water: 1, bottomGates: 0, topGates: 0, bottomPaddle: 0, topPaddle: 0 });
  });

  it('empties a full lock first when going up, in six jobs', () => {
    const { jobs, parts } = passage(true, 1);
    expect(jobs.slice(0, 6)).toEqual(['raise', 'open', 'close', 'lower', 'raise', 'open']);
    expect(parts.slice(0, 6)).toEqual(['bottomPaddle', 'bottomGates', 'bottomGates', 'bottomPaddle', 'topPaddle', 'topGates']);
  });

  it('goes down through a lock both ways too', () => {
    expect(passage(false, 1).parts.slice(0, 4)).toEqual(['topGates', 'topGates', 'bottomPaddle', 'bottomGates']);
    expect(passage(false, 0).parts.slice(0, 6)).toEqual(['topPaddle', 'topGates', 'topGates', 'topPaddle', 'bottomPaddle', 'bottomGates']);
  });

  it('can leave the gates open behind, for a boat waiting to come in, and still winds its paddle down', () => {
    const { lock } = passage(false, 1, true);
    expect(lock).toMatchObject({ water: 0, bottomGates: 1, topGates: 0, bottomPaddle: 0, topPaddle: 0 });
  });

  it('closes gates left open on the far side before levelling', () => {
    const lock = newLock(1);
    lock.topGates = 1;
    expect(nextJob(lock, true, 'before')).toEqual({ kind: 'close', part: 'topGates' });
  });

  it('waits for the water once the paddle is up, and points at the gates to try next', () => {
    const lock = newLock(0.5);
    windPaddle(lock, 'topPaddle', 1);
    expect(nextJob(lock, true, 'in')).toEqual({ kind: 'wait-water', part: 'topPaddle', fill: true });
    expect(nextPart(lock, true, 'in')).toEqual({ part: 'topGates', target: 1 });
  });

  it('points at the gates behind the boat while it comes in', () => {
    const lock = newLock(0);
    lock.bottomGates = 1;
    expect(nextJob(lock, true, 'before')).toEqual({ kind: 'boat-in' });
    expect(nextPart(lock, true, 'before')).toEqual({ part: 'bottomGates', target: 0 });
  });
});
