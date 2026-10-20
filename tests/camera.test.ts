import { describe, expect, it } from 'vitest';
import { FollowCamera, MAP_TIME, NEAR_SPAN } from '../src/view/camera';

const world = { width: 5600, height: 3360 };
const wide = { width: 1440, height: 900 };
const tall = { width: 390, height: 844 };
const boat = { x: 2000, y: 1500, angle: 0 };

function settle(camera: FollowCamera, seconds: number, at = boat, viewport = wide) {
  let view = camera.update(0, at, viewport);
  for (let t = 0; t < seconds; t += 1 / 60) view = camera.update(1 / 60, at, viewport);
  return view;
}

describe('the boat view', () => {
  it('shows a close view across the shorter side of the screen', () => {
    const view = settle(new FollowCamera(world), 1);
    expect(view.height).toBeCloseTo(NEAR_SPAN);
    expect(view.width / view.height).toBeCloseTo(wide.width / wide.height);
    const phone = settle(new FollowCamera(world), 1, boat, tall);
    expect(phone.width).toBeCloseTo(NEAR_SPAN);
  });

  it('keeps the boat in view, looking a little ahead of it', () => {
    const view = settle(new FollowCamera(world), 5);
    const cx = view.x + view.width / 2;
    expect(cx).toBeGreaterThan(boat.x);
    expect(boat.x).toBeGreaterThan(view.x);
    expect(boat.x).toBeLessThan(view.x + view.width);
    expect(view.mapFade).toBe(0);
    expect(view.labelFade).toBe(0);
  });

  it('never shows past the edge of the world', () => {
    const view = settle(new FollowCamera(world), 1, { x: 30, y: 20, angle: Math.PI });
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
  });
});

describe('the map', () => {
  it('eases out to show the whole stretch, with names, then back to the boat', () => {
    const camera = new FollowCamera(world);
    settle(camera, 1);
    camera.setMap(true);
    const half = settle(camera, MAP_TIME / 2);
    expect(half.width).toBeGreaterThan(NEAR_SPAN * 1.6);
    expect(half.width).toBeLessThan(world.width);
    const map = settle(camera, MAP_TIME);
    expect(map.width).toBeGreaterThanOrEqual(world.width);
    expect(map.height).toBeGreaterThanOrEqual(world.height);
    expect(map.x + map.width / 2).toBeCloseTo(world.width / 2);
    expect(map.mapFade).toBe(1);
    expect(map.labelFade).toBe(1);
    camera.setMap(false);
    const back = settle(camera, MAP_TIME + 0.1);
    expect(back.height).toBeCloseTo(NEAR_SPAN);
  });

  it('says how many world units each screen pixel covers, for names drawn at a fixed size', () => {
    const camera = new FollowCamera(world);
    camera.setMap(true);
    const map = settle(camera, MAP_TIME + 0.1);
    expect(map.unitsPerPixel).toBeCloseTo(map.width / wide.width);
  });
});
