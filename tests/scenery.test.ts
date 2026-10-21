import { describe, expect, it } from 'vitest';
import { paintScenery } from '../src/render/scenery';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);

describe('painting the stretch', () => {
  it('paints the same scenery from the same seed', () => {
    expect(paintScenery(stretch)).toEqual(paintScenery(stretch));
  });

  it('paints different fields and trees from a different seed', () => {
    const other = resolveStretch({ ...HALLAM, seed: HALLAM.seed + 1 });
    expect(paintScenery(other).base).not.toEqual(paintScenery(stretch).base);
  });

  it('writes only finite numbers', () => {
    const { base, top, map } = paintScenery(stretch);
    expect(`${base}${top}${map}`).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('names every place on the map', () => {
    const names = paintScenery(stretch).labels.map((l) => l.text);
    for (const name of ['Hallam Canal', 'Wendle Arm', 'Brook Lock', 'Hollin Bridge', 'Mill Bridge', 'Visitor moorings', 'Wendle Junction', 'The Navigation (pub)', 'Wendle', 'Kettle Pond', 'Coppice Wood', 'Coppice Wood bank']) {
      expect(names).toContain(name);
    }
  });

  it('finds windows to light at night, inside the world', () => {
    const { lamps } = paintScenery(stretch);
    expect(lamps.length).toBeGreaterThan(10);
    for (const [x, y] of lamps) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(HALLAM.size.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(HALLAM.size.height);
    }
  });

  it('keeps names on the map inside the world', () => {
    for (const l of paintScenery(stretch).labels) {
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(HALLAM.size.width);
      expect(l.y).toBeGreaterThan(0);
      expect(l.y).toBeLessThan(HALLAM.size.height);
    }
  });
});
