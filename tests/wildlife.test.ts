import { describe, expect, it } from 'vitest';
import { distanceTo, poseAt } from '../src/core/track';
import { paintScenery } from '../src/render/scenery';
import { RISE_LIFE, birdAt, grazeAt, planFlocks, planRises, quietReaches, riseAt } from '../src/sim/wildlife';
import { CANAL_WIDTH } from '../src/world/dimensions';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const canals = [...stretch.waterways.values()];
const flocks = planFlocks(stretch, HALLAM.seed);
const rises = planRises(stretch, HALLAM.seed);

/** How far a point is along its waterway from every lock, bridge, moorings and basin on it. */
function clearOfFeatures(waterway: string, s: number): number {
  let least = Infinity;
  for (const f of stretch.data.features) if (f.waterway === waterway) least = Math.min(least, Math.abs(f.at - s));
  return least;
}

describe('the quiet water', () => {
  it('keeps clear of locks, bridges, moored boats and the moorings for the night', () => {
    const reaches = quietReaches(stretch);
    expect(reaches.length).toBeGreaterThan(3);
    for (const reach of reaches) {
      for (const f of stretch.data.features) {
        if (f.waterway !== reach.waterway || f.kind === 'moorings' || f.kind === 'bank') continue;
        expect(f.at < reach.from || f.at > reach.to).toBe(true);
      }
    }
  });
});

describe('fish rising', () => {
  it('are in the same places for the same seed', () => {
    expect(planRises(stretch, HALLAM.seed)).toEqual(rises);
    expect(planRises(stretch, HALLAM.seed + 1)).not.toEqual(rises);
    expect(rises.length).toBeGreaterThan(20);
  });

  it('rise on open water, away from the bank and the locks', () => {
    for (const rise of rises) {
      expect(Math.abs(rise.d)).toBeLessThan(CANAL_WIDTH / 2 - 4);
      expect(clearOfFeatures(rise.waterway, rise.s)).toBeGreaterThan(50);
    }
  });

  it('rise now and then, each ring lasting a few seconds', () => {
    const rise = rises[0];
    let rising = 0;
    for (let t = 0; t < 600; t += 0.1) {
      const age = riseAt(rise, t);
      if (age === null) continue;
      rising++;
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(RISE_LIFE);
    }
    // A ring for a few seconds out of every half minute or so.
    expect(rising / 6000).toBeGreaterThan(0.03);
    expect(rising / 6000).toBeLessThan(0.15);
    expect(riseAt(rise, 123.4)).toBe(riseAt(rise, 123.4));
  });
});

describe('ducks and swans', () => {
  it('are the same families in the same places for the same seed', () => {
    expect(planFlocks(stretch, HALLAM.seed)).toEqual(flocks);
    const kinds = flocks.flatMap((f) => f.birds.map((b) => b.kind));
    expect(kinds).toContain('swan');
    expect(kinds).toContain('duckling');
    expect(kinds).toContain('drake');
  });

  it('stay on the water through the day, and swim slowly', () => {
    for (const flock of flocks) {
      for (const { lag } of flock.birds) {
        let last = birdAt(stretch, flock, lag, 0, []);
        for (let t = 1; t < 900; t += 1) {
          const now = birdAt(stretch, flock, lag, t, []);
          expect(Math.min(...canals.map((c) => distanceTo(c, [now.x, now.y])))).toBeLessThan(CANAL_WIDTH / 2);
          expect(Math.hypot(now.x - last.x, now.y - last.y)).toBeLessThan(2.5);
          last = now;
        }
      }
    }
  });

  it('ease over to the far bank as a boat comes by, and back once it has gone', () => {
    const flock = flocks[0];
    const track = stretch.waterways.get(flock.waterway)!;
    const bank = (boats: readonly (readonly [number, number])[]) => {
      const at = birdAt(stretch, flock, 0, 100, boats);
      // How far left of the waterway's middle: the far side from the towpath.
      const middle = poseAt(track, flock.s);
      return -((at.x - middle.x) * middle.nx + (at.y - middle.y) * middle.ny);
    };
    const alone = bank([]);
    const loose = birdAt(stretch, flock, 0, 100, []);
    const passing = bank([[loose.x, loose.y]]);
    expect(passing).toBeGreaterThan(alone + 3);
    expect(passing).toBeLessThan(CANAL_WIDTH / 2);
    expect(bank([[loose.x + 500, loose.y]])).toBeCloseTo(alone, 5);
  });
});

describe('sheep and cows', () => {
  const { herds } = paintScenery(stretch);

  it('graze the same meadows for the same seed', () => {
    expect(paintScenery(stretch).herds).toEqual(herds);
    expect(herds.some((h) => h.kind === 'sheep')).toBe(true);
    expect(herds.some((h) => h.kind === 'cow')).toBe(true);
  });

  it('keep well away from the canal and inside the world', () => {
    for (const herd of herds) {
      for (const a of herd.animals) {
        expect(Math.min(...canals.map((c) => distanceTo(c, [a.x, a.y])))).toBeGreaterThan(60);
        expect(a.x).toBeGreaterThan(0);
        expect(a.x).toBeLessThan(HALLAM.size.width);
        expect(a.y).toBeGreaterThan(0);
        expect(a.y).toBeLessThan(HALLAM.size.height);
      }
    }
  });

  it('wander only a few steps from where they graze', () => {
    const a = herds[0].animals[0];
    for (let t = 0; t < 2000; t += 7) {
      const now = grazeAt(a, t);
      expect(Math.hypot(now.x - a.x, now.y - a.y)).toBeLessThan(7);
    }
    expect(grazeAt(a, 321)).toEqual(grazeAt(a, 321));
  });
});
