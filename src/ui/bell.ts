// The boat's bell: a soft "ding-ding" made with the Web Audio API, so the
// game needs no sound file. Browsers only let a page make sound once you've
// clicked or pressed a key in it, so the bell wakes on your first touch and
// stays quiet until then.

/** A bell's overtones aren't whole multiples of its note, which gives it its ring: each is a ratio, a loudness and how long it rings. */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [0.5, 0.2, 2.6],
  [1, 1, 2.2],
  [2.76, 0.3, 1.1],
  [5.4, 0.1, 0.5],
];

/** The note of each strike, in hertz, and when it comes, in seconds. */
const STRIKES: readonly (readonly [number, number])[] = [
  [0, 740],
  [0.38, 622],
];

const VOLUME = 0.16;

export class Bell {
  private context: AudioContext | null = null;
  on = true;

  constructor(target: Window) {
    const wake = () => this.wake();
    target.addEventListener('pointerdown', wake, { capture: true });
    target.addEventListener('keydown', wake, { capture: true });
  }

  private wake(): void {
    if (!this.context) {
      if (typeof AudioContext === 'undefined') return;
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** Rings once, if the bell is on and the page may make sound. */
  ring(): void {
    const ctx = this.context;
    if (!this.on || !ctx || ctx.state !== 'running') return;
    const out = ctx.createGain();
    out.gain.value = VOLUME;
    out.connect(ctx.destination);
    const start = ctx.currentTime + 0.03;
    for (const [delay, note] of STRIKES) {
      for (const [ratio, loudness, length] of PARTIALS) {
        const at = start + delay;
        const tone = ctx.createOscillator();
        tone.frequency.value = note * ratio;
        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(loudness, at + 0.006);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
        tone.connect(envelope).connect(out);
        tone.start(at);
        tone.stop(at + length + 0.05);
      }
    }
  }
}
