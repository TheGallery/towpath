import { describe, expect, it } from 'vitest';
import { BELL_DUCK, CLOSEUP_WORLD, CUE_DUCK, FULL_BEAT, MAP_LEVEL, TEETH_PER_TURN, TICK_OVER, duck, eventCues, listenToHands, lockCues, mixLevels, worldBeds } from '../src/audio/cues';
import type { Cue, Hands, NearLock, World } from '../src/audio/cues';
import { SOUND_DEFAULTS, readSoundSettings, writeSoundSettings } from '../src/audio/settings';
import { ASTERN_SPEED, TOP_SPEED } from '../src/sim/boat';
import type { DayEvent } from '../src/sim/day';
import { newLock } from '../src/sim/lock';
import type { GateHeld, LockState } from '../src/sim/lock';
import { TURNS, fitWindlass, flickCatch, newGateHand, newPaddleHand, settlePaddle, swingBeam, takeOffWindlass, windWindlass } from '../src/sim/mechanism';
import type { GateHand, PaddleHand } from '../src/sim/mechanism';

const STEP = 1 / 30;
const TURN = Math.PI * 2;

const paddle = (hand: PaddleHand, lock: LockState, holding = true): Hands => ({ kind: 'paddle', fitted: hand.fitted, catchOn: hand.catchOn, angle: hand.angle, open: lock[hand.part], holding });
const gate = (hand: GateHand, lock: LockState, pushing: boolean, held: GateHeld | null = null): Hands => ({ kind: 'gate', spin: hand.spin, open: lock[hand.part], held, pushing });
const kinds = (cues: readonly Cue[]): string[] => cues.map((c) => c.kind);

/** Listens to a run of snapshots, a frame apart, and gathers every one-off sound. */
function listen(frames: readonly Hands[], dt = STEP): Cue[] {
  const cues: Cue[] = [];
  for (let i = 1; i < frames.length; i++) cues.push(...listenToHands(frames[i - 1], frames[i], dt).cues);
  return cues;
}

describe('the sound settings', () => {
  it('start with sound off until you turn it on', () => {
    expect(SOUND_DEFAULTS.on).toBe(false);
    expect(readSoundSettings(null)).toEqual(SOUND_DEFAULTS);
  });

  it('come back as they were kept', () => {
    const settings = { on: true, volume: 0.35, boat: false, nature: true };
    expect(readSoundSettings(writeSoundSettings(settings))).toEqual(settings);
  });

  it('give the default for anything broken, field by field, and keep the volume between 0 and 1', () => {
    expect(readSoundSettings('not json')).toEqual(SOUND_DEFAULTS);
    expect(readSoundSettings('[1, 2]')).toEqual({ ...SOUND_DEFAULTS });
    expect(readSoundSettings(JSON.stringify({ on: 'yes', volume: 4, boat: false }))).toEqual({ ...SOUND_DEFAULTS, volume: 1, boat: false });
    expect(readSoundSettings(JSON.stringify({ on: true, volume: -2 }))).toEqual({ ...SOUND_DEFAULTS, on: true, volume: 0 });
  });
});

describe("the day's events", () => {
  it('sound a bump into the bank or a moored boat, and the lock settling at its level', () => {
    const events: DayEvent[] = [
      { kind: 'bump', what: 'bank' },
      { kind: 'cast-off' },
      { kind: 'bump', what: 'boat' },
      { kind: 'lock', lock: 'brook', event: { kind: 'level', full: true } },
      { kind: 'lock', lock: 'brook', event: { kind: 'held', gate: 'topGates', why: 'water' } },
      { kind: 'lock', lock: 'brook', event: { kind: 'level', full: false } },
    ];
    expect(eventCues(events)).toEqual([
      { kind: 'bump', what: 'bank' },
      { kind: 'bump', what: 'boat' },
      { kind: 'settle', full: true },
      { kind: 'settle', full: false },
    ]);
  });
});

describe('your hands on a paddle', () => {
  it('clunk the windlass on, click the catch over every tooth winding up, and clink it off', () => {
    const lock = newLock(0);
    const hand = newPaddleHand('topPaddle', 1);
    const frames = [paddle(hand, lock)];
    fitWindlass(hand);
    frames.push(paddle(hand, lock));
    for (let i = 0; i < TURNS * 36; i++) {
      windWindlass(hand, lock, TURN / 36);
      frames.push(paddle(hand, lock));
    }
    takeOffWindlass(hand);
    frames.push(paddle(hand, lock));
    const cues = kinds(listen(frames));
    expect(cues[0]).toBe('windlass-on');
    expect(cues.at(-1)).toBe('windlass-off');
    // The paddle snaps the last of its travel fully up, a little short of the third turn's last tooth.
    const teeth = cues.filter((c) => c === 'tooth').length;
    expect(teeth).toBeGreaterThanOrEqual(TURNS * TEETH_PER_TURN - 1);
    expect(teeth).toBeLessThanOrEqual(TURNS * TEETH_PER_TURN);
  });

  it("don't click winding down with the catch off, but run the gear, and seat the paddle gently", () => {
    const lock = newLock(0);
    lock.bottomPaddle = 1;
    const hand = newPaddleHand('bottomPaddle', 0);
    fitWindlass(hand);
    const frames = [paddle(hand, lock)];
    flickCatch(hand);
    frames.push(paddle(hand, lock));
    let gear = 0;
    while (lock.bottomPaddle > 0) {
      const was = paddle(hand, lock);
      windWindlass(hand, lock, -TURN / 60);
      settlePaddle(hand, lock, STEP, true);
      const now = paddle(hand, lock);
      gear = Math.max(gear, listenToHands(was, now, STEP).beds.gear);
      frames.push(now);
    }
    const cues = listen(frames);
    expect(kinds(cues)).toEqual(['catch-off', 'paddle-down', 'catch-on']);
    expect(cues[1]).toEqual({ kind: 'paddle-down', hard: false });
    expect(gear).toBeGreaterThan(0);
  });

  it('whirr and slam when a paddle drops with the catch off and nobody holding it', () => {
    const lock = newLock(0);
    lock.topPaddle = 1;
    const hand = newPaddleHand('topPaddle', 0);
    fitWindlass(hand);
    flickCatch(hand);
    const frames = [paddle(hand, lock, false)];
    let whirred = false;
    while (lock.topPaddle > 0) {
      const was = paddle(hand, lock, false);
      settlePaddle(hand, lock, STEP, false);
      const now = paddle(hand, lock, false);
      whirred ||= listenToHands(was, now, STEP).beds.whirr;
      frames.push(now);
    }
    expect(whirred).toBe(true);
    expect(listen(frames)).toContainEqual({ kind: 'paddle-down', hard: true });
  });

  it('make no sound in the first frame of a close-up, or with none open', () => {
    const lock = newLock(0);
    const hand = newPaddleHand('topPaddle', 1);
    fitWindlass(hand);
    expect(listenToHands(null, paddle(hand, lock), STEP).cues).toEqual([]);
    expect(listenToHands(paddle(hand, lock), null, STEP)).toEqual({ cues: [], beds: { gear: 0, whirr: false, creak: 0, groan: 0, steps: 0 } });
  });
});

describe('your hands on a gate', () => {
  it('creak as the beam swings, with footsteps, and thump as the gate comes to rest', () => {
    const lock = newLock(1);
    lock.topGates = 1;
    const hand = newGateHand(lock, 'topGates', 0);
    const frames = [gate(hand, lock, true)];
    let creak = 0;
    let steps = 0;
    for (let t = 0; t < 30 && lock.topGates > 0; t += STEP) {
      const was = gate(hand, lock, true);
      swingBeam(hand, lock, STEP, { kind: 'lean' }, []);
      const now = gate(hand, lock, true);
      const beds = listenToHands(was, now, STEP).beds;
      creak = Math.max(creak, beds.creak);
      steps = Math.max(steps, beds.steps);
      frames.push(now);
    }
    expect(lock.topGates).toBe(0);
    expect(creak).toBeGreaterThan(0.3);
    expect(steps).toBe(1);
    expect(listen(frames)).toEqual([{ kind: 'gate-rest', shut: true, loud: 1 }]);
  });

  it('only groan, without moving, when the water holds the gate shut', () => {
    const lock = newLock(0.4);
    const hand = newGateHand(lock, 'bottomGates', 1);
    const was = gate(hand, lock, true);
    const held = swingBeam(hand, lock, STEP, { kind: 'lean' }, []);
    expect(held).toBe('water');
    const heard = listenToHands(was, gate(hand, lock, true, held), STEP);
    expect(heard.cues).toEqual([]);
    expect(heard.beds.groan).toBe(1);
    expect(heard.beds.steps).toBe(0);
  });
});

describe('the steady sounds', () => {
  const world = (over: Partial<World> = {}): World => ({ phase: 'underway', trip: 'cruising', speed: 0, lock: null, ...over });
  const lock = (over: Partial<NearLock> = {}): NearLock => ({ id: 'brook', distance: 205, flowIn: 0, flowOut: 0, bottomGates: 0, topGates: 0, ...over });

  it('run the engine from casting off until the boat is tied up, beating faster with speed', () => {
    expect(worldBeds(world({ phase: 'morning', trip: 'moored' })).engine).toBe(0);
    expect(worldBeds(world({ phase: 'evening', trip: 'arrived' })).engine).toBe(0);
    const tickingOver = worldBeds(world({ trip: 'in-lock' }));
    expect(tickingOver.engine).toBe(1);
    expect(tickingOver.beat).toBe(TICK_OVER);
    expect(worldBeds(world({ speed: TOP_SPEED })).beat).toBe(FULL_BEAT);
    expect(worldBeds(world({ phase: 'dusk', trip: 'arrived' })).engine).toBe(1);
    const astern = worldBeds(world({ speed: ASTERN_SPEED }));
    expect(astern.astern).toBe(true);
    expect(astern.beat).toBeGreaterThan(TICK_OVER);
  });

  it('lap at the hull all day, with a wash that grows with speed', () => {
    expect(worldBeds(world({ phase: 'night', trip: 'arrived' })).lapping).toBe(1);
    expect(worldBeds(world({ phase: 'night', trip: 'arrived' })).wash).toBe(0);
    expect(worldBeds(world({ speed: TOP_SPEED / 2 })).wash).toBeCloseTo(0.5, 5);
  });

  it('fill and empty the lock as hard as the water runs, and fade with distance', () => {
    expect(worldBeds(world({ lock: lock({ flowIn: 0.8 }) })).fill).toBeCloseTo(0.8, 5);
    expect(worldBeds(world({ lock: lock({ flowOut: 0.6 }) })).empty).toBeCloseTo(0.6, 5);
    expect(worldBeds(world({ lock: lock({ flowIn: 1, distance: 475 }) })).fill).toBeCloseTo(0.5, 5);
    expect(worldBeds(world({ lock: lock({ flowIn: 1, distance: 900 }) })).fill).toBe(0);
  });

  it("thump a crew's gates coming to rest, unless your hands are on them in a close-up", () => {
    const was = lock({ bottomGates: 0.4, topGates: 1 });
    const shut = lock({ bottomGates: 0, topGates: 1 });
    expect(lockCues(was, shut, false)).toEqual([{ kind: 'gate-rest', shut: true, loud: 1 }]);
    expect(lockCues(was, shut, true)).toEqual([]);
    expect(lockCues(lock({ topGates: 0.5, distance: 475 }), lock({ topGates: 1, distance: 475 }), false)).toEqual([{ kind: 'gate-rest', shut: false, loud: 0.5 }]);
    expect(lockCues(was, { ...shut, id: 'mill' }, false)).toEqual([]);
    expect(lockCues(was, lock({ bottomGates: 0.3, topGates: 1 }), false)).toEqual([]);
  });
});

describe('the mix', () => {
  const on = { ...SOUND_DEFAULTS, on: true, volume: 0.5 };
  const looking = { hidden: false, mapOpen: false, closeupOpen: false };

  it('is silent with sound off, and plays at your volume with it on', () => {
    expect(mixLevels(SOUND_DEFAULTS, looking).master).toBe(0);
    expect(mixLevels(on, looking).master).toBe(0.5);
  });

  it('fades out in a background tab', () => {
    expect(mixLevels(on, { ...looking, hidden: true }).master).toBe(0);
  });

  it('switches the boat and nature groups off on their own', () => {
    expect(mixLevels({ ...on, boat: false }, looking)).toMatchObject({ boat: 0, nature: 1 });
    expect(mixLevels({ ...on, nature: false }, looking)).toMatchObject({ boat: 1, nature: 0 });
  });

  it('steps the world back in a close-up, bringing the lock forward, and everything back on the map', () => {
    expect(mixLevels(on, { ...looking, closeupOpen: true })).toMatchObject({ world: CLOSEUP_WORLD, lock: 1 });
    expect(mixLevels(on, { ...looking, mapOpen: true })).toMatchObject({ world: MAP_LEVEL, lock: MAP_LEVEL });
  });

  it('dips the steady sounds under a one-off sound, and further under the bell', () => {
    expect(duck(Infinity, Infinity)).toBe(1);
    expect(duck(0.1, Infinity)).toBe(CUE_DUCK.depth);
    expect(duck(0.1, 0.1)).toBe(BELL_DUCK.depth);
    expect(duck(CUE_DUCK.length, BELL_DUCK.length)).toBe(1);
    expect(BELL_DUCK.depth).toBeLessThan(CUE_DUCK.depth);
  });
});
