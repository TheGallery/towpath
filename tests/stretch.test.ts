import { describe, expect, it } from 'vitest';
import { distanceTo, poseAt } from '../src/core/track';
import { BOAT_LENGTH } from '../src/world/dimensions';
import { HALLAM } from '../src/world/hallam';
import { checkStretch, resolveStretch, waterwayCurve } from '../src/world/stretch';
import type { StretchData } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const at = (id: string) => {
  const found = stretch.onRoute.find((f) => f.feature.id === id);
  if (!found) throw new Error(`${id} is not on the route`);
  return found.s;
};

describe('the Hallam stretch', () => {
  it('has no problems', () => {
    expect(checkStretch(HALLAM)).toEqual([]);
  });

  it('meets everything in the order of the trip', () => {
    expect(stretch.onRoute.map((f) => f.feature.id)).toEqual([
      'hollin-bridge',
      'visitor-moorings',
      'brook-lock',
      'mill-bridge',
      'wendle-footbridge',
      'wendle-basin',
    ]);
    expect(stretch.start).toBeLessThan(at('hollin-bridge'));
    expect(stretch.junctions.map((j) => j.name)).toEqual(['Wendle Junction']);
    expect(stretch.junctions[0].s).toBeGreaterThan(at('mill-bridge'));
    expect(stretch.junctions[0].s).toBeLessThan(at('wendle-footbridge'));
  });

  it('places features on the route where they are on their canal', () => {
    for (const { feature, s } of stretch.onRoute) {
      const track = stretch.waterways.get(feature.waterway);
      if (!track) throw new Error(feature.waterway);
      const p = poseAt(track, feature.at);
      const q = poseAt(stretch.route, s);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(5);
    }
  });

  it('turns into the arm smoothly, along the same curve the arm is drawn with', () => {
    const arm = stretch.waterways.get('wendle-arm');
    if (!arm) throw new Error('no arm');
    for (let s = 0; s < arm.length; s += 25) {
      const p = poseAt(arm, s);
      expect(distanceTo(stretch.route, [p.x, p.y])).toBeLessThan(4);
    }
  });

  it('ends the trip in the basin', () => {
    const basin = HALLAM.features.find((f) => f.kind === 'basin');
    if (basin?.kind !== 'basin') throw new Error('no basin');
    const end = poseAt(stretch.route, stretch.end);
    const { area } = basin;
    expect(end.x).toBeGreaterThan(area.x);
    expect(end.x).toBeLessThan(area.x + area.width);
    expect(end.y).toBeGreaterThan(area.y);
    expect(end.y).toBeLessThan(area.y + area.height);
  });

  it('spaces things out for a trip of about a quarter of an hour', () => {
    // Long enough to settle into, short enough to try in one sitting.
    expect(stretch.end - stretch.start).toBeGreaterThan(4000);
    expect(stretch.end - stretch.start).toBeLessThan(6000);
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
    const start = poseAt(stretch.route, stretch.start);
    expect(start.x).toBeGreaterThan(0);
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

  it('refuses to resolve a broken stretch', () => {
    const data = structuredClone(HALLAM) as StretchData;
    expect(() => resolveStretch({ ...data, trip: { ...data.trip, to: 'nowhere' } })).toThrow(/nowhere/);
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
