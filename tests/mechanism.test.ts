import { describe, expect, it } from 'vitest';
import { CHAMBER_HALF, newLock, stepLock } from '../src/sim/lock';
import type { LockState, Span } from '../src/sim/lock';
import {
  GATE_SWING_ANGLE,
  TURNS,
  fitWindlass,
  flickCatch,
  gateDone,
  holdPaddle,
  newGateHand,
  newPaddleHand,
  paddleDone,
  paddleStep,
  pressPaddle,
  settlePaddle,
  swingBeam,
  takeOffWindlass,
  windWindlass,
} from '../src/sim/mechanism';
import type { BeamPush, GateHand } from '../src/sim/mechanism';

const STEP = 1 / 30;
const TURN = Math.PI * 2;

/** Winds round and round in small steps, as a drag in circles does. */
function windRound(hand: ReturnType<typeof newPaddleHand>, lock: LockState, turns: number): string[] {
  const notes: string[] = [];
  const steps = Math.ceil(Math.abs(turns) * 36);
  for (let i = 0; i < steps; i++) {
    const note = windWindlass(hand, lock, (Math.sign(turns) * TURN) / 36);
    if (note) notes.push(note);
  }
  return notes;
}

function swing(hand: GateHand, lock: LockState, seconds: number, push: BeamPush, spans: Span[] = []): string[] {
  const held: string[] = [];
  for (let t = 0; t < seconds; t += STEP) {
    const why = swingBeam(hand, lock, STEP, push, spans);
    if (why) held.push(why);
  }
  return held;
}

describe('a paddle', () => {
  it("doesn't turn until the windlass is on the spindle", () => {
    const lock = newLock(0);
    const hand = newPaddleHand('topPaddle', 1);
    expect(paddleStep(hand, lock)).toBe('fit');
    windRound(hand, lock, 1);
    expect(lock.topPaddle).toBe(0);
  });

  it('winds fully up in three turns, with the catch clicking over the teeth', () => {
    const lock = newLock(0);
    const hand = newPaddleHand('topPaddle', 1);
    fitWindlass(hand);
    windRound(hand, lock, 1.5);
    expect(lock.topPaddle).toBeCloseTo(1.5 / TURNS, 5);
    expect(hand.catchOn).toBe(true);
    expect(windRound(hand, lock, TURNS)).toContain('fully-up');
    expect(lock.topPaddle).toBe(1);
  });

  it("isn't done until you take the windlass off", () => {
    const lock = newLock(0);
    const hand = newPaddleHand('bottomPaddle', 1);
    fitWindlass(hand);
    windRound(hand, lock, TURNS + 0.1);
    expect(paddleStep(hand, lock)).toBe('take-off');
    expect(paddleDone(hand, lock)).toBe(false);
    takeOffWindlass(hand);
    expect(paddleDone(hand, lock)).toBe(true);
  });

  it('is held up by the safety catch until you flick it off', () => {
    const lock = newLock(0);
    lock.bottomPaddle = 1;
    const hand = newPaddleHand('bottomPaddle', 0);
    expect(flickCatch(hand)).toBe('fit-first');
    expect(hand.catchOn).toBe(true);
    fitWindlass(hand);
    expect(paddleStep(hand, lock)).toBe('flick-catch');
    expect(windRound(hand, lock, -0.5)).toContain('caught');
    expect(lock.bottomPaddle).toBe(1);
    expect(flickCatch(hand)).toBeNull();
    expect(paddleStep(hand, lock)).toBe('wind-down');
    windRound(hand, lock, -(TURNS + 0.1));
    expect(lock.bottomPaddle).toBe(0);
  });

  it('drops if you let go with the catch off, and the catch drops back in at the bottom', () => {
    const lock = newLock(0);
    lock.topPaddle = 1;
    const hand = newPaddleHand('topPaddle', 0);
    fitWindlass(hand);
    flickCatch(hand);
    expect(settlePaddle(hand, lock, 0.5, true)).toBeNull();
    expect(lock.topPaddle).toBe(1);
    expect(settlePaddle(hand, lock, 0.5, false)).toBe('dropping');
    expect(lock.topPaddle).toBeLessThan(1);
    for (let t = 0; t < 5; t += STEP) settlePaddle(hand, lock, STEP, false);
    expect(lock.topPaddle).toBe(0);
    expect(hand.catchOn).toBe(true);
  });

  it('can be worked from the keyboard: press to fit, flick and take off, hold to wind', () => {
    const lock = newLock(0);
    lock.bottomPaddle = 1;
    const hand = newPaddleHand('bottomPaddle', 0);
    pressPaddle(hand, lock);
    expect(hand.fitted).toBe(true);
    pressPaddle(hand, lock);
    expect(hand.catchOn).toBe(false);
    let seconds = 0;
    while (lock.bottomPaddle > 0 && seconds < 20) {
      holdPaddle(hand, lock, STEP);
      seconds += STEP;
    }
    expect(lock.bottomPaddle).toBe(0);
    // Three turns at about a turn and a half a second.
    expect(seconds).toBeGreaterThan(3.5);
    expect(seconds).toBeLessThan(6);
    pressPaddle(hand, lock);
    expect(paddleDone(hand, lock)).toBe(true);
  });

  it('lets the water run as you wind', () => {
    const lock = newLock(0);
    const hand = newPaddleHand('topPaddle', 1);
    fitWindlass(hand);
    windRound(hand, lock, 1);
    stepLock(lock, STEP, []);
    expect(lock.flowIn).toBeGreaterThan(0.3);
  });
});

describe('a gate', () => {
  it('is heavy, so it starts slowly and then swings right open', () => {
    const lock = newLock(0);
    const hand = newGateHand(lock, 'bottomGates', 1);
    expect(hand.angle).toBeCloseTo(GATE_SWING_ANGLE);
    swing(hand, lock, 0.25, { kind: 'lean' });
    expect(lock.bottomGates).toBeGreaterThan(0);
    expect(lock.bottomGates).toBeLessThan(0.05);
    swing(hand, lock, 4, { kind: 'lean' });
    expect(gateDone(hand, lock)).toBe(true);
    expect(lock.bottomGates).toBe(1);
  });

  it('follows the beam as you drag its end round', () => {
    const lock = newLock(0);
    const hand = newGateHand(lock, 'bottomGates', 1);
    swing(hand, lock, 3, { kind: 'drag', angle: GATE_SWING_ANGLE / 2 });
    expect(lock.bottomGates).toBeCloseTo(0.5, 1);
    swing(hand, lock, 3, { kind: 'drag', angle: 0 });
    expect(lock.bottomGates).toBe(1);
  });

  it('coasts to a stop when you let go', () => {
    const lock = newLock(0);
    const hand = newGateHand(lock, 'bottomGates', 1);
    swing(hand, lock, 0.8, { kind: 'lean' });
    const moving = hand.spin;
    swing(hand, lock, 3, null);
    expect(Math.abs(moving)).toBeGreaterThan(0);
    expect(Math.abs(hand.spin)).toBeLessThan(0.01);
    expect(lock.bottomGates).toBeLessThan(1);
  });

  it("won't budge while the water is higher on one side, and opens once it's level", () => {
    const lock = newLock(1);
    lock.bottomPaddle = 1;
    const hand = newGateHand(lock, 'bottomGates', 1);
    const held = swing(hand, lock, 2, { kind: 'lean' });
    expect(held.every((h) => h === 'water')).toBe(true);
    expect(held.length).toBeGreaterThan(10);
    expect(lock.bottomGates).toBe(0);
    expect(hand.angle).toBeCloseTo(GATE_SWING_ANGLE);
    for (let t = 0; t < 30; t += STEP) stepLock(lock, STEP, []);
    swing(hand, lock, 5, { kind: 'lean' });
    expect(lock.bottomGates).toBe(1);
  });

  it("won't close on the boat", () => {
    const lock = newLock(0);
    lock.bottomGates = 1;
    const hand = newGateHand(lock, 'bottomGates', 0);
    const coming = { from: -CHAMBER_HALF - 30, to: -CHAMBER_HALF + 44 };
    const held = swing(hand, lock, 3, { kind: 'lean' }, [coming]);
    expect(held).toContain('boat');
    expect(lock.bottomGates).toBe(1);
    swing(hand, lock, 5, { kind: 'lean' }, [{ from: -37, to: 37 }]);
    expect(lock.bottomGates).toBe(0);
  });
});
