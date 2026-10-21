import { describe, expect, it } from 'vitest';
import { distanceTo, nearestDistance, poseAt } from '../src/core/track';
import { BOAT_LENGTH, MOORED_OFFSET } from '../src/world/dimensions';
import { HALLAM } from '../src/world/hallam';
import { checkStretch, resolveStretch, waterwayCurve } from '../src/world/stretch';
import type { StretchData } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const [arm, main] = stretch.ways;
const at = (id: string, way = arm) => {
  const found = way.onRoute.find((f) => f.feature.id === id);
  if (!found) throw new Error(`${id} is not on the route`);
  return found.s;
};

describe('the Hallam stretch', () => {
  it('has no problems', () => {
    expect(checkStretch(HALLAM)).toEqual([]);
  });

  it('meets everything in the order of the trip down the arm', () => {
    expect(arm.onRoute.map((f) => f.feature.id)).toEqual([
      'hollin-bridge',
      'visitor-moorings',
      'brook-lock',
      'mill-bridge',
      'wendle-footbridge',
      'wendle-basin',
    ]);
    expect(stretch.start).toBeLessThan(at('hollin-bridge'));
    expect(arm.junctions.map((j) => [j.name, j.turns])).toEqual([['Wendle Junction', true]]);
    expect(arm.junctions[0].s).toBeGreaterThan(at('mill-bridge'));
    expect(arm.junctions[0].s).toBeLessThan(at('wendle-footbridge'));
  });

  it('goes straight on at the junction along the main line, to a quiet bank', () => {
    expect(main.onRoute.map((f) => f.feature.id)).toEqual(['hollin-bridge', 'visitor-moorings', 'brook-lock', 'mill-bridge', 'coppice-bank']);
    expect(main.junctions.map((j) => [j.name, j.turns])).toEqual([['Wendle Junction', false]]);
    expect(main.mooring.id).toBe('coppice-bank');
    expect(main.end).toBeCloseTo(at('coppice-bank', main), 6);
  });

  it('shares one route between the ways until just before the junction', () => {
    for (let s = 0; s < arm.junctions[0].s - 380; s += 20) {
      const p = poseAt(arm.route, s);
      const q = poseAt(main.route, s);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.01);
    }
    expect(at('brook-lock', main)).toBeCloseTo(at('brook-lock'), 6);
  });

  it('places features on each way where they are on their canal', () => {
    for (const way of stretch.ways) {
      for (const { feature, s } of way.onRoute) {
        const track = stretch.waterways.get(feature.waterway);
        if (!track) throw new Error(feature.waterway);
        const p = poseAt(track, feature.at);
        const q = poseAt(way.route, s);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(5);
      }
    }
  });

  it('turns into the arm smoothly, along the same curve the arm is drawn with', () => {
    const curve = stretch.waterways.get('wendle-arm');
    if (!curve) throw new Error('no arm');
    for (let s = 0; s < curve.length; s += 25) {
      const p = poseAt(curve, s);
      expect(distanceTo(arm.route, [p.x, p.y])).toBeLessThan(4);
    }
  });

  it('ends the way down the arm in the basin, with spots to moor in it', () => {
    const basin = HALLAM.features.find((f) => f.kind === 'basin');
    if (basin?.kind !== 'basin') throw new Error('no basin');
    const { area } = basin;
    const inside = (x: number, y: number) => x > area.x && x < area.x + area.width && y > area.y && y < area.y + area.height;
    const end = poseAt(arm.route, arm.end);
    expect(inside(end.x, end.y)).toBe(true);
    expect(arm.spots.map((s) => s.name)).toEqual(['By the pub garden', 'Along the south wall', 'In the far corner']);
    for (const s of arm.spots) expect(inside(s.x, s.y)).toBe(true);
  });

  it('moors at the bank on the towpath side, ahead of where the boat arrives', () => {
    expect(main.spots).toHaveLength(3);
    for (const spot of main.spots) {
      const s = nearestDistance(main.route, [spot.x, spot.y]);
      const p = poseAt(main.route, s);
      expect(s).toBeGreaterThan(main.end);
      // Right of the centre line, where the towpath is.
      expect((spot.x - p.x) * p.nx + (spot.y - p.y) * p.ny).toBeCloseTo(MOORED_OFFSET, 0);
    }
  });

  it('spaces things out for a day of about a quarter of an hour either way', () => {
    // Long enough to settle into, short enough to try in one sitting.
    for (const way of stretch.ways) {
      expect(way.end - stretch.start).toBeGreaterThan(4000);
      expect(way.end - stretch.start).toBeLessThan(6000);
    }
    expect(Math.abs(arm.end - main.end)).toBeLessThan(150);
    expect(at('brook-lock') - stretch.start).toBeGreaterThan(1500);
  });

  it('stays inside the world', () => {
    for (const track of stretch.waterways.values()) {
      for (let s = 0; s < track.length; s += 50) {
        const p = poseAt(track, s);
        if (p.x < 0 || p.x > HALLAM.size.width) continue; // canals run on off the edge of the map
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(HALLAM.size.height);
      }
    }
    const start = poseAt(arm.route, stretch.start);
    expect(start.x).toBeGreaterThan(0);
    for (const spot of main.spots) expect(spot.x).toBeLessThan(HALLAM.size.width);
  });
});

describe('checkStretch', () => {
  const broken = (change: (d: StretchData) => StretchData) => checkStretch(change(structuredClone(HALLAM) as StretchData));

  it('notices a feature beyond the end of its canal', () => {
    const problems = broken((d) => ({ ...d, features: d.features.map((f) => (f.id === 'brook-lock' ? { ...f, at: 99_999 } : f)) }));
    expect(problems.some((p) => p.includes('brook-lock'))).toBe(true);
  });

  it('notices moored boats on top of each other', () => {
    const problems = broken((d) => ({
      ...d,
      features: d.features.map((f) => (f.kind === 'moorings' ? { ...f, boats: [{ at: 1500, facing: 1, livery: 0 }, { at: 1500 + BOAT_LENGTH / 2, facing: 1, livery: 1 }] } : f)),
    }));
    expect(problems.some((p) => p.includes('overlap'))).toBe(true);
  });

  it('notices a boat moored in the way at a lock', () => {
    const problems = broken((d) => ({
      ...d,
      features: d.features.map((f) => (f.kind === 'moorings' ? { ...f, boats: [{ at: 2336 - 50, facing: 1, livery: 0 }] } : f)),
    }));
    expect(problems.some((p) => p.includes('too close to brook-lock'))).toBe(true);
  });

  it('notices a branch leaving a canal that does not exist', () => {
    const problems = broken((d) => ({ ...d, waterways: d.waterways.map((w) => (w.leaves ? { ...w, leaves: { ...w.leaves, waterway: 'nowhere' } } : w)) }));
    expect(problems.some((p) => p.includes('nowhere'))).toBe(true);
  });

  it('notices a bridge carrying a road that does not exist', () => {
    const problems = broken((d) => ({ ...d, features: d.features.map((f) => (f.kind === 'bridge' ? { ...f, road: 'no-road' } : f)) }));
    expect(problems.some((p) => p.includes('no-road'))).toBe(true);
  });

  it('notices a way that ends somewhere you cannot moor', () => {
    const problems = broken((d) => ({ ...d, trip: { ...d.trip, ways: d.trip.ways.map((w) => ({ ...w, to: 'mill-bridge' })) } }));
    expect(problems.some((p) => p.includes("mill-bridge, which isn't a place to moor"))).toBe(true);
  });

  it('notices spots to moor that overlap, or lie outside the basin', () => {
    const problems = broken((d) => ({
      ...d,
      features: d.features.map((f) => {
        if (f.kind === 'bank') return { ...f, spots: [{ name: 'a', at: 5120 }, { name: 'b', at: 5140 }] };
        if (f.kind === 'basin') return { ...f, spots: [{ name: 'c', at: [100, 100], angle: 0 }] };
        return f;
      }),
    }));
    expect(problems.some((p) => p.includes('two spots at coppice-bank overlap'))).toBe(true);
    expect(problems.some((p) => p.includes('outside the basin'))).toBe(true);
  });

  it('notices a spot to moor on top of a boat already in the basin', () => {
    const problems = broken((d) => ({ ...d, features: d.features.map((f) => (f.kind === 'basin' ? { ...f, spots: [{ name: 'c', at: [3905, 2600], angle: 0 }] } : f)) }));
    expect(problems.some((p) => p.includes('too close to another boat'))).toBe(true);
  });

  it('refuses to resolve a broken stretch', () => {
    const data = structuredClone(HALLAM) as StretchData;
    expect(() => resolveStretch({ ...data, trip: { ...data.trip, ways: [{ id: 'x', route: ['hallam'], to: 'nowhere' }] } })).toThrow(/nowhere/);
  });
});

describe('waterwayCurve', () => {
  it('starts a branch at its junction and shapes it from the point before', () => {
    const arm = HALLAM.waterways[1];
    const curve = waterwayCurve(HALLAM, arm);
    expect(curve.points[0]).toEqual(HALLAM.waterways[0].points[8]);
    expect(curve.before).toEqual(HALLAM.waterways[0].points[7]);
    expect(curve.points.slice(1)).toEqual(arm.points);
  });
});
