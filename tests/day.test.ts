import { describe, expect, it } from 'vitest';
import { poseAt } from '../src/core/track';
import { MAX_REMINDERS, REMIND_EVERY } from '../src/sim/calls';
import type { CallKind } from '../src/sim/calls';
import {
  DAWN_TIME,
  EVENING_TIME,
  NIGHT_TIME,
  answerLock,
  boatPose,
  canChooseWay,
  castOffDay,
  chooseSpot,
  chooseWay,
  dayTimeline,
  glidePose,
  lightAt,
  needsYou,
  newDay,
  planDay,
  stepDay,
} from '../src/sim/day';
import type { Day, DayEvent } from '../src/sim/day';
import { isGate } from '../src/sim/lock';
import type { GatePart, PaddlePart } from '../src/sim/lock';
import { gateDone, holdPaddle, newGateHand, newPaddleHand, paddleDone, pressPaddle, settlePaddle, swingBeam } from '../src/sim/mechanism';
import type { GateHand, PaddleHand } from '../src/sim/mechanism';
import { callTitle, describeDay, waitedWords, wayWords } from '../src/sim/status';
import { NO_CONTROLS, boatsAt, lockForYou } from '../src/sim/trip';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const plan = planDay(stretch);
const fork = plan.fork!;
const [arm, main] = plan.ways;
const STEP = 1 / 30;

/** Runs the day until `until` says stop, or a time limit in seconds, and gathers its events. */
function run(day: Day, until: (d: Day) => boolean, limit = 3600, each?: (d: Day) => void): DayEvent[] {
  const events: DayEvent[] = [];
  const end = day.time + limit;
  while (!until(day) && day.time < end) {
    events.push(...stepDay(day, plan, NO_CONTROLS, STEP));
    each?.(day);
  }
  return events;
}

const calls = (events: readonly DayEvent[]) => events.flatMap((e) => (e.kind === 'call' && !e.again ? [e.call] : []));

/** You at the lock, working each close-up from the keyboard as soon as the lock is yours. */
function byHand(): (d: Day) => void {
  let hand: { paddle: PaddleHand } | { gate: GateHand } | null = null;
  return (d) => {
    const yours = lockForYou(d.trip);
    if (!yours) return;
    answerLock(d);
    const { state, next, job } = yours;
    if (!hand && next && job.kind !== 'wait-water' && job.kind !== 'boat-in') {
      hand = isGate(next.part) ? { gate: newGateHand(state, next.part as GatePart, next.target) } : { paddle: newPaddleHand(next.part as PaddlePart, next.target) };
    }
    if (hand && 'paddle' in hand) {
      pressPaddle(hand.paddle, state);
      holdPaddle(hand.paddle, state, STEP);
      settlePaddle(hand.paddle, state, STEP, true);
      if (paddleDone(hand.paddle, state)) hand = null;
    } else if (hand) {
      swingBeam(hand.gate, state, STEP, { kind: 'lean' }, boatsAt(d.trip, d.plan, yours.lock));
      if (gateDone(hand.gate, state)) hand = null;
    }
  };
}

/** A day underway, past the lock, with the locks worked for you. */
function pastTheLock(): Day {
  const day = newDay(plan, { other: 'down', crewed: true });
  castOffDay(day);
  run(day, (d) => d.trip.boat.s > d.plan.locks[0].s + 300);
  return day;
}

describe('the plan for the day', () => {
  it('goes one of two ways from Wendle Junction', () => {
    expect(plan.ways.map((w) => [w.way, w.endName])).toEqual([
      ['arm', 'Wendle Basin'],
      ['main', 'Coppice Wood bank'],
    ]);
    expect(fork.name).toBe('Wendle Junction');
    expect(fork.ring).toBeLessThan(fork.hold);
    expect(fork.hold).toBeLessThan(fork.s);
  });

  it('rings the junction call past the lock, and waits clear of Mill Bridge', () => {
    const lock = arm.locks[0];
    const bridge = arm.places.find((p) => p.name === 'Mill Bridge');
    expect(fork.ring).toBeGreaterThan(lock.s + 300);
    expect(fork.hold - (bridge?.s ?? 0)).toBeGreaterThan(80);
  });

  it('gives each way words for the choice', () => {
    expect(wayWords(arm, fork.name)).toEqual({ way: 'Turn right into the Wendle Arm', to: 'to Wendle Basin, by The Navigation pub' });
    expect(wayWords(main, fork.name)).toEqual({ way: 'Straight on along the Hallam Canal', to: 'to Coppice Wood bank, a quiet bank by the wood' });
  });
});

describe('a day with every call answered at once', () => {
  it('calls you to cast off, at the junction and at dusk, at the times the plan gave', () => {
    for (const way of ['arm', 'main']) {
      const { calls: rang, end } = dayTimeline(plan, way, 'down', STEP);
      expect(rang.map((c) => c.call)).toEqual(['cast-off', 'junction', 'dusk']);
      const at = (call: CallKind) => (rang.find((c) => c.call === call)?.at ?? 0) / 60;
      expect(at('cast-off')).toBeLessThan(0.1);
      expect(at('junction')).toBeGreaterThan(9);
      expect(at('junction')).toBeLessThan(13);
      expect(at('dusk')).toBeGreaterThan(14);
      expect(at('dusk')).toBeLessThan(18);
      // Then evening, night and morning: about twenty minutes in all.
      expect(end / 60).toBeGreaterThan(17);
      expect(end / 60).toBeLessThan(23);
    }
  });

  it('calls you to the lock when it is yours to work, and stops calling when you come', () => {
    for (const other of ['down', 'up'] as const) {
      const day = newDay(plan, { other });
      castOffDay(day);
      const events = run(day, (d) => d.calls.open?.kind === 'lock');
      expect(calls(events)).toEqual(['lock']);
      expect(day.time / 60).toBeGreaterThan(4);
      expect(day.time / 60).toBeLessThan(8);
      expect(needsYou(day, plan)).toBe('lock');
      expect(answerLock(day)).toEqual([{ kind: 'answered', call: 'lock' }]);
      expect(day.calls.open).toBeNull();
    }
  });

  it('plays a whole day by hand, morning to morning, down the arm or along the main line', () => {
    for (const [way, other] of [['arm', 'up'], ['main', 'down']] as const) {
      const day = newDay(plan, { other });
      const you = byHand();
      const phases: string[] = [];
      const rang: CallKind[] = [];
      run(day, (d) => d.phase === 'over', 3 * 3600, (d) => {
        const open = d.calls.open;
        if (open && rang.at(-1) !== open.kind) rang.push(open.kind);
        you(d);
        if (phases.at(-1) !== d.phase) phases.push(d.phase);
        if (open?.kind === 'cast-off') castOffDay(d);
        if (open?.kind === 'junction') chooseWay(d, plan, way);
        if (open?.kind === 'dusk') chooseSpot(d, 2);
      });
      expect(rang).toEqual(['cast-off', 'lock', 'junction', 'dusk']);
      expect(phases).toEqual(['morning', 'underway', 'dusk', 'tying-up', 'evening', 'night', 'dawn', 'over']);
      expect(day.plan.way).toBe(way);
      const spot = day.plan.spots[2];
      const at = boatPose(day);
      expect(Math.hypot(at.x - spot.x, at.y - spot.y)).toBeLessThan(0.01);
      expect(day.time / 60).toBeLessThan(26);
    }
  });
});

describe('a call you ignore', () => {
  it('keeps the boat moored until you cast off, ringing again now and then', () => {
    const day = newDay(plan);
    const events = run(day, () => false, 30 * 60);
    expect(day.phase).toBe('morning');
    expect(day.trip.boat.s).toBe(plan.ways[0].start);
    const rang = events.filter((e) => e.kind === 'call');
    expect(rang).toHaveLength(1 + MAX_REMINDERS);
    expect(rang.slice(1).every((e) => e.kind === 'call' && e.again)).toBe(true);
    expect(callTitle('cast-off', day, plan)).toBe('Ready to cast off');
    expect(castOffDay(day)).toContainEqual({ kind: 'answered', call: 'cast-off' });
  });

  it('keeps the boat waiting at the lock until you come', () => {
    for (const other of ['down', 'up'] as const) {
      const day = newDay(plan, { other });
      castOffDay(day);
      run(day, (d) => d.calls.open?.kind === 'lock');
      // Gates left open for it, it glides in by itself; either way it then waits.
      run(day, () => false, 3 * 60);
      const s = day.trip.boat.s;
      run(day, () => false, 40 * 60);
      expect(day.trip.boat.s).toBe(s);
      expect(day.calls.open?.kind).toBe('lock');
      expect(day.calls.open?.reminders).toBe(MAX_REMINDERS);
    }
  });

  it('names the lock in the tab title while it waits', () => {
    const day = newDay(plan, { other: 'down' });
    castOffDay(day);
    run(day, (d) => d.calls.open?.kind === 'lock');
    expect(callTitle('lock', day, plan)).toBe('Waiting at Brook Lock');
  });

  it('stops the boat before the junction until you choose a way, then carries on along it', () => {
    const day = pastTheLock();
    const events = run(day, (d) => d.trip.boat.s >= fork.hold - 0.01 && d.trip.boat.v === 0);
    expect(calls(events)).toEqual(['junction']);
    expect(needsYou(day, plan)).toBe('way');
    events.push(...run(day, () => false, 30 * 60));
    expect(events.filter((e) => e.kind === 'held')).toHaveLength(1);
    expect(day.trip.boat.s).toBeCloseTo(fork.hold, 0);
    expect(describeDay(day, plan)).toBe('Waiting before Wendle Junction for you to choose a way.');
    expect(callTitle('junction', day, plan)).toBe('Which way at Wendle Junction?');
    // The light doesn't go while the boat waits.
    expect(lightAt(day).dark).toBe(0);

    expect(chooseWay(day, plan, 'main')).toEqual([{ kind: 'chose-way', way: 'main', junction: 'Wendle Junction' }, { kind: 'answered', call: 'junction' }]);
    expect(chooseWay(day, plan, 'arm')).toEqual([]);
    run(day, (d) => d.phase === 'dusk');
    expect(day.phase).toBe('dusk');
    expect(day.trip.boat.s).toBeCloseTo(main.end, 0);
  });

  it("doesn't stop at the junction if you choose before the boat gets there", () => {
    const day = pastTheLock();
    run(day, (d) => d.calls.open?.kind === 'junction');
    chooseWay(day, plan, 'arm');
    let slowest = Infinity;
    const events = run(day, (d) => d.trip.boat.s > fork.s, 600, (d) => (slowest = Math.min(slowest, d.trip.boat.v)));
    expect(events.filter((e) => e.kind === 'held')).toEqual([]);
    expect(slowest).toBeGreaterThan(2);
  });

  it('keeps the boat at the mooring, at dusk, until you choose a spot', () => {
    const day = pastTheLock();
    run(day, (d) => d.calls.open?.kind === 'junction');
    chooseWay(day, plan, 'arm');
    const events = run(day, (d) => d.phase === 'dusk');
    expect(calls(events)).toEqual(['dusk']);
    const at = boatPose(day);
    run(day, () => false, 30 * 60);
    expect(day.phase).toBe('dusk');
    expect(boatPose(day)).toEqual(at);
    expect(needsYou(day, plan)).toBe('spot');
    expect(describeDay(day, plan)).toBe('The light is going. Choose where to moor at Wendle Basin.');
    expect(callTitle('dusk', day, plan)).toBe('Time to moor');
  });
});

describe('choosing a way', () => {
  it('moves the boat onto the other way without a jump', () => {
    const day = pastTheLock();
    run(day, (d) => d.calls.open?.kind === 'junction');
    const before = boatPose(day);
    chooseWay(day, plan, 'main');
    const after = boatPose(day);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.5);
    expect(Math.abs(after.angle - before.angle)).toBeLessThan(0.01);
    expect(day.plan).toBe(main);
  });

  it('only while the boat is short of the junction', () => {
    const day = newDay(plan, { crewed: true });
    expect(canChooseWay(day, plan)).toBe(false);
    castOffDay(day);
    expect(canChooseWay(day, plan)).toBe(true);
    expect(chooseWay(day, plan, 'nowhere')).toEqual([]);
    expect(chooseWay(day, plan, 'main')).toEqual([{ kind: 'chose-way', way: 'main', junction: 'Wendle Junction' }]);
    expect(canChooseWay(day, plan)).toBe(false);
    // Chosen early, the call never rings.
    const events = run(day, (d) => d.phase === 'dusk');
    expect(calls(events)).toEqual(['dusk']);
  });
});

describe('the end of the day', () => {
  function atDusk(way: string): Day {
    const day = pastTheLock();
    chooseWay(day, plan, way);
    run(day, (d) => d.phase === 'dusk');
    return day;
  }

  it('glides into the spot you choose and ties up, then evening, night and morning follow', () => {
    const day = atDusk('main');
    expect(chooseSpot(day, 7)).toEqual([]);
    expect(chooseSpot(day, 1)).toEqual([
      { kind: 'answered', call: 'dusk' },
      { kind: 'phase', phase: 'tying-up' },
    ]);
    expect(describeDay(day, plan)).toBe('Tying up by the bench for the night.');
    const events = run(day, (d) => d.phase === 'over', 3600);
    const phases = events.flatMap((e) => (e.kind === 'phase' ? [[e.phase, Math.round(day.time)]] : []));
    expect(phases.map(([p]) => p)).toEqual(['evening', 'night', 'dawn', 'over']);
    expect(events).toContainEqual({ kind: 'tied-up', spot: 'By the bench' });
    expect(describeDay(day, plan)).toBe("Morning at Coppice Wood bank. That's the end of the prototype day.");
  });

  it('takes a short evening, night and dawn', () => {
    const day = atDusk('arm');
    chooseSpot(day, 0);
    run(day, (d) => d.phase === 'evening');
    const evening = day.time;
    run(day, (d) => d.phase === 'over');
    expect(day.time - evening).toBeCloseTo(EVENING_TIME + NIGHT_TIME + DAWN_TIME, 0);
  });

  it('never glides faster than about four miles an hour', () => {
    for (const way of ['arm', 'main']) {
      for (let spot = 0; spot < 3; spot++) {
        const day = atDusk(way);
        chooseSpot(day, spot);
        let last = boatPose(day);
        let fastest = 0;
        run(day, (d) => d.phase !== 'tying-up', 600, (d) => {
          const p = boatPose(d);
          fastest = Math.max(fastest, Math.hypot(p.x - last.x, p.y - last.y) / STEP);
          last = p;
        });
        expect(fastest).toBeLessThan(8);
      }
    }
  });

  it('eases out of where it arrived and into the spot, facing the right way', () => {
    const glide = { from: { x: 0, y: 0, angle: 0 }, to: { x: 100, y: 20, angle: Math.PI }, time: 10, t: 0 };
    expect(glidePose(glide)).toEqual({ x: 0, y: 0, angle: 0 });
    glide.t = 1;
    const end = glidePose(glide);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(20);
    expect(end.angle).toBeCloseTo(Math.PI);
  });
});

describe('the light', () => {
  it('starts with a morning glow, is plain day while cruising, and goes as the boat nears the mooring', () => {
    const day = newDay(plan, { crewed: true });
    expect(lightAt(day)).toMatchObject({ dark: 0.05, lamps: 0 });
    expect(lightAt(day).warm).toBeGreaterThan(0.2);
    castOffDay(day);
    run(day, (d) => d.trip.boat.s > d.plan.locks[0].s + 300);
    expect(lightAt(day)).toEqual({ warm: 0, dark: 0, lamps: 0 });
    chooseWay(day, plan, 'arm');
    let last = lightAt(day).warm;
    run(day, (d) => d.phase === 'dusk', 3600, (d) => {
      expect(lightAt(d).warm).toBeGreaterThanOrEqual(last - 1e-9);
      last = lightAt(d).warm;
    });
    expect(lightAt(day).warm).toBeGreaterThan(0.7);
  });

  it('is darkest at night with the lamps lit, and morning again at the end', () => {
    const day = pastTheLock();
    chooseWay(day, plan, 'arm');
    run(day, (d) => d.phase === 'dusk');
    chooseSpot(day, 0);
    run(day, (d) => d.phase === 'night' && d.phaseTime > NIGHT_TIME / 2);
    const night = lightAt(day);
    expect(night.dark).toBeGreaterThan(0.7);
    expect(night.lamps).toBe(1);
    run(day, (d) => d.phase === 'over');
    expect(lightAt(day).lamps).toBe(0);
    expect(lightAt(day).dark).toBeLessThan(0.1);
  });
});

describe('a call that rings while the tab is hidden', () => {
  it('rings when the boat got there, however late the game catches up, and says how long it waited', () => {
    // A hidden tab may only catch up once a minute: the same day, stepped in minute-long batches.
    const day = pastTheLock();
    const crossed: number[] = [];
    run(day, (d) => d.calls.open?.kind === 'junction', 3600, (d) => {
      if (d.trip.boat.s >= fork.ring && crossed.length === 0) crossed.push(d.time);
    });
    const since = day.calls.open?.since ?? 0;
    expect(since).toBeCloseTo(crossed[0], 6);
    run(day, () => false, 4 * 60);
    expect(waitedWords(day.time - since)).toBe('The boat has waited 4 min for you');
    expect(waitedWords(30)).toBeNull();
    expect(waitedWords(3 * 3600)).toBe('The boat has waited over 3 hours for you');
  });

  it('rings again only a few times, however long you stay away', () => {
    const day = pastTheLock();
    const events = run(day, () => false, 2 * 3600);
    expect(events.filter((e) => e.kind === 'call')).toHaveLength(1 + MAX_REMINDERS);
    expect(REMIND_EVERY).toBeGreaterThanOrEqual(3 * 60);
  });
});

describe('what the day looks like on the water', () => {
  it('puts the boat where the trip has it while underway', () => {
    const day = pastTheLock();
    const p = poseAt(day.plan.route, day.trip.boat.s, day.trip.boat.d);
    expect(boatPose(day)).toMatchObject({ x: p.x, y: p.y });
  });
});
