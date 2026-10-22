// The game's SVG: the painted world drawn once, the moving parts updated each
// frame, the light of the day over it, and the map's names and route on top.

import { distanceTo, poseAt } from '../core/track';
import type { Point, Pose, Track } from '../core/track';
import type { LockState, Part } from '../sim/lock';
import { otherPose } from '../sim/otherboat';
import type { OtherBoatPlan } from '../sim/otherboat';
import type { Light, Placed } from '../sim/day';
import type { Weather, WeatherNow } from '../sim/weather';
import type { Trip } from '../sim/trip';
import { dogAt, walkerAt } from '../sim/walkers';
import type { Walker } from '../sim/walkers';
import { CANAL_WIDTH, LOCK_REACH, LOCK_WIDTH, MOORED_OFFSET } from '../world/dimensions';
import type { Spot, Stretch } from '../world/stretch';
import type { TowpathRun } from '../world/towpath';
import type { View } from '../view/camera';
import { Ambience } from './ambience';
import { boatMarkup, dogMarkup, personMarkup } from './figures';
import { COLOURS, DOG_COATS, HEADS, JOGGER_TOPS, OTHER_BOAT, WALKER_COATS, YOUR_BOAT, mixHex, pick } from './palette';
import { lockPose } from './scenery';
import type { Scenery } from './scenery';
import { element, f1, offsetPath, transformFor } from './svg';
import { Wake } from './wake';
import type { Room } from './wake';

interface LockParts {
  readonly id: string;
  readonly pose: Pose;
  readonly chamber: SVGRectElement;
  readonly bottomNorth: SVGGElement;
  readonly bottomSouth: SVGGElement;
  readonly top: SVGGElement;
  /** Rings on the water where it rushes out below the lock, and in at the top. */
  readonly out: readonly SVGEllipseElement[];
  readonly in: readonly SVGEllipseElement[];
}

/** The part of a lock that needs you next, and whether to make it glow. */
export interface Focus {
  readonly lock: string;
  readonly part: Part;
  readonly glow: boolean;
}

/** One way you can choose at a junction, drawn on the map from where the ways part. */
export interface WayChoice {
  readonly id: string;
  readonly route: Track;
  readonly from: number;
  readonly to: number;
  /** The number that picks it, shown at its end. */
  readonly label: string;
}

/** The towpath and the people who walk it. */
export interface Towpath {
  readonly runs: readonly TowpathRun[];
  readonly walkers: readonly Walker[];
}

/** One person on the towpath as drawn, and their dog if they have one. */
interface Figure {
  readonly walker: Walker;
  readonly person: SVGGElement;
  readonly feet: readonly [SVGEllipseElement, SVGEllipseElement];
  readonly dog: SVGGElement | null;
}

/** What moves and changes from frame to frame. */
export interface Frame {
  /** Seconds since the day began, and when the evening began, from when people head home. */
  readonly time: number;
  readonly homeFrom: number | null;
  readonly trip: Trip;
  /** Where your boat is, and how far along today's route. */
  readonly boat: Placed;
  readonly along: number;
  readonly focus: Focus | null;
  readonly light: Light;
  /** Spots to tie up at, marked while you choose one. */
  readonly spots: readonly Spot[] | null;
  /** Today's route, the day's weather, and how it looks right now. */
  readonly route: Track;
  readonly weather: Weather;
  readonly weatherNow: WeatherNow;
}

/** How far the bottom gates swing, and the top gate, in degrees from open. */
const BOTTOM_SWING = 48;
const TOP_SWING = 90;

/** How big people and dogs are drawn, and how far they fade as they step onto or off the towpath. */
const PERSON_SCALE = 1.7;
const DOG_SCALE = 1.4;
const FADE = 16;

/** The widest a wake spreads from the boat's stern, and the step it feels for the bank in. */
const WAKE_ROOM = 24;
const ROOM_STEP = 2;

/** Labels and lines on the map are drawn at these sizes on screen, in pixels. */
const LABEL_PX = 12.5;
const LABEL_PX_SMALL = 10.5;

export class Scene {
  readonly svg: SVGSVGElement;
  private readonly locks: LockParts[] = [];
  private readonly boat: SVGGElement;
  private readonly wake: Wake;
  private readonly other: SVGGElement;
  private readonly otherWake: Wake;
  private readonly ambience: Ambience;
  private readonly focus: SVGGElement;
  private readonly figures: Figure[] = [];
  private readonly mapLayer: SVGGElement;
  private readonly overlay: SVGGElement;
  private readonly routeAll: SVGPathElement;
  private readonly routeDone: SVGPathElement;
  /** How far today's route is drawn: all of it, or up to where the ways part until you choose. */
  private routeLength = 1;
  private readonly choices: SVGGElement;
  private readonly choiceLines: SVGPathElement[] = [];
  private readonly choiceLabels: SVGTextElement[] = [];
  private readonly night: SVGGElement;
  private readonly warm: SVGRectElement;
  private readonly dark: SVGRectElement;
  private readonly lamps: SVGGElement;
  private readonly boatLamp: SVGCircleElement;
  private readonly spotMarks: SVGGElement;
  private shownSpots: readonly Spot[] | null = null;
  private readonly labels: SVGTextElement[];
  private readonly marker: SVGGElement;
  private readonly ring: SVGCircleElement;
  private labelScale = -1;

  constructor(
    container: HTMLElement,
    stretch: Stretch,
    scenery: Scenery,
    private readonly otherPlan: OtherBoatPlan | null,
    private readonly towpath: Towpath,
    onPart: () => void,
    private readonly onWay: (id: string) => void,
    private readonly onSpot: (index: number) => void,
  ) {
    const svg = element('svg', { class: 'world', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid slice' });
    this.svg = svg;
    element('defs', {}, svg).innerHTML = scenery.defs;
    element('g', {}, svg).innerHTML = scenery.base;
    // Sheep and cows in the meadows, then the life on the water under the boats.
    const ground = element('g', { 'pointer-events': 'none' }, svg);

    const moving = element('g', {}, svg);
    const water = element('g', { 'pointer-events': 'none' }, moving);
    for (const f of stretch.data.features) {
      if (f.kind !== 'lock') continue;
      const pose = lockPose(stretch, f);
      const g = element('g', { transform: transformFor(pose) }, moving);
      const chamber = element('rect', { x: -72, y: -LOCK_WIDTH / 2, width: 144, height: LOCK_WIDTH, fill: COLOURS.water }, g);
      const rings = () => [0, 1].map(() => element('ellipse', { rx: 3, ry: 5, fill: 'none', stroke: COLOURS.waterLight, 'stroke-width': 1.2, opacity: 0 }, g));
      const out = rings();
      const into = rings();
      const leaf = (length: number, side: number) => {
        const leafGroup = element('g', {}, g);
        element('path', { d: `M0 ${side * 6}H-40`, stroke: '#2b2b2b', 'stroke-width': 4, 'stroke-linecap': 'round' }, leafGroup);
        element('path', { d: `M-32 ${side * 6}H-40`, stroke: '#f2efe6', 'stroke-width': 3, 'stroke-linecap': 'round' }, leafGroup);
        element('path', { d: `M0 0H${length}`, stroke: '#4a3a2c', 'stroke-width': 3.4, 'stroke-linecap': 'round' }, leafGroup);
        return leafGroup;
      };
      this.locks.push({ id: f.id, pose, chamber, bottomNorth: leaf(12, -1), bottomSouth: leaf(12, 1), top: leaf(18, -1), out, in: into });
    }
    // The part that needs you glows, and clicking it takes you there.
    this.focus = element('g', { class: 'lock-focus', display: 'none' }, moving);
    element('circle', { r: 22, fill: 'transparent' }, this.focus);
    element('circle', { r: 11, class: 'world-glow', fill: 'none' }, this.focus);
    this.focus.addEventListener('click', onPart);
    // People on the towpath, over the footbridges and under the road bridges they come and go by.
    element('g', {}, svg).innerHTML = scenery.footbridges;
    const people = element('g', { class: 'towpath-people', 'pointer-events': 'none' }, svg);
    for (const walker of towpath.walkers) {
      const dog = walker.dog ? element('g', { display: 'none' }, people) : null;
      const [coat, ears] = pick(DOG_COATS, walker.look >> 3);
      if (dog) dog.innerHTML = dogMarkup(coat, ears);
      const person = element('g', { display: 'none' }, people);
      // Feet, to swing as they step.
      const foot = () => element('ellipse', { rx: 1.3, ry: 0.8, fill: '#3a312b' }, person);
      const feet = [foot(), foot()] as const;
      const body = element('g', {}, person);
      body.innerHTML = personMarkup(walker.kind === 'jogger' ? pick(JOGGER_TOPS, walker.look) : pick(WALKER_COATS, walker.look), pick(HEADS, walker.look >> 2));
      this.figures.push({ walker, person, feet, dog });
    }
    this.other = element('g', { display: 'none' }, moving);
    this.other.innerHTML = boatMarkup(OTHER_BOAT, OTHER_BOAT.steerer);
    this.boat = element('g', {}, moving);
    this.boat.innerHTML = boatMarkup(YOUR_BOAT, YOUR_BOAT.steerer);
    const room = this.wakeRoom(stretch);
    this.otherWake = new Wake(moving, this.other, room);
    this.wake = new Wake(moving, this.boat, room);

    element('g', {}, svg).innerHTML = scenery.top;
    // Cloud shadows, mist and drizzle lie over everything, under the light of the day.
    const sky = element('g', { 'pointer-events': 'none' }, svg);
    this.ambience = new Ambience(stretch, scenery.herds, stretch.data.seed, { ground, water, sky });

    // The light of the day: a warm wash at morning and dusk, the dark of
    // night, and the windows that glow through it.
    const lampGlow = element('radialGradient', { id: 'tp-lamp' }, svg.querySelector('defs') ?? svg);
    element('stop', { offset: 0, 'stop-color': '#ffe3a1', 'stop-opacity': 0.95 }, lampGlow);
    element('stop', { offset: 0.3, 'stop-color': '#ffbf5e', 'stop-opacity': 0.5 }, lampGlow);
    element('stop', { offset: 1, 'stop-color': '#ffbf5e', 'stop-opacity': 0 }, lampGlow);
    const mist = element('radialGradient', { id: 'tp-mist' }, svg.querySelector('defs') ?? svg);
    element('stop', { offset: 0, 'stop-color': '#f1f3ef', 'stop-opacity': 0.75 }, mist);
    element('stop', { offset: 0.6, 'stop-color': '#f1f3ef', 'stop-opacity': 0.4 }, mist);
    element('stop', { offset: 1, 'stop-color': '#f1f3ef', 'stop-opacity': 0 }, mist);
    this.night = element('g', { class: 'night', 'pointer-events': 'none', display: 'none' }, svg);
    const far = { x: -stretch.data.size.width * 2, y: -stretch.data.size.height * 4, width: stretch.data.size.width * 5, height: stretch.data.size.height * 9 };
    this.warm = element('rect', { ...far, fill: '#f08c3c', opacity: 0 }, this.night);
    this.dark = element('rect', { ...far, fill: '#0c1733', opacity: 0 }, this.night);
    this.lamps = element('g', { opacity: 0 }, this.night);
    for (const [x, y] of scenery.lamps) element('circle', { cx: f1(x), cy: f1(y), r: 30, fill: 'url(#tp-lamp)' }, this.lamps);
    this.boatLamp = element('circle', { r: 34, fill: 'url(#tp-lamp)' }, this.lamps);

    // The spots to tie up at, while you choose one.
    this.spotMarks = element('g', { class: 'spot-marks', display: 'none' }, svg);

    this.mapLayer = element('g', { opacity: 0 }, svg);
    this.mapLayer.innerHTML = scenery.map;

    this.overlay = element('g', { class: 'map-overlay' }, svg);
    this.choices = element('g', { class: 'way-choices', display: 'none' }, this.overlay);
    this.routeAll = element('path', { fill: 'none', stroke: COLOURS.route, 'stroke-opacity': 0.55, 'stroke-linecap': 'round' }, this.overlay);
    this.routeDone = element('path', { fill: 'none', stroke: COLOURS.route, 'stroke-linecap': 'round', pathLength: 1000 }, this.overlay);
    this.labels = scenery.labels.map((l) => {
      const text = element('text', { x: f1(l.x), y: f1(l.y), 'text-anchor': 'middle', class: `map-label ${l.kind}` }, this.overlay);
      text.textContent = l.text;
      return text;
    });
    this.marker = element('g', {}, this.overlay);
    this.ring = element('circle', { r: 9, fill: 'none', stroke: COLOURS.route, 'stroke-width': 2 }, this.marker);
    element('circle', { r: 6.5, fill: COLOURS.route, stroke: '#fff', 'stroke-width': 2.5 }, this.marker);
    element('text', { x: 0, y: -14, 'text-anchor': 'middle', class: 'map-label here' }, this.marker).textContent = 'You are here';

    container.prepend(svg);
  }

  /**
   * How much open water there is from a point, feeling one way for the bank:
   * along the canal and in the basin it's the canal's width, and in a lock
   * only the narrow chamber.
   */
  private wakeRoom(stretch: Stretch): Room {
    const canals = [...stretch.waterways.values()];
    const basins = stretch.data.features.flatMap((f) => (f.kind === 'basin' ? [f.area] : []));
    const locks = this.locks.map((l) => l.pose);
    // Moored boats stop a wake as the bank does.
    const moored: { x: number; y: number; angle: number }[] = [];
    for (const f of stretch.data.features) {
      const track = stretch.waterways.get(f.waterway);
      if (f.kind === 'moorings' && track) for (const b of f.boats) moored.push(poseAt(track, b.at, MOORED_OFFSET));
      if (f.kind === 'basin') for (const b of f.boats) moored.push({ x: b.at[0], y: b.at[1], angle: b.angle });
    }
    const within = (pose: { x: number; y: number; angle: number }, px: number, py: number, along: number, across: number) => {
      const ox = px - pose.x;
      const oy = py - pose.y;
      return Math.abs(ox * Math.cos(pose.angle) + oy * Math.sin(pose.angle)) < along && Math.abs(-ox * Math.sin(pose.angle) + oy * Math.cos(pose.angle)) < across;
    };
    return (x, y, dx, dy) => {
      let canal = canals[0];
      let nearest = Infinity;
      for (const t of canals) {
        const d = distanceTo(t, [x, y]);
        if (d < nearest) [canal, nearest] = [t, d];
      }
      const isWater = (px: number, py: number) => {
        for (const pose of locks) if (within(pose, px, py, LOCK_REACH, 54)) return within(pose, px, py, LOCK_REACH, LOCK_WIDTH / 2);
        if (moored.some((pose) => within(pose, px, py, 39, 6))) return false;
        if (basins.some((a) => px > a.x && px < a.x + a.width && py > a.y && py < a.y + a.height)) return true;
        return distanceTo(canal, [px, py]) < CANAL_WIDTH / 2;
      };
      for (let out = ROOM_STEP; out <= WAKE_ROOM; out += ROOM_STEP) if (!isWater(x + dx * out, y + dy * out)) return out - ROOM_STEP;
      return WAKE_ROOM;
    };
  }

  /** Today's route on the map, drawn as far as it's decided. */
  showRoute(route: Track, upTo: number): void {
    const d = offsetPath(route, 0, 0, upTo);
    this.routeAll.setAttribute('d', d);
    this.routeDone.setAttribute('d', d);
    this.routeLength = upTo;
  }

  /** The ways you can choose at the junction, on the map, or none once you've chosen. Click one to choose it. */
  showChoices(ways: readonly WayChoice[] | null): void {
    this.choices.replaceChildren();
    this.choiceLines.length = 0;
    this.choiceLabels.length = 0;
    this.choices.setAttribute('display', ways ? '' : 'none');
    for (const [i, w] of (ways ?? []).entries()) {
      const g = element('g', { class: `way-choice way-${i}` }, this.choices);
      const d = offsetPath(w.route, 0, w.from, w.to);
      element('path', { d, class: 'way-hit', fill: 'none', stroke: 'transparent', 'stroke-linecap': 'round' }, g);
      this.choiceLines.push(element('path', { d, class: 'way-line', fill: 'none', 'stroke-linecap': 'round' }, g));
      const tip = poseAt(w.route, w.to);
      const label = element('text', { x: f1(tip.x), y: f1(tip.y), 'text-anchor': 'middle', class: 'map-label choice-label' }, g);
      label.textContent = w.label;
      this.choiceLabels.push(label);
      g.addEventListener('click', () => this.onWay(w.id));
    }
    this.labelScale = -1;
  }

  private markSpots(spots: readonly Spot[] | null): void {
    if (spots === this.shownSpots) return;
    this.shownSpots = spots;
    this.spotMarks.replaceChildren();
    this.spotMarks.setAttribute('display', spots ? '' : 'none');
    for (const [i, spot] of (spots ?? []).entries()) {
      const g = element('g', { class: 'spot-mark', transform: transformFor(spot) }, this.spotMarks);
      element('rect', { x: -40, y: -9, width: 80, height: 18, rx: 9, class: 'spot-outline' }, g);
      const badge = element('g', { transform: `rotate(${f1((-spot.angle * 180) / Math.PI)})` }, g);
      element('circle', { r: 9, class: 'spot-badge' }, badge);
      element('text', { y: 3.6, 'text-anchor': 'middle', class: 'spot-number' }, badge).textContent = String(i + 1);
      g.addEventListener('click', () => this.onSpot(i));
    }
  }

  /** Where a part of a lock is on the map: a paddle's gear on the towpath side, or the end of a gate's balance beam. */
  partPoint(lockId: string, part: Part, state: LockState): Point | null {
    const parts = this.locks.find((l) => l.id === lockId);
    if (!parts) return null;
    let local: Point;
    if (part === 'bottomPaddle') local = [-86, 18];
    else if (part === 'topPaddle') local = [86, 18];
    else {
      // The beam's end, turned round its hinge by how far the gate is open.
      const bottom = part === 'bottomGates';
      const a = ((bottom ? -BOTTOM_SWING : TOP_SWING) * (1 - state[part]) * Math.PI) / 180;
      const [bx, by] = bottom ? [-36, 6] : [-36, -6];
      const [hx, hy] = bottom ? [-72, 9] : [72, -9];
      local = [hx + bx * Math.cos(a) - by * Math.sin(a), hy + bx * Math.sin(a) + by * Math.cos(a)];
    }
    const { pose } = parts;
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    return [pose.x + local[0] * c - local[1] * s, pose.y + local[0] * s + local[1] * c];
  }

  /** People where they are on the towpath, stepping as they go, with their dogs about them. */
  private drawPeople(time: number, homeFrom: number | null): void {
    for (const { walker, person, feet, dog } of this.figures) {
      const at = walkerAt(walker, time, homeFrom);
      person.setAttribute('display', at ? '' : 'none');
      dog?.setAttribute('display', at ? '' : 'none');
      if (!at) continue;
      const run = this.towpath.runs[at.run];
      const place = (s: number, d: number, facing: number, scale: number, turn = 0) => {
        const p = poseAt(run.track, s, d);
        return `translate(${f1(p.x)} ${f1(p.y)}) rotate(${f1(((p.angle + (facing < 0 ? Math.PI : 0) + turn) * 180) / Math.PI)}) scale(${scale})`;
      };
      const fade = at.fromHome < FADE ? (at.fromHome / FADE).toFixed(2) : '1';
      person.setAttribute('transform', place(at.s, at.d, at.facing, PERSON_SCALE));
      person.setAttribute('opacity', fade);
      // A step every few units along the path, longer when jogging.
      const stride = walker.kind === 'jogger' ? 4.4 : 3;
      const swing = Math.sin((at.s / stride) * Math.PI) * (walker.kind === 'jogger' ? 2.3 : 1.6);
      feet[0].setAttribute('transform', `translate(${f1(swing)} -1.2)`);
      feet[1].setAttribute('transform', `translate(${f1(-swing)} 1.2)`);
      if (dog) {
        const pup = dogAt(walker, at, time);
        dog.setAttribute('transform', place(pup.s, pup.d, pup.facing, DOG_SCALE, 0.25 * Math.sin(time * 1.3 + walker.look)));
        dog.setAttribute('opacity', fade);
      }
    }
  }

  render(frame: Frame, view: View, screenWidth: number): void {
    const { trip, focus, light } = frame;
    this.svg.setAttribute('viewBox', `${f1(view.x)} ${f1(view.y)} ${f1(view.width)} ${f1(view.height)}`);

    const { boat } = trip;
    const at = frame.boat;
    this.boat.setAttribute('transform', transformFor(at));
    const onWater = view.mapFade < 0.98;
    this.wake.update(at, boat.v, frame.time, onWater);

    const lit = light.warm > 0.005 || light.dark > 0.005;
    this.night.setAttribute('display', lit ? '' : 'none');
    if (lit) {
      this.warm.setAttribute('opacity', (light.warm * 0.22).toFixed(3));
      this.dark.setAttribute('opacity', (light.dark * 0.85).toFixed(3));
      this.lamps.setAttribute('opacity', light.lamps.toFixed(3));
      this.boatLamp.setAttribute('cx', f1(at.x));
      this.boatLamp.setAttribute('cy', f1(at.y));
    }
    this.markSpots(frame.spots);
    this.drawPeople(frame.time, frame.homeFrom);

    const other = trip.other;
    const otherOut = other && other.phase !== 'gone' && this.otherPlan ? other : null;
    this.other.setAttribute('display', otherOut ? '' : 'none');
    const boats: { x: number; y: number }[] = [at];
    if (otherOut && this.otherPlan) {
      const op = otherPose(otherOut, this.otherPlan);
      this.other.setAttribute('transform', transformFor(op));
      this.otherWake.update(op, otherOut.v, frame.time, onWater);
      boats.push(op);
    } else this.otherWake.hide();
    this.ambience.render(
      { time: frame.time, weather: frame.weather, now: frame.weatherNow, light, boats: boats.map((b) => [b.x, b.y] as const), route: frame.route, along: frame.along },
      view,
      { width: screenWidth, height: screenWidth / (view.width / view.height) },
    );

    for (const parts of this.locks) {
      const work = trip.locks.get(parts.id);
      if (!work) continue;
      parts.chamber.setAttribute('fill', mixHex(COLOURS.waterDeep, COLOURS.water, work.water));
      parts.chamber.setAttribute('y', f1(-5.5 - 3.5 * work.water));
      parts.chamber.setAttribute('height', f1(11 + 7 * work.water));
      const bottom = BOTTOM_SWING * (1 - work.bottomGates);
      parts.bottomNorth.setAttribute('transform', `translate(-72 -9) rotate(${f1(bottom)})`);
      parts.bottomSouth.setAttribute('transform', `translate(-72 9) rotate(${f1(-bottom)})`);
      parts.top.setAttribute('transform', `translate(72 -9) rotate(${f1(TOP_SWING * (1 - work.topGates))})`);
      // Water running through the paddles spreads in rings: out below the bottom gates, in below the top one.
      const ripple = (rings: readonly SVGEllipseElement[], flow: number, x: number, way: number) =>
        rings.forEach((r, i) => {
          const ph = (trip.time * 0.9 + i / 2) % 1;
          r.setAttribute('cx', f1(x + way * ph * 22));
          r.setAttribute('rx', f1(2 + ph * 6));
          r.setAttribute('ry', f1(3 + ph * 5));
          r.setAttribute('opacity', (Math.min(1, flow * 2) * (1 - ph)).toFixed(2));
        });
      ripple(parts.out, work.flowOut, -80, -1);
      ripple(parts.in, work.flowIn, 64, -1);
    }

    const focusState = focus && trip.locks.get(focus.lock);
    const spot = focus && focusState ? this.partPoint(focus.lock, focus.part, focusState) : null;
    this.focus.setAttribute('display', spot ? '' : 'none');
    this.focus.classList.toggle('glowing', focus?.glow ?? false);
    if (spot) this.focus.setAttribute('transform', `translate(${f1(spot[0])} ${f1(spot[1])})`);

    this.mapLayer.setAttribute('opacity', view.mapFade.toFixed(3));
    const showOverlay = view.labelFade > 0.001;
    this.overlay.style.display = showOverlay ? '' : 'none';
    if (!showOverlay) return;
    this.overlay.setAttribute('opacity', view.labelFade.toFixed(3));

    // Names and lines stay the same size on screen at any zoom.
    const k = view.unitsPerPixel;
    if (Math.abs(k - this.labelScale) / k > 0.01) {
      this.labelScale = k;
      const px = screenWidth < 500 ? LABEL_PX_SMALL : LABEL_PX;
      for (const l of this.labels) {
        l.setAttribute('font-size', f1(px * k * (l.classList.contains('big') ? 1.4 : 1)));
        l.setAttribute('stroke-width', f1(3.2 * k));
      }
      this.routeAll.setAttribute('stroke-width', f1(3 * k));
      this.routeAll.setAttribute('stroke-dasharray', `${f1(7 * k)} ${f1(6 * k)}`);
      this.routeDone.setAttribute('stroke-width', f1(4.5 * k));
      for (const line of this.choiceLines) {
        line.setAttribute('stroke-width', f1(4 * k));
        line.setAttribute('stroke-dasharray', `${f1(9 * k)} ${f1(7 * k)}`);
      }
      for (const hit of this.choices.querySelectorAll('.way-hit')) hit.setAttribute('stroke-width', f1(26 * k));
      for (const l of this.choiceLabels) {
        l.setAttribute('font-size', f1(px * k * 1.6));
        l.setAttribute('stroke-width', f1(3.2 * k));
        l.setAttribute('dy', f1(-14 * k));
      }
    }
    this.routeDone.setAttribute('stroke-dasharray', `${f1(Math.min(1, frame.along / this.routeLength) * 1000)} 1000`);
    const pulse = (trip.time * 0.8) % 1;
    this.ring.setAttribute('r', f1(7 + pulse * 12));
    this.ring.setAttribute('stroke-opacity', (1 - pulse).toFixed(2));
    this.marker.setAttribute('transform', `translate(${f1(at.x)} ${f1(at.y)}) scale(${(k * (screenWidth < 500 ? 0.85 : 1)).toFixed(3)})`);
  }
}
