// The game's SVG: the painted world drawn once, the moving parts updated each
// frame, and the map's names and route on top.

import { poseAt } from '../core/track';
import type { Point, Pose } from '../core/track';
import type { Stretch } from '../world/stretch';
import { TOP_SPEED } from '../sim/boat';
import type { LockState, Part } from '../sim/lock';
import { otherPose } from '../sim/otherboat';
import type { OtherBoatPlan } from '../sim/otherboat';
import type { Trip } from '../sim/trip';
import type { View } from '../view/camera';
import { WAKE_PATH, boatMarkup } from './figures';
import { COLOURS, OTHER_BOAT, YOUR_BOAT, mixHex } from './palette';
import { lockPose } from './scenery';
import type { Scenery } from './scenery';
import { element, f1, smoothPath, transformFor } from './svg';

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

/** How far the bottom gates swing, and the top gate, in degrees from open. */
const BOTTOM_SWING = 48;
const TOP_SWING = 90;

/** Labels and lines on the map are drawn at these sizes on screen, in pixels. */
const LABEL_PX = 12.5;
const LABEL_PX_SMALL = 10.5;

export class Scene {
  readonly svg: SVGSVGElement;
  private readonly locks: LockParts[] = [];
  private readonly boat: SVGGElement;
  private readonly wake: SVGPathElement;
  private readonly other: SVGGElement;
  private readonly otherWake: SVGPathElement;
  private readonly focus: SVGGElement;
  private readonly mapLayer: SVGGElement;
  private readonly overlay: SVGGElement;
  private readonly routeAll: SVGPathElement;
  private readonly routeDone: SVGPathElement;
  private readonly labels: SVGTextElement[];
  private readonly marker: SVGGElement;
  private readonly ring: SVGCircleElement;
  private labelScale = -1;

  constructor(
    container: HTMLElement,
    private readonly stretch: Stretch,
    scenery: Scenery,
    private readonly otherPlan: OtherBoatPlan | null,
    onPart: () => void,
  ) {
    const svg = element('svg', { class: 'world', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid slice' });
    this.svg = svg;
    element('defs', {}, svg).innerHTML = scenery.defs;
    element('g', {}, svg).innerHTML = scenery.base;

    const moving = element('g', {}, svg);
    for (const f of stretch.data.features) {
      if (f.kind !== 'lock') continue;
      const pose = lockPose(stretch, f);
      const g = element('g', { transform: transformFor(pose) }, moving);
      const chamber = element('rect', { x: -72, y: -9, width: 144, height: 18, fill: COLOURS.water }, g);
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
    this.otherWake = element('path', { d: WAKE_PATH, stroke: '#eaf7fb', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }, moving);
    this.other = element('g', { display: 'none' }, moving);
    this.other.innerHTML = boatMarkup(OTHER_BOAT, OTHER_BOAT.steerer);
    this.wake = element('path', { d: WAKE_PATH, stroke: '#eaf7fb', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }, moving);
    this.boat = element('g', {}, moving);
    this.boat.innerHTML = boatMarkup(YOUR_BOAT, YOUR_BOAT.steerer);

    element('g', {}, svg).innerHTML = scenery.top;
    this.mapLayer = element('g', { opacity: 0 }, svg);
    this.mapLayer.innerHTML = scenery.map;

    this.overlay = element('g', { class: 'map-overlay' }, svg);
    const routePath = smoothPath(stretch.route);
    this.routeAll = element('path', { d: routePath, fill: 'none', stroke: COLOURS.route, 'stroke-opacity': 0.55, 'stroke-linecap': 'round' }, this.overlay);
    this.routeDone = element('path', { d: routePath, fill: 'none', stroke: COLOURS.route, 'stroke-linecap': 'round', pathLength: 1000 }, this.overlay);
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

  render(trip: Trip, view: View, screenWidth: number, focus: Focus | null): void {
    this.svg.setAttribute('viewBox', `${f1(view.x)} ${f1(view.y)} ${f1(view.width)} ${f1(view.height)}`);

    const { boat } = trip;
    const p = poseAt(this.stretch.route, boat.s, boat.d);
    const at = { x: p.x, y: p.y, angle: p.angle + boat.psi };
    this.boat.setAttribute('transform', transformFor(at));
    this.wake.setAttribute('transform', transformFor(at));
    this.wake.setAttribute('opacity', (Math.max(0, boat.v / TOP_SPEED) * 0.55).toFixed(2));

    const other = trip.other;
    this.other.setAttribute('display', other && other.phase !== 'gone' && this.otherPlan ? '' : 'none');
    this.otherWake.setAttribute('display', this.other.getAttribute('display') ?? '');
    if (other && other.phase !== 'gone' && this.otherPlan) {
      const op = otherPose(other, this.otherPlan);
      this.other.setAttribute('transform', transformFor(op));
      this.otherWake.setAttribute('transform', transformFor(op));
      this.otherWake.setAttribute('opacity', (Math.max(0, other.v / TOP_SPEED) * 0.55).toFixed(2));
    }

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
    }
    this.routeDone.setAttribute('stroke-dasharray', `${f1((boat.s / this.stretch.route.length) * 1000)} 1000`);
    const pulse = (trip.time * 0.8) % 1;
    this.ring.setAttribute('r', f1(7 + pulse * 12));
    this.ring.setAttribute('stroke-opacity', (1 - pulse).toFixed(2));
    this.marker.setAttribute('transform', `translate(${f1(p.x)} ${f1(p.y)}) scale(${(k * (screenWidth < 500 ? 0.85 : 1)).toFixed(3)})`);
  }
}
