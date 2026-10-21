import { describe, expect, it } from 'vitest';
import { poseAt } from '../src/core/track';
import { EVENING_TIME, NIGHT_TIME, castOffDay, chooseSpot, chooseWay, eveningBegan, newDay, planDay, stepDay } from '../src/sim/day';
import { NO_CONTROLS } from '../src/sim/trip';
import { JOG_SPEED, WALKERS, WALK_SPEED, dogAt, planWalkers, walkerAt } from '../src/sim/walkers';
import type { Walker } from '../src/sim/walkers';
import { TOWPATH_OFFSET } from '../src/world/dimensions';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';
import { towpathRuns } from '../src/world/towpath';

const stretch = resolveStretch(HALLAM);
const runs = towpathRuns(stretch);
const walkers = planWalkers(runs, HALLAM.seed);
/** Half the towpath's width. */
const HALF_PATH = 5.5;

/** Samples a walker through a stretch of time. */
function sample(w: Walker, from: number, to: number, homeFrom: number | null = null, step = 0.5) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ t, at: walkerAt(w, t, homeFrom) });
  return out;
}

describe('the towpath', () => {
  it('runs along the first way and on along the main line past the junction', () => {
    expect(runs).toHaveLength(2);
    const [arm, main] = runs;
    expect(arm.track).toBe(stretch.ways[0].route);
    // Stops short of the basin, where the pub garden meets the water.
    expect(arm.to).toBeLessThan(stretch.ways[0].end);
    expect(main.track).toBe(stretch.waterways.get('hallam'));
    expect(main.to).toBe(main.track.length);
  });

  it('has a way on and off at each end and at every bridge that crosses it', () => {
    const [arm, main] = runs;
    // Both ends, Hollin Bridge, Mill Bridge and the footbridge over the arm.
    expect(arm.exits).toHaveLength(5);
    expect(main.exits).toEqual([main.from, main.to]);
    for (const run of runs) expect([...run.exits].sort((a, b) => a - b)).toEqual(run.exits);
    const hollin = poseAt(arm.track, arm.exits[1]);
    expect(Math.hypot(hollin.x - 980, hollin.y - 2282)).toBeLessThan(120);
  });
});

describe('people on the towpath', () => {
  it('are the same every day for the same seed, and a mix of walkers, dogs and joggers', () => {
    expect(planWalkers(runs, HALLAM.seed)).toEqual(walkers);
    expect(planWalkers(runs, HALLAM.seed + 1)).not.toEqual(walkers);
    expect(walkers).toHaveLength(WALKERS);
    expect(walkers.filter((w) => w.kind === 'jogger').length).toBeGreaterThanOrEqual(2);
    expect(walkers.filter((w) => w.kind === 'walker').length).toBeGreaterThanOrEqual(8);
    expect(walkers.filter((w) => w.dog).length).toBeGreaterThanOrEqual(3);
    expect(walkers.some((w) => w.kind === 'jogger' && w.dog)).toBe(false);
    expect(new Set(walkers.map((w) => w.run)).size).toBe(runs.length);
  });

  it('come onto the towpath and leave it at its ways on and off', () => {
    for (const w of walkers) expect(runs[w.run].exits).toContain(w.home);
  });

  it('are out on the towpath when the day begins, and come and go through it', () => {
    expect(walkers.filter((w) => walkerAt(w, 0, null)).length).toBeGreaterThanOrEqual(WALKERS / 3);
    for (const w of walkers) {
      const seen = sample(w, 0, 1200);
      expect(seen.some((x) => x.at)).toBe(true);
      expect(seen.some((x) => !x.at)).toBe(true);
    }
  });

  it('stay on their run of towpath, at a walking or jogging pace', () => {
    for (const w of walkers) {
      const run = runs[w.run];
      const pace = w.kind === 'jogger' ? JOG_SPEED : WALK_SPEED;
      expect(w.speed).toBeGreaterThan(pace * 0.85);
      expect(w.speed).toBeLessThan(pace * 1.15);
      let last: { t: number; s: number } | null = null;
      for (const { t, at } of sample(w, 0, 900)) {
        if (!at) {
          last = null;
          continue;
        }
        expect(at.s).toBeGreaterThanOrEqual(run.from);
        expect(at.s).toBeLessThanOrEqual(run.to);
        expect(Math.abs(at.d - TOWPATH_OFFSET)).toBeLessThan(HALF_PATH);
        if (last) expect(Math.abs(at.s - last.s)).toBeLessThanOrEqual(w.speed * (t - last.t) + 1e-6);
        last = { t, s: at.s };
      }
    }
  });

  it('go out a way, turn, and come back, facing the way they walk', () => {
    const w = walkers[0];
    const seen = sample(w, 0, 2000).filter((x) => x.at);
    for (let i = 1; i < seen.length; i++) {
      const [a, b] = [seen[i - 1].at!, seen[i].at!];
      const moved = b.s - a.s;
      if (Math.abs(moved) > 0.5 && seen[i].t - seen[i - 1].t < 1) expect(Math.sign(moved)).toBe(b.facing);
    }
    expect(new Set(seen.map((x) => x.at!.facing)).size).toBe(2);
  });

  it('keep left as they pass each other', () => {
    for (const w of walkers) {
      for (const { at } of sample(w, 0, 600, null, 3)) {
        if (!at) continue;
        if (at.facing > 0) expect(at.d).toBeLessThan(TOWPATH_OFFSET);
        else expect(at.d).toBeGreaterThan(TOWPATH_OFFSET);
      }
    }
  });

  it('walk their dogs close by, on the towpath', () => {
    for (const w of walkers.filter((x) => x.dog)) {
      for (const { t, at } of sample(w, 0, 600, null, 1.5)) {
        if (!at) continue;
        const dog = dogAt(w, at, t);
        expect(Math.abs(dog.s - at.s)).toBeLessThanOrEqual(18);
        expect(Math.abs(dog.d - TOWPATH_OFFSET)).toBeLessThan(HALF_PATH);
        // Close to heel where they step off.
        if (at.fromHome < 5) expect(Math.abs(dog.s - at.s)).toBeLessThan(3);
      }
    }
  });

  it('head home in the evening, and are all gone before the night is out', () => {
    const evening = 700;
    const out = walkers.filter((w) => walkerAt(w, evening, evening));
    expect(out.length).toBeGreaterThan(0);
    for (const w of walkers) {
      const before = walkerAt(w, evening, evening);
      let last = before?.fromHome ?? 0;
      for (const { at } of sample(w, evening + 0.5, evening + EVENING_TIME + NIGHT_TIME, evening)) {
        // Nobody new comes out, and everyone out walks towards home.
        if (!before) expect(at).toBeNull();
        if (!at) {
          last = 0;
          continue;
        }
        expect(at.facing).toBe(w.dir === 1 ? -1 : 1);
        expect(at.fromHome).toBeLessThanOrEqual(last + 1e-9);
        last = at.fromHome;
      }
      expect(walkerAt(w, evening + EVENING_TIME + NIGHT_TIME, evening)).toBeNull();
    }
  });

  it('know from the day when the evening began, through the night and dawn', () => {
    const plan = planDay(stretch);
    const day = newDay(plan, { other: 'down', crewed: true });
    let began: number | null = null;
    while (day.phase !== 'over' && day.time < 4 * 3600) {
      for (const e of stepDay(day, plan, NO_CONTROLS, 0.25)) {
        if (e.kind === 'call' && !e.again && e.call === 'cast-off') castOffDay(day);
        if (e.kind === 'call' && !e.again && e.call === 'junction') chooseWay(day, plan, 'arm');
        if (e.kind === 'call' && !e.again && e.call === 'dusk') chooseSpot(day, 0);
        if (e.kind === 'phase' && e.phase === 'evening') began = day.time;
      }
      if (began === null) expect(eveningBegan(day)).toBeNull();
      else expect(eveningBegan(day)).toBeCloseTo(began, 0);
    }
    expect(day.phase).toBe('over');
    expect(began).not.toBeNull();
  });
});
