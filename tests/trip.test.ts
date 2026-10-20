import { describe, expect, it } from 'vitest';
import { CRUISE_SPEED, TOP_SPEED } from '../src/sim/boat';
import { describe as say, upcoming } from '../src/sim/status';
import {
  CHAMBER_HALF,
  HAND_BACK_AFTER,
  LANDING_GAP,
  NO_CONTROLS,
  PASSING_SPEED,
  castOff,
  newTrip,
  planTrip,
  plannedSpeed,
  steersItselfHere,
  stepTrip,
  tripDuration,
} from '../src/sim/trip';
import type { Controls, LockStage, Trip, TripEvent } from '../src/sim/trip';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const plan = planTrip(resolveStretch(HALLAM));
const STEP = 1 / 30;
const lock = plan.locks[0];

function underway(): Trip {
  const trip = newTrip(plan);
  castOff(trip);
  return trip;
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
    expect(plan.junctions.map((j) => [j.name, j.branch, j.turn])).toEqual([['Wendle Junction', 'Wendle Arm', 'right']]);
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

  it('cruises the whole way to the basin in about a quarter of an hour', () => {
    const minutes = tripDuration(plan, STEP) / 60;
    expect(minutes).toBeGreaterThan(13);
    expect(minutes).toBeLessThan(19);
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

describe('going up through Brook Lock', () => {
  it('ties up below, works the lock in order, and goes on up', () => {
    const trip = underway();
    const events = run(trip, (t) => t.boat.s > lock.s + CHAMBER_HALF + 300);
    const stages = events.flatMap((e) => (e.kind === 'lock-stage' ? [e.stage] : []));
    expect(stages).toEqual<LockStage[]>(['tying-up', 'opening-entry', 'entering', 'closing-entry', 'levelling', 'opening-exit', 'leaving']);
    expect(events.some((e) => e.kind === 'cleared-lock')).toBe(true);
    const work = trip.locks.get(lock.id);
    expect(work?.water).toBe(1);
  });

  it('never opens a gate against a difference in the water, and never has both pairs open', () => {
    const trip = underway();
    run(trip, (t) => t.boat.s > lock.s + CHAMBER_HALF + 600, 3600, NO_CONTROLS, (t) => {
      const work = t.locks.get(lock.id);
      if (!work) throw new Error('no lock');
      expect(work.bottomGates > 0 && work.topGates > 0).toBe(false);
      if (work.bottomGates > 0) expect(work.water).toBe(0);
      if (work.topGates > 0) expect(work.water).toBe(1);
    });
    // The top gates swing shut behind the boat.
    run(trip, () => false, 30);
    expect(trip.locks.get(lock.id)?.topGates).toBe(0);
  });

  it('keeps the boat still while the water moves', () => {
    const trip = underway();
    run(trip, (t) => t.stage?.name === 'levelling');
    const s = trip.boat.s;
    run(trip, (t) => t.stage?.name !== 'levelling');
    expect(trip.boat.s).toBeCloseTo(s, 6);
    expect(trip.boat.s).toBeCloseTo(lock.s, 0);
  });

  it('empties a full lock first, if it was left full', () => {
    const trip = underway();
    const work = trip.locks.get(lock.id);
    if (!work) throw new Error('no lock');
    work.water = 1;
    const events = run(trip, (t) => t.stage?.name === 'entering');
    expect(events.flatMap((e) => (e.kind === 'lock-stage' ? [e.stage] : []))).toEqual(['tying-up', 'levelling-for-you', 'opening-entry', 'entering']);
    expect(work.water).toBe(0);
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
    const trip = newTrip(plan);
    expect(say(trip, plan)).toBe("Moored at Kingsbridge. Cast off when you're ready.");
    castOff(trip);
    run(trip, (t) => t.time > 20);
    expect(say(trip, plan)).toBe('Cruising along the Hallam Canal. The boat steers itself.');
    run(trip, (t) => t.stage?.name === 'levelling');
    expect(say(trip, plan)).toBe('The lock fills, lifting the boat up to the next level.');
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
