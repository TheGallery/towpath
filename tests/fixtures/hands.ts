// You at a lock in a test, working each close-up from the keyboard as soon as
// the lock is yours.

import { answerLock } from '../../src/sim/day';
import type { Day } from '../../src/sim/day';
import { isGate } from '../../src/sim/lock';
import type { GatePart, PaddlePart } from '../../src/sim/lock';
import { gateDone, holdPaddle, newGateHand, newPaddleHand, paddleDone, pressPaddle, settlePaddle, swingBeam } from '../../src/sim/mechanism';
import type { GateHand, PaddleHand } from '../../src/sim/mechanism';
import { boatsAt, lockForYou } from '../../src/sim/trip';

/** You at the lock, working each close-up from the keyboard as soon as the lock is yours, a step of `step` seconds at a time. */
export function byHand(step: number): (d: Day) => void {
  let hand: { paddle: PaddleHand } | { gate: GateHand } | null = null;
  return (d) => {
    const yours = lockForYou(d.trip);
    if (!yours) return;
    answerLock(d);
    const { state, next, job } = yours;
    if (!hand && next && job.kind !== 'wait-water' && job.kind !== 'boat-in') {
      hand = isGate(next.part) ? { gate: newGateHand(state, next.part as GatePart, next.target) } : { paddle: newPaddleHand(next.part as PaddlePart, next.target) };
    }
    if (hand && 'paddle' in hand) {
      pressPaddle(hand.paddle, state);
      holdPaddle(hand.paddle, state, step);
      settlePaddle(hand.paddle, state, step, true);
      if (paddleDone(hand.paddle, state)) hand = null;
    } else if (hand) {
      swingBeam(hand.gate, state, step, { kind: 'lean' }, boatsAt(d.trip, d.plan, yours.lock));
      if (gateDone(hand.gate, state)) hand = null;
    }
  };
}
