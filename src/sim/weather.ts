// The day's weather and the clouds going over. Each day's weather comes from
// the canal's seed and the day's number, and how it looks at any moment is
// worked out from the phase of the day, so there's nothing to keep: a reload
// shows the same sky. All of it is only for the look of the day.

import { clamp, seededRandom, smoothstep } from '../core/math';
import { DAWN_TIME, EVENING_TIME } from './day';
import type { Day } from './day';

/** A spell of drizzle, in seconds since the boat cast off. */
export interface Drizzle {
  readonly from: number;
  readonly to: number;
}

export interface Weather {
  /** How thick the morning mist is, from 0 (none) to 1. */
  readonly mist: number;
  readonly drizzle: Drizzle | null;
  /** Which way the wind carries the clouds, in radians, and how fast in world units a second. */
  readonly wind: number;
  readonly windSpeed: number;
}

/** How the weather looks right now, each from 0 to 1. */
export interface WeatherNow {
  readonly mist: number;
  readonly drizzle: number;
}

/** Seconds after casting off for the morning mist to lift. */
export const MIST_LIFT = 300;
/** Seconds a spell of drizzle takes to come on, and to clear. */
export const DRIZZLE_FADE = 45;
/** The weather you can ask for with `?weather=`, for trying things out. */
export type WeatherName = 'mist' | 'drizzle' | 'clear';

/** A day's weather, the same every time for the same seed and day. */
export function planWeather(seed: number, dayNumber: number, asked: WeatherName | null = null): Weather {
  const r = seededRandom((seed ^ 0x7ea7) + dayNumber * 7919);
  const misty = r() < 0.55;
  const mist = misty ? 0.6 + 0.4 * r() : 0;
  const drizzly = r() < 0.4;
  const from = 120 + 480 * r();
  const drizzle = drizzly ? { from, to: from + 150 + 240 * r() } : null;
  const wind = r() * Math.PI * 2;
  const windSpeed = 2.5 + 2 * r();
  if (asked === 'mist') return { mist: 1, drizzle: null, wind, windSpeed };
  if (asked === 'drizzle') return { mist: 0, drizzle: { from: 0, to: Infinity }, wind, windSpeed };
  if (asked === 'clear') return { mist: 0, drizzle: null, wind, windSpeed };
  return { mist, drizzle, wind, windSpeed };
}

/**
 * How misty and drizzly it is at this point in the day. The mist lies over
 * the morning, lifts after you cast off, and gathers again at dawn. Drizzle
 * comes and goes while the boat is underway; a spell that lasts all day
 * carries on until the evening.
 */
export function weatherAt(day: Day, weather: Weather): WeatherNow {
  const t = day.phaseTime;
  let mist = 0;
  let drizzle = 0;
  const spell = weather.drizzle;
  switch (day.phase) {
    case 'morning':
    case 'over':
      mist = 1;
      break;
    case 'underway':
      mist = 1 - smoothstep(0, MIST_LIFT, t);
      if (spell) drizzle = smoothstep(spell.from, spell.from + DRIZZLE_FADE, t) * (spell.to === Infinity ? 1 : 1 - smoothstep(spell.to - DRIZZLE_FADE, spell.to, t));
      break;
    case 'dusk':
    case 'tying-up':
      if (spell && spell.to === Infinity) drizzle = 1;
      break;
    case 'evening':
      if (spell && spell.to === Infinity) drizzle = 1 - smoothstep(0, EVENING_TIME / 2, t);
      break;
    case 'dawn':
      mist = smoothstep(0, DAWN_TIME, t);
      break;
    case 'night':
      break;
  }
  return { mist: clamp(mist * weather.mist, 0, 1), drizzle: clamp(drizzle, 0, 1) };
}

/** One cloud: where it is in the sky's repeating square at the start of the day, and its shape. */
export interface Cloud {
  readonly x: number;
  readonly y: number;
  /** Puffs that make up its shadow, relative to its middle: x, y and radii. */
  readonly puffs: readonly (readonly [number, number, number, number])[];
}

/** The sky repeats every this many world units each way, so a few clouds cover any stretch. */
export const SKY_REPEAT = 1600;
const CLOUDS = 4;

/** The clouds whose shadows go over the land, the same every day for the same seed. */
export function planClouds(seed: number): Cloud[] {
  const r = seededRandom(seed ^ 0xc10d);
  const clouds: Cloud[] = [];
  for (let i = 0; i < CLOUDS; i++) {
    const size = 0.75 + 0.5 * r();
    const puffs: [number, number, number, number][] = [[0, 0, 70 * size, 42 * size]];
    const more = 2 + Math.floor(r() * 3);
    for (let k = 0; k < more; k++) {
      const a = r() * Math.PI * 2;
      const reach = (35 + 25 * r()) * size;
      puffs.push([Math.cos(a) * reach, Math.sin(a) * reach * 0.6, (38 + 18 * r()) * size, (24 + 12 * r()) * size]);
    }
    clouds.push({ x: r() * SKY_REPEAT, y: r() * SKY_REPEAT, puffs });
  }
  return clouds;
}

/** Where a cloud's middle is at a time, carried by the wind, as the copy nearest a point. */
export function cloudAt(cloud: Cloud, weather: Weather, time: number, near: readonly [number, number]): [number, number] {
  const nearest = (start: number, drift: number, centre: number) => {
    const at = start + drift * time;
    return at + Math.round((centre - at) / SKY_REPEAT) * SKY_REPEAT;
  };
  return [
    nearest(cloud.x, Math.cos(weather.wind) * weather.windSpeed, near[0]),
    nearest(cloud.y, Math.sin(weather.wind) * weather.windSpeed, near[1]),
  ];
}
