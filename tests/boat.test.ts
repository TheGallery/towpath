import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/core/track';
import { CRUISE_SPEED, hullSpan, hullSpanWithin, moveBoat } from '../src/sim/boat';
import type { Boat, Helm, Narrows } from '../src/sim/boat';
import { CANAL_WIDTH, MOORED_OFFSET } from '../src/world/dimensions';

const straight = buildTrack([[0, 0], [2000, 0], [4000, 0]]);
const bend = buildTrack([[0, 0], [600, 0], [1000, 250], [1300, 700], [1400, 1300]]);
const boat = (over: Partial<Boat> = {}): Boat => ({ s: 100, d: 0, psi: 0, v: CRUISE_SPEED, turn: 0, ...over });
const auto: Helm = { kind: 'auto', line: 0, speed: CRUISE_SPEED };
const tiller = (rudder: number, speed = CRUISE_SPEED): Helm => ({ kind: 'tiller', rudder, speed });

function run(b: Boat, track: typeof straight, helm: Helm, seconds: number, obstacles = [] as { s: number; d: number }[], narrows: Narrows[] = [], each?: () => void) {
  const bumps: string[] = [];
  for (let t = 0; t < seconds; t += 1 / 30) {
    const bump = moveBoat(b, track, helm, 1 / 30, obstacles, narrows);
    each?.();
    if (bump) bumps.push(bump);
  }
  return bumps;
}

describe('the boat by itself', () => {
  it('follows the centre line round bends', () => {
    const b = boat({ s: 0 });
    let worst = 0;
    for (let t = 0; t < 600 && b.s < bend.length - 50; t += 1 / 30) {
      moveBoat(b, bend, auto, 1 / 30);
      worst = Math.max(worst, Math.abs(b.d));
    }
    expect(b.s).toBeGreaterThan(bend.length - 60);
    expect(worst).toBeLessThan(3);
  });

  it('eases back to its line from off to one side, without hitting the bank', () => {
    const b = boat({ d: 12 });
    const bumps = run(b, straight, auto, 60);
    expect(bumps).toEqual([]);
    expect(Math.abs(b.d)).toBeLessThan(0.5);
    expect(Math.abs(b.psi)).toBeLessThan(0.01);
  });

  it('speeds up gently and keeps to the speed asked for', () => {
    const b = boat({ v: 0 });
    moveBoat(b, straight, auto, 1);
    expect(b.v).toBeGreaterThan(0);
    expect(b.v).toBeLessThan(1);
    run(b, straight, auto, 30);
    expect(b.v).toBeCloseTo(CRUISE_SPEED, 5);
  });
});

describe('taking the tiller', () => {
  it('turns the boat the way you push, slowly', () => {
    const right = boat();
    run(right, straight, tiller(1), 2);
    expect(right.psi).toBeGreaterThan(0.02);
    expect(right.psi).toBeLessThan(0.25);
    const left = boat();
    run(left, straight, tiller(-1), 2);
    expect(left.psi).toBeLessThan(-0.02);
  });

  it('moves the boat across the canal while you hold it', () => {
    const b = boat();
    run(b, straight, tiller(1), 2.5);
    run(b, straight, tiller(0), 1.5);
    expect(b.d).toBeGreaterThan(2);
  });

  it('turns less when the boat is barely moving', () => {
    const slow = boat({ v: 0.5 });
    run(slow, straight, tiller(1, 0.5), 2);
    const fast = boat();
    run(fast, straight, tiller(1), 2);
    expect(Math.abs(slow.turn)).toBeLessThan(Math.abs(fast.turn));
  });
});

describe('bumps', () => {
  it('stops at the bank softly, with a bump', () => {
    const b = boat();
    const bumps = run(b, straight, tiller(1), 20);
    expect(bumps).toContain('bank');
    expect(hullSpan(b).right).toBeLessThanOrEqual(CANAL_WIDTH / 2 + 1e-9);
    expect(b.v).toBeGreaterThan(0);
  });

  it('never lets the hull through the far bank either', () => {
    const b = boat();
    run(b, straight, tiller(-1), 20);
    expect(hullSpan(b).left).toBeGreaterThanOrEqual(-CANAL_WIDTH / 2 - 1e-9);
  });

  it('bumps a moored boat alongside, and stays clear of it', () => {
    const b = boat({ s: 400 });
    const moored = [{ s: 520, d: MOORED_OFFSET }];
    const bumps = run(b, straight, tiller(1), 20, moored);
    expect(bumps).toContain('boat');
    if (Math.abs(b.s - 520) < 70) expect(hullSpan(b).right).toBeLessThanOrEqual(MOORED_OFFSET - 5 + 1e-9);
  });

  it('passes a moored boat untouched on its line', () => {
    const b = boat({ s: 300 });
    const bumps = run(b, straight, { kind: 'auto', line: -6, speed: CRUISE_SPEED }, 60, [{ s: 500, d: MOORED_OFFSET }]);
    expect(bumps).toEqual([]);
    expect(b.s).toBeGreaterThan(560);
  });
});

describe('narrow water, as through a lock', () => {
  const lock: Narrows = { from: 400, to: 644, half: 9 };
  /** How far the hull reaches past the walls, while any of it is between them. */
  const over = (b: Boat) => {
    const span = hullSpanWithin(b, lock.from, lock.to);
    return span ? Math.max(0, span.right - lock.half, -lock.half - span.left) : 0;
  };

  it('measures only the part of the hull between the walls', () => {
    expect(hullSpanWithin(boat({ s: 300 }), lock.from, lock.to)).toBeNull();
    const straightIn = hullSpanWithin(boat({ s: 500, d: 2 }), lock.from, lock.to);
    expect(straightIn?.left).toBeCloseTo(-3, 9);
    expect(straightIn?.right).toBeCloseTo(7, 9);
    // Bow just in and turned across: only the bow's corner is between the walls.
    const crooked = boat({ s: 370, d: 0, psi: 0.3 });
    const bowIn = hullSpanWithin(crooked, lock.from, lock.to);
    expect(bowIn?.right).toBeCloseTo(hullSpan(crooked).right, 9);
    expect(bowIn?.left).toBeGreaterThan(hullSpan(crooked).left + 10);
  });

  it('keeps the whole hull between the walls when you steer into them, with soft bumps', () => {
    for (const rudder of [-1, 1]) {
      const b = boat({ s: 300, v: 3 });
      let worst = 0;
      const track = () => {
        worst = Math.max(worst, over(b));
      };
      const bumps = run(b, straight, tiller(rudder, 3), 60, [], [lock], track);
      run(b, straight, tiller(0, 3), 200, [], [lock], track);
      expect(b.s).toBeGreaterThan(lock.to + 40);
      expect(bumps).toContain('bank');
      expect(worst).toBeLessThan(1e-9);
    }
  });

  it('straightens a boat that comes at the mouth crooked, and lets it through', () => {
    const b = boat({ s: 330, d: 10, psi: -0.35, v: 3 });
    let worst = 0;
    const bumps = run(b, straight, { kind: 'auto', line: 0, speed: 3 }, 200, [], [lock], () => {
      worst = Math.max(worst, over(b));
    });
    expect(bumps).toEqual([]);
    expect(b.s).toBeGreaterThan(lock.to + 40);
    expect(worst).toBeLessThan(1e-9);
  });

  it('lines up sooner when told to look less far ahead', () => {
    const near = boat({ d: 12 });
    const far = boat({ d: 12 });
    run(near, straight, { kind: 'auto', line: 0, speed: CRUISE_SPEED, lookAhead: 40 }, 12);
    run(far, straight, { kind: 'auto', line: 0, speed: CRUISE_SPEED }, 12);
    expect(Math.abs(near.d)).toBeLessThan(Math.abs(far.d));
  });
});
