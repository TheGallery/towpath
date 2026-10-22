// People on the towpath: walkers, some with a dog, and joggers. Each comes
// onto the towpath at a bridge or an end of it, goes out a way (over the
// footbridge at a junction, if it takes them that far), turns back,
// and leaves where they came on, then comes out again a while later. Where
// they are is worked out from the time of day alone, so there's nothing to
// keep. In the evening everyone still out turns for home, and nobody new
// comes out until the next day.

import { seededRandom } from '../core/math';
import { unitsPerSecond } from '../world/dimensions';
import type { TowpathRun } from '../world/towpath';

export type WalkerKind = 'walker' | 'jogger';

export interface Walker {
  readonly kind: WalkerKind;
  readonly dog: boolean;
  /** Which run of towpath they walk, and where on it they come on and leave. */
  readonly run: number;
  readonly home: number;
  /** Which way along the run they set off. */
  readonly dir: 1 | -1;
  /** How far they go before turning back. */
  readonly reach: number;
  readonly speed: number;
  /** Seconds off the towpath between one outing and the next. */
  readonly rest: number;
  /** How far into their round they are when the day begins, in seconds. */
  readonly offset: number;
  /** Which coat, hat or dog they have. */
  readonly look: number;
}

export const WALK_SPEED = unitsPerSecond(2.8);
export const JOG_SPEED = unitsPerSecond(5.5);
/** The furthest a walker goes from where they came on, so all are home soon after dark. */
export const WALK_REACH = 650;
export const JOG_REACH = 1200;
/** How many people use the towpath in a day. */
export const WALKERS = 24;

/** People keep left, as on any English path, this far either side of the towpath's middle. */
const KEEP_LEFT = 2.2;

/** The day's people on the towpath, the same every day for the same seed. */
export function planWalkers(runs: readonly TowpathRun[], seed: number, count = WALKERS): Walker[] {
  const r = seededRandom(seed ^ 0x5eed);
  const total = runs.reduce((a, run) => a + run.track.length, 0);
  const walkers: Walker[] = [];
  for (let i = 0; i < count; i++) {
    // Longer runs get more people.
    let run = 0;
    for (let pick = r() * total; run < runs.length - 1; run++) {
      const length = runs[run].track.length;
      if (pick < length) break;
      pick -= length;
    }
    const { track, exits } = runs[run];
    const home = exits[Math.floor(r() * exits.length)];
    const jogger = r() < 0.25;
    const roomAhead = track.length - 10 - home;
    const roomBehind = home - 10;
    // Set off into the towpath, the longer way where there's a choice.
    const dir: 1 | -1 = roomAhead < 150 ? -1 : roomBehind < 150 ? 1 : r() < 0.5 ? 1 : -1;
    const room = dir > 0 ? roomAhead : roomBehind;
    const most = jogger ? JOG_REACH : WALK_REACH;
    const reach = Math.min(room, most * (0.45 + 0.55 * r()));
    const speed = (jogger ? JOG_SPEED : WALK_SPEED) * (0.88 + 0.24 * r());
    const rest = 20 + r() * 140;
    const period = (2 * reach) / speed + rest;
    walkers.push({ kind: jogger ? 'jogger' : 'walker', dog: !jogger && r() < 0.5, run, home, dir, reach, speed, rest, offset: r() * period, look: Math.floor(r() * 1000) });
  }
  return walkers;
}

/** Someone out on the towpath: how far along their run, how far off the towpath's middle, and which way they face. */
export interface OnTowpath {
  readonly run: number;
  readonly s: number;
  readonly d: number;
  readonly facing: 1 | -1;
  /** How far they are from where they leave the towpath, so they can fade as they step off. */
  readonly fromHome: number;
}

/** How far from home someone is at a time, and whether they're still going out, or null if they're at home. */
function outing(w: Walker, time: number): { readonly gone: number; readonly out: boolean } | null {
  const out = w.reach / w.speed;
  const period = 2 * out + w.rest;
  const u = (((time + w.offset) % period) + period) % period;
  if (u < out) return { gone: u * w.speed, out: true };
  if (u < 2 * out) return { gone: (2 * out - u) * w.speed, out: false };
  return null;
}

/**
 * Where someone is at a time of day, or null if they're not on the towpath.
 * `homeFrom` is when the evening began, from when everyone heads home.
 */
export function walkerAt(w: Walker, time: number, homeFrom: number | null): OnTowpath | null {
  let gone: number;
  let out: boolean;
  if (homeFrom === null || time <= homeFrom) {
    const now = outing(w, time);
    if (!now) return null;
    ({ gone, out } = now);
  } else {
    const then = outing(w, homeFrom);
    if (!then) return null;
    gone = then.gone - (time - homeFrom) * w.speed;
    out = false;
  }
  if (gone <= 0) return null;
  const facing = out ? w.dir : w.dir === 1 ? -1 : 1;
  return { run: w.run, s: w.home + w.dir * gone, d: -facing * KEEP_LEFT, facing, fromHome: gone };
}

/** A dog trots about round its walker, mostly a little ahead, nosing at the verge. */
export function dogAt(w: Walker, owner: OnTowpath, time: number): OnTowpath {
  const k = w.look * 0.37;
  // Close to heel where they step on and off the towpath.
  const heel = Math.min(1, owner.fromHome / 30);
  const ahead = (10 + 5 * Math.sin(time * 0.8 + k) + 1.5 * Math.sin(time * 2.3 + k * 2)) * heel;
  return { ...owner, s: owner.s + owner.facing * ahead, d: 3 * Math.sin(time * 1.3 + k * 3) };
}
