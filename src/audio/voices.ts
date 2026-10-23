// The sounds themselves, made with the Web Audio API from noise and tones, so
// the game needs no sound files: the engine's putter, the water at the hull,
// the lock filling and emptying, the gear and the beam's creak as steady
// sounds that follow their levels, and the bumps, clunks, clicks and thumps
// as one-off sounds. Times are on the audio clock, in seconds.

import type { Cue, HandBeds, WorldBeds } from './cues';

type Noise = 'white' | 'pink' | 'brown';

interface ToneShape {
  readonly f: number;
  /** Where the pitch slides to by the end. */
  readonly to?: number;
  readonly type?: OscillatorType;
  readonly peak: number;
  readonly attack?: number;
  readonly length: number;
}

interface BurstShape {
  readonly noise?: Noise;
  readonly filter?: BiquadFilterType;
  readonly f: number;
  readonly q?: number;
  readonly peak: number;
  readonly attack?: number;
  readonly length: number;
}

const random = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/** Building blocks for the sounds: noise, filters, tones and short bursts. */
export class Kit {
  private readonly noises = new Map<Noise, AudioBuffer>();

  constructor(readonly ctx: BaseAudioContext) {}

  /** Three seconds of noise, made once and looped. */
  private buffer(kind: Noise): AudioBuffer {
    const made = this.noises.get(kind);
    if (made) return made;
    const length = this.ctx.sampleRate * 3;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const d = buffer.getChannelData(0);
    let last = 0;
    const b = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        // Paul Kellet's filter, for noise that falls off as 1/f.
        b[0] = 0.99886 * b[0] + w * 0.0555179;
        b[1] = 0.99332 * b[1] + w * 0.0750759;
        b[2] = 0.969 * b[2] + w * 0.153852;
        b[3] = 0.8665 * b[3] + w * 0.3104856;
        b[4] = 0.55 * b[4] + w * 0.5329522;
        b[5] = -0.7616 * b[5] - w * 0.016898;
        d[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11;
        b[6] = w * 0.115926;
      }
    }
    this.noises.set(kind, buffer);
    return buffer;
  }

  /** Noise playing on and on, from a random point in its loop. */
  noise(kind: Noise, at: number): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer(kind);
    source.loop = true;
    source.start(at, Math.random() * 2);
    return source;
  }

  filter(type: BiquadFilterType, f: number, q = 1): BiquadFilterNode {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    return filter;
  }

  gain(value = 1): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    return gain;
  }

  /** A fixed place left (-1) or right (1) of the middle, feeding `dest`. */
  place(pan: number, dest: AudioNode): AudioNode {
    if (typeof this.ctx.createStereoPanner !== 'function') return dest;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(dest);
    return panner;
  }

  tone(at: number, dest: AudioNode, s: ToneShape): void {
    const attack = s.attack ?? 0.005;
    const tone = this.ctx.createOscillator();
    tone.type = s.type ?? 'sine';
    tone.frequency.setValueAtTime(s.f, at);
    if (s.to) tone.frequency.exponentialRampToValueAtTime(s.to, at + attack + s.length);
    const envelope = this.envelope(at, s.peak, attack, s.length);
    tone.connect(envelope).connect(dest);
    tone.start(at);
    tone.stop(at + attack + s.length + 0.05);
  }

  burst(at: number, dest: AudioNode, s: BurstShape): void {
    const attack = s.attack ?? 0.003;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer(s.noise ?? 'white');
    const envelope = this.envelope(at, s.peak, attack, s.length);
    source.connect(this.filter(s.filter ?? 'bandpass', s.f, s.q ?? 1)).connect(envelope).connect(dest);
    source.start(at, Math.random() * 2);
    source.stop(at + attack + s.length + 0.05);
  }

  /** Struck metal: overtones that aren't whole multiples of the note, each dying away faster. */
  metal(at: number, dest: AudioNode, f: number, ratios: readonly number[], peak: number, length: number): void {
    ratios.forEach((r, i) => this.tone(at, dest, { f: f * r, peak: peak / (i + 1), attack: 0.002, length: length / (1 + i * 0.6) }));
  }

  private envelope(at: number, peak: number, attack: number, length: number): GainNode {
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + length);
    return g;
  }
}

/** How quickly a steady sound follows its level, in seconds. */
const FOLLOW = 0.25;

function follow(param: AudioParam, value: number, at: number, time = FOLLOW): void {
  param.setTargetAtTime(value, at, time);
}

/** Where the steady sounds play: the canal round the boat, the lock, and your hands. */
export interface BedOuts {
  readonly engine: AudioNode;
  readonly water: AudioNode;
  readonly lock: AudioNode;
  readonly hands: AudioNode;
}

/**
 * The steady sounds, playing for as long as sound is on and the tab is in
 * view. Each follows its level; the ones made of separate strokes (the
 * engine's beats, the water's slaps and bubbles, the gear's rattle, the
 * footsteps) are scheduled a little ahead of the audio clock.
 */
export class Beds {
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly engineLevel: GainNode;
  private readonly engineBody: BiquadFilterNode;
  private readonly lapLevel: GainNode;
  private readonly lapTone: BiquadFilterNode;
  private readonly wash: GainNode;
  private readonly slapSides: AudioNode[];
  private readonly roar: GainNode;
  private readonly roarTone: BiquadFilterNode;
  private readonly boil: GainNode;
  private readonly fall: GainNode;
  private readonly suck: GainNode;
  private readonly gear: OscillatorNode;
  private readonly gearLevel: GainNode;
  private readonly creak: OscillatorNode;
  private readonly creakLevel: GainNode;
  private readonly creakTones: readonly BiquadFilterNode[];
  private readonly swish: GainNode;
  private readonly bubbleSides: AudioNode[];
  private readonly handsOut: AudioNode;
  private world: WorldBeds | null = null;
  private hands: HandBeds | null = null;
  private next = { beat: 0, slap: 0, bubble: 0, gurgle: 0, rattle: 0, step: 0, jitter: 0 };
  private strong = false;

  constructor(
    private readonly kit: Kit,
    outs: BedOuts,
    at: number,
  ) {
    const k = kit;
    this.handsOut = outs.hands;
    // The engine: a low rumble under its beats, through the body of the boat.
    this.engineLevel = k.gain(0);
    this.engineLevel.connect(outs.engine);
    this.engineBody = k.filter('lowpass', 1350, 0.7);
    this.engineBody.connect(this.engineLevel);
    this.loop('brown', at).connect(k.filter('lowpass', 210, 0.8)).connect(k.gain(0.22)).connect(this.engineBody);

    // The water at the hull, and the wash along it as the boat moves.
    this.lapLevel = k.gain(0);
    this.lapLevel.connect(outs.water);
    this.lapTone = k.filter('lowpass', 300, 0.7);
    this.loop('brown', at).connect(this.lapTone).connect(k.gain(0.22)).connect(this.lapLevel);
    this.wash = k.gain(0);
    this.loop('pink', at).connect(k.filter('bandpass', 1100, 0.9)).connect(this.wash).connect(this.lapLevel);
    this.slapSides = [-0.35, 0, 0.35].map((p) => k.place(p, this.lapLevel));

    // Filling: a deep roar and a boil of water coming up from the paddles.
    this.roar = k.gain(0);
    this.roarTone = k.filter('lowpass', 360, 0.8);
    this.loop('brown', at).connect(this.roarTone).connect(this.roar).connect(outs.lock);
    this.boil = k.gain(0);
    this.loop('pink', at).connect(k.filter('bandpass', 520, 0.7)).connect(this.boil).connect(outs.lock);
    this.bubbleSides = [-0.4, 0, 0.4].map((p) => k.place(p, outs.lock));

    // Emptying: water falling below the bottom gates, and a gurgle in the chamber.
    this.fall = k.gain(0);
    this.loop('white', at).connect(k.filter('bandpass', 1700, 0.5)).connect(k.filter('highpass', 400, 0.7)).connect(this.fall).connect(k.place(0.3, outs.lock));
    this.suck = k.gain(0);
    this.loop('brown', at).connect(k.filter('lowpass', 170, 0.9)).connect(this.suck).connect(outs.lock);

    // The paddle's gear running down, and the beam's creak and the water round the gate.
    this.gear = k.ctx.createOscillator();
    this.gear.type = 'sawtooth';
    this.gear.frequency.value = 30;
    this.gearLevel = k.gain(0);
    this.gear.connect(k.filter('lowpass', 180, 1)).connect(this.gearLevel).connect(outs.hands);
    this.start(this.gear, at);
    this.creak = k.ctx.createOscillator();
    this.creak.type = 'sawtooth';
    this.creakLevel = k.gain(0);
    this.creakLevel.connect(outs.hands);
    this.creakTones = [k.filter('bandpass', 800, 7), k.filter('bandpass', 1520, 6)];
    for (const tone of this.creakTones) this.creak.connect(tone).connect(this.creakLevel);
    this.start(this.creak, at);
    this.swish = k.gain(0);
    this.loop('pink', at).connect(k.filter('lowpass', 600, 0.7)).connect(this.swish).connect(outs.hands);

    for (const key of Object.keys(this.next) as (keyof Beds['next'])[]) this.next[key] = at;
  }

  private start<T extends AudioScheduledSourceNode>(source: T, at: number): T {
    source.start(at);
    this.sources.push(source);
    return source;
  }

  private loop(kind: Noise, at: number): AudioBufferSourceNode {
    const source = this.kit.noise(kind, at);
    this.sources.push(source);
    return source;
  }

  /** Sets each sound towards its level, from `at`, and schedules its strokes up to `until`. */
  update(world: WorldBeds, hands: HandBeds, at: number, until: number): void {
    const k = this.kit;
    this.world = world;
    this.hands = hands;
    follow(this.engineLevel.gain, world.engine, at, world.engine > 0 ? 0.6 : 0.8);
    follow(this.lapLevel.gain, world.lapping, at);
    follow(this.lapTone.frequency, 300 + 400 * world.wash, at);
    follow(this.wash.gain, 0.11 * world.wash, at, 0.4);
    follow(this.roar.gain, 0.7 * world.fill, at);
    follow(this.roarTone.frequency, 180 + 180 * world.fill, at);
    follow(this.boil.gain, 0.25 * world.fill, at);
    follow(this.fall.gain, 0.32 * world.empty, at);
    follow(this.suck.gain, 0.45 * world.empty, at);
    follow(this.gear.frequency, hands.whirr ? 90 : 30, at, 0.3);
    follow(this.gearLevel.gain, (hands.whirr ? 0.12 : 0.06) * hands.gear, at, 0.08);
    const creaking = Math.max(hands.creak, hands.groan * 0.6);
    follow(this.creakLevel.gain, creaking > 0.02 ? 0.08 + 0.45 * creaking : 0, at, 0.1);
    follow(this.swish.gain, 0.15 * hands.creak, at, 0.2);
    this.creakTones.forEach((tone, i) => follow(tone.frequency, (700 + 200 * hands.creak) * (i ? 1.9 : 1), at, 0.2));
    this.schedule(k, until);
  }

  private schedule(k: Kit, until: number): void {
    const world = this.world;
    const hands = this.hands;
    if (!world || !hands) return;
    const n = this.next;
    const now = k.ctx.currentTime;
    const from = (t: number) => Math.max(t, now);
    // The engine: each beat a thump and a puff, every other one weaker.
    for (n.beat = from(n.beat); n.beat < until; n.beat += (1 / world.beat) * random(0.97, 1.03)) {
      if (world.engine <= 0) continue;
      this.strong = !this.strong;
      const loud = this.strong ? 1 : 0.72;
      const m = (world.beat - 3.6) / 5.4;
      const low = world.astern ? 0.85 : 1;
      k.tone(n.beat, this.engineBody, { f: (78 + 21 * m) * low, to: 54, peak: 0.55 * loud, attack: 0.004, length: 0.13 });
      k.burst(n.beat, this.engineBody, { noise: 'brown', filter: 'lowpass', f: 570 + 450 * m, q: 0.9, peak: 0.5 * loud, length: 0.09 });
      k.burst(n.beat + 0.012, this.engineBody, { f: 2600, q: 3, peak: 0.02, attack: 0.001, length: 0.02 });
    }
    // Water slapping at the hull, more often as the boat moves.
    for (n.slap = from(n.slap); n.slap < until; n.slap += random(0.35, 0.35 + 1.1 - 0.6 * world.wash)) {
      k.burst(n.slap, this.slapSides[Math.floor(Math.random() * this.slapSides.length)], { noise: 'pink', f: random(320, 570) + 300 * world.wash, q: 1.2, peak: random(0.16, 0.36), attack: random(0.08, 0.18), length: random(0.25, 0.55) });
    }
    // Bubbles boiling up as the lock fills, fewer as it nears the top.
    for (n.bubble = from(n.bubble); n.bubble < until; n.bubble += (1 / (4 + 22 * world.fill)) * random(0.4, 1.6)) {
      if (world.fill < 0.02) continue;
      const f = random(180, 680);
      k.tone(n.bubble, this.bubbleSides[Math.floor(Math.random() * 3)], { f, to: f * 1.8, peak: 0.02 + 0.12 * world.fill * Math.random(), attack: 0.004, length: random(0.04, 0.09) });
    }
    // The chamber gurgling as it drains.
    for (n.gurgle = from(n.gurgle); n.gurgle < until; n.gurgle += (1 / (2 + 9 * world.empty)) * random(0.4, 1.6)) {
      if (world.empty < 0.02) continue;
      const f = random(120, 340);
      k.tone(n.gurgle, this.bubbleSides[1], { f, to: f * 0.6, peak: 0.03 + 0.1 * world.empty * Math.random(), attack: 0.01, length: random(0.08, 0.16) });
    }
    // The windlass handle clattering round as a dropped paddle runs down.
    for (n.rattle = from(n.rattle); n.rattle < until; n.rattle += 1 / 22) {
      if (!hands.whirr) continue;
      k.burst(n.rattle, this.gearLevel, { f: random(1600, 2000), q: 6, peak: 1.5, attack: 0.0008, length: 0.006 });
    }
    // Footsteps on the brick setts as you walk the beam round.
    for (n.step = from(n.step); n.step < until; n.step += random(0.76, 0.84)) {
      if (hands.steps <= 0) continue;
      footstep(k, n.step, this.handsOut);
    }
    // The creak's grain: wood sticking and slipping, faster as the beam swings faster.
    for (n.jitter = from(n.jitter); n.jitter < until; n.jitter += 0.03) {
      const groaning = hands.groan > 0 && hands.creak < 0.1;
      const lo = groaning ? 12 : 18 + 40 * hands.creak;
      const hi = groaning ? 24 : 30 + 70 * hands.creak;
      this.creak.frequency.setValueAtTime(random(lo, hi), n.jitter);
    }
  }

  /** Fades every steady sound out by `at` and stops them. */
  stop(at: number): void {
    for (const source of this.sources) {
      try {
        source.stop(at);
      } catch {
        // Already stopped.
      }
    }
  }
}

function footstep(k: Kit, at: number, dest: AudioNode): void {
  k.burst(at, dest, { f: random(1300, 1800), q: 0.9, peak: 0.1, attack: 0.004, length: 0.07 });
  k.tone(at, dest, { f: 95, to: 60, peak: 0.12, length: 0.06 });
  for (let i = 0; i < 5; i++) k.burst(at + random(0.01, 0.07), dest, { f: random(2500, 6000), q: 5, peak: 0.045, attack: 0.0008, length: 0.006 });
}

function click(k: Kit, at: number, dest: AudioNode, peak: number, f: number): void {
  k.burst(at, dest, { f, q: 6, peak, attack: 0.0008, length: 0.006 });
  k.tone(at, dest, { f: f * 0.6, peak: peak * 0.5, attack: 0.001, length: 0.015 });
}

/** Plays a one-off sound at `at`. */
export function playCue(k: Kit, cue: Cue, at: number, dest: AudioNode): void {
  switch (cue.kind) {
    case 'bump':
      if (cue.what === 'bank') {
        // A muffled thud into the soft bank, and the grass brushing the hull.
        k.tone(at, dest, { f: 85, to: 42, peak: 0.6, attack: 0.006, length: 0.28 });
        k.burst(at, dest, { noise: 'brown', filter: 'lowpass', f: 260, peak: 0.6, attack: 0.004, length: 0.22 });
        k.burst(at + 0.02, dest, { filter: 'highpass', f: 2500, peak: 0.04, attack: 0.02, length: 0.25 });
      } else {
        // A hollow knock on a steel hull, and a fender squeaking.
        [190, 430, 760].forEach((f, i) => k.burst(at, dest, { f, q: 14, peak: [2.4, 1.3, 0.6][i], attack: 0.002, length: 0.33 - i * 0.08 }));
        k.tone(at, dest, { f: 70, to: 50, peak: 0.35, length: 0.18 });
        const squeak = k.filter('bandpass', 1400, 6);
        squeak.connect(dest);
        k.tone(at + 0.05, squeak, { f: 520, to: 690, type: 'sawtooth', peak: 0.05, attack: 0.05, length: 0.26 });
      }
      return;
    case 'settle':
      if (cue.full) {
        // The water, risen to the top, slops against the gates.
        for (let i = 0; i < 4; i++) k.burst(at + 0.2 + i * 0.7, dest, { noise: 'pink', filter: 'lowpass', f: 500, q: 0.7, peak: 0.12 - i * 0.025, attack: 0.15, length: 0.5 });
      } else {
        // A few drips into the emptied chamber.
        [0.4, 1.1, 1.5, 2.2].forEach((o, i) => {
          k.tone(at + o, dest, { f: 1300, to: 320, peak: 0.25 - i * 0.04, attack: 0.002, length: 0.06 });
          k.tone(at + o + 0.12, dest, { f: 1900, to: 1100, peak: 0.05, attack: 0.002, length: 0.04 });
        });
      }
      return;
    case 'windlass-on':
      k.metal(at, dest, 420, [1, 2.69, 4.45, 7.1], 0.25, 0.35);
      k.tone(at, dest, { f: 140, to: 90, peak: 0.3, length: 0.07 });
      return;
    case 'windlass-off':
      k.metal(at, dest, 760, [1, 2.4, 3.9], 0.15, 0.25);
      return;
    case 'catch-off':
      click(k, at, dest, 0.35, 2400);
      k.tone(at, dest, { f: 300, to: 180, peak: 0.25, length: 0.06 });
      return;
    case 'catch-on':
      click(k, at, dest, 0.25, 2400);
      return;
    case 'tooth':
      click(k, at, dest, random(0.1, 0.14), random(3100, 3300));
      return;
    case 'paddle-down':
      if (cue.hard) {
        k.tone(at, dest, { f: 70, to: 35, peak: 0.7, length: 0.4 });
        k.metal(at, dest, 300, [1, 2.2, 3.7, 5.9], 0.35, 0.6);
        k.burst(at, dest, { noise: 'brown', filter: 'lowpass', f: 500, peak: 0.5, length: 0.3 });
      } else {
        k.tone(at, dest, { f: 90, to: 50, peak: 0.4, length: 0.2 });
      }
      return;
    case 'gate-rest': {
      // A deep wooden thump, lighter when a gate opens against the side.
      const size = (cue.shut ? 1 : 0.6) * cue.loud;
      if (size <= 0.01) return;
      k.tone(at, dest, { f: 62, to: 38, peak: 0.75 * size, attack: 0.004, length: 0.45 });
      k.burst(at, dest, { f: 220, q: 10, peak: 1.2 * size, attack: 0.001, length: 0.25 });
      k.burst(at, dest, { f: 510, q: 10, peak: 0.5 * size, attack: 0.001, length: 0.18 });
      k.burst(at + 0.03, dest, { noise: 'pink', filter: 'lowpass', f: 900, peak: 0.25 * size, attack: 0.02, length: 0.35 });
      return;
    }
  }
}
