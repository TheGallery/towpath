// The other boat. It uses the lock just before you, so how you find the lock
// depends on it, as in real life. Coming down, it empties the lock and leaves
// the bottom gates open for you. Going up ahead of you, it fills the lock and
// closes up behind it, so you'll have to empty it first.

import { approach, clamp } from '../core/math';
import { poseAt } from '../core/track';
import type { Track } from '../core/track';
import { BOAT_LENGTH } from '../world/dimensions';
import { CRUISE_SPEED, LOCK_SPEED, PASSING_SPEED } from './boat';
import { LANDING_GAP, crewStep, isOpen, lockEnds, newCrew, whereIs } from './lock';
import type { Crew, LockState, Span } from './lock';

const HALF_LENGTH = BOAT_LENGTH / 2;
/** How far right of the centre line a boat keeps when it might meet another. */
export const KEEP_RIGHT = 12;
const ACCELERATION = 0.5;
/** How far clear of your boat, end to end, it is before it moves over. */
const PASSING_GAP = 10;

export type OtherWay = 'down' | 'up';

export interface OtherBoatPlan {
  /** The canal it travels, and the lock on it. */
  readonly track: Track;
  readonly lock: { readonly id: string; readonly at: number; readonly uphill: 1 | -1 };
  /** Stretches of its canal where it slows to pass moored boats. */
  readonly slow: readonly { readonly from: number; readonly to: number }[];
  /** It sets off once your boat is this far along your route, timed to meet you at the lock. */
  readonly trigger: Readonly<Record<OtherWay, number>>;
}

export interface OtherBoat {
  readonly way: OtherWay;
  /** Where it is, measured from the lock's middle towards the top gate. */
  x: number;
  /** Distance right of its canal's centre line. */
  d: number;
  v: number;
  /** Its heading compared with the way it's going along the canal, for the drawing. */
  yaw: number;
  phase: 'waiting' | 'working' | 'away' | 'gone';
  readonly crew: Crew;
}

/** How full the lock is before the other boat comes: ready for it. */
export const lockWaterFor = (way: OtherWay): number => (way === 'down' ? 1 : 0);

export function newOtherBoat(way: OtherWay): OtherBoat {
  // Coming down it waits above the lock; going up it's already in, the gates shut behind it.
  return { way, x: way === 'down' ? LANDING_GAP : 0, d: 0, v: 0, yaw: 0, phase: 'waiting', crew: newCrew(way === 'up', way === 'down') };
}

/** Its distance along its own canal. */
export const otherAt = (o: OtherBoat, plan: OtherBoatPlan): number => plan.lock.at + plan.lock.uphill * o.x;

export const otherSpan = (o: OtherBoat): Span => ({ from: o.x - HALF_LENGTH, to: o.x + HALF_LENGTH });

/** Its pose on the map, facing the way it travels. */
export function otherPose(o: OtherBoat, plan: OtherBoatPlan): { x: number; y: number; angle: number } {
  const p = poseAt(plan.track, otherAt(o, plan), o.d);
  const forwards = (o.way === 'up' ? 1 : -1) * plan.lock.uphill > 0;
  return { x: p.x, y: p.y, angle: p.angle + (forwards ? o.yaw : Math.PI - o.yaw) };
}

/** The fastest it can go and still stop gently in `distance`. */
const stopping = (distance: number): number => (distance <= 0.3 ? 0 : Math.max(0.5, Math.sqrt(2 * 0.45 * distance)));

export type OtherEvent = { readonly kind: 'set-off' } | { readonly kind: 'out-of-lock' } | { readonly kind: 'gone' };

/**
 * Moves the other boat on by `dt` seconds, working the lock as it goes.
 * `yourS` is how far along your route you are, and `yours` the stretch of the
 * lock's canal your boat takes up, if it's on it.
 */
export function stepOther(o: OtherBoat, plan: OtherBoatPlan, lock: LockState, dt: number, yourS: number, yours: Span | null = null): OtherEvent[] {
  const events: OtherEvent[] = [];
  if (o.phase === 'gone') return events;
  if (o.phase === 'waiting') {
    if (yourS < plan.trigger[o.way]) return events;
    o.phase = 'working';
    events.push({ kind: 'set-off' });
  }

  const up = o.way === 'up';
  const ahead = up ? 1 : -1;
  const where = whereIs(otherSpan(o), up);
  if (!o.crew.done) crewStep(lock, o.crew, where, dt);

  // In the lock it glides to the middle once the gates ahead of it open, and
  // waits there until the far gates open too.
  const exitOpen = isOpen(lock[lockEnds(up).exitGate]);
  const toMiddle = Math.min(LOCK_SPEED, stopping(-o.x * ahead));
  let want: number;
  if (o.phase === 'working' && where === 'before') want = isOpen(lock[lockEnds(up).entryGate]) ? toMiddle : 0;
  else if (o.phase === 'working' && where === 'in') want = exitOpen ? LOCK_SPEED : toMiddle;
  else if (Math.abs(o.x) < LANDING_GAP) want = LOCK_SPEED;
  else {
    const s = otherAt(o, plan);
    want = plan.slow.some((z) => s > z.from - 60 && s < z.to + 60) ? PASSING_SPEED : CRUISE_SPEED;
  }
  if (o.phase === 'working' && where === 'after') {
    o.phase = 'away';
    events.push({ kind: 'out-of-lock' });
  }
  o.v = approach(o.v, want, ACCELERATION * dt);
  const before = o.x;
  o.x += ahead * o.v * dt;
  if (o.phase === 'working' && !exitOpen && o.x * ahead > 0) {
    o.x = before * ahead > 0 ? before : 0;
    o.v = 0;
  }

  // Through the lock it keeps to the middle, and out on the canal it keeps
  // right. It holds its line while it's alongside your boat, so its stern
  // never swings into you as it moves over.
  const along = Math.abs(o.x - before);
  const theirs = otherSpan(o);
  const alongside = yours !== null && yours.to > theirs.from - PASSING_GAP && yours.from < theirs.to + PASSING_GAP;
  const line = alongside ? o.d : Math.abs(o.x) < LANDING_GAP + 40 ? 0 : KEEP_RIGHT * ahead * plan.lock.uphill;
  const dd = (line - o.d) * clamp(along / 35, 0, 1);
  o.d += dd;
  o.yaw = along > 1e-6 ? Math.atan2(dd * ahead * plan.lock.uphill, along) : o.yaw * 0.9;

  const s = otherAt(o, plan);
  if (o.phase === 'away' && (s < 5 || s > plan.track.length - 5)) {
    o.phase = 'gone';
    events.push({ kind: 'gone' });
  }
  return events;
}
