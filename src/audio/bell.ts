// The boat's bell: a soft "ding-ding" made with the Web Audio API, so the
// game needs no sound file. It has its own switch, and rings at its own level
// whether the other sounds are on or off, because it's how the boat calls you.

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

/** Rings the bell once, into `dest`. */
export function ringBell(ctx: BaseAudioContext, dest: AudioNode): void {
  const out = ctx.createGain();
  out.gain.value = VOLUME;
  out.connect(dest);
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
