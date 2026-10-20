// The full-screen close-ups, in the even mix of the natural lockside and the
// game dial: you look across the lock from the paddle gear, with the dial's
// toothed wheel, gold ring, catch and windlass on a post in front of you, and
// no hands; or down on a gate's balance beam, with the dial's track and gold
// fill round its worn path. The scenes run on past the frame, so the
// close-up fills a screen of any shape.

import type { Point } from '../core/track';
import { COLOURS, mixHex } from './palette';
import { element, f1, tag } from './svg';

export const CLOSEUP_WIDTH = 800;
export const CLOSEUP_HEIGHT = 392;
/** How far the scenes run on past the frame, for screens of other shapes. */
const BEYOND = 900;

const W = CLOSEUP_WIDTH;
const H = CLOSEUP_HEIGHT;
const TAU = Math.PI * 2;
const deg = (radians: number): string => f1((radians * 180) / Math.PI);

/** The game dial's colours. */
const DIAL = {
  wheel: '#46544c',
  wheelEdge: '#6f8076',
  disc: '#26302a',
  spindle: '#cfd6d1',
  spindleEdge: '#8a958e',
  track: '#3a4740',
  gold: '#e9c46a',
  catchOn: '#e07a5f',
  catchOff: '#8a958e',
  hub: '#58665e',
  bar: '#cfd6d1',
  knob: '#c58b52',
  knobEdge: '#f2d2a9',
  post: '#3a4740',
  postEdge: '#6f8076',
  pill: '#161c18',
  level: '#7cc48f',
} as const;

const LOCKSIDE = {
  lockside: '#b7cf95',
  pebble: '#b49e74',
  beam: '#2b2b2b',
  beamTip: '#f2efe6',
  gate: '#4a3a2c',
  high: '#78b3c6',
} as const;

/** Where things are in the paddle close-up. */
export const PADDLE_LAYOUT = {
  spindle: [400, 196] as Point,
  /** Where the windlass lies on the ground until you pick it up. */
  rest: [110, 354] as Point,
  /** The middle of the safety catch, where a click flicks it. */
  catchAt: [400, 92] as Point,
  catchReach: 26,
  hubReach: 28,
  grabReach: 50,
  fitReach: 58,
  /** The windlass's arm, from the square socket to the handle. */
  arm: 66,
} as const;

/** Where things are in the gate close-up: the hinge, and the beam and gate leaf either side of it. */
export const GATE_LAYOUT = { hinge: [470, 262] as Point, beam: 200, leaf: 150 } as const;

function text(parent: Element, x: number, y: number, words: string, attrs: Record<string, string | number> = {}): SVGTextElement {
  const t = element('text', { x, y, ...attrs }, parent);
  t.textContent = words;
  return t;
}

function ratchet(r1: number, r2: number, teeth: number, attrs: Record<string, string | number>): string {
  const points: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const r = i % 2 ? r2 : r1;
    points.push(`${f1(Math.cos(a) * r)} ${f1(Math.sin(a) * r)}`);
  }
  return tag('path', { d: `M${points.join('L')}Z`, ...attrs });
}

/** Someone seen from above: shoulders, arms and a head. */
const personFromAbove = (coat: string, hat: string): string =>
  tag('ellipse', { cx: 1.2, cy: 2.2, rx: 6, ry: 4.4, fill: '#000', opacity: 0.18 }) +
  tag('ellipse', { rx: 3, ry: 5.6, fill: coat, stroke: '#00000033', 'stroke-width': 0.6 }) +
  tag('circle', { cx: 1, cy: -5, r: 1.4, fill: coat }) +
  tag('circle', { cx: 1, cy: 5, r: 1.4, fill: coat }) +
  tag('circle', { r: 2.5, fill: hat });

/** A ring that pulses round the next thing to touch. */
const glowRing = (parent: Element, r: number): SVGCircleElement => element('circle', { r, class: 'cu-glow', fill: 'none', opacity: 0 }, parent);

function placeRing(ring: SVGCircleElement, at: Point | null): void {
  ring.setAttribute('opacity', at ? '1' : '0');
  if (at) {
    ring.setAttribute('cx', f1(at[0]));
    ring.setAttribute('cy', f1(at[1]));
  }
}

// ---- The lockside, seen from the paddle gear ------------------------------------

interface Lockside {
  readonly wet: SVGRectElement;
  readonly water: SVGRectElement;
  readonly surface: SVGPathElement;
  readonly swirl: SVGGElement;
  readonly rings: readonly SVGEllipseElement[];
  /** The top of the wet line the water leaves on the wall as it drops. */
  wetTop: number | null;
}

/** Sky, hedge, the far wall of the chamber with its wet line, the water, and the near edge you stand on. */
function lockside(g: Element): Lockside {
  const defs = element('defs', {}, g);
  defs.innerHTML =
    '<pattern id="cu-brick" width="36" height="16" patternUnits="userSpaceOnUse"><rect width="36" height="16" fill="#a87458"/><path d="M0 15.5H36M0 7.5H36M9 0V7.5M27 8V16" stroke="#8a5c45" stroke-width="1.2"/></pattern>' +
    '<linearGradient id="cu-water" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7fb8ca"/><stop offset="1" stop-color="#3f7389"/></linearGradient>' +
    '<linearGradient id="cu-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#cfe5ec"/><stop offset="1" stop-color="#eef0e2"/></linearGradient>';
  const x0 = -BEYOND;
  const wide = W + 2 * BEYOND;
  const hedge: string[] = [];
  for (let x = x0 - 6; x < W + BEYOND + 10; x += 15) hedge.push(tag('circle', { cx: x, cy: 62 + (((x % 4) + 4) % 4), r: 11, fill: ['#41763a', '#5a9447', '#4d8840'][Math.abs(x) % 3] }));
  const stones: string[] = [];
  for (let x = x0 + 20; x < W + BEYOND; x += 64) stones.push(`M${x} 316v26`);
  const gravel: string[] = [];
  for (let i = 0; i < 160; i++) gravel.push(tag('circle', { cx: x0 + ((i * 97) % wide), cy: 348 + ((i * 31) % 40), r: 1.8, fill: '#a8986e' }));
  element('g', {}, g).innerHTML = [
    tag('rect', { x: x0, y: -BEYOND, width: wide, height: BEYOND, fill: '#cfe5ec' }),
    tag('rect', { x: x0, width: wide, height: 70, fill: 'url(#cu-sky)' }),
    ...hedge,
    tag('rect', { x: x0, y: 66, width: wide, height: 28, fill: '#9cc477' }),
    tag('rect', { x: x0, y: 92, width: wide, height: 12, fill: COLOURS.coping }),
    tag('path', { d: `M${x0} 104H${W + BEYOND}`, stroke: COLOURS.copingEdge, 'stroke-width': 2 }),
    tag('rect', { x: x0, y: 104, width: wide, height: 216, fill: 'url(#cu-brick)' }),
  ].join('');
  const wet = element('rect', { x: x0, y: 132, width: wide, height: 0, fill: '#3a2418', opacity: 0.32 }, g);
  const water = element('rect', { x: x0, y: 132, width: wide, height: 200, fill: 'url(#cu-water)' }, g);
  const surface = element('path', { d: '', stroke: '#d6eef4', 'stroke-width': 2.4, fill: 'none', opacity: 0.8 }, g);
  const swirl = element('g', { opacity: 0 }, g);
  const rings = [0, 1, 2].map(() => element('ellipse', { rx: 20, ry: 5, fill: 'none', stroke: '#eaf7fb', 'stroke-width': 2 }, swirl));
  element('g', {}, g).innerHTML = [
    tag('rect', { x: x0, y: 316, width: wide, height: 26, fill: COLOURS.coping }),
    tag('path', { d: stones.join(''), stroke: COLOURS.copingEdge, 'stroke-width': 1.4 }),
    tag('path', { d: `M${x0} 316H${W + BEYOND}`, stroke: '#8f8676', 'stroke-width': 3 }),
    tag('rect', { x: x0, y: 342, width: wide, height: BEYOND, fill: '#c4b48a' }),
    ...gravel,
  ].join('');
  return { wet, water, surface, swirl, rings, wetTop: null };
}

/** The water stands at `y`; the wet line it leaves dries slowly, and a swirl at `x` shows it rushing through the paddle. */
function lockWater(o: Lockside, y: number, time: number, dt: number, flow: number, x: number): void {
  o.wetTop = o.wetTop === null ? y : Math.min(o.wetTop + 4 * dt, y);
  o.wet.setAttribute('y', f1(o.wetTop));
  o.wet.setAttribute('height', f1(Math.max(0, y - o.wetTop)));
  o.water.setAttribute('y', f1(y));
  o.water.setAttribute('height', f1(330 - y));
  let d = `M${-BEYOND} ${f1(y)}`;
  for (let px = -BEYOND; px <= W + BEYOND; px += 40) d += `L${px} ${f1(y + Math.sin(px / 50 + time * 2) * 1.6)}`;
  o.surface.setAttribute('d', d);
  o.swirl.setAttribute('opacity', Math.min(1, flow * 2).toFixed(2));
  o.rings.forEach((r, i) => {
    const ph = (time * 0.8 + i / 3) % 1;
    r.setAttribute('cx', f1(x));
    r.setAttribute('cy', f1(y + 10 + ph * 6));
    r.setAttribute('rx', f1(10 + ph * 50));
    r.setAttribute('ry', f1(3 + ph * 7));
    r.setAttribute('stroke-opacity', (1 - ph).toFixed(2));
  });
}

// ---- The paddle -------------------------------------------------------------------

export interface PaddlePicture {
  /** How far the paddle is wound up, 0 to 1. */
  readonly open: number;
  readonly catchOn: boolean;
  /** How far the spindle has turned, in radians. */
  readonly angle: number;
  /** Water in the chamber, 0 low to 1 high, and how hard it's running through the paddle. */
  readonly water: number;
  readonly flow: number;
  /** Where the windlass is drawn, and its angle. */
  readonly windlass: { readonly at: Point; readonly angle: number };
  /** The next thing to touch, if a ring should show it. */
  readonly ring: Point | null;
}

const RING_START = Math.PI * 0.75;
const RING_END = Math.PI * 2.25;
const RING_R = 128;

export class PaddleCloseup {
  private readonly scene: Lockside;
  private readonly progress: SVGPathElement;
  private readonly wheel: SVGGElement;
  private readonly pawl: SVGGElement;
  private readonly pawlBar: SVGPathElement;
  private readonly windlass: SVGGElement;
  private readonly words: SVGTextElement;
  private readonly ring: SVGCircleElement;

  constructor(svg: SVGSVGElement) {
    svg.replaceChildren();
    const g = element('g', {}, svg);
    this.scene = lockside(g);
    const [cx, cy] = PADDLE_LAYOUT.spindle;
    // The gear stands on a post on the lockside, with its shadow on the stones.
    element('g', {}, g).innerHTML = [
      tag('ellipse', { cx, cy: 338, rx: 92, ry: 7, fill: '#000', opacity: 0.2 }),
      tag('rect', { x: cx - 28, y: cy, width: 56, height: 326 - cy, rx: 6, fill: DIAL.post, stroke: DIAL.postEdge, 'stroke-width': 2 }),
      tag('rect', { x: cx - 70, y: 318, width: 140, height: 16, rx: 4, fill: DIAL.post, stroke: DIAL.postEdge, 'stroke-width': 2 }),
      // The ring that fills as the paddle opens.
      tag('path', { d: this.arc(RING_START, RING_END), stroke: DIAL.track, 'stroke-width': 18, fill: 'none', 'stroke-linecap': 'round' }),
    ].join('');
    this.progress = element('path', { d: '', stroke: DIAL.gold, 'stroke-width': 18, fill: 'none', 'stroke-linecap': 'round' }, g);
    text(g, cx + Math.cos(RING_START) * RING_R - 6, cy + Math.sin(RING_START) * RING_R + 32, 'shut', { 'text-anchor': 'middle', class: 'cu-tag' });
    text(g, cx + Math.cos(RING_END) * RING_R + 6, cy + Math.sin(RING_END) * RING_R + 32, 'open', { 'text-anchor': 'middle', class: 'cu-tag' });
    // The toothed wheel with the square spindle at its middle.
    this.wheel = element('g', {}, g);
    this.wheel.innerHTML =
      ratchet(84, 76, 22, { fill: DIAL.wheel, stroke: DIAL.wheelEdge, 'stroke-width': 1.5 }) +
      tag('circle', { r: 68, fill: DIAL.disc }) +
      tag('rect', { x: -15, y: -15, width: 30, height: 30, rx: 4, fill: DIAL.spindle, stroke: DIAL.spindleEdge, 'stroke-width': 2 });
    // The catch hangs from a pin above the wheel and rests in its teeth.
    this.pawl = element('g', { class: 'cu-hot' }, g);
    element('circle', { cy: 20, r: 30, fill: 'transparent' }, this.pawl);
    this.pawlBar = element('path', { d: 'M0 0V42', stroke: DIAL.catchOn, 'stroke-width': 11, 'stroke-linecap': 'round' }, this.pawl);
    element('circle', { r: 7.5, fill: DIAL.disc, stroke: DIAL.spindle, 'stroke-width': 2 }, this.pawl);
    text(g, cx + 14, 98, 'catch', { class: 'cu-tag' });
    // The windlass: a square socket, an arm and a round handle.
    this.windlass = element('g', { class: 'cu-hot' }, g);
    this.windlass.innerHTML =
      tag('rect', { x: -16, y: -16, width: 32, height: 32, rx: 5, fill: DIAL.hub, stroke: DIAL.spindle, 'stroke-width': 2 }) +
      tag('rect', { x: 0, y: -7, width: PADDLE_LAYOUT.arm, height: 14, rx: 7, fill: DIAL.bar }) +
      tag('circle', { cx: PADDLE_LAYOUT.arm, r: 20, fill: DIAL.knob, stroke: DIAL.knobEdge, 'stroke-width': 3 });
    // What the paddle is doing, in words.
    const pill = element('g', {}, g);
    element('rect', { x: cx - 150, y: 350, width: 300, height: 34, rx: 17, fill: DIAL.pill, opacity: 0.85 }, pill);
    this.words = text(pill, cx, 373, '', { 'text-anchor': 'middle', class: 'cu-pill' });
    this.ring = glowRing(g, 30);
  }

  private arc(a0: number, a1: number): string {
    const [cx, cy] = PADDLE_LAYOUT.spindle;
    const p0 = [cx + Math.cos(a0) * RING_R, cy + Math.sin(a0) * RING_R];
    const p1 = [cx + Math.cos(a1) * RING_R, cy + Math.sin(a1) * RING_R];
    return `M${f1(p0[0])} ${f1(p0[1])}A${RING_R} ${RING_R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f1(p1[0])} ${f1(p1[1])}`;
  }

  render(p: PaddlePicture, time: number, dt: number): void {
    lockWater(this.scene, 132 + (1 - p.water) * 160, time, dt, p.flow, 170);
    this.progress.setAttribute('d', p.open > 0.005 ? this.arc(RING_START, RING_START + (RING_END - RING_START) * p.open) : '');
    this.words.textContent = `paddle ${Math.round(p.open * 100)}% open · catch ${p.catchOn ? 'on' : 'off'}`;
    const [sx, sy] = PADDLE_LAYOUT.spindle;
    this.wheel.setAttribute('transform', `translate(${sx} ${sy}) rotate(${deg(p.angle)})`);
    // The catch clicks over each tooth as the wheel turns, and swings clear when it's off.
    const click = p.catchOn ? (Math.sin(p.angle * 9) > 0.7 ? 4 : 0) : -38;
    this.pawl.setAttribute('transform', `translate(${sx} 72) rotate(${click})`);
    this.pawlBar.setAttribute('stroke', p.catchOn ? DIAL.catchOn : DIAL.catchOff);
    this.windlass.setAttribute('transform', `translate(${f1(p.windlass.at[0])} ${f1(p.windlass.at[1])}) rotate(${deg(p.windlass.angle)})`);
    placeRing(this.ring, p.ring);
  }
}

// ---- The gate ---------------------------------------------------------------------

export interface GatePicture {
  /** The beam's angle: 0 with the gate open, up to the angle it rests at shut. */
  readonly angle: number;
  readonly open: number;
  /** Water either side of the gate, 0 low to 1 high. */
  readonly left: number;
  readonly right: number;
  /** Whether the levels match, so the gate can move. */
  readonly level: boolean;
  readonly ring: Point | null;
}

export class GateCloseup {
  private readonly leftWater: SVGRectElement;
  private readonly rightWater: SVGRectElement;
  private readonly progress: SVGPathElement;
  private readonly leaf: SVGGElement;
  private readonly person: SVGGElement;
  private readonly dot: SVGCircleElement;
  private readonly words: SVGTextElement;
  private readonly ring: SVGCircleElement;

  /** `sides` names the water either side of the gate, left then right. */
  constructor(
    svg: SVGSVGElement,
    sides: readonly [string, string],
    private readonly shutAngle: number,
  ) {
    svg.replaceChildren();
    const g = element('g', {}, svg);
    const [hx, hy] = GATE_LAYOUT.hinge;
    const x0 = -BEYOND;
    const wide = W + 2 * BEYOND;
    const pebbles: string[] = [];
    for (let i = 0; i < 160; i++) pebbles.push(tag('circle', { cx: x0 + ((i * 137) % wide), cy: 8 + ((i * 53) % 30), r: 1.6, fill: LOCKSIDE.pebble, opacity: 0.7 }));
    element('g', {}, g).innerHTML = [
      tag('rect', { x: x0, y: -BEYOND, width: wide, height: H + 2 * BEYOND, fill: LOCKSIDE.lockside }),
      tag('rect', { x: x0, y: -BEYOND, width: wide, height: BEYOND + 44, fill: COLOURS.towpath }),
      tag('path', { d: `M${x0} 44H${W + BEYOND}`, stroke: COLOURS.towpathEdge, 'stroke-width': 2 }),
      ...pebbles,
    ].join('');
    this.leftWater = element('rect', { x: x0, y: hy, width: hx - x0, height: H - hy + BEYOND, fill: COLOURS.water }, g);
    this.rightWater = element('rect', { x: hx, y: hy, width: W + BEYOND - hx, height: H - hy + BEYOND, fill: COLOURS.water }, g);
    const joints: string[] = [];
    for (let x = x0 + 10; x < W + BEYOND; x += 28) joints.push(`M${x} ${hy - 16}v16`);
    element('g', {}, g).innerHTML =
      tag('rect', { x: x0, y: hy - 16, width: wide, height: 16, fill: COLOURS.coping }) + tag('path', { d: joints.join(''), stroke: COLOURS.copingEdge, 'stroke-width': 1 });
    text(g, 24, hy + 34, sides[0], { class: 'cu-water' });
    text(g, W - 24, hy + 34, sides[1], { 'text-anchor': 'end', class: 'cu-water' });
    // The worn path the beam's end walks round, as the dial's track.
    element('path', { d: this.track(Math.PI + shutAngle, Math.PI), stroke: DIAL.track, 'stroke-width': 26, fill: 'none', 'stroke-linecap': 'round' }, g);
    const shut = [hx - Math.cos(shutAngle) * GATE_LAYOUT.beam, hy - Math.sin(shutAngle) * GATE_LAYOUT.beam];
    text(g, shut[0] - 30, shut[1] - 2, 'shut', { 'text-anchor': 'end', class: 'cu-tag' });
    text(g, hx - GATE_LAYOUT.beam - 6, hy + 70, 'open', { 'text-anchor': 'middle', class: 'cu-tag' });
    this.progress = element('path', { d: '', stroke: DIAL.gold, 'stroke-width': 26, fill: 'none', 'stroke-linecap': 'round' }, g);
    // The gate leaf and its balance beam turn together round the hinge.
    this.leaf = element('g', { class: 'cu-hot' }, g);
    this.leaf.innerHTML = [
      tag('path', { d: `M0 0H${GATE_LAYOUT.leaf}`, stroke: LOCKSIDE.gate, 'stroke-width': 16, 'stroke-linecap': 'round' }),
      tag('path', { d: `M0 -10H${-GATE_LAYOUT.beam}`, stroke: 'transparent', 'stroke-width': 60, 'stroke-linecap': 'round' }),
      tag('path', { d: `M0 -10H${-GATE_LAYOUT.beam}`, stroke: LOCKSIDE.beam, 'stroke-width': 16, 'stroke-linecap': 'round' }),
      tag('path', { d: `M${-GATE_LAYOUT.beam + 46} -10H${-GATE_LAYOUT.beam}`, stroke: LOCKSIDE.beamTip, 'stroke-width': 12, 'stroke-linecap': 'round' }),
      tag('circle', { r: 10, fill: '#2b2b2b' }),
    ].join('');
    this.person = element('g', {}, g);
    this.person.innerHTML = personFromAbove('#a8402f', '#5a3b2a');
    element('rect', { x: 500, y: 58, width: 280, height: 40, rx: 20, fill: DIAL.pill, opacity: 0.85 }, g);
    this.dot = element('circle', { cx: 524, cy: 78, r: 7 }, g);
    this.words = text(g, 540, 84, '', { class: 'cu-pill' });
    this.ring = glowRing(g, 34);
  }

  private track(a0: number, a1: number): string {
    const [hx, hy] = GATE_LAYOUT.hinge;
    const points: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = a0 + ((a1 - a0) * i) / 24;
      points.push(`${f1(hx + Math.cos(a) * GATE_LAYOUT.beam)} ${f1(hy + Math.sin(a) * GATE_LAYOUT.beam)}`);
    }
    return `M${points.join('L')}`;
  }

  /** The end of the beam, `reach` from the hinge, at the beam's angle. */
  static beamEnd(angle: number, reach: number): Point {
    const [hx, hy] = GATE_LAYOUT.hinge;
    return [hx - Math.cos(angle) * reach, hy - Math.sin(angle) * reach];
  }

  render(p: GatePicture): void {
    this.leftWater.setAttribute('fill', waterColour(p.left));
    this.rightWater.setAttribute('fill', waterColour(p.right));
    const [hx, hy] = GATE_LAYOUT.hinge;
    this.leaf.setAttribute('transform', `translate(${hx} ${hy}) rotate(${deg(p.angle)})`);
    const out = GateCloseup.beamEnd(p.angle, GATE_LAYOUT.beam + 18);
    this.person.setAttribute('transform', `translate(${f1(out[0])} ${f1(out[1])}) rotate(${deg(p.angle)}) scale(2.6)`);
    this.progress.setAttribute('d', p.open > 0.01 ? this.track(Math.PI + this.shutAngle, Math.PI + p.angle) : '');
    this.dot.setAttribute('fill', p.level ? DIAL.level : DIAL.catchOn);
    this.words.textContent = `gate ${Math.round(p.open * 100)}% open · ${p.level ? 'level ✓' : 'not level yet'}`;
    placeRing(this.ring, p.ring);
  }
}

/** Low water is darker, high water lighter, as in the lock from above. */
const waterColour = (level: number): string => mixHex(COLOURS.water, LOCKSIDE.high, level);
