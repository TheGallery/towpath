import { describe, expect, it } from 'vitest';
import { distanceTo, nearestDistance, poseAt } from '../src/core/track';
import type { Track } from '../src/core/track';
import { EVENING_TIME, NIGHT_TIME, castOffDay, chooseSpot, chooseWay, eveningBegan, newDay, planDay, stepDay } from '../src/sim/day';
import { NO_CONTROLS } from '../src/sim/trip';
import { JOG_SPEED, WALKERS, WALK_SPEED, dogAt, planWalkers, walkerAt } from '../src/sim/walkers';
import type { Walker } from '../src/sim/walkers';
import { BASIN_CORNER, CANAL_WIDTH, TOWPATH_OFFSET } from '../src/world/dimensions';
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

/** Where a bridge or footbridge meets the towpath's bank, on either side of its canal. */
const feet = (id: string) => {
  const f = HALLAM.features.find((x) => x.id === id);
  const canal = f && stretch.waterways.get(f.waterway);
  if (!canal) throw new Error(id);
  return [poseAt(canal, f.at, TOWPATH_OFFSET), poseAt(canal, f.at, -TOWPATH_OFFSET)];
};
const off = (track: Track, p: { x: number; y: number }) => distanceTo(track, [p.x, p.y]);
const footbridge = feet('wendle-footbridge');
/** Where the first run crosses the footbridge, from the near foot to the far one. */
const deck = footbridge.map((p) => nearestDistance(runs[0].track, [p.x, p.y]));

describe('the towpath', () => {
  it('runs along the first way, over the footbridge by the junction and on along the main line, and on down the arm', () => {
    expect(runs).toHaveLength(2);
    const [main, arm] = runs;
    // Over the footbridge, square across the arm.
    for (const p of footbridge) expect(off(main.track, p)).toBeLessThan(4);
    expect(deck[1] - deck[0]).toBeGreaterThan(2 * TOWPATH_OFFSET - 4);
    expect(deck[1] - deck[0]).toBeLessThan(2 * TOWPATH_OFFSET + 12);
    // On along the main line to the edge of the stretch.
    const hallam = stretch.waterways.get('hallam');
    if (!hallam) throw new Error('hallam');
    const end = poseAt(main.track, main.track.length);
    expect(Math.hypot(end.x - poseAt(hallam, hallam.length, TOWPATH_OFFSET).x, end.y - poseAt(hallam, hallam.length, TOWPATH_OFFSET).y)).toBeLessThan(4);
    // The arm's run starts at the footbridge's foot.
    const start = poseAt(arm.track, 0);
    expect(Math.hypot(start.x - footbridge[0].x, start.y - footbridge[0].y)).toBeLessThan(4);
  });

  it('has a way on and off at each end, where the runs join, and at every bridge that crosses it', () => {
    const [main, arm] = runs;
    // Both ends, Hollin Bridge, Mill Bridge, and the foot of the footbridge, where the arm's run joins.
    expect(main.exits).toHaveLength(5);
    expect(main.exits[3]).toBeCloseTo(deck[0], -1);
    expect(arm.exits).toEqual([0, arm.track.length]);
    for (const run of runs) expect([...run.exits].sort((a, b) => a - b)).toEqual(run.exits);
    const hollin = poseAt(main.track, main.exits[1]);
    expect(Math.hypot(hollin.x - 980, hollin.y - 2282)).toBeLessThan(120);
  });

  it('never ends in the open: each end is at a bridge, a footbridge, the edge of the stretch, or the pub by the basin', () => {
    const ends = HALLAM.features.filter((f) => f.kind === 'bridge' || f.kind === 'footbridge').flatMap((f) => feet(f.id));
    const { width, height } = HALLAM.size;
    for (const run of runs) {
      for (const s of [0, run.track.length]) {
        const p = poseAt(run.track, s);
        const offEdge = p.x < 0 || p.x > width || p.y < 0 || p.y > height;
        const atBridge = ends.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 4);
        const atPub = HALLAM.pubs.some((pub) => Math.hypot(p.x - pub.at[0], p.y - pub.at[1]) < 60);
        expect(offEdge || atBridge || atPub).toBe(true);
      }
    }
  });

  it('keeps to the bank, out of the water but for the footbridge', () => {
    const basin = HALLAM.features.find((f) => f.kind === 'basin');
    if (basin?.kind !== 'basin') throw new Error('no basin');
    const a = basin.area;
    runs.forEach((run, i) => {
      for (let s = 0; s <= run.track.length; s += 5) {
        if (i === 0 && s > deck[0] - 1 && s < deck[1] + 1) continue;
        const p = poseAt(run.track, s);
        for (const canal of stretch.waterways.values()) expect(off(canal, p)).toBeGreaterThan(CANAL_WIDTH / 2 + 4);
        // Out of the basin's water, with its rounded corners.
        const [cx, cy] = [Math.min(Math.max(p.x, a.x + BASIN_CORNER), a.x + a.width - BASIN_CORNER), Math.min(Math.max(p.y, a.y + BASIN_CORNER), a.y + a.height - BASIN_CORNER)];
        expect(Math.hypot(p.x - cx, p.y - cy) - BASIN_CORNER).toBeGreaterThan(4);
      }
    });
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
        expect(at.s).toBeGreaterThanOrEqual(0);
        expect(at.s).toBeLessThanOrEqual(run.track.length);
        expect(Math.abs(at.d)).toBeLessThan(HALF_PATH);
        if (last) expect(Math.abs(at.s - last.s)).toBeLessThanOrEqual(w.speed * (t - last.t) + 1e-6);
        last = { t, s: at.s };
      }
    }
  });

  it('cross the footbridge by the junction and carry on along the far bank', () => {
    const crossers = walkers.filter((w) => {
      if (w.run !== 0) return false;
      const seen = sample(w, 0, 3600, null, 1).flatMap(({ at }) => (at ? [at.s] : []));
      return seen.some((s) => s < deck[0] - 20) && seen.some((s) => s > deck[1] + 20);
    });
    expect(crossers.length).toBeGreaterThan(0);
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
        if (at.facing > 0) expect(at.d).toBeLessThan(0);
        else expect(at.d).toBeGreaterThan(0);
      }
    }
  });

  it('walk their dogs close by, on the towpath', () => {
    for (const w of walkers.filter((x) => x.dog)) {
      for (const { t, at } of sample(w, 0, 600, null, 1.5)) {
        if (!at) continue;
        const dog = dogAt(w, at, t);
        expect(Math.abs(dog.s - at.s)).toBeLessThanOrEqual(18);
        expect(Math.abs(dog.d)).toBeLessThan(HALF_PATH);
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
