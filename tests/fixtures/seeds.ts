// A run of seeds in a test, each making a canal: every one must end in a
// playable day, a canal that plays or, for the rare seed with no try that
// plays, the Hallam Canal. The first 1,000 seeds are tested a quarter at a
// time, in files of their own, so the quarters run side by side.

import { describe, expect, it } from 'vitest';
import { dayProblems, makeCanal } from '../../src/sim/playable';
import type { MadeCanal } from '../../src/sim/playable';
import { dayShape } from '../../src/world/generate';
import { HALLAM } from '../../src/world/hallam';

/** Long enough to make a few hundred canals on a slow machine. */
const SEEDS_TIMEOUT = 300_000;
/** How many seeds in a run may fall back to the Hallam Canal. */
const MOST_FALLING_BACK = 3;

export function seedsPlay(from: number, to: number): void {
  describe(`canals made from seeds ${from} to ${to}`, () => {
    it('each end in a playable day, with the shape the seed asks for, and seldom fall back to the Hallam Canal', () => {
      const made: (MadeCanal & { seed: number })[] = [];
      for (let seed = from; seed <= to; seed++) made.push({ seed, ...makeCanal(seed) });
      for (const m of made) {
        if (m.fellBack) {
          expect(m.data).toBe(HALLAM);
          continue;
        }
        const shape = dayShape(m.seed);
        expect(m.data.seed).toBe(m.seed);
        expect(new Set(m.data.waterways.flatMap((w) => (w.leaves ? [w.leaves.junction] : []))).size, `seed ${m.seed}`).toBe(shape.junctions.length);
        expect(m.data.trip.ways, `seed ${m.seed}`).toHaveLength(1 + shape.junctions.length + shape.junctions.filter(Boolean).length);
        const locks = m.data.features.filter((f) => f.kind === 'lock').length;
        expect(locks, `seed ${m.seed}`).toBeGreaterThanOrEqual(shape.locks);
        expect(locks, `seed ${m.seed}`).toBeLessThanOrEqual(shape.locks + m.data.trip.ways.length);
      }
      // Each canal was checked as it was made; check every tenth again, from scratch.
      for (const m of made.filter((x) => x.seed % 10 === 0)) expect(dayProblems(m.data), `seed ${m.seed}`).toEqual([]);
      expect(made.filter((m) => m.fellBack).length).toBeLessThanOrEqual(MOST_FALLING_BACK);

      // And between them, every kind of day the board picked.
      const canals = made.filter((m) => !m.fellBack).map((m) => m.data);
      const abouts = canals.flatMap((d) => d.features.flatMap((f) => (f.id.startsWith('end-') && (f.kind === 'bank' || f.kind === 'basin') ? [f.about] : [])));
      for (const kind of [/^by The /, /^at the old wharf/, /^a quiet bank/, /^in /, /^outside /, /^below the lock/]) expect(abouts.some((a) => kind.test(a)), String(kind)).toBe(true);
      expect(canals.some((d) => d.waterways.some((w) => w.leaves && w.name.endsWith('Canal')))).toBe(true);
      expect(canals.some((d) => d.trip.ways.length >= 5)).toBe(true);
      expect(canals.some((d) => d.trip.ways.length === 1)).toBe(true);
    }, SEEDS_TIMEOUT);
  });
}
