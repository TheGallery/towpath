// What's happening, in a sentence, what's coming up next, and the words for
// the boat's calls and the choices they ask you to make.

import { CRUISE_SPEED } from './boat';
import type { CallKind } from './calls';
import type { Day, DayPlan } from './day';
import { CHAMBER_HALF } from './lock';
import type { Job, Part, Where } from './lock';
import { lockForYou, steersItselfHere } from './trip';
import type { RouteJunction, RouteLock, Trip, TripPlan } from './trip';

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
  if (junction) return junction.turn === 'straight' ? `${junction.name}: straight on along the ${junction.onto}.` : `${junction.name}: turning ${junction.turn} into the ${junction.onto}.`;
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

/** A spot's name as part of a sentence: "By the bench" becomes "by the bench". */
const inSentence = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/** What's happening at any time of the day. */
export function describeDay(day: Day, plan: DayPlan): string {
  const { trip } = day;
  const p = day.plan;
  switch (day.phase) {
    case 'morning':
      return `Morning at ${p.startName}. Cast off when you're ready.`;
    case 'underway':
      if (plan.fork && !day.chosen && trip.passage === null && trip.boat.s >= plan.fork.hold - 2) return `Waiting before ${plan.fork.name} for you to choose a way.`;
      return describe(trip, p);
    case 'dusk':
      return `The light is going. Choose where to moor at ${p.endName}.`;
    case 'tying-up':
      return `Tying up ${inSentence(day.spot?.name ?? 'here')} for the night.`;
    case 'evening':
      return `Evening at ${p.endName}, ${p.endAbout}. The lamps are lit, and the last walkers head home along the towpath.`;
    case 'night':
      return 'Night. The canal is quiet, and the boat is tied up snug.';
    case 'dawn':
      return `Dawn. The sky lightens over ${p.endName}.`;
    case 'over':
      return `Morning at ${p.endName}. That's the end of the prototype day.`;
  }
}

/** A call in a few words, for the tab's title. */
export function callTitle(kind: CallKind, day: Day, plan: DayPlan): string {
  switch (kind) {
    case 'cast-off':
      return 'Ready to cast off';
    case 'lock':
      return `Waiting at ${day.trip.passage?.lock.name ?? 'the lock'}`;
    case 'junction':
      return `Which way at ${plan.fork?.name ?? 'the junction'}?`;
    case 'dusk':
      return 'Time to moor';
  }
}

/** Which way a trip goes at a junction, and where it ends: "Turn right into the Wendle Arm", "to Wendle Basin, by The Navigation pub". */
export function wayWords(trip: TripPlan, junction: string): { readonly way: string; readonly to: string } {
  const j: RouteJunction | undefined = trip.junctions.find((k) => k.name === junction);
  const way = !j ? `Along the ${trip.legs[0].name}` : j.turn === 'straight' ? `Straight on along the ${j.onto}` : `Turn ${j.turn} into the ${j.onto}`;
  return { way, to: `to ${trip.endName}, ${trip.endAbout}` };
}

/** How long the boat has waited for you, when it's long enough to mention. */
export function waitedWords(seconds: number): string | null {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return null;
  if (minutes < 60) return `The boat has waited ${minutes} min for you`;
  const hours = Math.floor(minutes / 60);
  return `The boat has waited over ${hours} hour${hours > 1 ? 's' : ''} for you`;
}
