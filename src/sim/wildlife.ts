// Life on and by the water: fish rising, ducks and swans, and the sheep and
// cows grazing the meadows. Like the people on the towpath, where everything
// is comes from the canal's seed and the time of day alone, so there's
// nothing to keep. The birds ease towards the far bank as a boat comes by,
// worked out afresh each moment from where the boats are.

import { clamp, seededRandom, smoothstep } from '../core/math';
import { nearestDistance, poseAt } from '../core/track';
import type { Point } from '../core/track';
import { CANAL_WIDTH } from '../world/dimensions';
import type { Stretch } from '../world/stretch';

/** A quiet stretch of open water, away from locks, bridges, moored boats, the junction and the moorings for the night. */
interface Reach {
  readonly waterway: string;
  readonly from: number;
  readonly to: number;
}

/** How far each kind of feature keeps the wildlife away, either side of where it is. */
const KEEP_CLEAR = { lock: 220, bridge: 80, footbridge: 60, moorings: 180, basin: 260, bank: 240 } as const;

/** The stretches of open water where fish rise and birds swim. */
export function quietReaches(stretch: Stretch): Reach[] {
  const reaches: Reach[] = [];
  for (const [id, track] of stretch.waterways) {
    const busy: [number, number][] = [[-Infinity, 150], [track.length - 150, Infinity]];
    for (const f of stretch.data.features) {
      if (f.waterway !== id) continue;
      const gap = KEEP_CLEAR[f.kind];
      if (f.kind === 'moorings') {
        const ats = f.boats.map((b) => b.at);
        busy.push([Math.min(...ats) - gap, Math.max(...ats) + gap]);
      } else if (f.kind === 'bank') {
        const ats = f.spots.map((sp) => sp.at);
        busy.push([Math.min(f.at, ...ats) - gap, Math.max(f.at, ...ats) + gap]);
      } else busy.push([f.at - gap, f.at + gap]);
    }
    // Where a branch leaves this waterway, and where it begins.
    for (const w of stretch.data.waterways) {
      if (w.leaves?.waterway === id) {
        const s = nearestDistance(track, stretch.data.waterways.find((p) => p.id === id)!.points[w.leaves.atPoint]);
        busy.push([s - 200, s + 200]);
      }
      if (w.id === id && w.leaves) busy.push([-Infinity, 200]);
    }
    busy.sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [a, b] of busy) {
      if (a - at > 120) reaches.push({ waterway: id, from: at, to: a });
      at = Math.max(at, b);
    }
    if (track.length - at > 120) reaches.push({ waterway: id, from: at, to: track.length });
  }
  return reaches;
}

/** A place where a fish rises now and then. */
export interface Rise {
  readonly waterway: string;
  readonly s: number;
  /** Distance right of the waterway's centre line. */
  readonly d: number;
  /** Seconds between one rise and the next, and how far into that the day begins. */
  readonly every: number;
  readonly offset: number;
}

/** Seconds a ring from a rising fish takes to spread and fade. */
export const RISE_LIFE = 3.2;
/** The open water either side of the middle, short of the bank. */
const OPEN = CANAL_WIDTH / 2 - 5;

/** Where fish rise along the canal, about one place in every 120 units of open water. */
export function planRises(stretch: Stretch, seed: number): Rise[] {
  const r = seededRandom(seed ^ 0xf15);
  const rises: Rise[] = [];
  for (const reach of quietReaches(stretch)) {
    for (let s = reach.from + r() * 120; s < reach.to; s += 80 + 80 * r()) {
      rises.push({ waterway: reach.waterway, s, d: (r() * 2 - 1) * OPEN, every: 25 + 35 * r(), offset: r() * 60 });
    }
  }
  return rises;
}

/** How many seconds ago the fish rose, while its ring is still spreading, or null. */
export function riseAt(rise: Rise, time: number): number | null {
  const age = (((time + rise.offset) % rise.every) + rise.every) % rise.every;
  return age < RISE_LIFE ? age : null;
}

export type BirdKind = 'drake' | 'duck' | 'duckling' | 'swan';

/** A family on the water: a pair of mallards with their ducklings, or a pair of swans. */
export interface Flock {
  readonly waterway: string;
  /** The middle of the loop they swim, along the waterway and off its centre line. */
  readonly s: number;
  readonly d: number;
  /** How far along the bank the loop reaches each way, and how far across. */
  readonly along: number;
  readonly across: number;
  /** Seconds to swim the loop once, and how far round it they are when the day begins. */
  readonly period: number;
  readonly phase: number;
  readonly birds: readonly { readonly kind: BirdKind; readonly lag: number }[];
}

/** A bird on the water: where, and which way it faces. */
export interface Swimming {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** How near a boat comes before the birds start to move over, and how near before they're right by the bank. */
const SHY_FROM = 90;
const SHY_AT = 30;
/** How far the birds keep from the bank when they move over for a boat. */
const BY_BANK = CANAL_WIDTH / 2 - 3;

/** The ducks and swans along the canal: mallard families, and a pair of swans or two. */
export function planFlocks(stretch: Stretch, seed: number): Flock[] {
  const r = seededRandom(seed ^ 0xd0c);
  const reaches = quietReaches(stretch).filter((reach) => reach.to - reach.from > 260);
  const flocks: Flock[] = [];
  reaches.forEach((reach, i) => {
    // A family every 700 units or so of quiet water, and swans on every third reach.
    const count = Math.max(1, Math.round((reach.to - reach.from) / 700));
    for (let k = 0; k < count; k++) {
      const swans = (i + k) % 3 === 1;
      const along = swans ? 70 : 40;
      const room = reach.to - reach.from - 2 * along;
      const s = reach.from + along + (room * (k + 0.2 + 0.6 * r())) / count;
      const birds: { kind: BirdKind; lag: number }[] = swans
        ? [{ kind: 'swan', lag: 0 }, { kind: 'swan', lag: 0.16 }]
        : [{ kind: 'duck', lag: 0 }, ...Array.from({ length: 2 + Math.floor(r() * 4) }, (_, n) => ({ kind: 'duckling' as const, lag: 0.07 * (n + 1) })), { kind: 'drake', lag: 0.07 * 6 + 0.08 }];
      flocks.push({ waterway: reach.waterway, s, d: -(11 + 4 * r()), along, across: 3 + 2 * r(), period: (swans ? 420 : 260) * (0.85 + 0.3 * r()), phase: r() * Math.PI * 2, birds });
    }
  });
  return flocks;
}

/**
 * Where one of a flock's birds is at a time. They swim a long, slow loop by
 * the far bank, the young ones following on behind, and ease over to the
 * bank as a boat comes by.
 */
export function birdAt(stretch: Stretch, flock: Flock, lag: number, time: number, boats: readonly Point[]): Swimming {
  const track = stretch.waterways.get(flock.waterway);
  if (!track) throw new Error(`No waterway ${flock.waterway}`);
  const w = (Math.PI * 2) / flock.period;
  const a = time * w + flock.phase - lag;
  const s = flock.s + flock.along * Math.cos(a);
  const loose = poseAt(track, s, flock.d);
  let near = Infinity;
  for (const [x, y] of boats) near = Math.min(near, Math.hypot(x - loose.x, y - loose.y));
  const shy = smoothstep(SHY_FROM, SHY_AT, near);
  const d = clamp(flock.d + flock.across * Math.sin(a) - shy * 8, -BY_BANK, BY_BANK);
  const p = poseAt(track, s, d);
  // Which way they swim round the loop, turned a little towards the bank while they move over.
  const heading = Math.atan2(flock.across * Math.cos(a), -flock.along * Math.sin(a)) - shy * 0.5;
  return { x: p.x, y: p.y, angle: p.angle + heading };
}

/** A sheep or cow grazing: where it stands, which way it faces, and which of a few looks it has. */
export interface Grazer {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly look: number;
}

/** A grazing animal at a time: it wanders a few steps about where it stands and slowly turns as it crops the grass. */
export function grazeAt(animal: Grazer, time: number): Grazer {
  const k = animal.look * 0.61;
  const step = 4;
  return {
    x: animal.x + step * Math.sin(time / 37 + k) + 1.5 * Math.sin(time / 11 + k * 2),
    y: animal.y + step * Math.cos(time / 43 + k * 1.3),
    angle: animal.angle + 0.6 * Math.sin(time / 29 + k) + 0.2 * Math.sin(time / 7 + k),
    look: animal.look,
  };
}
