// The water behind a moving boat: short curved ripples left in the water
// where the stern passed, spreading out at the angle a real wake makes until
// they reach the bank and fade, and a faint pale trail along the way the boat
// has come. Where the stern has been is all the drawing needs to remember,
// and only for a few seconds, so none of it is kept with your place.

import { clamp } from '../core/math';
import { TOP_SPEED } from '../sim/boat';
import { element, f1 } from './svg';

/** One place the stern passed: where, which way the boat was facing, how fast, and how much room there was to each side. */
interface Mark {
  readonly x: number;
  readonly y: number;
  /** The boat's heading, and the way to its right. */
  readonly hx: number;
  readonly hy: number;
  readonly nx: number;
  readonly ny: number;
  readonly time: number;
  /** How far the stern had come when it passed here. */
  readonly run: number;
  /** How fast the boat was going, as a share of top speed. */
  readonly pace: number;
  /** Open water to the boat's right and left of here. */
  readonly right: number;
  readonly left: number;
  /** Every other mark sets off a pair of ripples. */
  readonly ripples: boolean;
}

/** How far behind the middle of the boat its stern is. */
const STERN = 38;
/** The stern leaves a mark every this many units it moves. */
const SPACING = 4;
/** Seconds a ripple lasts. */
const RIPPLE_LIFE = 7;
/** How fast ripples spread sideways, as a share of the boat's speed: the wake's angle of about 20 degrees. */
const SPREAD = 0.36;
/** How far behind the trail reaches, and the longest it lasts once the boat has stopped. */
const TRAIL_REACH = 160;
const TRAIL_LIFE = 25;
/** The trail is drawn in a few shades rather than one shape per mark. */
const TRAIL_SHADES = 6;
const TRAIL_MOST = 0.1;
/** A jump further than this, such as a new day or coming back to the tab, starts the wake afresh. */
const JUMP = 40;

/** How much open water there is from a point, going one way, up to the widest the wake spreads. */
export type Room = (x: number, y: number, dx: number, dy: number) => number;

export class Wake {
  private readonly group: SVGGElement;
  private readonly ripples: SVGPathElement[];
  private readonly trail: SVGPathElement[];
  private readonly marks: Mark[] = [];
  private run = 0;
  private count = 0;

  constructor(parent: Element, before: Element, private readonly room: Room) {
    this.group = element('g', { 'pointer-events': 'none' });
    parent.insertBefore(this.group, before);
    this.trail = Array.from({ length: TRAIL_SHADES }, (_, i) => element('path', { fill: '#eaf7fb', opacity: (((i + 0.5) / TRAIL_SHADES) * TRAIL_MOST).toFixed(3) }, this.group));
    const most = Math.ceil((RIPPLE_LIFE * TOP_SPEED) / (2 * SPACING)) + 2;
    this.ripples = Array.from({ length: most * 2 }, () => element('path', { fill: 'none', stroke: '#eaf7fb', 'stroke-width': 1.3, 'stroke-linecap': 'round', opacity: 0 }, this.group));
  }

  /** Follows the boat at `pose`, going at `v`, and draws its wake if `show`. */
  update(pose: { x: number; y: number; angle: number }, v: number, time: number, show: boolean): void {
    const hx = Math.cos(pose.angle);
    const hy = Math.sin(pose.angle);
    const x = pose.x - hx * STERN;
    const y = pose.y - hy * STERN;
    const last = this.marks[this.marks.length - 1];
    if (last && (time < last.time || Math.hypot(x - last.x, y - last.y) > JUMP)) this.marks.length = 0;
    const prev = this.marks[this.marks.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) >= SPACING) {
      this.run += prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
      const nx = -hy;
      const ny = hx;
      this.marks.push({ x, y, hx, hy, nx, ny, time, run: this.run, pace: clamp(v / TOP_SPEED, 0, 1), right: this.room(x, y, nx, ny), left: this.room(x, y, -nx, -ny), ripples: this.count++ % 2 === 0 });
    }
    while (this.marks.length && (time - this.marks[0].time > TRAIL_LIFE || this.run - this.marks[0].run > TRAIL_REACH + SPACING)) this.marks.shift();
    this.group.setAttribute('display', show ? '' : 'none');
    if (!show) return;
    this.drawTrail(x, y, clamp(v / TOP_SPEED, 0, 1), time);
    this.drawRipples(time);
  }

  /** Hides the wake while its boat is out of sight, and forgets where it has been. */
  hide(): void {
    this.marks.length = 0;
    this.group.setAttribute('display', 'none');
  }

  private drawTrail(x: number, y: number, pace: number, time: number): void {
    const shades: string[] = Array.from({ length: TRAIL_SHADES }, () => '');
    const run = this.run + Math.hypot(x - (this.marks[this.marks.length - 1]?.x ?? x), y - (this.marks[this.marks.length - 1]?.y ?? y));
    // The marks, oldest first, and the stern where it is now.
    const last = this.marks[this.marks.length - 1];
    const points = last ? [...this.marks, { ...last, x, y, time, run, pace }] : [];
    const edge = (m: Mark) => {
      const behind = run - m.run;
      const w = 4.5 + 12.5 * Math.min(1, behind / TRAIL_REACH);
      const right = Math.min(w, m.right);
      const left = Math.min(w, m.left);
      return { r: [m.x + m.nx * right, m.y + m.ny * right], l: [m.x - m.nx * left, m.y - m.ny * left], behind };
    };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const ea = edge(a);
      const eb = edge(b);
      const strength = 0.24 * 0.4 * b.pace * (1 - eb.behind / TRAIL_REACH) * (1 - (time - b.time) / TRAIL_LIFE);
      const shade = Math.floor((strength / TRAIL_MOST) * TRAIL_SHADES);
      if (shade < 0 || strength <= 0.004) continue;
      shades[Math.min(TRAIL_SHADES - 1, shade)] += `M${f1(ea.r[0])} ${f1(ea.r[1])}L${f1(eb.r[0])} ${f1(eb.r[1])}L${f1(eb.l[0])} ${f1(eb.l[1])}L${f1(ea.l[0])} ${f1(ea.l[1])}Z`;
    }
    this.trail.forEach((p, i) => p.setAttribute('d', shades[i] || 'M0 0'));
  }

  private drawRipples(time: number): void {
    let used = 0;
    for (let i = this.marks.length - 1; i >= 0 && used < this.ripples.length; i--) {
      const m = this.marks[i];
      const age = time - m.time;
      if (age > RIPPLE_LIFE) break;
      if (!m.ripples || m.pace <= 0.01) continue;
      for (const side of [1, -1]) {
        const room = Math.max(2, (side > 0 ? m.right : m.left) - 3);
        let out = 4.5 + SPREAD * m.pace * TOP_SPEED * age;
        let fade = 1 - age / RIPPLE_LIFE;
        // At the bank a ripple stops spreading and dies away.
        if (out > room) {
          fade *= Math.max(0, 1 - (out - room) / 8);
          out = room + (out - room) * 0.25;
        }
        const length = Math.min(7.5, 2.2 + 1.1 * age);
        const cx = m.x + m.nx * side * out;
        const cy = m.y + m.ny * side * out;
        // Each crest leans back from the boat's line, its outer end furthest behind.
        const dx = (-0.57 * m.hx + 0.82 * side * m.nx) * length;
        const dy = (-0.57 * m.hy + 0.82 * side * m.ny) * length;
        const p = this.ripples[used++];
        p.setAttribute('d', `M${f1(cx - dx)} ${f1(cy - dy)}Q${f1(cx - m.hx * 1.6)} ${f1(cy - m.hy * 1.6)} ${f1(cx + dx)} ${f1(cy + dy)}`);
        p.setAttribute('opacity', (0.62 * m.pace * Math.pow(fade, 1.3) * Math.min(1, age / 0.5)).toFixed(2));
      }
    }
    for (let i = used; i < this.ripples.length; i++) this.ripples[i].setAttribute('opacity', '0');
  }
}
