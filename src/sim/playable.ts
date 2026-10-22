// Making a canal from a seed that's sure to play: lay one out, check it with
// the game's own rules, and try again if it fails, up to a limit, then fall
// back to the Hallam Canal. A canal plays if its data is sound, it keeps the
// two rules for crossings, and every way it can go makes a whole day, with the
// other boat coming down through the first lock or going up ahead of you: the
// boat calls you to cast off, at every junction where the ways part, and at
// dusk, which falls within the limits for a day.

import { generateStretch, crossingProblems, NoRoom } from '../world/generate';
import { HALLAM } from '../world/hallam';
import { checkStretch, resolveStretch } from '../world/stretch';
import type { StretchData } from '../world/stretch';
import { dayTimeline, planDay } from './day';

/** The shortest and longest a day may be, in minutes from casting off to dusk, with the locks worked for you. */
export const DAY_MINUTES = { min: 11, max: 25 };
/** How many tries a seed gets before it falls back to the Hallam Canal. */
export const MAX_TRIES = 60;
/** How finely the day is timed, in seconds: coarser than the game's step, which is close enough to tell. */
const TIMING_STEP = 0.5;

/** What keeps a stretch from making a playable day, in plain words, as far as the first way that fails. Empty when it plays. */
export function dayProblems(data: StretchData): string[] {
  const problems = checkStretch(data);
  if (problems.length) return problems;
  const stretch = resolveStretch(data);
  problems.push(...crossingProblems(stretch));
  if (problems.length) return problems;
  const plan = planDay(stretch);
  for (const way of plan.ways) {
    for (const other of ['down', 'up'] as const) {
      const { calls, end } = dayTimeline(plan, way.way, other, TIMING_STEP);
      const dusk = calls.find((c) => c.call === 'dusk');
      if (!dusk || calls[0]?.call !== 'cast-off' || end >= 4 * 60 * 60) {
        problems.push(`the day down the ${way.way} way never ends`);
        continue;
      }
      const minutes = dusk.at / 60;
      if (minutes < DAY_MINUTES.min || minutes > DAY_MINUTES.max) problems.push(`the day down the ${way.way} way takes ${minutes.toFixed(1)} min`);
    }
    if (problems.length) break;
  }
  return problems;
}

/** A canal made from a seed: the stretch, how many tries it took, and why the others were thrown away. */
export interface MadeCanal {
  readonly data: StretchData;
  readonly tries: number;
  /** True if no try played, so it's the Hallam Canal instead. */
  readonly fellBack: boolean;
  readonly thrownAway: readonly string[];
}

/** The canal for a seed: the first try that plays, or the Hallam Canal if none does. */
export function makeCanal(seed: number): MadeCanal {
  const thrownAway: string[] = [];
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    let data: StretchData;
    try {
      data = generateStretch(seed, attempt);
    } catch (e) {
      if (!(e instanceof NoRoom)) throw e;
      thrownAway.push(e.message);
      continue;
    }
    const problems = dayProblems(data);
    if (!problems.length) return { data, tries: attempt + 1, fellBack: false, thrownAway };
    thrownAway.push(problems[0]);
  }
  return { data: HALLAM, tries: MAX_TRIES, fellBack: true, thrownAway };
}
