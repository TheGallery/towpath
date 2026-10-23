// What the game should sound like, worked out as plain data so it can be
// tested without a browser. Each one-off sound comes from a day's event, or
// from a change in your hands at a lock close-up between one frame and the
// next. Each steady sound (the engine, the water at the hull, the lock
// filling or emptying, the gear, the beam's creak) has a level, worked out
// from how things are right now. The mix sets how loud each group is. The
// sounds themselves are made in ./voices.

import { clamp } from '../core/math';
import { TOP_SPEED } from '../sim/boat';
import type { DayEvent, DayPhase } from '../sim/day';
import type { GateHeld } from '../sim/lock';
import type { TripPhase } from '../sim/trip';
import type { SoundSettings } from './settings';

const TAU = Math.PI * 2;

/** A one-off sound. */
export type Cue =
  | { readonly kind: 'bump'; readonly what: 'bank' | 'boat' }
  /** The lock reaches its level, and the water slops against the gates. */
  | { readonly kind: 'settle'; readonly full: boolean }
  | { readonly kind: 'windlass-on' }
  | { readonly kind: 'windlass-off' }
  | { readonly kind: 'catch-off' }
  | { readonly kind: 'catch-on' }
  /** The safety catch clicks over one tooth of the ratchet as the paddle is wound up. */
  | { readonly kind: 'tooth' }
  /** The paddle comes right down: gently when wound down, with a slam when it dropped. */
  | { readonly kind: 'paddle-down'; readonly hard: boolean }
  /** A gate comes to rest, shut against its pair or open against the side, so loud (1 close by). */
  | { readonly kind: 'gate-rest'; readonly shut: boolean; readonly loud: number };

/** The one-off sounds for the day's events. */
export function eventCues(events: readonly DayEvent[]): Cue[] {
  const cues: Cue[] = [];
  for (const e of events) {
    if (e.kind === 'bump') cues.push({ kind: 'bump', what: e.what });
    else if (e.kind === 'lock' && e.event.kind === 'level') cues.push({ kind: 'settle', full: e.event.full });
  }
  return cues;
}

/** Your hands at a lock close-up, as the sound needs them. */
export type Hands =
  | {
      readonly kind: 'paddle';
      readonly fitted: boolean;
      readonly catchOn: boolean;
      /** How far the spindle has turned, in radians; clockwise is positive. */
      readonly angle: number;
      /** How far the paddle is wound up, 0 right down to 1 fully up. */
      readonly open: number;
      /** Holding the windlass, by the pointer or a key. */
      readonly holding: boolean;
    }
  | {
      readonly kind: 'gate';
      /** How fast the beam is swinging, in radians a second. */
      readonly spin: number;
      /** How far the gate is open, 0 shut to 1 open. */
      readonly open: number;
      readonly held: GateHeld | null;
      readonly pushing: boolean;
    };

/** Teeth on a paddle's ratchet, each a click of the catch, in a turn of the spindle. */
export const TEETH_PER_TURN = 10;
/** The most clicks in one frame, so a fast wind or a fast game doesn't rattle. */
const MAX_TEETH = 3;
/** The spin, in radians a second, at which the beam creaks its loudest. */
const LOUDEST_SPIN = 1.2;

/** The steady sounds of your hands, each from 0 to 1. */
export interface HandBeds {
  /** The gear running as the paddle comes down with the catch off. */
  readonly gear: number;
  /** The windlass spinning, with nobody holding it, as the paddle drops. */
  readonly whirr: boolean;
  readonly creak: number;
  /** The beam straining against water that holds the gate shut. */
  readonly groan: number;
  /** Footsteps on the setts, walking the beam round. */
  readonly steps: number;
}

export const NO_HANDS: HandBeds = { gear: 0, whirr: false, creak: 0, groan: 0, steps: 0 };

/** What your hands sound like from one frame to the next, `dt` seconds apart: the one-off sounds, and the steady ones. */
export function listenToHands(was: Hands | null, now: Hands | null, dt: number): { readonly cues: Cue[]; readonly beds: HandBeds } {
  const cues: Cue[] = [];
  if (!now) return { cues, beds: NO_HANDS };
  // A new close-up starts quiet.
  const prev = was?.kind === now.kind ? was : null;
  if (now.kind === 'gate') {
    const before = prev?.kind === 'gate' ? prev : null;
    if (before && before.open !== now.open && (now.open === 0 || now.open === 1)) cues.push({ kind: 'gate-rest', shut: now.open === 0, loud: 1 });
    const spin = Math.abs(now.spin);
    return {
      cues,
      beds: { ...NO_HANDS, creak: clamp(spin / LOUDEST_SPIN, 0, 1), groan: now.pushing && now.held === 'water' ? 1 : 0, steps: now.pushing && spin > 0.05 ? 1 : 0 },
    };
  }
  const before = prev?.kind === 'paddle' ? prev : null;
  if (!before) return { cues, beds: NO_HANDS };
  if (!before.fitted && now.fitted) cues.push({ kind: 'windlass-on' });
  if (before.fitted && !now.fitted) cues.push({ kind: 'windlass-off' });
  if (before.catchOn && !now.catchOn) cues.push({ kind: 'catch-off' });
  const falling = dt > 0 ? (before.open - now.open) / dt : 0;
  // A paddle coming down with nobody holding the windlass has been dropped, not wound.
  if (before.open > 0.001 && now.open <= 0.001) cues.push({ kind: 'paddle-down', hard: !before.holding });
  // The catch drops back into the teeth once the paddle is right down.
  if (!before.catchOn && now.catchOn) cues.push({ kind: 'catch-on' });
  if (now.catchOn && now.fitted && now.angle > before.angle) {
    const tooth = TAU / TEETH_PER_TURN;
    const crossed = Math.floor(now.angle / tooth) - Math.floor(before.angle / tooth);
    for (let i = 0; i < Math.min(crossed, MAX_TEETH); i++) cues.push({ kind: 'tooth' });
  }
  const lowering = !now.catchOn && falling > 0;
  return { cues, beds: { ...NO_HANDS, gear: lowering ? clamp(falling / 0.35, 0.3, 1) : 0, whirr: lowering && !now.holding } };
}

/** How things are on the canal, as the sound needs them. */
export interface World {
  readonly phase: DayPhase;
  readonly trip: TripPhase;
  /** The boat's speed through the water; negative going astern. */
  readonly speed: number;
  /** The lock nearest the boat, and how far it is, if it's near enough to hear. */
  readonly lock: NearLock | null;
}

export interface NearLock {
  readonly id: string;
  readonly distance: number;
  readonly flowIn: number;
  readonly flowOut: number;
  /** How far each end's gates are open, 0 shut to 1 open. */
  readonly bottomGates: number;
  readonly topGates: number;
}

/** The steady sounds of the canal, each from 0 to 1. */
export interface WorldBeds {
  readonly engine: number;
  /** The engine's beats a second. */
  readonly beat: number;
  readonly astern: boolean;
  readonly lapping: number;
  /** The wash along the hull, with the boat's speed. */
  readonly wash: number;
  readonly fill: number;
  readonly empty: number;
}

/** The engine's beats a second, ticking over and at full speed. */
export const TICK_OVER = 3.6;
export const FULL_BEAT = 9;
/** A lock this near is heard in full, and one this far not at all. */
const LOCK_NEAR = 250;
export const LOCK_FAR = 700;

/** How much of a lock you hear from where the boat is, from 1 close by to 0. */
const nearness = (lock: NearLock): number => clamp((LOCK_FAR - lock.distance) / (LOCK_FAR - LOCK_NEAR), 0, 1);

/**
 * The gates a crew swings, coming to rest: the other boat's, and the ones
 * swung shut behind yours. Gates you swing yourself are heard through your
 * hands, so none are while a close-up is open.
 */
export function lockCues(was: NearLock | null, now: NearLock | null, closeupOpen: boolean): Cue[] {
  if (!was || !now || was.id !== now.id || closeupOpen) return [];
  const loud = nearness(now);
  if (loud <= 0) return [];
  const cues: Cue[] = [];
  for (const gate of ['bottomGates', 'topGates'] as const) {
    if (was[gate] !== now[gate] && (now[gate] === 0 || now[gate] === 1)) cues.push({ kind: 'gate-rest', shut: now[gate] === 0, loud });
  }
  return cues;
}

/** The engine runs from casting off until the boat is tied up for the night. */
const ENGINE_PHASES: ReadonlySet<DayPhase> = new Set(['underway', 'dusk', 'tying-up']);

export function worldBeds(world: World): WorldBeds {
  const m = clamp(Math.abs(world.speed) / TOP_SPEED, 0, 1);
  const running = ENGINE_PHASES.has(world.phase) && world.trip !== 'moored';
  const near = world.lock ? nearness(world.lock) : 0;
  return {
    engine: running ? 1 : 0,
    beat: TICK_OVER + (FULL_BEAT - TICK_OVER) * m,
    astern: world.speed < -0.05,
    lapping: 1,
    wash: running ? m : 0,
    fill: world.lock ? clamp(world.lock.flowIn, 0, 1) * near : 0,
    empty: world.lock ? clamp(world.lock.flowOut, 0, 1) * near : 0,
  };
}

/** Where you're looking, as the mix needs it. */
export interface View {
  readonly hidden: boolean;
  readonly mapOpen: boolean;
  readonly closeupOpen: boolean;
}

/** How loud each part of the mix is, each from 0 to 1. The bell isn't in it: it has its own switch and always rings at its own level. */
export interface Mix {
  readonly master: number;
  /** The two groups you can switch off. */
  readonly boat: number;
  readonly nature: number;
  /** The canal around the boat: the engine and the water at the hull. */
  readonly world: number;
  /** The lock: its water, and your hands in a close-up. */
  readonly lock: number;
}

/** In a close-up the world steps back and the lock comes forward; on the map, everything steps back. */
export const CLOSEUP_WORLD = 0.35;
export const MAP_LEVEL = 0.5;

export function mixLevels(settings: SoundSettings, view: View): Mix {
  return {
    master: settings.on && !view.hidden ? settings.volume : 0,
    boat: settings.boat ? 1 : 0,
    nature: settings.nature ? 1 : 0,
    world: view.closeupOpen ? CLOSEUP_WORLD : view.mapOpen ? MAP_LEVEL : 1,
    lock: view.mapOpen ? MAP_LEVEL : 1,
  };
}

/** How far the steady sounds dip under a one-off sound, and for how long in seconds; the bell dips them further. */
export const CUE_DUCK = { depth: 0.6, length: 0.4 } as const;
export const BELL_DUCK = { depth: 0.4, length: 2.5 } as const;

/** How much the steady sounds are dipped, from 1 (not at all), so many seconds after the last one-off sound and the last bell. */
export function duck(sinceCue: number, sinceBell: number): number {
  return Math.min(sinceCue < CUE_DUCK.length ? CUE_DUCK.depth : 1, sinceBell < BELL_DUCK.length ? BELL_DUCK.depth : 1);
}
