// How the boat moves on the water. Its position is kept relative to the route:
// how far along it is, how far off the centre line, and which way it points
// compared with the canal. That keeps it on the water, and makes the bends,
// banks and moored boats simple to reason about.

import { approach, clamp } from '../core/math';
import { curvatureAt } from '../core/track';
import type { Track } from '../core/track';
import { BOAT_BEAM, BOAT_LENGTH, CANAL_WIDTH, unitsPerSecond } from '../world/dimensions';

export interface Boat {
  /** Distance along the route. */
  s: number;
  /** Distance right of the centre line (negative is left). */
  d: number;
  /** Heading compared with the canal's direction, in radians; positive turns right. */
  psi: number;
  /** Speed through the water; negative is going astern. */
  v: number;
  /** How fast the boat is turning, in radians per second. */
  turn: number;
}

export const CRUISE_SPEED = unitsPerSecond(3.5);
/** Four miles an hour: the speed limit on most canals. */
export const TOP_SPEED = unitsPerSecond(4);
export const ASTERN_SPEED = -unitsPerSecond(1.5);
/** Slow past moored boats, as you should, and slower still into and out of a lock. */
export const PASSING_SPEED = unitsPerSecond(1.8);
export const LOCK_SPEED = unitsPerSecond(2);
export const ACCELERATION = 0.7;
export const BRAKING = 1.1;

/** How fast the boat can turn at cruising speed. A narrowboat swings from the back, so it turns slowly. */
export const MAX_TURN = 0.07;
/** How long the boat takes to answer the tiller, in seconds. */
const TURN_LAG = 0.9;

const HALF_LENGTH = BOAT_LENGTH / 2;
const HALF_BEAM = BOAT_BEAM / 2;
const BANK = CANAL_WIDTH / 2;

/** A moored boat the hull can bump, on the route. */
export interface Obstacle {
  s: number;
  /** Its centre's distance right of the centre line. */
  d: number;
}

/** Where the water narrows between walls, as through a lock: from one distance along the route to another. */
export interface Narrows {
  from: number;
  to: number;
  /** Half the width of the water between the walls. */
  half: number;
}

/** How far ahead the autopilot aims for its line, unless it's told to line up more sharply. */
const LOOK_AHEAD = 70;

/**
 * How the boat is being steered this step: by the tiller, or towards a line on
 * the water, aiming for it `lookAhead` ahead.
 */
export type Helm =
  | { kind: 'tiller'; rudder: number; speed: number }
  | { kind: 'auto'; line: number; speed: number; lookAhead?: number };

export type Bump = 'bank' | 'boat';

/** The turn rate the autopilot asks for, to follow `line` through the bends. */
export function autopilotTurn(boat: Boat, route: Track, line: number, lookAhead = LOOK_AHEAD): number {
  const kappa = curvatureAt(route, boat.s);
  const along = boat.v * Math.cos(boat.psi) / (1 - kappa * boat.d);
  // Aim at a point on the line a little way ahead, so the boat eases back to it.
  const wantPsi = Math.atan2(line - boat.d, lookAhead);
  const gain = 0.55 * clamp(Math.abs(boat.v) / CRUISE_SPEED, 0.35, 1);
  return clamp(kappa * along + gain * (wantPsi - boat.psi), -MAX_TURN * 1.5, MAX_TURN * 1.5);
}

/** The widest the hull reaches either side of the centre line. */
export function hullSpan(boat: Boat): { left: number; right: number } {
  const swing = Math.abs(HALF_LENGTH * Math.sin(boat.psi)) + HALF_BEAM * Math.cos(boat.psi);
  return { left: boat.d - swing, right: boat.d + swing };
}

/** The hull's corners, as distances along the route and right of the centre line. */
function hullCorners(boat: Boat): [number, number][] {
  const [c, s] = [Math.cos(boat.psi), Math.sin(boat.psi)];
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => [boat.s + u * HALF_LENGTH * c - v * HALF_BEAM * s, boat.d + u * HALF_LENGTH * s + v * HALF_BEAM * c]);
}

/** The widest the hull reaches either side of the centre line between two distances along the route, or null if none of it is there. */
export function hullSpanWithin(boat: Boat, from: number, to: number): { left: number; right: number } | null {
  // Trim the hull's outline to the stretch, one end at a time, and see how wide what's left is.
  let outline = hullCorners(boat);
  for (const inside of [(p: [number, number]) => p[0] - from, (p: [number, number]) => to - p[0]]) {
    const kept: [number, number][] = [];
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const [ia, ib] = [inside(a), inside(b)];
      if (ia >= 0) kept.push(a);
      if (ia >= 0 !== ib >= 0) {
        const t = ia / (ia - ib);
        kept.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    });
    outline = kept;
  }
  if (outline.length === 0) return null;
  const ds = outline.map((p) => p[1]);
  return { left: Math.min(...ds), right: Math.max(...ds) };
}

/**
 * Moves the boat on by `dt` seconds. Bumps are soft: the hull is nudged back
 * onto the water, it straightens a little, and it loses some speed. The
 * autopilot never bumps; it just eases the hull clear, as when casting off.
 * Where the water narrows between walls, the whole hull keeps between them.
 */
export function moveBoat(boat: Boat, route: Track, helm: Helm, dt: number, obstacles: readonly Obstacle[] = [], narrows: readonly Narrows[] = []): Bump | null {
  const speedingUp = Math.abs(helm.speed) > Math.abs(boat.v) && helm.speed * boat.v >= 0;
  boat.v = approach(boat.v, helm.speed, (speedingUp ? ACCELERATION : BRAKING) * dt);

  let wantTurn: number;
  if (helm.kind === 'tiller') {
    // The rudder needs water flowing past it, so a slow boat turns less.
    const flow = clamp(Math.abs(boat.v) / CRUISE_SPEED, 0.25, 1);
    wantTurn = helm.rudder * MAX_TURN * flow;
  } else {
    wantTurn = autopilotTurn(boat, route, helm.line, helm.lookAhead);
  }
  boat.turn += (wantTurn - boat.turn) * (1 - Math.exp(-dt / TURN_LAG));

  const kappa = curvatureAt(route, boat.s);
  const along = boat.v * Math.cos(boat.psi) / (1 - kappa * boat.d);
  boat.s = clamp(boat.s + along * dt, 0, route.length);
  boat.d += boat.v * Math.sin(boat.psi) * dt;
  boat.psi += (boat.turn - kappa * along) * dt;
  boat.psi = clamp(boat.psi, -1.2, 1.2);

  const bump = keepOnTheWater(boat, obstacles, narrows, helm.kind === 'tiller');
  return helm.kind === 'tiller' ? bump : null;
}

function keepOnTheWater(boat: Boat, obstacles: readonly Obstacle[], narrows: readonly Narrows[], soft: boolean): Bump | null {
  let bump: Bump | null = null;
  const soften = (towardsRight: boolean) => {
    if (!soft) return;
    // Turn away a little and lose some way, like a fender rubbing the bank.
    if ((boat.psi > 0) === towardsRight) boat.psi *= -0.2;
    boat.turn = 0;
    boat.v *= 0.7;
  };

  let rightLimit = BANK;
  let leftLimit = -BANK;
  for (const o of obstacles) {
    if (Math.abs(o.s - boat.s) >= BOAT_LENGTH - 4) continue;
    if (o.d > 0) rightLimit = Math.min(rightLimit, o.d - HALF_BEAM);
    else leftLimit = Math.max(leftLimit, o.d + HALF_BEAM);
  }
  let span = hullSpan(boat);
  if (span.right > rightLimit) {
    boat.d -= span.right - rightLimit;
    bump = rightLimit < BANK ? 'boat' : 'bank';
    soften(true);
  }
  span = hullSpan(boat);
  if (span.left < leftLimit) {
    boat.d += leftLimit - span.left;
    bump = leftLimit > -BANK ? 'boat' : 'bank';
    soften(false);
  }

  for (const n of narrows) {
    let within = hullSpanWithin(boat, n.from, n.to);
    if (!within) continue;
    // Coming in at too much of an angle to fit, the walls straighten it up.
    for (let i = 0; i < 20 && within.right - within.left > 2 * n.half; i++) {
      boat.psi *= 0.8;
      within = hullSpanWithin(boat, n.from, n.to) ?? within;
    }
    if (within.right > n.half) {
      boat.d -= within.right - n.half;
      bump = 'bank';
      soften(true);
    } else if (within.left < -n.half) {
      boat.d += -n.half - within.left;
      bump = 'bank';
      soften(false);
    }
  }
  return bump;
}
