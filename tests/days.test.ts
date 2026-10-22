// A new stretch every day: the next day's stretch is made from the canal's
// seed, the day's number and where the boat moored. It starts at that bank or
// basin, with the boats moored there, carries on along the canal the boat was
// on, and plays like any other.

import { describe, expect, it } from 'vitest';
import { poseAt } from '../src/core/track';
import { castOffDay, chooseSpot, chooseWay, needsYou, newDay, planDay, stepDay } from '../src/sim/day';
import type { Day, DayPlan } from '../src/sim/day';
import { dayProblems, makeCanal, makeDay } from '../src/sim/playable';
import type { MadeCanal } from '../src/sim/playable';
import { HALLAM_SAVE_VERSION, loadGame, nextMorning, saveGame } from '../src/sim/save';
import { NO_CONTROLS } from '../src/sim/trip';
import { daySeed, mooredAt } from '../src/world/generate';
import type { StartPlace } from '../src/world/generate';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';
import type { Stretch, StretchData } from '../src/world/stretch';
import { byHand } from './fixtures/hands';

/** Long enough to play a few whole days by hand, and make a few dozen stretches, on a slow machine. */
const DAYS_TIMEOUT = 120_000;

/** Plays a day to the next morning, as you would: casting off, working each lock by hand, going down `way` at each junction, and mooring. */
function finish(day: Day, plan: DayPlan, way: string): void {
  const you = byHand(0.25);
  const end = day.time + 4 * 3600;
  while (day.phase !== 'over' && day.time < end) {
    const need = needsYou(day, plan);
    if (need === 'cast-off') castOffDay(day);
    else if (need === 'way') chooseWay(day, plan, way);
    else if (need === 'spot') chooseSpot(day, 0);
    you(day);
    stepDay(day, plan, NO_CONTROLS, 0.25);
  }
}

/** A whole day played on a stretch, down one of its ways. */
function play(data: StretchData, way: string, number = 1): { stretch: Stretch; plan: DayPlan; day: Day } {
  const stretch = resolveStretch(data);
  const plan = planDay(stretch);
  const day = newDay(plan, { other: 'up', number });
  finish(day, plan, way);
  return { stretch, plan, day };
}

/** The canal the day carries on along: the one it starts on. */
const mainName = (data: StretchData): string | undefined => data.waterways.find((w) => w.id === data.trip.from.waterway)?.name;

/** Checks a day starts at the place the boat moored the day before, along the canal it was on, with the boats and the pub there. */
function startsAt(data: StretchData, from: StartPlace): void {
  expect(data.trip.from.name).toBe(from.name);
  expect(mainName(data)).toBe(from.canal);
  expect(data.name.startsWith(`The ${from.canal} at `)).toBe(true);
  const start = data.features.find((f) => f.id === 'start');
  expect(start?.kind).toBe(from.kind);
  expect(start?.name).toBe(from.name);
  if (start?.kind !== 'basin' && start?.kind !== 'bank') throw new Error('No start place');
  expect(start.about).toBe(from.about);
  const stretch = resolveStretch(data);
  const boat = poseAt(stretch.ways[0].route, stretch.start);
  if (start.kind === 'basin') {
    expect(start.boats.map((b) => b.livery)).toEqual(from.boats.slice(0, 3));
    expect(data.pubs.some((p) => p.name === from.pub)).toBe(from.pub !== null);
    // The boat starts the day on the basin's water.
    const a = start.area;
    expect(boat.x > a.x && boat.x < a.x + a.width && boat.y > a.y && boat.y < a.y + a.height).toBe(true);
  } else {
    // The boat starts the day where it tied up last night.
    expect(start.spots.map((s) => s.at)).toEqual([data.trip.from.at]);
  }
}

describe("a canal's next day", () => {
  const SEED = 318;
  const first = play(makeCanal(SEED).data, makeCanal(SEED).data.trip.ways[0].id);
  const from = mooredAt(first.stretch, first.day.plan.way);
  const day2 = makeDay(SEED, 2, from);

  it('starts where the first day moored', () => {
    expect(first.day.phase).toBe('over');
    expect(from.name).toBe(first.day.plan.endName);
    expect(from.about).toBe(first.day.plan.endAbout);
    startsAt(day2.data, from);
  });

  it('is the same stretch every time, made from the canal, the day and the place, and another for another day or place', () => {
    expect(makeDay(SEED, 2, from)).toEqual(day2);
    expect(day2.data.seed).toBe(daySeed(SEED, 2, from));
    expect(makeDay(SEED, 3, from).data).not.toEqual(day2.data);
    expect(makeDay(SEED + 1, 2, from).data).not.toEqual(day2.data);
    expect(makeDay(SEED, 2, { ...from, name: `${from.name} again` }).data).not.toEqual(day2.data);
  });

  it('plays day 2, then day 3 from where day 2 moored, the same every time', () => {
    expect(day2.fellBack).toBe(false);
    expect(dayProblems(day2.data)).toEqual([]);
    const ways = day2.data.trip.ways;
    const second = play(day2.data, ways[ways.length - 1].id, 2);
    expect(second.day.phase).toBe('over');
    expect(second.day.log.written).toBe(true);
    const from3 = mooredAt(second.stretch, second.day.plan.way);
    const day3 = makeDay(SEED, 3, from3);
    expect(makeDay(SEED, 3, from3)).toEqual(day3);
    expect(day3.fellBack).toBe(false);
    expect(dayProblems(day3.data)).toEqual([]);
    startsAt(day3.data, from3);
    const third = play(day3.data, day3.data.trip.ways[0].id, 3);
    expect(third.day.phase).toBe('over');
  }, DAYS_TIMEOUT);
});

describe('a day starts where the boat moored', () => {
  // A mooring of each kind: a bank, a basin by a pub, and an old wharf with no pub.
  const found = new Map<string, { seed: number; from: StartPlace }>();
  for (let seed = 1; found.size < 3; seed++) {
    const made = makeCanal(seed);
    if (made.fellBack) continue;
    const stretch = resolveStretch(made.data);
    for (const way of made.data.trip.ways) {
      const from = mooredAt(stretch, way.id);
      const kind = from.kind === 'bank' ? 'bank' : from.pub ? 'basin by a pub' : 'wharf';
      if (!found.has(kind)) found.set(kind, { seed, from });
    }
  }

  it.each([...found])('at %s, along the canal it was on, with the boats there', (_, { seed, from }) => {
    const next = makeDay(seed, 2, from);
    expect(next.fellBack).toBe(false);
    startsAt(next.data, from);
    expect(dayProblems(next.data)).toEqual([]);
  });

  it('knows where the boat moored on the Hallam Canal, down either way', () => {
    const stretch = resolveStretch(HALLAM);
    expect(mooredAt(stretch, 'arm')).toEqual({ kind: 'basin', name: 'Wendle Basin', about: 'by The Navigation pub', canal: 'Wendle Arm', boats: [3, 4, 5], pub: 'The Navigation' });
    expect(mooredAt(stretch, 'main')).toEqual({ kind: 'bank', name: 'Coppice Wood bank', about: 'a quiet bank by the wood', canal: 'Hallam Canal', boats: [], pub: null });
  });
});

describe('a finished day on the Hallam Canal', () => {
  const plan = planDay(resolveStretch(HALLAM));

  /** A day on the Hallam Canal as the game kept it before canals had numbers, read back. */
  function keptBeforeNumbers(day: Day): ReturnType<typeof loadGame> {
    const old = JSON.parse(saveGame({ canal: { number: null, data: HALLAM }, day, pages: [], other: 'up', bell: true }));
    delete old.canal;
    delete old.pages;
    return loadGame(JSON.stringify({ ...old, version: HALLAM_SAVE_VERSION, stretch: HALLAM.id, seed: HALLAM.seed }));
  }

  it.each(['arm', 'main'])('kept before canals had numbers, finishes there, then carries on down the %s way into a made day', (way) => {
    const today = newDay(plan, { other: 'down' });
    castOffDay(today);
    for (let i = 0; i < 1200; i++) stepDay(today, plan, NO_CONTROLS, 0.25);
    const loaded = keptBeforeNumbers(today)!;
    expect(loaded.canal).toEqual({ number: null, data: HALLAM });
    finish(loaded.day, loaded.plan, way);
    expect(loaded.day.phase).toBe('over');

    const next = nextMorning(loaded, loaded.stretch, 'up');
    expect(next.canal.number).toBeNull();
    expect(next.canal.data).not.toBe(HALLAM);
    expect(next.canal.data.trip.from.name).toBe(way === 'arm' ? 'Wendle Basin' : 'Coppice Wood bank');
    expect(mainName(next.canal.data)).toBe(way === 'arm' ? 'Wendle Arm' : 'Hallam Canal');
    startsAt(next.canal.data, mooredAt(loaded.stretch, way));
    expect(dayProblems(next.canal.data)).toEqual([]);
    expect(next.day.number).toBe(2);
    expect(next.day.phase).toBe('morning');
    expect(next.pages).toEqual([{ number: 1, name: HALLAM.name, seed: HALLAM.seed, log: { entries: loaded.day.log.entries, waited: loaded.day.log.waited } }]);

    // Kept the new way, it reads back and plays on to the next morning.
    const again = loadGame(saveGame(next))!;
    expect(again.canal).toEqual(next.canal);
    expect(again.day).toEqual(next.day);
    expect(again.pages).toEqual(next.pages);
    finish(again.day, again.plan, again.plan.ways[0].way);
    expect(again.day.phase).toBe('over');
  }, DAYS_TIMEOUT);
});

describe('several days on', () => {
  it('keeps making playable days, each from where the last one moored, and seldom falls back to the Hallam Canal', () => {
    const days: (MadeCanal & { from: StartPlace })[] = [];
    for (let seed = 1; seed <= 16; seed++) {
      let data = makeCanal(seed).data;
      for (let number = 2; number <= 5; number++) {
        // A different way each day, so every kind of mooring comes up.
        const ways = data.trip.ways;
        const from = mooredAt(resolveStretch(data), ways[(seed + number) % ways.length].id);
        const made = makeDay(seed, number, from);
        days.push({ ...made, from });
        data = made.data;
      }
    }
    for (const made of days) {
      // Each was checked as it was made; check them again, from scratch.
      expect(dayProblems(made.data)).toEqual([]);
      if (made.fellBack) expect(made.data).toBe(HALLAM);
      else startsAt(made.data, made.from);
    }
    expect(days.filter((d) => d.fellBack).length).toBeLessThanOrEqual(2);
    expect(new Set(days.map((d) => (d.from.kind === 'bank' ? 'bank' : d.from.pub ? 'basin' : 'wharf')))).toEqual(new Set(['bank', 'basin', 'wharf']));
  }, DAYS_TIMEOUT);
});

