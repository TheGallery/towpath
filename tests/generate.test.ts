import { describe, expect, it } from 'vitest';
import { poseAt } from '../src/core/track';
import { seededRandom } from '../src/core/math';
import { callKey } from '../src/sim/calls';
import { castOffDay, chooseSpot, chooseWay, newDay, planDay, stepDay } from '../src/sim/day';
import { dayProblems, makeCanal } from '../src/sim/playable';
import { NO_CONTROLS } from '../src/sim/trip';
import { BOAT_BEAM } from '../src/world/dimensions';
import { JUNCTION_ODDS, LOCK_ODDS, MADE_SIZE, NoRoom, THREE_WAY, crossingProblems, dayShape, generateStretch } from '../src/world/generate';
import { HALLAM } from '../src/world/hallam';
import { BLOCKED, fitName, namer } from '../src/world/names';
import { checkStretch, resolveStretch } from '../src/world/stretch';
import type { StretchData } from '../src/world/stretch';
import { FORKS } from './fixtures/forks';
import { byHand } from './fixtures/hands';

/** The first try of a seed that has room for everything. */
function firstLaidOut(seed: number): StretchData {
  for (let attempt = 0; ; attempt++) {
    try {
      return generateStretch(seed, attempt);
    } catch (e) {
      if (!(e instanceof NoRoom)) throw e;
    }
  }
}

describe('names made from parts', () => {
  it('never contain anything on the blocklist', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const names = namer(seededRandom(seed));
      for (let i = 0; i < 40; i++) {
        const name = names.place();
        expect(fitName(name), name).toBe(true);
        for (const blocked of BLOCKED) expect(name.toLowerCase()).not.toContain(blocked);
      }
    }
  });

  it('turns away a name with a blocked word in it, however it is written', () => {
    expect(fitName('Shitbury')).toBe(false);
    expect(fitName('Ashcock')).toBe(false);
    expect(fitName('Ashbury')).toBe(true);
  });

  it('uses each name once on a canal', () => {
    const names = namer(seededRandom(9));
    const places = Array.from({ length: 30 }, () => names.place());
    expect(new Set(places).size).toBe(places.length);
  });

  it('shares a letter where the parts meet on it, but for an l', () => {
    const names = Array.from({ length: 2000 }, (_, i) => namer(seededRandom(i)).place());
    expect(names.some((n) => /(.)\1\1/i.test(n))).toBe(false);
    expect(names).not.toContain('Heathham');
  });
});

describe("a day's shape", () => {
  const shapes = Array.from({ length: 20_000 }, (_, i) => dayShape(i + 1));
  const share = (count: number) => (100 * count) / shapes.length;

  it('is the same every time for a seed', () => {
    expect(dayShape(318)).toEqual(dayShape(318));
  });

  it('has none to three junctions, at the odds on the board', () => {
    for (const [count, odds] of JUNCTION_ODDS) expect(share(shapes.filter((s) => s.junctions.length === count).length)).toBeCloseTo(odds, -0.3);
  });

  it('sends branches both ways at about a third of junctions', () => {
    const junctions = shapes.flatMap((s) => s.junctions);
    expect(share((junctions.filter(Boolean).length * shapes.length) / junctions.length)).toBeCloseTo(THREE_WAY * 100, -0.3);
  });

  it('has none to four locks, besides any above a mooring, at the odds on the board', () => {
    for (const [count, odds] of LOCK_ODDS) expect(share(shapes.filter((s) => s.locks === count).length)).toBeCloseTo(odds, -0.3);
  });

  it('ends each way at one of six kinds of mooring, the main line always at a bank', () => {
    const ends = new Set(shapes.flatMap((s) => s.ends.slice(1)));
    expect([...ends].sort()).toEqual(['lock-moorings', 'pub-bank', 'pub-basin', 'quiet-bank', 'village', 'wharf']);
    expect(shapes.every((s) => s.ends[0] !== 'pub-basin' && s.ends[0] !== 'wharf')).toBe(true);
  });
});

describe('a canal laid out from a seed', () => {
  const data = firstLaidOut(318);

  it('is the same every time for the same seed and try', () => {
    expect(firstLaidOut(318)).toEqual(data);
    expect(firstLaidOut(319)).not.toEqual(data);
  });

  it('keeps the seed for its scenery and life, and its own size of world', () => {
    expect(data.seed).toBe(318);
    expect(data.id).toBe('made-318');
    expect(data.size).toEqual(MADE_SIZE);
  });

  it('has the junctions and branches its shape asks for, each with a way ending at a mooring', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const made = firstLaidOut(seed);
      const shape = dayShape(seed);
      const junctions = new Set(made.waterways.flatMap((w) => (w.leaves ? [w.leaves.junction] : [])));
      expect(junctions.size).toBe(shape.junctions.length);
      expect(made.trip.ways).toHaveLength(1 + shape.junctions.length + shape.junctions.filter(Boolean).length);
      for (const way of made.trip.ways) expect(made.features.find((f) => f.id === way.to)?.kind).toMatch(/^(bank|basin)$/);
    }
  });

  it('builds every lock on a straight reach, so a boat lined up with the canal fits between its walls', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const stretch = resolveStretch(firstLaidOut(seed));
      for (const f of stretch.data.features) {
        if (f.kind !== 'lock') continue;
        const canal = stretch.waterways.get(f.waterway);
        if (!canal) throw new Error(f.waterway);
        const c = poseAt(canal, f.at);
        for (let x = -260; x <= 260; x += 10) {
          const p = poseAt(canal, f.at + x);
          expect(Math.abs((p.x - c.x) * c.nx + (p.y - c.y) * c.ny), `${f.id} on canal ${seed}`).toBeLessThan((18 - BOAT_BEAM) / 2);
        }
      }
    }
  });
});

describe('the rules for crossings', () => {
  it('are kept on the Hallam Canal and the test stretch', () => {
    expect(crossingProblems(resolveStretch(HALLAM))).toEqual([]);
    expect(crossingProblems(resolveStretch(FORKS))).toEqual([]);
  });

  it('notice a road that crosses a canal without a bridge', () => {
    const data: StretchData = { ...HALLAM, features: HALLAM.features.filter((f) => f.id !== 'mill-bridge') };
    expect(checkStretch(data)).toEqual([]);
    expect(crossingProblems(resolveStretch(data))).toEqual(['mill-road crosses a canal without a bridge']);
  });

  it('notice a towpath that ends in the open', () => {
    const data: StretchData = { ...FORKS, waterways: FORKS.waterways.map((w) => (w.id === 'kent' ? { ...w, points: [...w.points.slice(0, 4), [3020, 200]] } : w)) };
    expect(crossingProblems(resolveStretch(data))).toEqual([expect.stringMatching(/^a towpath ends in the open at /)]);
  });
});

describe('making a canal that plays', () => {
  it('gives the same canal for the same seed', () => {
    expect(makeCanal(318).data).toEqual(makeCanal(318).data);
  });

  it('keeps only a try that plays: sound, with its crossings kept, and a whole day down every way', () => {
    const made = makeCanal(318);
    expect(made.fellBack).toBe(false);
    expect(dayProblems(made.data)).toEqual([]);
    expect(made.thrownAway).toHaveLength(made.tries - 1);
  });

  it('plays by hand, down the way with the most locks, calling you to each lock and junction and on to the next morning', () => {
    const plan = planDay(resolveStretch(makeCanal(318).data));
    const way = [...plan.ways].sort((a, b) => b.locks.filter((l) => l.s < b.end).length - a.locks.filter((l) => l.s < a.end).length)[0];
    const day = newDay(plan, { other: 'up' });
    const you = byHand(1 / 30);
    const rang: string[] = [];
    while (day.phase !== 'over' && day.time < 3 * 3600) {
      stepDay(day, plan, NO_CONTROLS, 1 / 30);
      const open = day.calls.open;
      if (open && rang.at(-1) !== callKey(open.kind, open.place)) rang.push(callKey(open.kind, open.place));
      you(day);
      if (open?.kind === 'cast-off') castOffDay(day);
      if (open?.kind === 'junction') chooseWay(day, plan, way.way);
      if (open?.kind === 'dusk') chooseSpot(day, 0);
    }
    expect(day.phase).toBe('over');
    expect(day.plan.way).toBe(way.way);
    expect(rang.filter((c) => c.startsWith('lock:'))).toEqual(way.locks.filter((l) => l.s < way.end).map((l) => `lock:${l.id}`));
    expect(rang.filter((c) => c.startsWith('junction:'))).toHaveLength(new Set(way.junctions.map((j) => j.name)).size);
  }, 30_000);

  it('finds the Hallam Canal playable, as a seed that never plays falls back to it', () => {
    expect(dayProblems(HALLAM)).toEqual([]);
  });
});
