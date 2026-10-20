// Your hands on the lock, in the close-ups. A paddle: fit the windlass, wind
// it clockwise to raise the paddle while the safety catch clicks over the
// teeth, flick the catch off to wind it down, and take the windlass off when
// you're done. With the catch off, the paddle drops if you let go. A gate:
// walk its heavy balance beam round, and it starts slowly, won't open until
// the water is level, and won't close on a boat.

import { clamp } from '../core/math';
import { gateHeld, pushGate, windPaddle } from './lock';
import type { GateHeld, GatePart, LockState, PaddlePart, Span } from './lock';

const TAU = Math.PI * 2;

/** Turns of the windlass from a paddle right down to fully up. */
export const TURNS = 3;
/** How fast a paddle drops with the catch off and nobody holding the windlass, per second. */
const DROP_RATE = 0.35;
/** How far you can push against the catch, in radians, before it stops you. */
const CATCH_PLAY = 0.2;
/** How fast a held key winds the windlass, in radians per second: a turn in about a second and a half. */
export const KEY_WIND = TAU / 1.5;

export interface PaddleHand {
  readonly part: PaddlePart;
  /** Wound right up (1) or right down (0). */
  readonly target: 0 | 1;
  fitted: boolean;
  catchOn: boolean;
  /** How far the spindle has turned, in radians; clockwise is positive. */
  angle: number;
  /** How far you've wound back against the catch. */
  strain: number;
}

export function newPaddleHand(part: PaddlePart, target: 0 | 1): PaddleHand {
  return { part, target, fitted: false, catchOn: true, angle: 0, strain: 0 };
}

export const paddleAtTarget = (hand: PaddleHand, lock: LockState): boolean => Math.abs(lock[hand.part] - hand.target) < 0.02;

/** The paddle is where you wanted it and your windlass is off the spindle. */
export const paddleDone = (hand: PaddleHand, lock: LockState): boolean => paddleAtTarget(hand, lock) && !hand.fitted;

export type PaddleStep = 'fit' | 'wind-up' | 'flick-catch' | 'wind-down' | 'take-off' | 'done';

export function paddleStep(hand: PaddleHand, lock: LockState): PaddleStep {
  if (paddleAtTarget(hand, lock)) return hand.fitted ? 'take-off' : 'done';
  if (!hand.fitted) return 'fit';
  if (hand.target === 1) return 'wind-up';
  return hand.catchOn ? 'flick-catch' : 'wind-down';
}

/** Something the paddle says back when you work it. */
export type PaddleNote = 'fully-up' | 'right-down' | 'caught' | 'fit-first' | 'dropping';

export function fitWindlass(hand: PaddleHand): void {
  hand.fitted = true;
}

export function takeOffWindlass(hand: PaddleHand): void {
  hand.fitted = false;
}

/** Flicks the safety catch off or back on. The windlass must be on first, to take the paddle's weight. */
export function flickCatch(hand: PaddleHand): PaddleNote | null {
  if (!hand.fitted) return 'fit-first';
  hand.catchOn = !hand.catchOn;
  return null;
}

/** Turns the fitted windlass by `turn` radians, clockwise to raise the paddle. */
export function windWindlass(hand: PaddleHand, lock: LockState, turn: number): PaddleNote | null {
  if (!hand.fitted || turn === 0) return null;
  const at = lock[hand.part];
  if (turn > 0 && at >= 1) return 'fully-up';
  if (turn < 0) {
    if (at <= 0) return 'right-down';
    if (hand.catchOn) {
      hand.strain = Math.min(CATCH_PLAY, hand.strain - turn);
      return hand.strain >= CATCH_PLAY ? 'caught' : null;
    }
  }
  hand.strain = 0;
  // The last of the travel goes with it, so a paddle ends right up or right down.
  let to = at + turn / (TAU * TURNS);
  if (turn > 0 && to > 0.98) to = 1;
  if (turn < 0 && to < 0.02) to = 0;
  windPaddle(lock, hand.part, to);
  hand.angle += turn;
  return null;
}

/** Moves the paddle on by `dt` seconds: with the catch off and nobody holding the windlass, it drops. */
export function settlePaddle(hand: PaddleHand, lock: LockState, dt: number, holding: boolean): PaddleNote | null {
  let note: PaddleNote | null = null;
  if (!hand.catchOn && !holding && lock[hand.part] > 0) {
    windPaddle(lock, hand.part, lock[hand.part] - DROP_RATE * dt);
    if (hand.fitted) hand.angle -= DROP_RATE * dt * TAU * TURNS;
    note = 'dropping';
  }
  // Right down, the catch drops back into the teeth.
  if (lock[hand.part] <= 0.001 && !hand.catchOn) hand.catchOn = true;
  return note;
}

/** The one-press part of the next step, for the keyboard: fit, flick the catch, or take the windlass off. */
export function pressPaddle(hand: PaddleHand, lock: LockState): PaddleNote | null {
  const step = paddleStep(hand, lock);
  if (step === 'fit') fitWindlass(hand);
  else if (step === 'take-off') takeOffWindlass(hand);
  else if (step === 'flick-catch') return flickCatch(hand);
  return null;
}

/** Winds towards the paddle's target while a key is held. */
export function holdPaddle(hand: PaddleHand, lock: LockState, dt: number): PaddleNote | null {
  const step = paddleStep(hand, lock);
  if (step !== 'wind-up' && step !== 'wind-down') return null;
  const at = lock[hand.part];
  const turn = (step === 'wind-up' ? 1 : -1) * Math.min(KEY_WIND * dt, Math.abs(hand.target - at) * TAU * TURNS);
  return windWindlass(hand, lock, turn);
}

/** How far a gate's balance beam swings, in radians, from open to shut. */
export const GATE_SWING_ANGLE = Math.atan2(23, 7);

export interface GateHand {
  readonly part: GatePart;
  /** Open (1) or shut (0). */
  readonly target: 0 | 1;
  /** The beam's angle: 0 with the gate open, GATE_SWING_ANGLE shut. */
  angle: number;
  /** How fast the beam is swinging, in radians per second. */
  spin: number;
}

export function newGateHand(lock: LockState, part: GatePart, target: 0 | 1): GateHand {
  return { part, target, angle: GATE_SWING_ANGLE * (1 - lock[part]), spin: 0 };
}

export const gateDone = (hand: GateHand, lock: LockState): boolean => Math.abs(lock[hand.part] - hand.target) < 0.02;

/** How you're moving the beam: dragging its end towards an angle, leaning on it (a held key), or not at all. */
export type BeamPush = { readonly kind: 'drag'; readonly angle: number } | { readonly kind: 'lean' } | null;

/** Moves the gate on by `dt` seconds. The beam is heavy, so it gathers speed slowly and coasts to a stop. */
export function swingBeam(hand: GateHand, lock: LockState, dt: number, push: BeamPush, spans: readonly Span[]): GateHeld | null {
  if (!push && hand.spin === 0) {
    hand.angle = GATE_SWING_ANGLE * (1 - lock[hand.part]);
    return null;
  }
  let accel: number;
  if (push?.kind === 'drag') {
    const want = clamp(push.angle, 0, GATE_SWING_ANGLE);
    accel = clamp(14 * (want - hand.angle) - 5 * hand.spin, -2.2, 2.2);
  } else if (push?.kind === 'lean') {
    accel = (hand.target === 1 ? -1 : 1) * 1.3 - 0.8 * hand.spin;
  } else {
    accel = -3 * hand.spin;
  }
  hand.spin += accel * dt;
  let angle = hand.angle + hand.spin * dt;
  if (angle <= 0 || angle >= GATE_SWING_ANGLE) {
    angle = clamp(angle, 0, GATE_SWING_ANGLE);
    hand.spin = 0;
  }
  // The gate goes where the beam is, near enough, unless the water or a boat holds it.
  const swung = 1 - angle / GATE_SWING_ANGLE;
  const open = swung > 0.985 ? 1 : swung < 0.015 ? 0 : swung;
  const held = gateHeld(lock, hand.part, swung, spans) ?? pushGate(lock, hand.part, open, spans);
  if (held) {
    hand.spin = 0;
    hand.angle = GATE_SWING_ANGLE * (1 - lock[hand.part]);
  } else {
    hand.angle = angle;
  }
  return held;
}
