import { describe, expect, it } from 'vitest';
import { answerLock, castOffDay, chooseSpot, chooseWay, lightAt, newDay, planDay, stepDay } from '../src/sim/day';
import type { Day } from '../src/sim/day';
import { logLines } from '../src/sim/logbook';
import { windPaddle } from '../src/sim/lock';
import { SAVE_VERSION, loadGame, saveGame } from '../src/sim/save';
import type { Kept } from '../src/sim/save';
import { describeDay } from '../src/sim/status';
import { NO_CONTROLS, lockForYou } from '../src/sim/trip';
import type { Controls } from '../src/sim/trip';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const plan = planDay(stretch);
const STEP = 1 / 30;

function run(day: Day, until: (d: Day) => boolean, controls: Controls = NO_CONTROLS, moor = true, limit = 4 * 3600): void {
  const end = day.time + limit;
  while (!until(day) && day.time < end) {
    for (const e of stepDay(day, plan, controls, 0.25)) {
      if (e.kind !== 'call' || e.again) continue;
      if (e.call === 'cast-off') castOffDay(day);
      if (e.call === 'junction') chooseWay(day, plan, 'arm');
      if (e.call === 'dusk' && moor) chooseSpot(day, 1);
    }
  }
}

const keep = (day: Day): Kept => ({ day, other: 'up', bell: false });
const roundTrip = (day: Day): Kept | null => loadGame(saveGame(keep(day), HALLAM), plan, HALLAM);

/** Days at moments worth keeping: each phase, at the lock half worked by hand, steering, and gliding into a spot. */
function moments(): [string, Day][] {
  const out: [string, Day][] = [];
  const morning = newDay(plan, { other: 'down', number: 3 });
  stepDay(morning, plan, NO_CONTROLS, 30);
  out.push(['morning, with the call waiting', morning]);

  const steering = newDay(plan, { other: 'up' });
  castOffDay(steering);
  run(steering, (d) => d.trip.boat.s > 900);
  run(steering, (d) => d.trip.helm === 'you' && d.trip.boat.s > 960, { rudder: 1, throttle: 1 });
  out.push(['at the tiller', steering]);

  const lock = newDay(plan, { other: 'up' });
  run(lock, (d) => lockForYou(d.trip)?.next !== undefined && lockForYou(d.trip)?.next !== null && d.calls.open?.kind === 'lock');
  answerLock(lock);
  const yours = lockForYou(lock.trip)!;
  windPaddle(yours.state, 'bottomPaddle', 0.6);
  run(lock, (d) => d.time > lock.time + 4);
  out.push(['at the lock, half worked by hand', lock]);

  const crewed = newDay(plan, { other: 'down', crewed: true });
  run(crewed, (d) => d.trip.phase === 'in-lock' && d.trip.passage?.yours === true && d.trip.boat.s > d.trip.passage.lock.s - 50);
  out.push(['in the lock with a crew', crewed]);

  const tidying = newDay(plan, { other: 'down', crewed: true });
  run(tidying, (d) => d.trip.tidying.length > 0);
  out.push(['closing up behind', tidying]);

  for (const phase of ['dusk', 'tying-up', 'evening', 'night', 'over'] as const) {
    const day = newDay(plan, { other: 'down', crewed: true });
    run(day, (d) => d.phase === phase && (phase !== 'tying-up' || (d.glide?.t ?? 0) > 0.3), NO_CONTROLS, phase !== 'dusk');
    expect(day.phase).toBe(phase);
    out.push([phase, day]);
  }
  return out;
}

const MOMENTS = moments();

describe('keeping your place', () => {
  it.each(MOMENTS)('reads back exactly as it was: %s', (_, day) => {
    const kept = roundTrip(day);
    expect(kept).not.toBeNull();
    expect(kept!.other).toBe('up');
    expect(kept!.bell).toBe(false);
    expect(kept!.day).toEqual(day);
    // The plan, its spots and its locks are the day plan's own, not copies.
    expect(plan.ways).toContain(kept!.day.plan);
    if (day.spot) expect(kept!.day.spot).toBe(day.spot);
    if (day.trip.passage) expect(kept!.day.trip.passage?.lock).toBe(day.trip.passage.lock);
  });

  it.each(MOMENTS)('carries on just as it would have: %s', (_, day) => {
    const kept = roundTrip(day)!.day;
    // Both answer calls the same way as they go on.
    run(day, (d) => d.time > day.time + 90);
    run(kept, (d) => d.time >= day.time - 1e-9);
    expect(kept).toEqual(day);
    expect(describeDay(kept, plan)).toBe(describeDay(day, plan));
    expect(lightAt(kept)).toEqual(lightAt(day));
    expect(logLines(kept.log)).toEqual(logLines(day.log));
  });

  it('keeps a new day as a new day', () => {
    const day = newDay(plan, { other: 'down' });
    expect(roundTrip(day)!.day).toEqual(day);
  });

  it('is plain text, small enough for browser storage', () => {
    const text = saveGame(keep(MOMENTS[MOMENTS.length - 1][1]), HALLAM);
    expect(JSON.parse(text).version).toBe(SAVE_VERSION);
    expect(text.length).toBeLessThan(8000);
  });
});

describe('a kept place that is stale or broken', () => {
  const day = MOMENTS[2][1];
  const good = JSON.parse(saveGame(keep(day), HALLAM));

  it('is set aside when there is none', () => {
    expect(loadGame(null, plan, HALLAM)).toBeNull();
    expect(loadGame('', plan, HALLAM)).toBeNull();
  });

  it('is set aside when it is from another version', () => {
    for (const version of [SAVE_VERSION - 1, SAVE_VERSION + 1, String(SAVE_VERSION), undefined, null]) {
      expect(loadGame(JSON.stringify({ ...good, version }), plan, HALLAM)).toBeNull();
    }
  });

  it('is set aside when it is for another stretch, or the same stretch with another seed', () => {
    expect(loadGame(JSON.stringify({ ...good, stretch: 'elsewhere' }), plan, HALLAM)).toBeNull();
    expect(loadGame(JSON.stringify({ ...good, seed: HALLAM.seed + 1 }), plan, HALLAM)).toBeNull();
    expect(loadGame(saveGame(keep(day), HALLAM), plan, { ...HALLAM, seed: 7 })).toBeNull();
  });

  it('is set aside when it is not what was written', () => {
    const text = saveGame(keep(day), HALLAM);
    for (const broken of ['{', 'null', '[]', '42', '"towpath"', 'undefined', text.slice(0, text.length / 2), `${text}}`, text.replace(/"time":/, '"time":"soon",')]) {
      expect(loadGame(broken, plan, HALLAM)).toBeNull();
    }
  });

  it('is set aside when a part of it is missing or makes no sense', () => {
    const edits: ((s: typeof good) => void)[] = [
      (s) => delete s.day,
      (s) => delete s.day.trip.boat,
      (s) => (s.day.way = 'nowhere'),
      (s) => (s.day.phase = 'teatime'),
      (s) => (s.day.spot = 7),
      (s) => (s.day.spot = 0.5),
      (s) => (s.day.trip.boat.s = -40),
      (s) => (s.day.trip.boat.s = 1e9),
      (s) => (s.day.trip.locks = {}),
      (s) => (s.day.trip.locks['brook-lock'].water = 2),
      (s) => (s.day.trip.passage.lock = 'another-lock'),
      (s) => (s.day.trip.passage = null),
      (s) => (s.day.calls.answered = ['cast-off', 'tea']),
      (s) => (s.day.calls.open = { kind: 'lock' }),
      (s) => (s.day.log.entries = [{ kind: 'picnic', at: 3 }]),
      (s) => (s.day.log.entries[0].from = 4),
      (s) => (s.other = 'sideways'),
      (s) => delete s.bell,
    ];
    for (const edit of edits) {
      const s = structuredClone(good);
      edit(s);
      expect(loadGame(JSON.stringify(s), plan, HALLAM), edit.toString()).toBeNull();
    }
  });

  it.each([MOMENTS[2], MOMENTS[MOMENTS.length - 1]])('never stops the game, whatever is changed in it: %s', (_, kept) => {
    const odd: unknown[] = [null, true, 'x', -1, 0, 0.5, 1e9, {}, [], [1]];
    const base = JSON.parse(saveGame(keep(kept), HALLAM));
    // Every value in the kept place, by its path.
    const paths: (string | number)[][] = [];
    const walk = (v: unknown, path: (string | number)[]) => {
      paths.push(path);
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, Array.isArray(v) ? Number(k) : k]);
    };
    walk(base, []);
    expect(paths.length).toBeGreaterThan(80);
    let loaded = 0;
    for (const path of paths.slice(1)) {
      for (const value of odd) {
        const s = structuredClone(base);
        let at = s;
        for (const k of path.slice(0, -1)) at = at[k];
        at[path[path.length - 1]] = value;
        const back = loadGame(JSON.stringify(s), plan, HALLAM);
        if (!back) continue;
        loaded++;
        // Whatever it lets through still plays.
        for (let i = 0; i < 60; i++) stepDay(back.day, plan, NO_CONTROLS, STEP);
        lightAt(back.day);
        describeDay(back.day, plan);
        logLines(back.day.log);
      }
    }
    expect(loaded).toBeGreaterThan(0);
  });
});
