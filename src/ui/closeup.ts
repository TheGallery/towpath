// The full-screen close-up of the part of the lock you're working. It zooms
// out of the part and fills the game. Work it with the mouse, or with the
// keyboard: Space does the next thing and, held, winds or pushes; the arrow
// keys wind either way. It closes by itself when the job is done.

import { wrapAngle } from '../core/math';
import type { Point } from '../core/track';
import { GATE_LAYOUT, GateCloseup, PADDLE_LAYOUT, PaddleCloseup } from '../render/closeups';
import { isGate, levelsMatch } from '../sim/lock';
import type { GateHeld, LockState, Part, Span } from '../sim/lock';
import {
  GATE_SWING_ANGLE,
  KEY_WIND,
  fitWindlass,
  flickCatch,
  gateDone,
  holdPaddle,
  newGateHand,
  newPaddleHand,
  paddleAtTarget,
  paddleDone,
  paddleStep,
  pressPaddle,
  settlePaddle,
  swingBeam,
  takeOffWindlass,
  windWindlass,
} from '../sim/mechanism';
import type { BeamPush, GateHand, PaddleHand, PaddleNote } from '../sim/mechanism';
import { PART_NAMES } from '../sim/status';

export interface CloseupJob {
  readonly lockName: string;
  readonly lock: LockState;
  readonly part: Part;
  readonly target: 0 | 1;
  /** The boats in the lock, which a gate must not close on. */
  readonly boats: () => readonly Span[];
  /** Whether the lock still wants this part worked this way, which ends the job when it doesn't. */
  readonly wanted: () => boolean;
  /** Where the part is on screen, in pixels, so the close-up can zoom out of it. */
  readonly from: { readonly x: number; readonly y: number };
}

/** The keys held down: Space (or Enter), and the arrows for winding. */
export interface HeldKeys {
  readonly work: boolean;
  readonly turn: -1 | 0 | 1;
}

/** Seconds the finished job stays on screen before the close-up closes. */
const LINGER = 0.7;
/** How long a note about something you tried stays up, in seconds. */
const NOTE_TIME = 3;

const NOTES: Readonly<Record<PaddleNote | GateHeld, string>> = {
  'fully-up': 'The paddle is fully up.',
  'right-down': 'The paddle is right down.',
  caught: 'The safety catch stops it going down. Click the red catch to flick it off, or press Space.',
  'fit-first': 'Fit your windlass first, so it takes the weight when the catch comes off.',
  dropping: 'Careful: with the catch off, the paddle drops if you let go of the windlass.',
  water: "It won't budge: the water is higher on one side, and its weight holds the gate shut.",
  boat: 'The boat is in the way of the gate. Wait for it to come right in.',
};

const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function byId<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`The close-up is missing ${selector}`);
  return found as T;
}

interface PaddleWork {
  readonly kind: 'paddle';
  readonly hand: PaddleHand;
  readonly view: PaddleCloseup;
  /** Where the windlass lies while it's off the spindle. */
  at: Point;
  /** Carrying the windlass, held this far from the pointer. */
  carry: { readonly id: number; readonly offset: Point } | null;
  /** Winding round the spindle, from this pointer angle. */
  winding: { readonly id: number; last: number } | null;
}

interface GateWork {
  readonly kind: 'gate';
  readonly hand: GateHand;
  readonly view: GateCloseup;
  drag: { readonly id: number; at: Point } | null;
  held: GateHeld | null;
}

export class Closeup {
  private readonly art: SVGSVGElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private job: CloseupJob | null = null;
  private work: PaddleWork | GateWork | null = null;
  private doneFor = 0;
  private time = 0;
  private note: { text: string; until: number } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onClosed: () => void,
  ) {
    this.art = byId(root, '.closeup-art');
    this.title = byId(root, '.closeup-title');
    this.hint = byId(root, '.closeup-hint');
    byId<HTMLButtonElement>(root, '.closeup-back').addEventListener('click', () => this.close());
    this.art.addEventListener('pointerdown', (ev) => this.down(ev));
    this.art.addEventListener('pointermove', (ev) => this.move(ev));
    this.art.addEventListener('pointerup', (ev) => this.up(ev));
    this.art.addEventListener('pointercancel', (ev) => this.up(ev));
  }

  get isOpen(): boolean {
    return this.job !== null;
  }

  open(job: CloseupJob): void {
    this.job = job;
    this.doneFor = 0;
    this.note = null;
    if (isGate(job.part)) {
      const sides = job.part === 'bottomGates' ? (['below the lock', 'inside the lock'] as const) : (['inside the lock', 'above the lock'] as const);
      this.work = { kind: 'gate', hand: newGateHand(job.lock, job.part, job.target), view: new GateCloseup(this.art, sides, GATE_SWING_ANGLE), drag: null, held: null };
    } else {
      this.work = { kind: 'paddle', hand: newPaddleHand(job.part, job.target), view: new PaddleCloseup(this.art), at: PADDLE_LAYOUT.rest, carry: null, winding: null };
    }
    this.title.textContent = `${job.lockName}: the ${PART_NAMES[job.part]}`;
    const box = this.root.parentElement?.getBoundingClientRect();
    this.root.style.setProperty('--from-x', box ? `${((job.from.x / Math.max(1, box.width)) * 100).toFixed(1)}%` : '50%');
    this.root.style.setProperty('--from-y', box ? `${((job.from.y / Math.max(1, box.height)) * 100).toFixed(1)}%` : '50%');
    this.root.hidden = false;
    this.root.classList.remove('zoom');
    void this.root.offsetWidth;
    this.root.classList.add('zoom');
    this.render(0);
    this.art.focus({ preventScroll: true });
  }

  /** Back to the lock. You take your windlass with you. */
  close(): void {
    if (!this.job) return;
    this.job = null;
    this.work = null;
    this.root.hidden = true;
    this.onClosed();
  }

  /** Space was pressed: fit or take off the windlass, or flick the catch. */
  press(): void {
    const { job, work } = this;
    if (!job || work?.kind !== 'paddle') return;
    this.say(pressPaddle(work.hand, job.lock));
  }

  /** Moves the close-up on by `dt` seconds of game time, with the keys held down. */
  step(dt: number, keys: HeldKeys): void {
    const { job, work } = this;
    if (!job || !work) return;
    this.time += dt;
    let done: boolean;
    if (work.kind === 'paddle') {
      const { hand } = work;
      if (keys.work) this.say(holdPaddle(hand, job.lock, dt));
      else if (keys.turn) this.say(windWindlass(hand, job.lock, keys.turn * KEY_WIND * dt));
      this.say(settlePaddle(hand, job.lock, dt, work.winding !== null || keys.work || keys.turn !== 0));
      done = paddleDone(hand, job.lock) || (!hand.fitted && !job.wanted());
    } else {
      const push: BeamPush = work.drag ? { kind: 'drag', angle: wrapAngle(Math.atan2(work.drag.at[1] - GATE_LAYOUT.hinge[1], work.drag.at[0] - GATE_LAYOUT.hinge[0]) + Math.PI) } : keys.work || keys.turn ? { kind: 'lean' } : null;
      work.held = swingBeam(work.hand, job.lock, dt, push, job.boats());
      if (push) this.say(work.held);
      done = gateDone(work.hand, job.lock) || !job.wanted();
    }
    this.doneFor = done ? this.doneFor + dt : 0;
    if (this.doneFor > LINGER) this.close();
  }

  render(dt: number): void {
    const { job, work } = this;
    if (!job || !work) return;
    const lock = job.lock;
    if (work.kind === 'paddle') {
      const { hand } = work;
      const windlass = hand.fitted ? { at: PADDLE_LAYOUT.spindle, angle: hand.angle } : { at: work.at, angle: 0 };
      work.view.render({ open: lock[hand.part], catchOn: hand.catchOn, angle: hand.angle, water: lock.water, flow: hand.part === 'bottomPaddle' ? lock.flowOut : lock.flowIn, windlass, ring: this.paddleRing(work) }, this.time, dt);
    } else {
      const { hand } = work;
      const part = hand.part;
      const level = levelsMatch(lock, part);
      const ring = !gateDone(hand, lock) && (level || lock[part] > 0.02) && !work.drag ? GateCloseup.beamEnd(hand.angle, GATE_LAYOUT.beam - 12) : null;
      work.view.render({ angle: hand.angle, open: lock[part], left: part === 'bottomGates' ? 0 : lock.water, right: part === 'bottomGates' ? lock.water : 1, level, ring });
    }
    const words = this.note && this.note.until > this.time ? this.note.text : this.hintText();
    if (this.hint.textContent !== words) this.hint.textContent = words;
  }

  private say(note: PaddleNote | GateHeld | null): void {
    if (!note) return;
    if (note === 'dropping' && this.work?.kind === 'paddle' && this.work.hand.target === 0) return;
    this.note = { text: NOTES[note], until: this.time + NOTE_TIME };
  }

  /** What to do next, in words. */
  private hintText(): string {
    const { job, work } = this;
    if (!job || !work) return '';
    if (work.kind === 'gate') {
      const verb = work.hand.target === 1 ? 'open' : 'shut';
      if (gateDone(work.hand, job.lock)) return `Done: the gate is ${verb}.`;
      if (!levelsMatch(job.lock, work.hand.part) && job.lock[work.hand.part] < 0.02) return "Not level yet: the water's weight holds the gate shut until the levels match. Watch the water, or come back when it's level.";
      return `Grab the white end of the beam and walk it round to swing the gate ${verb}, or hold Space. It's heavy, so it starts slowly.`;
    }
    const { hand } = work;
    switch (paddleStep(hand, job.lock)) {
      case 'done':
        return hand.target === 1 ? 'Done: the paddle is up and the water is running.' : 'Done: the paddle is down and the catch is back on.';
      case 'take-off':
        return 'Now take your windlass off: drag it away from the spindle, or press Space. Never leave it on: it can spin round.';
      case 'fit':
        return 'Pick up your windlass and drop it onto the square spindle, or press Space.';
      case 'flick-catch':
        return 'The safety catch holds the paddle up. Click the red catch to flick it off, or press Space, then wind anticlockwise.';
      case 'wind-down':
        return 'Wind anticlockwise to lower the paddle: drag round in circles, or hold Space. With the catch off, it drops if you let go.';
      case 'wind-up':
        return 'Wind clockwise to raise the paddle: drag round in circles, or hold Space. The catch clicks over the teeth as it rises.';
    }
  }

  private paddleRing(work: PaddleWork): Point | null {
    const lock = this.job?.lock;
    if (!lock) return null;
    const { hand } = work;
    if (paddleDone(hand, lock)) return null;
    if (!hand.fitted) return work.carry ? null : [work.at[0] + PADDLE_LAYOUT.arm, work.at[1]];
    if (paddleAtTarget(hand, lock)) return PADDLE_LAYOUT.spindle;
    if (hand.target === 0 && hand.catchOn) return PADDLE_LAYOUT.catchAt;
    return null;
  }

  // ---- The mouse, a finger or a pen --------------------------------------------

  private toArt(ev: PointerEvent): Point {
    const m = this.art.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  private down(ev: PointerEvent): void {
    const { job, work } = this;
    if (!job || !work) return;
    ev.preventDefault();
    try {
      this.art.setPointerCapture(ev.pointerId);
    } catch {
      // A pointer that can't be captured still works while it stays over the close-up.
    }
    const p = this.toArt(ev);
    if (work.kind === 'gate') {
      work.drag = { id: ev.pointerId, at: p };
      return;
    }
    const { hand } = work;
    const L = PADDLE_LAYOUT;
    if (dist(p, L.catchAt) < L.catchReach) {
      this.say(flickCatch(hand));
      return;
    }
    if (!hand.fitted) {
      const handle: Point = [work.at[0] + L.arm, work.at[1]];
      if (dist(p, work.at) < L.grabReach || dist(p, handle) < 40) work.carry = { id: ev.pointerId, offset: [work.at[0] - p[0], work.at[1] - p[1]] };
      return;
    }
    if (dist(p, L.spindle) < L.hubReach) {
      takeOffWindlass(hand);
      work.at = L.spindle;
      work.carry = { id: ev.pointerId, offset: [L.spindle[0] - p[0], L.spindle[1] - p[1]] };
      return;
    }
    work.winding = { id: ev.pointerId, last: Math.atan2(p[1] - L.spindle[1], p[0] - L.spindle[0]) };
  }

  private move(ev: PointerEvent): void {
    const { job, work } = this;
    if (!job || !work) return;
    const p = this.toArt(ev);
    if (work.kind === 'gate') {
      if (work.drag?.id === ev.pointerId) work.drag.at = p;
      return;
    }
    if (work.carry?.id === ev.pointerId) {
      work.at = [p[0] + work.carry.offset[0], p[1] + work.carry.offset[1]];
      return;
    }
    const winding = work.winding;
    if (winding?.id !== ev.pointerId) return;
    const [sx, sy] = PADDLE_LAYOUT.spindle;
    if (Math.hypot(p[0] - sx, p[1] - sy) < 8) return;
    const a = Math.atan2(p[1] - sy, p[0] - sx);
    const turn = wrapAngle(a - winding.last);
    winding.last = a;
    this.say(windWindlass(work.hand, job.lock, turn));
  }

  private up(ev: PointerEvent): void {
    const work = this.work;
    if (!work) return;
    if (work.kind === 'gate') {
      if (work.drag?.id === ev.pointerId) work.drag = null;
      return;
    }
    if (work.carry?.id === ev.pointerId) {
      // Dropped near the spindle it fits; anywhere else it goes back on the ground.
      if (dist(work.at, PADDLE_LAYOUT.spindle) < PADDLE_LAYOUT.fitReach) fitWindlass(work.hand);
      work.at = PADDLE_LAYOUT.rest;
      work.carry = null;
    }
    if (work.winding?.id === ev.pointerId) work.winding = null;
  }
}
