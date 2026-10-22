import { describe, expect, it } from 'vitest';
import { answerLock, castOffDay, chooseSpot, chooseWay, lightAt, needsYou, newDay, planDay, stepDay } from '../src/sim/day';
import type { Day, DayPlan } from '../src/sim/day';
import { logLines } from '../src/sim/logbook';
import type { DayPage } from '../src/sim/logbook';
import { windPaddle } from '../src/sim/lock';
import { makeCanal } from '../src/sim/playable';
import { HALLAM_SAVE_VERSION, MAX_PAGES, NUMBERS_SAVE_VERSION, SAVE_VERSION, dayPage, loadGame, saveGame } from '../src/sim/save';
import type { Canal, Kept } from '../src/sim/save';
import { describeDay } from '../src/sim/status';
import { NO_CONTROLS, lockForYou } from '../src/sim/trip';
import { planWeather, weatherAt } from '../src/sim/weather';
import type { Controls } from '../src/sim/trip';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';
import { byHand } from './fixtures/hands';

const stretch = resolveStretch(HALLAM);
const plan = planDay(stretch);
const STEP = 1 / 30;

function run(day: Day, until: (d: Day) => boolean, controls: Controls = NO_CONTROLS, moor = true, limit = 4 * 3600, on: DayPlan = plan): void {
  const end = day.time + limit;
  while (!until(day) && day.time < end) {
    for (const e of stepDay(day, on, controls, 0.25)) {
      if (e.kind !== 'call' || e.again) continue;
      if (e.call === 'cast-off') castOffDay(day);
      if (e.call === 'junction') chooseWay(day, on, on.ways[0].way);
      if (e.call === 'dusk' && moor) chooseSpot(day, 1);
    }
  }
}

/** Plays a day on to the next morning, as you would: casting off, working each lock by hand, taking the first way at each junction, and mooring. */
function finish(day: Day, on: DayPlan): void {
  const you = byHand(0.25);
  const end = day.time + 4 * 3600;
  while (day.phase !== 'over' && day.time < end) {
    const need = needsYou(day, on);
    if (need === 'cast-off') castOffDay(day);
    else if (need === 'way') chooseWay(day, on, on.ways.find((w) => day.ways.includes(w.way))!.way);
    else if (need === 'spot') chooseSpot(day, 1);
    you(day);
    stepDay(day, on, NO_CONTROLS, 0.25);
  }
}

const HALLAM_CANAL: Canal = { number: null, data: HALLAM };
const keep = (day: Day): Kept => ({ canal: HALLAM_CANAL, day, pages: [], other: 'up', bell: false });
const roundTrip = (day: Day) => loadGame(saveGame(keep(day)));

/** A kept place as the game wrote it before canals had numbers, when the Hallam Canal's was kept with only its id and seed. */
function beforeNumbers(day: Day): string {
  const { canal, stretch, ...rest } = JSON.parse(saveGame(keep(day)));
  expect(canal).toBeNull();
  expect(stretch).toEqual(HALLAM);
  return JSON.stringify({ ...rest, version: HALLAM_SAVE_VERSION, stretch: HALLAM.id, seed: HALLAM.seed });
}

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
    expect(kept!.canal).toEqual(HALLAM_CANAL);
    // The plan, its spots and its locks are the loaded day plan's own, not copies.
    expect(kept!.plan.ways).toContain(kept!.day.plan);
    if (day.spot) expect(kept!.day.plan.spots).toContain(kept!.day.spot);
    if (day.trip.passage) expect(kept!.day.plan.locks).toContain(kept!.day.trip.passage?.lock);
  });

  it.each(MOMENTS)('carries on just as it would have: %s', (_, day) => {
    const loaded = roundTrip(day)!;
    const kept = loaded.day;
    // Both answer calls the same way as they go on.
    run(day, (d) => d.time > day.time + 90);
    run(kept, (d) => d.time >= day.time - 1e-9, NO_CONTROLS, true, 4 * 3600, loaded.plan);
    expect(kept).toEqual(day);
    expect(describeDay(kept, plan)).toBe(describeDay(day, plan));
    expect(lightAt(kept)).toEqual(lightAt(day));
    expect(logLines(kept.log)).toEqual(logLines(day.log));
  });

  it.each(MOMENTS)('comes back to the same weather, worked out again rather than kept: %s', (_, day) => {
    const weather = planWeather(HALLAM.seed, day.number);
    const kept = roundTrip(day)!.day;
    expect(planWeather(HALLAM.seed, kept.number)).toEqual(weather);
    expect(weatherAt(kept, weather)).toEqual(weatherAt(day, weather));
    expect(saveGame(keep(day)).replace(JSON.stringify(HALLAM), '')).not.toMatch(/weather|mist|drizzle|cloud|duck|swan|sheep|wake/i);
  });

  it('keeps a new day as a new day', () => {
    const day = newDay(plan, { other: 'down' });
    expect(roundTrip(day)!.day).toEqual(day);
  });

  it('is plain text, small enough for browser storage', () => {
    const text = saveGame(keep(MOMENTS[MOMENTS.length - 1][1]));
    expect(JSON.parse(text).version).toBe(SAVE_VERSION);
    expect(text.length).toBeLessThan(8000);
  });
});

describe('keeping your place on a canal made from its number', () => {
  const made = makeCanal(318).data;
  const canal: Canal = { number: 318, data: made };
  const madePlan = planDay(resolveStretch(made));
  const day = newDay(madePlan, { other: 'down', number: 3, crewed: true });
  run(day, (d) => d.phase === 'night', NO_CONTROLS, true, 4 * 3600, madePlan);
  const text = saveGame({ canal, day, pages: [], other: 'down', bell: true });

  it('keeps the canal number, the whole stretch and the day, and reads them back', () => {
    const kept = loadGame(text)!;
    expect(kept.canal.number).toBe(318);
    expect(kept.canal.data).toEqual(made);
    expect(kept.day).toEqual(day);
    expect(kept.day.number).toBe(3);
    expect(kept.day.phase).toBe('night');
    expect(kept.day.spot).toBe(kept.day.plan.spots[1]);
    expect(kept.other).toBe('down');
    expect(kept.bell).toBe(true);
    expect(JSON.parse(text).stretch).toEqual(made);
    // The whole stretch, and still small enough for browser storage.
    expect(text.length).toBeLessThan(16000);
  });

  it('plays its kept stretch, not one made again from the number, so a change to how canals are made never moves the map under the boat', () => {
    const s = JSON.parse(text);
    s.stretch.name = 'The Kept Canal at Wendle';
    s.stretch.features.find((f: { kind: string }) => f.kind === 'bridge').name = 'Kept Bridge';
    const kept = loadGame(JSON.stringify(s))!;
    expect(kept.canal.data.name).toBe('The Kept Canal at Wendle');
    expect(kept.stretch.data.features.some((f) => f.name === 'Kept Bridge')).toBe(true);
    expect(kept.canal.number).toBe(318);
  });

  it('carries on to the next morning as it would have', () => {
    const loaded = loadGame(text)!;
    run(day, (d) => d.phase === 'over', NO_CONTROLS, true, 4 * 3600, madePlan);
    run(loaded.day, (d) => d.phase === 'over', NO_CONTROLS, true, 4 * 3600, loaded.plan);
    expect(loaded.day.phase).toBe('over');
    expect(loaded.day).toEqual(day);
  });
});

describe('the pages of the earlier days in the logbook', () => {
  const over = MOMENTS[MOMENTS.length - 1][1];
  const pages: DayPage[] = [1, 2, 3].map((number) => ({ ...dayPage(HALLAM_CANAL, { ...over, number }), name: `The Hallam Canal at Wendle, day ${number}`, seed: HALLAM.seed + number }));
  const kept: Kept = { ...keep(newDay(plan, { other: 'down', number: 4 })), pages };

  it('are kept, each only its page and seed line, without its map, and read back', () => {
    expect(over.log.written).toBe(true);
    const text = saveGame(kept);
    const loaded = loadGame(text)!;
    expect(loaded.pages).toEqual(pages);
    for (const page of loaded.pages) expect(logLines(page.log)).toEqual(logLines(over.log));
    expect(loaded.day).toEqual(kept.day);
    for (const page of JSON.parse(text).pages) expect(Object.keys(page).sort()).toEqual(['entries', 'name', 'number', 'seed', 'waited']);
    expect(text.length - saveGame(keep(kept.day)).length).toBeLessThan(pages.length * 1500);
  });

  it('keep the latest year of days', () => {
    const many = Array.from({ length: MAX_PAGES + 20 }, (_, i) => ({ ...pages[0], number: i + 1 }));
    const loaded = loadGame(saveGame({ ...kept, pages: many }))!;
    expect(loaded.pages).toHaveLength(MAX_PAGES);
    expect(loaded.pages[0].number).toBe(21);
  });

  it('are none on a day kept before each day had its page, which reads back otherwise just as it was', () => {
    const old = JSON.parse(saveGame(kept));
    delete old.pages;
    const loaded = loadGame(JSON.stringify({ ...old, version: NUMBERS_SAVE_VERSION }))!;
    expect(loaded.pages).toEqual([]);
    expect(loaded.canal).toEqual(HALLAM_CANAL);
    expect(loaded.day).toEqual(kept.day);
  });

  it('set the kept place aside when one is missing or makes no sense', () => {
    const good = JSON.parse(saveGame(kept));
    const edits: ((s: typeof good) => void)[] = [
      (s) => delete s.pages,
      (s) => (s.pages = {}),
      (s) => (s.pages = Array.from({ length: MAX_PAGES + 1 }, () => s.pages[0])),
      (s) => (s.pages[0] = null),
      (s) => (s.pages[0].number = 0),
      (s) => (s.pages[1].seed = -1),
      (s) => (s.pages[1].seed = 2 ** 32),
      (s) => delete s.pages[2].name,
      (s) => (s.pages[0].entries = [{ kind: 'picnic', at: 3 }]),
      (s) => (s.pages[0].waited = { 'tea:brook-lock': 5 }),
    ];
    for (const edit of edits) {
      const s = structuredClone(good);
      edit(s);
      expect(loadGame(JSON.stringify(s)), edit.toString()).toBeNull();
    }
  });
});

describe('a kept place from an older version', () => {
  it.each(MOMENTS)('is set aside, so the boat never starts where its places have moved: %s', (_, day) => {
    for (const version of [1, 2]) {
      const old = { ...JSON.parse(beforeNumbers(day)), version };
      expect(loadGame(JSON.stringify(old))).toBeNull();
    }
  });

  it('is set aside when it was on a canal made from ?seed=, or the Hallam Canal with another seed', () => {
    const old = JSON.parse(beforeNumbers(MOMENTS[2][1]));
    expect(loadGame(JSON.stringify({ ...old, stretch: 'made-318', seed: 318 }))).toBeNull();
    expect(loadGame(JSON.stringify({ ...old, seed: HALLAM.seed + 1 }))).toBeNull();
    expect(loadGame(JSON.stringify({ ...old, version: SAVE_VERSION }))).toBeNull();
  });
});

describe('a day on the Hallam Canal kept before canals had numbers', () => {
  it.each(MOMENTS)('reads back on the Hallam Canal, exactly as it was: %s', (_, day) => {
    const kept = loadGame(beforeNumbers(day))!;
    expect(kept).not.toBeNull();
    expect(kept.canal).toEqual(HALLAM_CANAL);
    expect(kept.day).toEqual(day);
    expect(kept.plan.ways).toContain(kept.day.plan);
  });

  it.each(MOMENTS)('finishes its day, and is kept the new way from then on: %s', (_, day) => {
    const loaded = loadGame(beforeNumbers(day))!;
    finish(loaded.day, loaded.plan);
    expect(loaded.day.phase).toBe('over');
    expect(loaded.day.log.written).toBe(true);
    const text = saveGame(loaded);
    expect(JSON.parse(text).version).toBe(SAVE_VERSION);
    expect(loadGame(text)!.day).toEqual(loaded.day);
  });
});

describe('a kept place that is stale or broken', () => {
  const day = MOMENTS[2][1];
  const good = JSON.parse(saveGame(keep(day)));

  it('is set aside when there is none', () => {
    expect(loadGame(null)).toBeNull();
    expect(loadGame('')).toBeNull();
  });

  it('is set aside when it is from another version', () => {
    for (const version of [0, HALLAM_SAVE_VERSION, SAVE_VERSION + 1, String(SAVE_VERSION), undefined, null]) {
      expect(loadGame(JSON.stringify({ ...good, version }))).toBeNull();
    }
  });

  it('is set aside when it is not what was written', () => {
    const text = saveGame(keep(day));
    for (const broken of ['{', 'null', '[]', '42', '"towpath"', 'undefined', text.slice(0, text.length / 2), `${text}}`, text.replace(/"time":/, '"time":"soon",')]) {
      expect(loadGame(broken)).toBeNull();
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
      (s) => (s.day.calls.answered = ['tea:brook-lock']),
      (s) => (s.day.ways = ['nowhere']),
      (s) => (s.day.ways = ['main']),
      (s) => delete s.day.ways,
      (s) => (s.day.log.waited = { 'picnic:brook-lock': 5 }),
      (s) => (s.day.calls.open = { kind: 'lock' }),
      (s) => (s.day.log.entries = [{ kind: 'picnic', at: 3 }]),
      (s) => (s.day.log.entries[0].from = 4),
      (s) => (s.other = 'sideways'),
      (s) => delete s.bell,
      (s) => (s.canal = -1),
      (s) => (s.canal = 2 ** 32),
      (s) => (s.canal = '318'),
      (s) => delete s.canal,
      (s) => delete s.stretch,
      (s) => (s.stretch = 'hallam'),
      (s) => (s.stretch.waterways = []),
      (s) => (s.stretch.waterways[0].points = [[0, 0]]),
      (s) => (s.stretch.waterways[0].points[3] = [1e9, 0]),
      (s) => (s.stretch.waterways[1].leaves.waterway = 'nowhere'),
      (s) => (s.stretch.size.width = 1e9),
      (s) => (s.stretch.features[2].waterway = 'nowhere'),
      (s) => (s.stretch.features[2].at = 1e6),
      (s) => (s.stretch.features[2].kind = 'aqueduct'),
      (s) => (s.stretch.features[0].road = 'nowhere'),
      (s) => (s.stretch.trip.ways = []),
      (s) => (s.stretch.trip.ways[0].to = 'hollin-bridge'),
      (s) => (s.stretch.trip.from.waterway = 'wendle-arm'),
      (s) => s.stretch.features.splice(4, 1),
    ];
    for (const edit of edits) {
      const s = structuredClone(good);
      edit(s);
      expect(loadGame(JSON.stringify(s)), edit.toString()).toBeNull();
    }
  });

  /** Sets each value in a kept place whose path passes `where`, in turn, to each of a few odd ones, and plays whatever is let through. How many were. */
  function oddlyChanged(kept: Day, where: (path: (string | number)[]) => boolean): number {
    const odd: unknown[] = [null, true, 'x', -1, 0, 0.5, 1e9, {}, [], [1]];
    const base = JSON.parse(saveGame(keep(kept)));
    // Every value in the kept place, by its path.
    const paths: (string | number)[][] = [];
    const walk = (v: unknown, path: (string | number)[]) => {
      if (path.length && where(path)) paths.push(path);
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, Array.isArray(v) ? Number(k) : k]);
    };
    walk(base, []);
    expect(paths.length).toBeGreaterThan(80);
    let loaded = 0;
    for (const path of paths) {
      for (const value of odd) {
        const s = structuredClone(base);
        let at = s;
        for (const k of path.slice(0, -1)) at = at[k];
        at[path[path.length - 1]] = value;
        const back = loadGame(JSON.stringify(s));
        if (!back) continue;
        loaded++;
        // Whatever it lets through still plays.
        for (let i = 0; i < 60; i++) stepDay(back.day, back.plan, NO_CONTROLS, STEP);
        lightAt(back.day);
        describeDay(back.day, back.plan);
        logLines(back.day.log);
      }
    }
    return loaded;
  }

  it.each([MOMENTS[2], MOMENTS[MOMENTS.length - 1]])('never stops the game, whatever is changed in it: %s', (_, kept) => {
    expect(oddlyChanged(kept, (path) => path[0] !== 'stretch')).toBeGreaterThan(0);
  }, 60_000);

  it('never stops the game, whatever is changed in its stretch', () => {
    expect(oddlyChanged(MOMENTS[2][1], (path) => path[0] === 'stretch')).toBeGreaterThan(0);
  }, 60_000);
});
