// What's happening, in a sentence, and what's coming up next.

import { CRUISE_SPEED } from './boat';
import { CHAMBER_HALF, steersItselfHere } from './trip';
import type { LockStage, RouteLock, Trip, TripPlan } from './trip';

function lockWords(lock: RouteLock, stage: LockStage): string {
  const up = lock.goingUp;
  switch (stage) {
    case 'tying-up':
      return `Tied up ${up ? 'below' : 'above'} ${lock.name}.`;
    case 'levelling-for-you':
      return `${lock.name} is ${up ? 'full' : 'empty'}, so it's being ${up ? 'emptied' : 'filled'} for you first.`;
    case 'opening-entry':
      return `Opening the ${up ? 'bottom' : 'top'} gates.`;
    case 'entering':
      return 'The gates are open, so in you go.';
    case 'closing-entry':
      return 'Closing the gates behind you.';
    case 'levelling':
      return up ? 'The lock fills, lifting the boat up to the next level.' : 'The lock empties, lowering the boat to the next level.';
    case 'opening-exit':
      return `Opening the ${up ? 'top' : 'bottom'} gates.`;
    case 'leaving':
      return `Out of ${lock.name} and on ${up ? 'up' : 'down'} the canal.`;
  }
}

export function describe(trip: Trip, plan: TripPlan): string {
  const s = trip.boat.s;
  if (trip.phase === 'moored') return `Moored at ${plan.startName}. Cast off when you're ready.`;
  if (trip.phase === 'arrived') return `Moored at ${plan.endName} for the night. That's the end of the trip for now.`;
  if (trip.stage) return lockWords(trip.stage.lock, trip.stage.name);
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
