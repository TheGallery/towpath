// The life of the day around the boat: sheep and cows in the meadows, ducks
// and swans on the water, fish rising, cloud shadows going over, and the
// morning mist and drizzle. Everything here is drawn from a fixed set of
// shapes moved each frame, only near the view, and with soft gradients rather
// than blur filters, so it stays light on a phone.

import { clamp, seededRandom } from '../core/math';
import { poseAt } from '../core/track';
import type { Point, Track } from '../core/track';
import type { Light } from '../sim/day';
import { cloudAt, planClouds } from '../sim/weather';
import type { Cloud, Weather, WeatherNow } from '../sim/weather';
import { RISE_LIFE, birdAt, grazeAt, planFlocks, planRises, riseAt } from '../sim/wildlife';
import type { Flock } from '../sim/wildlife';
import type { View } from '../view/camera';
import type { Stretch } from '../world/stretch';
import { cowMarkup, ducklingMarkup, mallardMarkup, sheepMarkup, swanMarkup, swimRipplesMarkup } from './figures';
import type { Herd } from './scenery';
import { element, f1 } from './svg';

/** What the ambience needs to know each frame. */
export interface AmbientFrame {
  /** Seconds since the day began. */
  readonly time: number;
  readonly weather: Weather;
  readonly now: WeatherNow;
  readonly light: Light;
  /** Where the boats on the water are, for the birds to keep clear of. */
  readonly boats: readonly Point[];
  /** Today's route, and how far along it your boat is, for the mist and the drizzle on the water. */
  readonly route: Track;
  readonly along: number;
}

/** How much darker a cloud's shadow is at its middle. */
const SHADOW = 0.14;
/** A cloud's shadow is drawn a few times, each larger and fainter, for a soft edge. */
const SHADOW_EDGE: readonly (readonly [number, number])[] = [[1.3, 0.16], [1.2, 0.3], [1.1, 0.5], [1, 1]];
const SHEEP_SCALE = 1.5;
const COW_SCALE = 1.4;
const BIRD_SCALE = 1.4;
/** How many fish rings and drizzle rings can show at once. */
const RISES_AT_ONCE = 6;
const DRIZZLE_RINGS = 6;
/** Seconds between one drizzle ring and the next in each place, and how long each lasts. */
const DRIZZLE_EVERY = 1.4;
const DRIZZLE_LIFE = 1.2;
/** How far apart the banks of mist lie along the canal. */
const MIST_GAP = 170;
/** Drops of drizzle on a phone-sized screen, and the most on a big one. */
const DROPS_LEAST = 30;
const DROPS_MOST = 110;
const DROP_PIXELS = 9;

interface Animal {
  readonly g: SVGGElement;
  readonly at: Herd['animals'][number];
  readonly scale: number;
}

interface Bird {
  readonly g: SVGGElement;
  readonly flock: Flock;
  readonly lag: number;
}

const inView = (view: View, x: number, y: number, margin: number): boolean =>
  x > view.x - margin && x < view.x + view.width + margin && y > view.y - margin && y < view.y + view.height + margin;

/** A number from 0 to 1 for a pair of whole numbers, the same every time. */
const noise = (a: number, b: number): number => seededRandom(a * 7919 + b * 104729 + 17)();

export class Ambience {
  private readonly ground: SVGGElement;
  private readonly water: SVGGElement;
  private readonly sky: SVGGElement;
  private readonly animals: Animal[] = [];
  private readonly birds: Bird[] = [];
  private readonly rises: { readonly x: number; readonly y: number; readonly rise: ReturnType<typeof planRises>[number] }[];
  private readonly riseRings: SVGEllipseElement[];
  private readonly drizzleRings: SVGEllipseElement[];
  private readonly clouds: { readonly cloud: Cloud; readonly g: SVGGElement }[];
  private readonly mistVeil: SVGRectElement;
  private readonly mistBanks: SVGEllipseElement[];
  private readonly drizzleTint: SVGRectElement;
  private readonly drops: SVGPathElement;
  private readonly dropAt: readonly (readonly [number, number, number])[];

  constructor(
    private readonly stretch: Stretch,
    herds: readonly Herd[],
    seed: number,
    layers: { readonly ground: SVGGElement; readonly water: SVGGElement; readonly sky: SVGGElement },
  ) {
    ({ ground: this.ground, water: this.water, sky: this.sky } = layers);
    for (const herd of herds) {
      for (const at of herd.animals) {
        const g = element('g', { display: 'none' }, this.ground);
        g.innerHTML = herd.kind === 'sheep' ? sheepMarkup() : cowMarkup(at.look % 3 === 0);
        this.animals.push({ g, at, scale: herd.kind === 'sheep' ? SHEEP_SCALE : COW_SCALE });
      }
    }

    this.rises = planRises(stretch, seed).map((rise) => {
      const track = stretch.waterways.get(rise.waterway);
      if (!track) throw new Error(`No waterway ${rise.waterway}`);
      const p = poseAt(track, rise.s, rise.d);
      return { x: p.x, y: p.y, rise };
    });
    const ring = () => element('ellipse', { fill: 'none', stroke: '#c4e3ea', 'stroke-width': 1, opacity: 0 }, this.water);
    this.riseRings = Array.from({ length: RISES_AT_ONCE * 2 }, ring);
    this.drizzleRings = Array.from({ length: DRIZZLE_RINGS }, ring);
    for (const flock of planFlocks(stretch, seed)) {
      for (const { kind, lag } of flock.birds) {
        const g = element('g', { display: 'none' }, this.water);
        const body = kind === 'swan' ? swanMarkup() : kind === 'duckling' ? ducklingMarkup() : mallardMarkup(kind === 'drake');
        g.innerHTML = swimRipplesMarkup(kind === 'swan' ? 8 : kind === 'duckling' ? 2.5 : 4.5) + body;
        this.birds.push({ g, flock, lag });
      }
    }

    this.clouds = planClouds(seed).map((cloud) => {
      const g = element('g', { display: 'none' }, this.sky);
      g.innerHTML = SHADOW_EDGE.map(
        ([size, share]) =>
          `<g fill="#16261b" opacity="${(SHADOW * share).toFixed(3)}">${cloud.puffs.map(([x, y, rx, ry]) => `<ellipse cx="${f1(x * size)}" cy="${f1(y * size)}" rx="${f1(rx * size)}" ry="${f1(ry * size)}"/>`).join('')}</g>`,
      ).join('');
      return { cloud, g };
    });
    const far = { x: -stretch.data.size.width * 2, y: -stretch.data.size.height * 4, width: stretch.data.size.width * 5, height: stretch.data.size.height * 9 };
    this.mistVeil = element('rect', { ...far, fill: '#eef1ee', opacity: 0, display: 'none' }, this.sky);
    this.mistBanks = Array.from({ length: 7 }, () => element('ellipse', { rx: 160, ry: 46, fill: 'url(#tp-mist)', opacity: 0, display: 'none' }, this.sky));
    this.drizzleTint = element('rect', { ...far, fill: '#6d7c86', opacity: 0, display: 'none' }, this.sky);
    this.drops = element('path', { stroke: '#e6eef2', 'stroke-width': 0.7, 'stroke-linecap': 'round', fill: 'none', opacity: 0, display: 'none' }, this.sky);
    const r = seededRandom(seed ^ 0xd2122);
    this.dropAt = Array.from({ length: DROPS_MOST }, () => [r(), r(), 0.5 + 0.25 * r()] as const);
  }

  render(frame: AmbientFrame, view: View, screen: { readonly width: number; readonly height: number }): void {
    // Under the map there's nothing to see, so nothing is drawn.
    const shown = view.mapFade < 0.98;
    for (const layer of [this.ground, this.water, this.sky]) layer.setAttribute('display', shown ? '' : 'none');
    if (!shown) return;
    const { time } = frame;
    this.drawAnimals(time, view);
    this.drawBirds(frame, view);
    this.drawRises(time, view);
    this.drawClouds(frame, view);
    this.drawMist(frame);
    this.drawDrizzle(frame, view, screen);
  }

  private drawAnimals(time: number, view: View): void {
    for (const { g, at, scale } of this.animals) {
      const near = inView(view, at.x, at.y, 40);
      g.setAttribute('display', near ? '' : 'none');
      if (!near) continue;
      const now = grazeAt(at, time);
      g.setAttribute('transform', `translate(${f1(now.x)} ${f1(now.y)}) rotate(${f1((now.angle * 180) / Math.PI)}) scale(${scale})`);
    }
  }

  private drawBirds(frame: AmbientFrame, view: View): void {
    for (const { g, flock, lag } of this.birds) {
      const track = this.stretch.waterways.get(flock.waterway);
      const middle = track ? poseAt(track, flock.s) : null;
      const near = middle !== null && inView(view, middle.x, middle.y, flock.along + 60);
      g.setAttribute('display', near ? '' : 'none');
      if (!near) continue;
      const at = birdAt(this.stretch, flock, lag, frame.time, frame.boats);
      g.setAttribute('transform', `translate(${f1(at.x)} ${f1(at.y)}) rotate(${f1((at.angle * 180) / Math.PI)}) scale(${BIRD_SCALE})`);
    }
  }

  private drawRises(time: number, view: View): void {
    let used = 0;
    for (const { x, y, rise } of this.rises) {
      if (used >= RISES_AT_ONCE) break;
      if (!inView(view, x, y, 20)) continue;
      const age = riseAt(rise, time);
      if (age === null) continue;
      const fade = 1 - age / RISE_LIFE;
      // A wider ring, and a second one following it in.
      for (const [grow, share] of [[3, 0.75], [2, 0.5]] as const) {
        const ring = this.riseRings[used * 2 + (grow === 3 ? 0 : 1)];
        const rad = 0.8 + age * grow;
        ring.setAttribute('cx', f1(x));
        ring.setAttribute('cy', f1(y));
        ring.setAttribute('rx', f1(rad));
        ring.setAttribute('ry', f1(rad * 0.8));
        ring.setAttribute('opacity', (share * fade).toFixed(2));
      }
      used++;
    }
    for (let i = used * 2; i < this.riseRings.length; i++) this.riseRings[i].setAttribute('opacity', '0');
  }

  private drawClouds(frame: AmbientFrame, view: View): void {
    // Shadows only show while there's sun to cast them.
    const sun = clamp(1 - frame.light.dark * 1.4, 0, 1) * (1 - 0.6 * frame.now.drizzle);
    const centre: Point = [view.x + view.width / 2, view.y + view.height / 2];
    for (const { cloud, g } of this.clouds) {
      const [x, y] = cloudAt(cloud, frame.weather, frame.time, centre);
      const near = sun > 0.01 && inView(view, x, y, 260);
      g.setAttribute('display', near ? '' : 'none');
      if (!near) continue;
      g.setAttribute('transform', `translate(${f1(x)} ${f1(y)})`);
      g.setAttribute('opacity', sun.toFixed(2));
    }
  }

  private drawMist(frame: AmbientFrame): void {
    const { mist } = frame.now;
    const on = mist > 0.005;
    this.mistVeil.setAttribute('display', on ? '' : 'none');
    for (const bank of this.mistBanks) bank.setAttribute('display', on ? '' : 'none');
    if (!on) return;
    this.mistVeil.setAttribute('opacity', (mist * 0.22).toFixed(3));
    // Banks of mist lie along the canal about the boat, drifting slowly.
    const first = Math.floor(frame.along / MIST_GAP) - 3;
    this.mistBanks.forEach((bank, i) => {
      const k = first + i;
      const s = k * MIST_GAP + 30 * Math.sin(frame.time / 40 + k * 1.7);
      const p = poseAt(frame.route, s);
      bank.setAttribute('transform', `translate(${f1(p.x)} ${f1(p.y)}) rotate(${f1((p.angle * 180) / Math.PI)})`);
      bank.setAttribute('opacity', (mist * (0.6 + 0.25 * noise(k, 3))).toFixed(3));
    });
  }

  private drawDrizzle(frame: AmbientFrame, view: View, screen: { readonly width: number; readonly height: number }): void {
    const wet = frame.now.drizzle;
    const on = wet > 0.005;
    this.drizzleTint.setAttribute('display', on ? '' : 'none');
    this.drops.setAttribute('display', on ? '' : 'none');
    if (!on) {
      for (const ring of this.drizzleRings) ring.setAttribute('opacity', '0');
      return;
    }
    const { time } = frame;
    this.drizzleTint.setAttribute('opacity', (wet * 0.13).toFixed(3));
    // Fine drops falling across the screen, as many as suit its size.
    const count = clamp(Math.round((screen.width * screen.height) / 9000), DROPS_LEAST, DROPS_MOST);
    const k = view.unitsPerPixel;
    const length = DROP_PIXELS * k;
    let d = '';
    for (let i = 0; i < count; i++) {
      const [u0, v0, fall] = this.dropAt[i];
      const v = (((v0 + fall * time) % 1) + 1) % 1;
      const u = (((u0 - fall * 0.22 * time * (view.height / view.width)) % 1) + 1) % 1;
      const x = view.x + u * view.width;
      const y = view.y + v * view.height;
      d += `M${f1(x)} ${f1(y)}l${f1(-length * 0.22)} ${f1(length)}`;
    }
    this.drops.setAttribute('d', d);
    this.drops.setAttribute('stroke-width', f1(0.9 * k));
    this.drops.setAttribute('opacity', (0.35 * wet).toFixed(2));
    // And a few rings where they land on the canal near the boat.
    this.drizzleRings.forEach((ring, i) => {
      const offset = (i / DRIZZLE_RINGS) * DRIZZLE_EVERY;
      const n = Math.floor((time + offset) / DRIZZLE_EVERY);
      const age = time + offset - n * DRIZZLE_EVERY;
      const p = poseAt(frame.route, frame.along + (noise(i, n) - 0.5) * 500, (noise(i + 40, n) - 0.5) * 34);
      const rad = 0.4 + age * 4.5;
      ring.setAttribute('cx', f1(p.x));
      ring.setAttribute('cy', f1(p.y));
      ring.setAttribute('rx', f1(rad));
      ring.setAttribute('ry', f1(rad * 0.8));
      ring.setAttribute('opacity', (age < DRIZZLE_LIFE ? 0.6 * wet * (1 - age / DRIZZLE_LIFE) : 0).toFixed(2));
    });
  }
}
