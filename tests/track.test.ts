import { describe, expect, it } from 'vitest';
import { buildTrack, curvatureAt, distanceTo, headingAt, nearestDistance, poseAt } from '../src/core/track';
import type { Point } from '../src/core/track';

const straight = buildTrack([[0, 0], [100, 0], [200, 0]]);

describe('buildTrack', () => {
  it('measures a straight line exactly', () => {
    expect(straight.length).toBeCloseTo(200, 6);
  });

  it('passes through every point it is given', () => {
    const points: Point[] = [[0, 0], [120, 40], [260, -30], [400, 10]];
    const track = buildTrack(points);
    for (const p of points) expect(distanceTo(track, p)).toBeLessThan(1e-6);
  });

  it('needs at least two points', () => {
    expect(() => buildTrack([[0, 0]])).toThrow();
  });

  it('lets a lead-in point bend the start, as where a branch leaves', () => {
    const plain = buildTrack([[0, 0], [100, 0], [100, 100]]);
    const led = buildTrack([[0, 0], [100, 0], [100, 100]], 5, [-100, -100]);
    // Coming in from the north-west, the curve leaves the start heading south-east.
    expect(headingAt(led, 0)).toBeGreaterThan(headingAt(plain, 0) + 0.2);
    expect(led.points).toEqual(plain.points);
  });
});

describe('poseAt', () => {
  it('finds the point at a distance, facing along the track', () => {
    const p = poseAt(straight, 50);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
    expect(p.angle).toBeCloseTo(0);
  });

  it('puts a positive offset on the right-hand side', () => {
    // Facing east on screen (y down), the right-hand side is south: +y.
    const p = poseAt(straight, 50, 10);
    expect(p.y).toBeCloseTo(10);
  });

  it('stays on the track past either end', () => {
    expect(poseAt(straight, -40).x).toBeCloseTo(0);
    expect(poseAt(straight, 999).x).toBeCloseTo(200);
  });
});

describe('measuring along a track', () => {
  it('finds how far along a nearby point is', () => {
    expect(nearestDistance(straight, [73, 12])).toBeCloseTo(73, 0);
  });

  it('says how far a point is from the track', () => {
    expect(distanceTo(straight, [80, 30])).toBeCloseTo(30, 0);
  });

  it('gives no bend on a straight and a positive bend turning right', () => {
    expect(curvatureAt(straight, 100)).toBeCloseTo(0);
    // East, then south: a right turn on screen.
    const right = buildTrack([[0, 0], [200, 0], [400, 200]]);
    expect(curvatureAt(right, 200)).toBeGreaterThan(0);
    const left = buildTrack([[0, 0], [200, 0], [400, -200]]);
    expect(curvatureAt(left, 200)).toBeLessThan(0);
  });

  it('keeps headings continuous round a full loop', () => {
    const loop = buildTrack([[0, 0], [100, 0], [100, 100], [0, 100], [0, 1]]);
    for (let i = 1; i < loop.headings.length; i++) expect(Math.abs(loop.headings[i] - loop.headings[i - 1])).toBeLessThan(1);
  });
});
