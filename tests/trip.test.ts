import { describe, expect, it } from 'vitest';
import { poseAt } from '../src/core/track';
import { CRUISE_SPEED, PASSING_SPEED, TOP_SPEED } from '../src/sim/boat';
import { CHAMBER_HALF, LANDING_GAP, isGate, newLock } from '../src/sim/lock';
import type { GatePart, PaddlePart } from '../src/sim/lock';
import { gateDone, holdPaddle, newGateHand, newPaddleHand, paddleDone, pressPaddle, settlePaddle, swingBeam } from '../src/sim/mechanism';
import type { GateHand, PaddleHand } from '../src/sim/mechanism';
import { newOtherBoat, otherPose, stepOther } from '../src/sim/otherboat';
import type { OtherWay } from '../src/sim/otherboat';
import { describe as say, upcoming } from '../src/sim/status';
import {
  HAND_BACK_AFTER,
  NO_CONTROLS,
  boatsAt,
  castOff,
  lockForYou,
  newTrip,
  planTrip,
  plannedSpeed,
  steersItselfHere,
  stepTrip,
  tripDuration,
  wantsPart,
} from '../src/sim/trip';
import type { Controls, Trip, TripEvent } from '../src/sim/trip';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const plan = planTrip(stretch);
const STEP = 1 / 30;
const lock = plan.locks[0];

function underway(other: OtherWay | null = null, crewed = true): Trip {
  const trip = newTrip(plan, { other, crewed });
  castOff(trip);
  return trip;
}

/**
 * You, at the lock: whenever it's yours, go to the part that needs you and
 * work its close-up from the keyboard, as a player would. Returns the parts
 * you went to, in order.
 */
function byHand(): { visits: string[]; each: (t: Trip) => void } {
  const visits: string[] = [];
  let hand: { paddle: PaddleHand } | { gate: GateHand } | null = null;
  const each = (t: Trip) => {
    const yours = lockForYou(t);
    if (!yours) return;
    const { state, next, job } = yours;
    if (!hand && next && job.kind !== 'wait-water' && job.kind !== 'boat-in') {
      visits.push(next.part);
      hand = isGate(next.part) ? { gate: newGateHand(state, next.part as GatePart, next.target) } : { paddle: newPaddleHand(next.part as PaddlePart, next.target) };
    }
    if (hand && 'paddle' in hand) {
      pressPaddle(hand.paddle, state);
      holdPaddle(hand.paddle, state, STEP);
      settlePaddle(hand.paddle, state, STEP, true);
      if (paddleDone(hand.paddle, state)) hand = null;
    } else if (hand) {
      swingBeam(hand.gate, state, STEP, { kind: 'lean' }, boatsAt(t, plan, yours.lock));
      if (gateDone(hand.gate, state)) hand = null;
    }
  };
  return { visits, each };
}

/** Runs the trip until `until` says stop, or a time limit in seconds, and gathers its events. */
function run(trip: Trip, until: (t: Trip) => boolean, limit = 3600, controls: Controls = NO_CONTROLS, each?: (t: Trip) => void): TripEvent[] {
  const events: TripEvent[] = [];
  const end = trip.time + limit;
  while (!until(trip) && trip.time < end) {
    events.push(...stepTrip(trip, plan, controls, STEP));
    each?.(trip);
  }
  return events;
}

describe('the plan for the Hallam trip', () => {
  it('finds the lock, the moorings, the junction and both ends', () => {
    expect(plan.locks.map((l) => [l.name, l.goingUp])).toEqual([['Brook Lock', true]]);
    expect(plan.moorings.map((m) => m.name)).toEqual(['Visitor moorings']);
    expect(plan.obstacles).toHaveLength(3);
    expect(plan.junctions.map((j) => [j.name, j.onto, j.turn])).toEqual([['Wendle Junction', 'Wendle Arm', 'right']]);
    expect(plan.startName).toBe('Kingsbridge');
    expect(plan.endName).toBe('Wendle Basin');
  });

  it('slows for moorings and the junction, and stops at the lock landing and the end', () => {
    const m = plan.moorings[0];
    expect(plannedSpeed(plan, plan.start + 10)).toBeCloseTo(CRUISE_SPEED);
    expect(plannedSpeed(plan, (m.from + m.to) / 2)).toBeCloseTo(PASSING_SPEED);
    expect(plannedSpeed(plan, m.from - 20)).toBeLessThan(CRUISE_SPEED);
    expect(plannedSpeed(plan, lock.s - LANDING_GAP)).toBe(0);
    expect(plannedSpeed(plan, plan.junctions[0].s)).toBeLessThan(CRUISE_SPEED);
    expect(plannedSpeed(plan, plan.end)).toBe(0);
  });
});

describe('a trip left to itself', () => {
  it('starts moored and waits for you to cast off', () => {
    const trip = newTrip(plan);
    for (let i = 0; i < 600; i++) stepTrip(trip, plan, NO_CONTROLS, STEP);
    expect(trip.phase).toBe('moored');
    expect(trip.boat.s).toBe(plan.start);
    expect(castOff(trip)).toEqual([{ kind: 'cast-off' }]);
    expect(castOff(trip)).toEqual([]);
  });

  it('cruises the whole way to the basin in about a quarter of an hour, with the lock worked for it', () => {
    for (const way of ['down', 'up'] as const) {
      const minutes = tripDuration(plan, STEP, way) / 60;
      expect(minutes).toBeGreaterThan(13);
      expect(minutes).toBeLessThan(19);
    }
  });

  it('reaches the lock, the junction and the basin at the times the plan gave', () => {
    const trip = underway();
    const minutesTo = (s: number) => {
      run(trip, (t) => t.boat.s >= s);
      return trip.time / 60;
    };
    expect(minutesTo(lock.s - LANDING_GAP - 1)).toBeGreaterThan(4);
    expect(minutesTo(lock.s - LANDING_GAP - 1)).toBeLessThan(7);
    expect(minutesTo(plan.junctions[0].s)).toBeGreaterThan(10);
    expect(minutesTo(plan.junctions[0].s)).toBeLessThan(14);
  });

  it('never goes backwards, never bumps anything, and moors at the end', () => {
    const trip = underway();
    let last = trip.boat.s;
    const events = run(trip, (t) => t.phase === 'arrived', 3600, NO_CONTROLS, (t) => {
      expect(t.boat.s).toBeGreaterThanOrEqual(last - 1e-9);
      expect(t.boat.v).toBeLessThanOrEqual(TOP_SPEED);
      last = t.boat.s;
    });
    expect(trip.phase).toBe('arrived');
    expect(trip.boat.s).toBeCloseTo(plan.end, 0);
    expect(events.filter((e) => e.kind === 'bump')).toEqual([]);
    expect(events.at(-1)).toEqual({ kind: 'arrived' });
  });

  it('slows right down past the moored boats', () => {
    const trip = underway();
    const m = plan.moorings[0];
    run(trip, (t) => t.boat.s > m.from + 60);
    let fastest = 0;
    run(trip, (t) => t.boat.s > m.to - 20, 600, NO_CONTROLS, (t) => (fastest = Math.max(fastest, t.boat.v)));
    expect(fastest).toBeLessThanOrEqual(PASSING_SPEED + 1e-9);
  });
});

describe('going up through Brook Lock by hand', () => {
  it('waits at the lock until you work it', () => {
    const trip = underway(null, false);
    const events = run(trip, (t) => t.time > 20 * 60);
    expect(events).toContainEqual({ kind: 'reached-lock', lock: lock.id, waiting: false });
    expect(events).toContainEqual({ kind: 'lock-yours', lock: lock.id, ready: true });
    expect(trip.phase).toBe('in-lock');
    expect(trip.boat.s).toBeCloseTo(lock.s - LANDING_GAP, 0);
    expect(lockForYou(trip)?.next).toEqual({ part: 'bottomGates', target: 1 });
  });

  it('takes four close-ups when the lock is ready, and the boat glides in and out by itself', () => {
    const trip = underway(null, false);
    const you = byHand();
    const events = run(trip, (t) => t.phase === 'arrived', 3600, NO_CONTROLS, you.each);
    expect(you.visits).toEqual(['bottomGates', 'bottomGates', 'topPaddle', 'topGates']);
    expect(events).toContainEqual({ kind: 'cleared-lock', lock: lock.id });
    expect(trip.phase).toBe('arrived');
  });

  it('closes up behind you once the boat is out', () => {
    const trip = underway(null, false);
    const you = byHand();
    run(trip, (t) => t.boat.s > lock.s + CHAMBER_HALF + 300, 3600, NO_CONTROLS, you.each);
    run(trip, () => false, 30);
    expect(trip.locks.get(lock.id)).toMatchObject({ water: 1, bottomGates: 0, topGates: 0, bottomPaddle: 0, topPaddle: 0 });
  });

  it('never opens a gate against a difference in the water, and never has both pairs open', () => {
    for (const way of ['down', 'up'] as const) {
      const trip = underway(way, false);
      const you = byHand();
      run(trip, (t) => t.boat.s > lock.s + CHAMBER_HALF + 600, 3600, NO_CONTROLS, (t) => {
        you.each(t);
        const work = t.locks.get(lock.id);
        if (!work) throw new Error('no lock');
        expect(work.bottomGates > 0 && work.topGates > 0).toBe(false);
        if (work.bottomGates > 0) expect(work.water).toBe(0);
        if (work.topGates > 0) expect(work.water).toBe(1);
      });
      expect(trip.phase).toBe('cruising');
    }
  });

  it('keeps the boat still while the water moves', () => {
    const trip = underway(null, false);
    const you = byHand();
    run(trip, (t) => lockForYou(t)?.job.kind === 'wait-water' && lockForYou(t)?.where === 'in' && t.boat.v === 0, 3600, NO_CONTROLS, you.each);
    const s = trip.boat.s;
    run(trip, (t) => lockForYou(t)?.job.kind !== 'wait-water', 600, NO_CONTROLS, you.each);
    expect(trip.boat.s).toBeCloseTo(s, 6);
    expect(trip.boat.s).toBeCloseTo(lock.s, 0);
  });

  it("holds the boat where it is, past the middle, if the gates ahead swing back while it's leaving", () => {
    const trip = underway(null, false);
    const you = byHand();
    run(trip, (t) => t.phase === 'in-lock' && t.boat.s > lock.s + 3, 3600, NO_CONTROLS, you.each);
    const work = trip.locks.get(lock.id);
    if (!work) throw new Error('no lock');
    work.topGates = 0.9;
    const s = trip.boat.s;
    let lowest = s;
    run(trip, () => false, 5, NO_CONTROLS, (t) => {
      t.locks.get(lock.id)!.topGates = 0.9;
      lowest = Math.min(lowest, t.boat.s);
    });
    expect(lowest).toBeGreaterThanOrEqual(s);
    expect(trip.boat.v).toBe(0);
  });

  it('stops wanting a part once the lock has moved on from it', () => {
    const trip = underway(null, false);
    const you = byHand();
    run(trip, (t) => t.phase === 'in-lock');
    run(trip, (t) => t.passage?.yours === true);
    expect(wantsPart(trip, lock.id, 'bottomGates', 1)).toBe(true);
    expect(wantsPart(trip, lock.id, 'topGates', 1)).toBe(false);
    run(trip, (t) => (t.locks.get(lock.id)?.bottomGates ?? 0) >= 0.95, 3600, NO_CONTROLS, you.each);
    expect(wantsPart(trip, lock.id, 'bottomGates', 1)).toBe(false);
    run(trip, (t) => t.phase === 'cruising', 3600, NO_CONTROLS, you.each);
    expect(wantsPart(trip, lock.id, 'topGates', 1)).toBe(false);
    expect(wantsPart(trip, lock.id, 'topGates', 0)).toBe(false);
  });
});

describe('the other boat', () => {
  it("doesn't jump back to the middle if the gates ahead swing back while it's leaving", () => {
    const other = plan.other;
    if (!other) throw new Error('no other boat');
    const o = newOtherBoat('up');
    o.phase = 'working';
    o.crew.done = true;
    o.x = 5;
    o.v = 0.5;
    const work = newLock(1);
    work.topGates = 0.9;
    stepOther(o, other, work, STEP, 0);
    expect(o.x).toBe(5);
    expect(o.v).toBe(0);
  });

  it('comes down through the lock first and leaves it empty, with the gates open for you: three close-ups', () => {
    const trip = underway('down', false);
    const you = byHand();
    const events = run(trip, (t) => t.phase === 'arrived', 3600, NO_CONTROLS, you.each);
    expect(events).toContainEqual({ kind: 'reached-lock', lock: lock.id, waiting: true });
    expect(events).toContainEqual({ kind: 'lock-yours', lock: lock.id, ready: true });
    expect(you.visits).toEqual(['bottomGates', 'topPaddle', 'topGates']);
  });

  it('goes up ahead of you and leaves the lock full, so you empty it first: six close-ups', () => {
    const trip = underway('up', false);
    const you = byHand();
    const events = run(trip, (t) => t.phase === 'arrived', 3600, NO_CONTROLS, you.each);
    expect(events).toContainEqual({ kind: 'lock-yours', lock: lock.id, ready: false });
    expect(you.visits).toEqual(['bottomPaddle', 'bottomGates', 'bottomGates', 'bottomPaddle', 'topPaddle', 'topGates']);
  });

  it('works the lock by itself while you wait, and then leaves it to you', () => {
    for (const way of ['down', 'up'] as const) {
      const trip = underway(way, false);
      run(trip, (t) => t.passage?.yours === true);
      const work = trip.locks.get(lock.id);
      expect(work?.water).toBe(way === 'down' ? 0 : 1);
      expect(work).toMatchObject({ bottomPaddle: 0, topPaddle: 0, topGates: 0, bottomGates: way === 'down' ? 1 : 0 });
      expect(trip.other?.phase).toBe('away');
    }
  });

  it('passes your boat without touching it, and nothing bumps', () => {
    for (const way of ['down', 'up'] as const) {
      const trip = underway(way, true);
      let closest = Infinity;
      const events = run(trip, (t) => t.phase === 'arrived', 3600, NO_CONTROLS, (t) => {
        const o = t.other;
        if (!o || o.phase === 'gone' || !plan.other) return;
        const theirs = otherPose(o, plan.other);
        const p = poseAtRoute(t);
        closest = Math.min(closest, Math.hypot(theirs.x - p.x, theirs.y - p.y));
        // Side by side or end to end, the hulls never overlap.
        const along = Math.abs(o.x - (t.boat.s - lock.s));
        if (along < 74) expect(Math.abs(o.d - t.boat.d)).toBeGreaterThanOrEqual(10);
      });
      expect(events.filter((e) => e.kind === 'bump')).toEqual([]);
      expect(trip.phase).toBe('arrived');
      if (way === 'down') expect(closest).toBeLessThan(40);
    }
  });
});

describe('taking the tiller', () => {
  const steer = (rudder: -1 | 0 | 1, throttle: -1 | 0 | 1 = 0): Controls => ({ rudder, throttle });

  it('gives you the helm when you touch the keys, and takes it back when you let go', () => {
    const trip = underway();
    run(trip, (t) => t.time > 30);
    const took = stepTrip(trip, plan, steer(1), STEP);
    expect(took).toContainEqual({ kind: 'took-helm' });
    expect(trip.helm).toBe('you');
    run(trip, () => false, 1.5, steer(1));
    const offLine = Math.abs(trip.boat.d);
    expect(offLine).toBeGreaterThan(0.5);
    const events = run(trip, (t) => t.helm === 'auto', 10);
    expect(events).toContainEqual({ kind: 'handed-back' });
    expect(trip.time).toBeGreaterThan(30 + 1.5 + HAND_BACK_AFTER - 0.1);
    // The boat finds its line again gently, without bumping.
    const after = run(trip, () => false, 40);
    expect(after.filter((e) => e.kind === 'bump')).toEqual([]);
    expect(Math.abs(trip.boat.d)).toBeLessThan(1);
  });

  it('lets you speed up to four miles an hour, and no faster', () => {
    const trip = underway();
    run(trip, (t) => t.time > 30);
    run(trip, () => false, 20, steer(0, 1));
    expect(trip.boat.v).toBeCloseTo(TOP_SPEED, 1);
  });

  it('lets you slow down and go astern', () => {
    const trip = underway();
    run(trip, (t) => t.time > 30);
    run(trip, () => false, 20, steer(0, -1));
    expect(trip.boat.v).toBeLessThan(0);
  });

  it('stops going astern where the day began', () => {
    const trip = underway();
    run(trip, (t) => t.time > 10);
    run(trip, () => false, 300, steer(0, -1));
    expect(trip.boat.s).toBe(plan.start);
    expect(trip.boat.v).toBeGreaterThanOrEqual(0);
  });

  it('bumps the bank softly if you steer into it', () => {
    const trip = underway();
    run(trip, (t) => t.time > 30);
    const events = run(trip, () => false, 20, steer(-1));
    expect(events).toContainEqual({ kind: 'bump', what: 'bank' });
    expect(trip.boat.v).toBeGreaterThan(0);
  });

  it('bumps a moored boat softly if you steer into it', () => {
    const trip = underway();
    const first = plan.obstacles[0];
    run(trip, (t) => t.boat.s > first.s - 120);
    const events = run(trip, () => false, 25, steer(1));
    expect(events).toContainEqual({ kind: 'bump', what: 'boat' });
  });

  it('takes the helm back near the lock, and ignores the tiller there', () => {
    const trip = underway();
    run(trip, (t) => t.boat.s > lock.s - LANDING_GAP - 400);
    const events = run(trip, (t) => steersItselfHere(plan, t.boat.s) === 'lock', 600, steer(1));
    events.push(...run(trip, () => false, 2, steer(1)));
    expect(events).toContainEqual({ kind: 'helm-taken', reason: 'lock' });
    expect(trip.helm).toBe('auto');
    expect(events.filter((e) => e.kind === 'took-helm')).toHaveLength(1);
  });
});

describe('what the game says', () => {
  it('describes each part of the day', () => {
    const trip = newTrip(plan, { other: 'up' });
    const you = byHand();
    expect(say(trip, plan)).toBe("Moored at Kingsbridge. Cast off when you're ready.");
    castOff(trip);
    run(trip, (t) => t.time > 20);
    expect(say(trip, plan)).toBe('Cruising along the Hallam Canal. The boat steers itself.');
    run(trip, (t) => t.phase === 'in-lock');
    expect(say(trip, plan)).toBe('Waiting below Brook Lock while the boat ahead goes up through it.');
    run(trip, (t) => t.passage?.yours === true);
    expect(say(trip, plan)).toBe('Brook Lock is full, so empty it first: wind up the bottom paddle.');
    run(trip, (t) => lockForYou(t)?.job.kind === 'lower', 600, NO_CONTROLS, you.each);
    expect(say(trip, plan)).toBe('Wind the bottom paddle back down, so the lock can fill.');
    run(trip, (t) => lockForYou(t)?.job.kind === 'wait-water', 600, NO_CONTROLS, you.each);
    expect(say(trip, plan)).toBe('The lock fills, lifting the boat up to the next level.');
    run(trip, (t) => t.passage === null, 600, NO_CONTROLS, you.each);
    run(trip, (t) => Math.abs(t.boat.s - plan.junctions[0].s) < 50);
    expect(say(trip, plan)).toBe('Wendle Junction: turning right into the Wendle Arm.');
    run(trip, (t) => t.phase === 'arrived');
    expect(say(trip, plan)).toMatch(/^Moored at Wendle Basin/);
  });

  it('names the next place along the way, and about how long until it', () => {
    const next = upcoming(plan.places, plan.start);
    expect(next?.name).toBe('Hollin Bridge');
    expect(next?.minutes).toBeGreaterThan(1);
    expect(next?.minutes).toBeLessThan(4);
    expect(upcoming(plan.places, plan.end)).toBeNull();
  });
});

function poseAtRoute(t: Trip): { x: number; y: number } {
  return poseAt(plan.route, t.boat.s, t.boat.d);
}
