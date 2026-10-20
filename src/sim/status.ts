// What's happening, in a sentence, and what's coming up next.

import { CRUISE_SPEED } from './boat';
import { CHAMBER_HALF } from './lock';
import type { Job, Part, Where } from './lock';
import { lockForYou, steersItselfHere } from './trip';
import type { RouteLock, Trip, TripPlan } from './trip';

export const PART_NAMES: Readonly<Record<Part, string>> = {
  bottomPaddle: 'bottom paddle',
  topPaddle: 'top paddle',
  bottomGates: 'bottom gates',
  topGates: 'top gate',
};

const levelWord = (fill: boolean) => (fill ? 'fill' : 'empty');

/** The next job at a lock you're working, as an instruction. */
export function jobWords(lock: RouteLock, job: Job, where: Where): string {
  const up = lock.goingUp;
  switch (job.kind) {
    case 'raise':
      return where === 'before'
        ? `${lock.name} is ${job.fill ? 'empty' : 'full'}, so ${levelWord(job.fill)} it first: wind up the ${PART_NAMES[job.part]}.`
        : `Wind up the ${PART_NAMES[job.part]} to ${levelWord(job.fill)} the lock.`;
    case 'wait-water':
      if (where === 'before') return `The lock is ${job.fill ? 'filling' : 'emptying'}. Its gates open once it's level.`;
      return job.fill ? 'The lock fills, lifting the boat up to the next level.' : 'The lock empties, lowering the boat to the next level.';
    case 'lower':
      return `Wind the ${PART_NAMES[job.part]} back down, so the lock can ${(where === 'in') === up ? 'fill' : 'empty'}.`;
    case 'open':
      return where === 'before' ? `Open the ${PART_NAMES[job.part]} to let the boat in.` : `The lock is level. Open the ${PART_NAMES[job.part]} to let the boat out.`;
    case 'close':
      return `Close the ${PART_NAMES[job.part]} behind the boat.`;
    case 'boat-in':
      return 'The gates are open, so the boat glides into the lock.';
    case 'boat-out':
      return `Out of ${lock.name} and on ${up ? 'up' : 'down'} the canal.`;
    case 'done':
      return '';
  }
}

export function describe(trip: Trip, plan: TripPlan): string {
  const s = trip.boat.s;
  if (trip.phase === 'moored') return `Moored at ${plan.startName}. Cast off when you're ready.`;
  if (trip.phase === 'arrived') return `Moored at ${plan.endName} for the night. That's the end of the trip for now.`;
  const passage = trip.passage;
  if (passage && !passage.yours) {
    const side = passage.lock.goingUp ? 'below' : 'above';
    return trip.other?.way === 'down'
      ? `Waiting ${side} ${passage.lock.name} while another boat comes down through it.`
      : `Waiting ${side} ${passage.lock.name} while the boat ahead goes up through it.`;
  }
  const yours = lockForYou(trip);
  if (yours) return jobWords(yours.lock, yours.job, yours.where);
  if (passage) return passage.crew ? `Working ${passage.lock.name}.` : `Out of ${passage.lock.name} and on ${passage.lock.goingUp ? 'up' : 'down'} the canal.`;
  if (trip.helm === 'you') return 'You have the tiller. Let go and the boat carries on by itself.';

  const junction = plan.junctions.find((j) => Math.abs(s - j.s) < 150);
  if (junction) return `${junction.name}: turning ${junction.turn} into the ${junction.branch}.`;
  if (plan.moorings.some((m) => s > m.from - 40 && s < m.to)) return 'Passing moored boats, so the boat slows right down.';
  const justLeft = plan.locks.find((l) => s > l.s && s < l.s + CHAMBER_HALF + 400);
  if (justLeft) return `Out of ${justLeft.name} and on ${justLeft.goingUp ? 'up' : 'down'} the canal.`;
  const ahead = plan.locks.find((l) => s < l.s && steersItselfHere(plan, s) === 'lock');
  if (ahead) return `Pulling in for ${ahead.name}.`;
  if (steersItselfHere(plan, s) === 'mooring') return `Coming in to moor at ${plan.endName}.`;
  const leg = [...plan.legs].reverse().find((l) => s >= l.from);
  return `Cruising along the ${leg?.name ?? 'canal'}. The boat steers itself.`;
}

export interface Upcoming {
  readonly name: string;
  readonly distance: number;
  /** About how long until you get there at cruising speed, in minutes. */
  readonly minutes: number;
}

/** The next place along the route, from a list of named places with their distances. */
export function upcoming(places: readonly { name: string; s: number }[], s: number): Upcoming | null {
  const next = places.find((p) => p.s > s + 40);
  if (!next) return null;
  const distance = next.s - s;
  return { name: next.name, distance, minutes: distance / CRUISE_SPEED / 60 };
}
