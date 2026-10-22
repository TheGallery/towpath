// The painted world, worked out once from the stretch and its seed: fields
// and hedges, woods, roads, the canal and towpath, houses, the pub, moored
// boats and trees. It also paints the guidebook map that fades in over it,
// and finds the windows that light up at night.

import { clamp, lerp, seededRandom } from '../core/math';
import { distanceTo, nearestDistance, poseAt } from '../core/track';
import type { Point, Pose, Track } from '../core/track';
import { BASIN_CORNER, BRIDGE_DECK, CANAL_WIDTH, LOCK_REACH, LOCK_WIDTH, MOORED_OFFSET, TOWPATH_OFFSET } from '../world/dimensions';
import { towpathSide } from '../world/stretch';
import type { FeatureData, LockData, Stretch } from '../world/stretch';
import { towpathRuns } from '../world/towpath';
import type { Grazer } from '../sim/wildlife';
import { boatMarkup, personMarkup } from './figures';
import { COLOURS, MAP_COLOURS, livery } from './palette';
import { circlePath, f1, offsetPath, placed, polygonPath, smoothPath, tag } from './svg';

export interface MapLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly kind: 'water' | 'place' | 'big' | 'plain';
}

export interface Scenery {
  readonly defs: string;
  /** Everything under the boats. */
  readonly base: string;
  /** Footbridges, which boats pass under and people walk over. */
  readonly footbridges: string;
  /** Road bridges, which boats and people pass under. */
  readonly top: string;
  /** The guidebook map. */
  readonly map: string;
  readonly labels: readonly MapLabel[];
  /** Windows that light up in the evening: houses, the pub and moored boats. */
  readonly lamps: readonly Point[];
  /** Sheep and cows out in the meadows near the canal. */
  readonly herds: readonly Herd[];
}

export interface Herd {
  readonly kind: 'sheep' | 'cow';
  readonly animals: readonly Grazer[];
}

/** How a lock sits on its canal, with the bottom gates at -x. */
export function lockPose(stretch: Stretch, lock: LockData): Pose {
  const track = stretch.waterways.get(lock.waterway);
  if (!track) throw new Error(`No waterway ${lock.waterway}`);
  const p = poseAt(track, lock.at);
  return lock.uphill > 0 ? p : { ...p, angle: p.angle + Math.PI, nx: -p.nx, ny: -p.ny };
}

const trackOf = (stretch: Stretch, f: FeatureData): Track => {
  const t = stretch.waterways.get(f.waterway);
  if (!t) throw new Error(`No waterway ${f.waterway}`);
  return t;
};

const FIELDS: readonly { colour: string; weight: number; pattern?: string; meadow?: boolean }[] = [
  { colour: '#a4cd7c', weight: 5, meadow: true },
  { colour: '#9cc477', weight: 4, meadow: true },
  { colour: '#b2d388', weight: 3, meadow: true },
  { colour: '#8fbf6e', weight: 3, meadow: true },
  { colour: '#e8cf7a', weight: 2, pattern: 'tp-wheat' },
  { colour: '#c9a77e', weight: 2, pattern: 'tp-plough' },
  { colour: '#e3dc6c', weight: 1 },
  { colour: '#bccf8e', weight: 2 },
];

export function paintScenery(stretch: Stretch): Scenery {
  const { data } = stretch;
  const [first, ...others] = stretch.ways;
  const lamps: Point[] = [];
  const r = seededRandom(data.seed);
  const W = data.size.width;
  const H = data.size.height;
  const base: string[] = [];
  const footbridges: string[] = [];
  const top: string[] = [];
  const map: string[] = [];
  const canals = [...stretch.waterways.values(), ...stretch.ways.map((w) => w.route)];
  const roads = [...stretch.roads.values()];
  const basins = data.features.filter((f) => f.kind === 'basin');
  const clearOf = (pt: Point, gap: number): boolean =>
    canals.every((t) => distanceTo(t, pt) > gap) &&
    roads.every((t) => distanceTo(t, pt) > 34) &&
    basins.every(({ area: a }) => !(pt[0] > a.x - 60 && pt[0] < a.x + a.width + 60 && pt[1] > a.y - 60 && pt[1] < a.y + a.height + 140));

  // Fields: a jittered patchwork, with hedges along most edges.
  const cols = 12;
  const rows = 10;
  const pad = 560;
  const dx = (W + 2 * pad) / cols;
  const dy = (H + 2 * pad) / rows;
  const grid: Point[][] = [];
  for (let j = 0; j <= rows; j++) {
    grid.push([]);
    for (let i = 0; i <= cols; i++) {
      const edge = i === 0 || j === 0 || i === cols || j === rows;
      grid[j].push([-pad + i * dx + (edge ? 0 : (r() - 0.5) * dx * 0.48), -pad + j * dy + (edge ? 0 : (r() - 0.5) * dy * 0.47)]);
    }
  }
  const meadows: (readonly [Point, Point, Point, Point])[] = [];
  const totalWeight = FIELDS.reduce((a, f) => a + f.weight, 0);
  const pickField = () => {
    let x = r() * totalWeight;
    for (const f of FIELDS) {
      x -= f.weight;
      if (x <= 0) return f;
    }
    return FIELDS[0];
  };
  // Grass and map paper reach far past the world, so a tall screen never sees an edge.
  const far = { x: -W * 2, y: -H * 4, width: W * 5, height: H * 9 };
  base.push(tag('rect', { ...far, fill: COLOURS.grass }));
  map.push(tag('rect', { ...far, fill: MAP_COLOURS.paper }));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = polygonPath([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
      const f = pickField();
      if (f.meadow) meadows.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
      base.push(tag('path', { d, fill: f.colour }));
      if (f.pattern) base.push(tag('path', { d, fill: `url(#${f.pattern}-${r() < 0.5 ? 'a' : 'b'})` }));
    }
  }
  const edges: [Point, Point][] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) edges.push([grid[j][i], grid[j][i + 1]]);
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) edges.push([grid[j][i], grid[j + 1][i]]);
  let hedge = '';
  const trees: [number, number, number][] = [];
  for (const [a, b] of edges) {
    if (r() < 0.14) continue;
    hedge += `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`;
    const k = Math.floor(r() * 3);
    for (let n = 0; n < k; n++) {
      const t = r();
      const pt: Point = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
      if (clearOf(pt, 70)) trees.push([pt[0], pt[1], 13 + r() * 9]);
    }
  }
  base.push(tag('path', { d: hedge, stroke: COLOURS.hedge, 'stroke-width': 13, 'stroke-linecap': 'round', fill: 'none' }));
  base.push(tag('path', { d: hedge, stroke: COLOURS.hedgeLight, 'stroke-width': 8, 'stroke-linecap': 'round', fill: 'none', 'stroke-dasharray': '10 6' }));
  map.push(tag('path', { d: hedge, stroke: MAP_COLOURS.hedge, 'stroke-width': 5, fill: 'none' }));

  // Ponds and woods.
  for (const p of data.ponds) {
    const [cx, cy] = p.centre;
    const [rx, ry] = p.radius;
    base.push(tag('ellipse', { cx, cy, rx: rx + 28, ry: ry + 22, fill: COLOURS.verge }));
    base.push(tag('ellipse', { cx, cy, rx, ry, fill: '#6aa3b5' }));
    base.push(tag('ellipse', { cx: cx - 28, cy: cy - 20, rx: f1(rx * 0.6), ry: f1(ry * 0.4), fill: '#8fc0cf', opacity: 0.6 }));
    map.push(tag('ellipse', { cx, cy, rx, ry, fill: MAP_COLOURS.pond, stroke: MAP_COLOURS.pondEdge, 'stroke-width': 4 }));
  }
  for (const w of data.woods) {
    const [cx, cy] = w.centre;
    const [rx, ry] = w.radius;
    const outline: Point[] = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const k = 0.85 + r() * 0.3;
      outline.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    const d = polygonPath(outline);
    base.push(tag('path', { d, fill: COLOURS.wood, stroke: COLOURS.hedge, 'stroke-width': 18, 'stroke-linejoin': 'round' }));
    map.push(tag('path', { d, fill: MAP_COLOURS.wood, stroke: MAP_COLOURS.woodEdge, 'stroke-width': 4 }));
    for (let n = 0; n < (rx * ry) / 1500; n++) {
      const a = r() * Math.PI * 2;
      const k = Math.sqrt(r()) * 0.9;
      const pt: Point = [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
      if (clearOf(pt, 60)) trees.push([pt[0], pt[1], 16 + r() * 12]);
    }
  }

  // Roads and lanes.
  for (const road of roads) {
    const d = smoothPath(road);
    base.push(tag('path', { d, stroke: COLOURS.roadVerge, 'stroke-width': 34, fill: 'none', 'stroke-linecap': 'round' }));
    base.push(tag('path', { d, stroke: COLOURS.road, 'stroke-width': 22, fill: 'none', 'stroke-linecap': 'round' }));
    map.push(tag('path', { d, stroke: MAP_COLOURS.roadEdge, 'stroke-width': 18, fill: 'none' }));
    map.push(tag('path', { d, stroke: MAP_COLOURS.road, 'stroke-width': 11, fill: 'none' }));
  }

  // The canal: grass verge, bank, then water, with the basin drawn the same way.
  const canalPaths = canals.map((t) => smoothPath(t));
  for (const [width, colour] of [[96, COLOURS.verge], [50, COLOURS.bank], [CANAL_WIDTH, COLOURS.water]] as const) {
    for (const d of canalPaths) base.push(tag('path', { d, stroke: colour, 'stroke-width': width, fill: 'none', 'stroke-linejoin': 'round' }));
    const g = (width - CANAL_WIDTH) / 2;
    for (const { area: a } of basins) base.push(tag('rect', { x: a.x - g, y: a.y - g, width: a.width + 2 * g, height: a.height + 2 * g, rx: BASIN_CORNER + g, fill: colour }));
  }
  for (const w of stretch.ways) base.push(tag('path', { d: offsetPath(w.route, 0, 0, w.end), stroke: COLOURS.waterLight, 'stroke-width': 1.5, fill: 'none', opacity: 0.35, 'stroke-dasharray': '24 60' }));

  const towpath = towpathRuns(stretch).map((run) => smoothPath(run.track)).join('');
  base.push(tag('path', { d: towpath, stroke: COLOURS.towpathEdge, 'stroke-width': 15, fill: 'none', 'stroke-linejoin': 'round' }));
  base.push(tag('path', { d: towpath, stroke: COLOURS.towpath, 'stroke-width': 11, fill: 'none', 'stroke-linejoin': 'round' }));
  for (const d of canalPaths) map.push(tag('path', { d, stroke: MAP_COLOURS.water, 'stroke-width': 26, fill: 'none', 'stroke-linejoin': 'round' }));
  for (const { area: a } of basins) map.push(tag('rect', { x: a.x + 10, y: a.y + 10, width: a.width - 20, height: a.height - 20, rx: 20, fill: MAP_COLOURS.water }));
  map.push(tag('path', { d: towpath, stroke: MAP_COLOURS.towpath, 'stroke-width': 5, fill: 'none', 'stroke-dasharray': '14 10' }));

  // Locks: stone sides, a chamber, and paddle gear at each end. The moving
  // gates and water are drawn with the boats.
  const houses: { x: number; y: number; angle: number; w: number; h: number; roof: string }[] = [];
  for (const f of data.features) {
    if (f.kind !== 'lock') continue;
    const pose = lockPose(stretch, f);
    base.push(placed(pose, lockStonework()));
    map.push(placed(pose, tag('path', { d: 'M-22 -36L12 0L-22 36', stroke: COLOURS.ink, 'stroke-width': 9, fill: 'none', 'stroke-linejoin': 'round' })));
    // The lock keeper's cottage, on the far side from the towpath.
    const c = poseAt(trackOf(stretch, f), f.at - 20, -120);
    houses.push({ x: c.x, y: c.y, angle: c.angle, w: 40, h: 24, roof: COLOURS.roofSlate });
    lamps.push([c.x, c.y]);
  }

  // Houses: villages along their roads, and farms.
  for (const v of data.villages) {
    const road = stretch.roads.get(v.road);
    if (!road) continue;
    for (let k = 0; k < v.houses; k++) {
      const p = poseAt(road, v.from + k * 52 + r() * 20);
      const off = (k % 2 ? 1 : -1) * (44 + r() * 18);
      const pt: Point = [p.x + p.nx * off, p.y + p.ny * off];
      const w = 34 + r() * 10;
      const h = 22 + r() * 4;
      const roof = r() < 0.5 ? COLOURS.roofRed : COLOURS.roofSlate;
      if (canals.some((t) => distanceTo(t, pt) < 90)) continue;
      houses.push({ x: pt[0], y: pt[1], angle: p.angle, w, h, roof });
      if (k % 3 !== 1) lamps.push(pt);
    }
  }
  for (const farm of data.farms) {
    const road = stretch.roads.get(farm.road);
    if (!road) continue;
    const p = poseAt(road, farm.at, farm.side * 70);
    houses.push({ x: p.x, y: p.y, angle: p.angle, w: 44, h: 26, roof: COLOURS.roofRed });
    lamps.push([p.x, p.y]);
    houses.push({ x: p.x + 70, y: p.y + 20, angle: p.angle + 0.1, w: 70, h: 34, roof: '#7b6a55' });
  }
  for (const h of houses) {
    const inner =
      tag('rect', { x: f1(-h.w / 2 - 10), y: f1(-h.h / 2 - 12), width: f1(h.w + 20), height: f1(h.h + 26), rx: 4, fill: COLOURS.garden, stroke: COLOURS.hedgeLight, 'stroke-width': 2.5 }) +
      tag('rect', { x: f1(-h.w / 2 + 3), y: f1(-h.h / 2 + 4), width: f1(h.w), height: f1(h.h), fill: '#000', opacity: 0.18 }) +
      tag('rect', { x: f1(-h.w / 2), y: f1(-h.h / 2), width: f1(h.w), height: f1(h.h), fill: h.roof }) +
      tag('path', { d: `M${f1(-h.w / 2)} 0H${f1(h.w / 2)}`, stroke: '#00000040', 'stroke-width': 1.5 }) +
      tag('rect', { x: f1(h.w / 4), y: f1(-h.h / 2 + 2), width: 5, height: 5, fill: '#5a4a3a' });
    base.push(placed(h, inner));
    map.push(placed(h, tag('rect', { x: f1(-h.w / 2), y: f1(-h.h / 2), width: f1(h.w), height: f1(h.h), fill: MAP_COLOURS.house })));
  }

  // Pubs and their beer gardens.
  for (const pub of data.pubs) {
    const [x, y] = pub.at;
    base.push(tag('rect', { x: x - 90, y: y - 45, width: 290, height: 110, rx: 6, fill: COLOURS.garden, stroke: COLOURS.hedgeLight, 'stroke-width': 3 }));
    base.push(tag('rect', { x: x - 56, y: y - 16, width: 110, height: 48, fill: '#000', opacity: 0.18 }));
    base.push(tag('rect', { x: x - 60, y: y - 20, width: 110, height: 48, fill: COLOURS.roofRed }));
    base.push(tag('path', { d: `M${x - 60} ${y + 4}H${x + 50}`, stroke: '#00000040', 'stroke-width': 2 }));
    const tables: [number, number, string][] = [[90, -10, '#e9c46a'], [135, 20, '#f2efe6'], [90, 40, '#b8433a'], [150, -25, '#2f6b4a']];
    for (const [tx, ty, umbrella] of tables) {
      base.push(tag('rect', { x: x + tx - 7, y: y + ty - 4, width: 14, height: 8, fill: '#8b5a2b' }));
      base.push(tag('circle', { cx: x + tx, cy: y + ty, r: 9, fill: umbrella, opacity: 0.9 }));
      const coat = ['#3f5f8a', '#a8402f', '#6b4a7a'][Math.floor(r() * 3)];
      base.push(`<g transform="translate(${x + tx + 13} ${y + ty + 2}) rotate(90) scale(1.6)">${personMarkup(coat, COLOURS.skin)}</g>`);
    }
    map.push(tag('circle', { cx: x, cy: y, r: 24, fill: MAP_COLOURS.pub, stroke: MAP_COLOURS.road, 'stroke-width': 6 }));
    lamps.push([x - 30, y + 4], [x + 20, y + 4], [x + 120, y + 5]);
  }

  // Moored boats: along the bank at moorings, and in basins.
  for (const f of data.features) {
    if (f.kind === 'moorings') {
      const track = trackOf(stretch, f);
      for (const b of f.boats) {
        const p = poseAt(track, b.at, MOORED_OFFSET);
        base.push(placed({ x: p.x, y: p.y, angle: p.angle + (b.facing < 0 ? Math.PI : 0) }, boatMarkup(livery(b.livery))));
        map.push(tag('path', { d: offsetPath(track, MOORED_OFFSET + 10, b.at - 36, b.at + 36), stroke: MAP_COLOURS.moorings, 'stroke-width': 12, fill: 'none' }));
        lamps.push([p.x, p.y]);
      }
    } else if (f.kind === 'basin') {
      for (const b of f.boats) {
        base.push(placed({ x: b.at[0], y: b.at[1], angle: b.angle }, boatMarkup(livery(b.livery))));
        lamps.push(b.at);
      }
    } else if (f.kind === 'bank') {
      // Mooring rings along the edge of the towpath, a bench, and a short mown verge, on whichever bank the towpath runs.
      const track = trackOf(stretch, f);
      const waterway = stretch.data.waterways.find((w) => w.id === f.waterway);
      const side = waterway ? towpathSide(stretch.waterways, waterway) : 1;
      const ats = f.spots.map((sp) => sp.at);
      const from = Math.min(f.at, ...ats) - 20;
      const to = Math.max(...ats) + 50;
      base.push(tag('path', { d: offsetPath(track, side * (TOWPATH_OFFSET + 14), from, to), stroke: '#b4d48a', 'stroke-width': 12, fill: 'none', 'stroke-linecap': 'round' }));
      for (const at of ats) {
        for (const end of [-28, 28]) {
          const p = poseAt(track, at + end, side * (TOWPATH_OFFSET - 6));
          base.push(tag('circle', { cx: f1(p.x), cy: f1(p.y), r: 2.6, fill: 'none', stroke: '#3b3b3b', 'stroke-width': 1.4 }));
        }
      }
      const bench = poseAt(track, ats[Math.floor(ats.length / 2)], side * (TOWPATH_OFFSET + 15));
      base.push(placed(bench, tag('rect', { x: -9, y: -3, width: 18, height: 6, rx: 1, fill: '#8b5a2b', stroke: '#5e3c1c', 'stroke-width': 1 })));
      map.push(tag('path', { d: offsetPath(track, side * (MOORED_OFFSET + 10), from + 20, to - 20), stroke: MAP_COLOURS.moorings, 'stroke-width': 12, fill: 'none', 'stroke-dasharray': '10 8' }));
    }
  }

  // Trees last, so their tops overhang hedges and fields. A line of them
  // stands along the far bank from the towpath.
  // The other ways get theirs from where they leave the first.
  const lines = [{ route: first.route, from: 60 }, ...others.map((w) => ({ route: w.route, from: (w.junctions[0]?.s ?? 0) + 100 }))];
  for (const line of lines) {
    for (let at = line.from; at < line.route.length; at += 50) {
      const p = poseAt(line.route, at + r() * 30, -60 - r() * 20);
      if (r() < 0.55 && clearOf([p.x, p.y], 48)) trees.push([p.x, p.y, 12 + r() * 8]);
    }
  }
  const shades = ['#4d8840', '#5a9447', '#41763a', '#6a9f4e'];
  const byShade = shades.map(() => '');
  let shadow = '';
  let light = '';
  for (const [x, y, rad] of trees) {
    shadow += circlePath(x + 5, y + 6, rad);
    byShade[Math.floor(r() * shades.length)] += circlePath(x, y, rad);
    light += circlePath(x - rad / 3, y - rad / 3, rad * 0.45);
  }
  base.push(tag('path', { d: shadow, fill: '#2e4d2a', opacity: 0.25 }));
  shades.forEach((c, i) => base.push(tag('path', { d: byShade[i], fill: c })));
  base.push(tag('path', { d: light, fill: '#86b866', opacity: 0.5 }));
  const inWood = ([x, y]: readonly number[]) => data.woods.some((w) => ((x - w.centre[0]) / w.radius[0]) ** 2 + ((y - w.centre[1]) / w.radius[1]) ** 2 < 1.1);
  map.push(tag('path', { d: trees.filter((t) => !inWood(t)).map(([x, y]) => circlePath(x, y, 10)).join(''), fill: MAP_COLOURS.tree }));

  // Bridges go on top, so boats pass under them.
  for (const f of data.features) {
    const pose = () => poseAt(trackOf(stretch, f), f.at);
    if (f.kind === 'bridge') {
      top.push(placed(pose(), bridgeMarkup()));
      map.push(placed(pose(), tag('path', { d: 'M-14 -42V42M14 -42V42', stroke: COLOURS.ink, 'stroke-width': 7 })));
    } else if (f.kind === 'footbridge') {
      footbridges.push(placed(pose(), footbridgeMarkup()));
      map.push(placed(pose(), tag('path', { d: 'M0 -34V34', stroke: COLOURS.ink, 'stroke-width': 6 })));
    }
  }

  // A compass in the map's corner.
  map.push(
    `<g transform="translate(${W - 250} ${H - 290})">${tag('circle', { r: 70, fill: MAP_COLOURS.road, stroke: MAP_COLOURS.roadEdge, 'stroke-width': 4 })}${tag('path', { d: 'M0 -56L16 10L0 0L-16 10Z', fill: COLOURS.ink })}${tag('text', { y: 54, 'text-anchor': 'middle', class: 'map-compass' }, 'N')}</g>`,
  );

  const defs = (
    [
      ['tp-wheat-a', 9, 20, '#cfa955'],
      ['tp-wheat-b', 9, -35, '#cfa955'],
      ['tp-plough-a', 11, 62, '#a98a62'],
      ['tp-plough-b', 11, -12, '#a98a62'],
    ] as const
  )
    .map(([id, gap, rot, c]) => `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rot})"><path d="M0 0V${gap}" stroke="${c}" stroke-width="2.4" opacity="0.6"/></pattern>`)
    .join('');

  const herds = placeHerds(stretch, meadows, (pt) => clearOf(pt, 75) && trees.every(([x, y, rad]) => Math.hypot(x - pt[0], y - pt[1]) > rad + 10) && houses.every((h) => Math.hypot(h.x - pt[0], h.y - pt[1]) > 70) && data.pubs.every((pub) => Math.hypot(pub.at[0] + 50 - pt[0], pub.at[1] - pt[1]) > 220));
  return { defs, base: base.join(''), footbridges: footbridges.join(''), top: top.join(''), map: map.join(''), labels: mapLabels(stretch), lamps, herds };
}

/** How many meadows have animals in, and how far from the canal they can be and still be seen from the boat. */
const HERDS = 6;
const HERD_REACH = 360;

/**
 * Sheep and cows in some of the meadows that the canal passes. They have a
 * random sequence of their own, so the fields, hedges and trees come out as
 * they always have for the seed.
 */
function placeHerds(stretch: Stretch, meadows: readonly (readonly [Point, Point, Point, Point])[], open: (pt: Point) => boolean): Herd[] {
  const r = seededRandom(stretch.data.seed ^ 0x5ee9);
  const canals = [...stretch.waterways.values()];
  const inWood = ([x, y]: Point) => stretch.data.woods.some((w) => ((x - w.centre[0]) / (w.radius[0] + 40)) ** 2 + ((y - w.centre[1]) / (w.radius[1] + 40)) ** 2 < 1);
  const inPond = ([x, y]: Point) => stretch.data.ponds.some((p) => ((x - p.centre[0]) / (p.radius[0] + 40)) ** 2 + ((y - p.centre[1]) / (p.radius[1] + 40)) ** 2 < 1);
  // A point inside a field, kept in from its hedges.
  const within = (q: readonly [Point, Point, Point, Point], u: number, v: number): Point => {
    const top = [lerp(q[0][0], q[1][0], u), lerp(q[0][1], q[1][1], u)];
    const foot = [lerp(q[3][0], q[2][0], u), lerp(q[3][1], q[2][1], u)];
    return [lerp(top[0], foot[0], v), lerp(top[1], foot[1], v)];
  };
  const near = meadows.filter((q) => {
    const mid = within(q, 0.5, 0.5);
    return canals.some((t) => distanceTo(t, mid) < HERD_REACH);
  });
  const herds: Herd[] = [];
  for (let n = 0; n < HERDS && near.length; n++) {
    const q = near.splice(Math.floor(r() * near.length), 1)[0];
    const kind = n % 3 === 2 ? 'cow' : 'sheep';
    const want = kind === 'sheep' ? 8 + Math.floor(r() * 6) : 5 + Math.floor(r() * 3);
    // They graze near one another, about a spot in the field.
    const hub = [0.3 + 0.4 * r(), 0.3 + 0.4 * r()];
    const facing = r() * Math.PI * 2;
    const animals: Grazer[] = [];
    for (let tries = 0; animals.length < want && tries < want * 12; tries++) {
      const u = clamp(hub[0] + (r() - 0.5) * 0.5, 0.12, 0.88);
      const v = clamp(hub[1] + (r() - 0.5) * 0.5, 0.12, 0.88);
      const pt = within(q, u, v);
      const inWorld = pt[0] > 20 && pt[0] < stretch.data.size.width - 20 && pt[1] > 20 && pt[1] < stretch.data.size.height - 20;
      if (!inWorld || !open(pt) || inWood(pt) || inPond(pt)) continue;
      if (animals.some((a) => Math.hypot(a.x - pt[0], a.y - pt[1]) < (kind === 'sheep' ? 16 : 30))) continue;
      animals.push({ x: pt[0], y: pt[1], angle: facing + (r() - 0.5) * 2.4, look: Math.floor(r() * 1000) });
    }
    if (animals.length >= 3) herds.push({ kind, animals });
  }
  return herds;
}

function lockStonework(): string {
  return [
    tag('rect', { x: -LOCK_REACH, y: -54, width: 2 * LOCK_REACH, height: 108, rx: 10, fill: COLOURS.coping, stroke: COLOURS.copingEdge, 'stroke-width': 2 }),
    ...[-90, -60, -30, 0, 30, 60, 90].map((x) => tag('path', { d: `M${x} -54V-14M${x} 14V54`, stroke: '#d5ccb8', 'stroke-width': 1.5 })),
    tag('rect', { x: -LOCK_REACH, y: -LOCK_WIDTH / 2, width: 2 * LOCK_REACH, height: LOCK_WIDTH, fill: '#7d7466' }),
    tag('rect', { x: -LOCK_REACH, y: -LOCK_WIDTH / 2, width: LOCK_REACH - 72, height: LOCK_WIDTH, fill: COLOURS.water }),
    tag('rect', { x: 72, y: -LOCK_WIDTH / 2, width: LOCK_REACH - 72, height: LOCK_WIDTH, fill: COLOURS.water }),
    ...[[-86, -18], [-86, 18], [86, -18], [86, 18]].map(([x, y]) => tag('rect', { x: x - 3.5, y: y - 3.5, width: 7, height: 7, rx: 1, fill: '#2b2b2b' })),
  ].join('');
}

function bridgeMarkup(): string {
  return (
    tag('rect', { x: -17, y: -BRIDGE_DECK, width: 34, height: 2 * BRIDGE_DECK, rx: 3, fill: COLOURS.stone }) +
    tag('rect', { x: -11, y: -BRIDGE_DECK, width: 22, height: 2 * BRIDGE_DECK, fill: COLOURS.road }) +
    tag('rect', { x: -17, y: -BRIDGE_DECK, width: 5, height: 2 * BRIDGE_DECK, fill: COLOURS.stoneDark }) +
    tag('rect', { x: 12, y: -BRIDGE_DECK, width: 5, height: 2 * BRIDGE_DECK, fill: COLOURS.stoneDark })
  );
}

function footbridgeMarkup(): string {
  return (
    tag('path', { d: 'M-7 -40Q-9 0 -7 40H7Q9 0 7 -40Z', fill: '#b48a5a' }) +
    tag('path', { d: 'M-7 -40Q-9 0 -7 40M7 -40Q9 0 7 40', stroke: '#6b4a35', 'stroke-width': 2.4, fill: 'none' })
  );
}

/** Names on the map, placed beside what they name. */
export function mapLabels(stretch: Stretch): MapLabel[] {
  const { data } = stretch;
  const labels: MapLabel[] = [];
  const beside = (track: Track, s: number, offset: number) => poseAt(track, s, offset);
  for (const w of data.waterways) {
    const track = stretch.waterways.get(w.id);
    if (!track || !w.label) continue;
    const p = beside(track, w.label.at, w.label.side * 100);
    labels.push({ text: w.name, x: p.x, y: p.y, kind: 'water' });
  }
  for (const f of data.features) {
    if (!f.labelSide) continue;
    const p = beside(trackOf(stretch, f), f.at, f.labelSide * 95);
    labels.push({ text: f.name, x: p.x, y: p.y, kind: f.kind === 'lock' ? 'place' : 'plain' });
  }
  const junctions = new Map(stretch.ways.flatMap((w) => w.junctions).map((j) => [j.name, j]));
  for (const j of junctions.values()) {
    const parent = j.branch.leaves ? stretch.waterways.get(j.branch.leaves.waterway) : undefined;
    if (!parent) continue;
    const p = beside(parent, nearestDistance(parent, j.point), -150);
    labels.push({ text: j.name, x: p.x, y: p.y, kind: 'place' });
  }
  for (const v of data.villages) labels.push({ text: v.name, x: v.label[0], y: v.label[1], kind: 'big' });
  for (const p of data.pubs) labels.push({ text: `${p.name} (pub)`, x: p.at[0] + 55, y: p.at[1] + 120, kind: 'place' });
  for (const w of data.woods) labels.push({ text: w.name, x: w.centre[0], y: w.centre[1], kind: 'plain' });
  for (const p of data.ponds) labels.push({ text: p.name, x: p.centre[0], y: p.centre[1] + p.radius[1] + 70, kind: 'plain' });
  for (const n of data.mapNotes) labels.push({ text: n.text, x: n.at[0], y: n.at[1], kind: 'water' });
  return labels;
}
