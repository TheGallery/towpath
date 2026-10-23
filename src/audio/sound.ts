// The game's sound, all through one AudioContext. Browsers only let a page
// make sound once you've clicked or pressed a key in it, so it wakes on your
// first touch and stays quiet until then. The bell rings at its own level,
// with its own switch. The other sounds are off until you turn them on, and
// play through a mix: the boat and its locks, and nature, each with its own
// switch, under a master volume and a compressor. The steady sounds dip under
// a one-off sound, and further under the bell. When sound is off or the tab
// is hidden, they fade out and stop, so only the bell rings in a background
// tab.

import type { DayEvent } from '../sim/day';
import { ringBell } from './bell';
import { duck, eventCues, listenToHands, lockCues, mixLevels, worldBeds } from './cues';
import type { Cue, Hands, NearLock, View, World } from './cues';
import type { SoundSettings } from './settings';
import { Beds, Kit, playCue } from './voices';

/** How far ahead of the audio clock the steady sounds' strokes are scheduled, in seconds. */
const AHEAD = 0.2;
/** Seconds the sounds take to fade out when sound is turned off or the tab is hidden. */
const FADE_OUT = 0.8;
/** Each part of the mix's own level, before the master volume. */
const LEVELS = { engine: 0.55, water: 0.6, lock: 0.8, hands: 0.9, cues: 0.8 } as const;
/** The clicks of one frame's teeth are spread out by this much, in seconds. */
const TOOTH_GAP = 0.02;

/** How things are this frame, as the sound needs them. */
export interface SoundFrame {
  readonly world: World;
  readonly hands: Hands | null;
  readonly mapOpen: boolean;
  readonly closeupOpen: boolean;
}

interface Mixer {
  readonly master: GainNode;
  readonly boat: GainNode;
  readonly nature: GainNode;
  readonly engine: GainNode;
  readonly water: GainNode;
  readonly lock: GainNode;
  readonly hands: GainNode;
  readonly cues: GainNode;
}

function buildMixer(ctx: AudioContext): Mixer {
  const gain = (dest: AudioNode, value = 0): GainNode => {
    const g = ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  };
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 4;
  compressor.connect(ctx.destination);
  const master = gain(compressor);
  const boat = gain(master);
  const nature = gain(master);
  return { master, boat, nature, engine: gain(boat), water: gain(nature), lock: gain(boat), hands: gain(boat), cues: gain(boat) };
}

export class Sound {
  /** Whether the bell rings for the boat's calls. */
  bellOn = true;
  private ctx: AudioContext | null = null;
  private kit: Kit | null = null;
  private mixer: Mixer | null = null;
  private beds: Beds | null = null;
  private hidden = false;
  private view: View = { hidden: false, mapOpen: false, closeupOpen: false };
  private hands: Hands | null = null;
  private lock: NearLock | null = null;
  private lastCue = -Infinity;
  private lastBell = -Infinity;

  constructor(
    target: Window,
    private settings: SoundSettings,
  ) {
    const wake = () => this.wake();
    target.addEventListener('pointerdown', wake, { capture: true });
    target.addEventListener('keydown', wake, { capture: true });
  }

  get current(): SoundSettings {
    return this.settings;
  }

  /** Changes how the sound is set: on or off, the volume, and the groups. */
  configure(settings: SoundSettings): void {
    this.settings = settings;
    this.apply();
  }

  /** The tab has gone into the background, or come back. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.apply();
  }

  private running(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  private audible(): boolean {
    return this.running() !== null && this.settings.on && !this.hidden;
  }

  private wake(): void {
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') return;
      this.ctx = new AudioContext();
      this.kit = new Kit(this.ctx);
      this.mixer = buildMixer(this.ctx);
      this.ctx.addEventListener('statechange', () => this.apply());
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Rings the bell once, if it's on and the page may make sound. */
  ring(): void {
    const ctx = this.running();
    if (!this.bellOn || !ctx) return;
    ringBell(ctx, ctx.destination);
    this.lastBell = ctx.currentTime;
  }

  /** Plays the one-off sounds for the day's events. */
  hear(events: readonly DayEvent[]): void {
    this.play(eventCues(events));
  }

  /** Moves the sound on to this frame, `dt` seconds after the last. */
  update(frame: SoundFrame, dt: number): void {
    this.view = { hidden: this.hidden, mapOpen: frame.mapOpen, closeupOpen: frame.closeupOpen };
    const heard = listenToHands(this.hands, frame.hands, dt);
    const crew = lockCues(this.lock, frame.world.lock, frame.closeupOpen);
    this.hands = frame.hands;
    this.lock = frame.world.lock;
    this.apply();
    const ctx = this.running();
    if (!ctx || !this.kit || !this.mixer || !this.audible()) return;
    this.play([...heard.cues, ...crew]);
    const m = this.mixer;
    const at = ctx.currentTime;
    this.beds ??= new Beds(this.kit, { engine: m.engine, water: m.water, lock: m.lock, hands: m.hands }, at);
    this.beds.update(worldBeds(frame.world), heard.beds, at, at + AHEAD);
  }

  /** Sets each part of the mix towards its level, and stops the steady sounds when nothing should be heard. */
  private apply(): void {
    const ctx = this.ctx;
    const m = this.mixer;
    if (!ctx || !m) return;
    const at = ctx.currentTime;
    const mix = mixLevels(this.settings, { ...this.view, hidden: this.hidden });
    const audible = this.audible();
    const dip = duck(at - this.lastCue, at - this.lastBell);
    m.master.gain.setTargetAtTime(audible ? mix.master : 0, at, audible ? 0.1 : FADE_OUT / 3);
    m.boat.gain.setTargetAtTime(mix.boat, at, 0.1);
    m.nature.gain.setTargetAtTime(mix.nature, at, 0.1);
    m.engine.gain.setTargetAtTime(LEVELS.engine * mix.world * dip, at, 0.08);
    m.water.gain.setTargetAtTime(LEVELS.water * mix.world * dip, at, 0.08);
    m.lock.gain.setTargetAtTime(LEVELS.lock * mix.lock * dip, at, 0.08);
    m.hands.gain.setTargetAtTime(LEVELS.hands * mix.lock, at, 0.08);
    m.cues.gain.setTargetAtTime(LEVELS.cues, at, 0.08);
    if (!audible && this.beds) {
      this.beds.stop(at + FADE_OUT + 0.2);
      this.beds = null;
    }
  }

  private play(cues: readonly Cue[]): void {
    const ctx = this.running();
    if (!ctx || !this.kit || !this.mixer || !this.audible() || cues.length === 0) return;
    const at = ctx.currentTime + 0.01;
    let teeth = 0;
    for (const cue of cues) playCue(this.kit, cue, cue.kind === 'tooth' ? at + TOOTH_GAP * teeth++ : at, this.mixer.cues);
    // The ratchet's clicks are your hands' own steady work, so they don't dip the rest.
    if (cues.some((c) => c.kind !== 'tooth')) this.lastCue = ctx.currentTime;
  }
}
