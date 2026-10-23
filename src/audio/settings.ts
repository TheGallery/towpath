// How you've set the sound: whether it's on at all, how loud, and which of its
// two groups you hear, the boat and its locks, and nature. It's kept in the
// browser under its own key, apart from your place in the game, so the kept
// place's format doesn't change. Your choice is remembered from one game to
// the next on this browser, and a broken or missing setting gives the
// defaults: sound off until you turn it on.

import { clamp } from '../core/math';

export interface SoundSettings {
  readonly on: boolean;
  /** How loud, from 0 to 1. */
  readonly volume: number;
  /** The engine, the bumps and the lock: water, paddles and gates. */
  readonly boat: boolean;
  /** The water lapping at the hull. */
  readonly nature: boolean;
}

export const SOUND_DEFAULTS: SoundSettings = { on: false, volume: 0.7, boat: true, nature: true };

/** Where the settings are kept in the browser. */
export const SOUND_KEY = 'towpath:sound';

/** The settings kept as `raw`, field by field, with the default for any that's missing or broken. */
export function readSoundSettings(raw: string | null): SoundSettings {
  let kept: unknown = null;
  try {
    kept = raw === null ? null : JSON.parse(raw);
  } catch {
    kept = null;
  }
  if (typeof kept !== 'object' || kept === null) return SOUND_DEFAULTS;
  const get = (key: keyof SoundSettings): unknown => (kept as Record<string, unknown>)[key];
  const flag = (key: 'on' | 'boat' | 'nature'): boolean => {
    const value = get(key);
    return typeof value === 'boolean' ? value : SOUND_DEFAULTS[key];
  };
  const volume = get('volume');
  return {
    on: flag('on'),
    volume: typeof volume === 'number' && Number.isFinite(volume) ? clamp(volume, 0, 1) : SOUND_DEFAULTS.volume,
    boat: flag('boat'),
    nature: flag('nature'),
  };
}

export function writeSoundSettings(settings: SoundSettings): string {
  return JSON.stringify({ on: settings.on, volume: settings.volume, boat: settings.boat, nature: settings.nature });
}
