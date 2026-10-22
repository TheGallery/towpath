// The logbook of the day: setting out, each lock, the way taken at each
// junction and where you moored, noted as it happens and written up in the
// evening, when it's there to read. It keeps names, times and facts rather
// than finished sentences, so a kept place still reads well if the words
// change.

import { METRES_PER_UNIT } from '../world/dimensions';
import { callKey } from './calls';
import type { Day, DayEvent } from './day';
import type { OtherWay } from './otherboat';

export type LogEntry =
  | { readonly kind: 'set-out'; readonly at: number; readonly from: string; readonly along: string }
  | {
      readonly kind: 'lock';
      /** When the boat tied up below it. */
      readonly at: number;
      readonly id: string;
      readonly lock: string;
      readonly goingUp: boolean;
      /** Which way the other boat went through just before, if it did. */
      readonly other: OtherWay | null;
      /** Whether it was ready for you once it was yours, and when that was. */
      ready: boolean | null;
      yours: number | null;
      cleared: number | null;
    }
  /** The way taken at a junction, and the mooring it goes to, or none if there's another choice still to come. */
  | { readonly kind: 'way'; readonly at: number; readonly junction: string; readonly turn: 'left' | 'right' | 'straight'; readonly onto: string; readonly to: string }
  | { readonly kind: 'moored'; readonly at: number; readonly spot: string; readonly mooring: string; readonly about: string }
  | { readonly kind: 'evening'; readonly at: number; readonly miles: number; readonly locks: number };

export interface Logbook {
  readonly entries: LogEntry[];
  /** When the boat began waiting for you on each call, by the call's key: from when it rang, or for a junction, from when it pulled in. */
  readonly waiting: Record<string, number>;
  /** How long it waited for you on each call, in seconds, by the call's key. */
  readonly waited: Record<string, number>;
  /** True once the day is written up in the evening, ready to read. */
  written: boolean;
}

export function newLogbook(): Logbook {
  return { entries: [], waiting: {}, waited: {}, written: false };
}

const METRES_PER_MILE = 1609.344;

/** Notes in the day's logbook what its events say has just happened. */
export function noteEvents(day: Day, events: readonly DayEvent[]): void {
  const log = day.log;
  const plan = day.plan;
  const lockEntry = (id: string) => {
    for (let i = log.entries.length - 1; i >= 0; i--) {
      const entry = log.entries[i];
      if (entry.kind === 'lock' && entry.id === id) return entry;
    }
    return null;
  };
  for (const e of events) {
    switch (e.kind) {
      case 'cast-off':
        log.entries.push({ kind: 'set-out', at: day.time, from: plan.startName, along: plan.legs[0]?.name ?? 'canal' });
        break;
      case 'call':
        if (!e.again && e.call !== 'junction') log.waiting[callKey(e.call, e.place)] = day.time;
        break;
      case 'held':
        log.waiting[callKey('junction', e.junction)] = day.time;
        break;
      case 'answered': {
        const key = callKey(e.call, e.place);
        const since = log.waiting[key];
        if (since !== undefined) log.waited[key] = day.time - since;
        break;
      }
      case 'reached-lock': {
        const lock = plan.locks.find((l) => l.id === e.lock);
        if (!lock) break;
        const other = day.trip.other && plan.other?.lock.id === lock.id ? day.trip.other.way : null;
        log.entries.push({ kind: 'lock', at: day.time, id: lock.id, lock: lock.name, goingUp: lock.goingUp, other, ready: null, yours: null, cleared: null });
        break;
      }
      case 'lock-yours': {
        const entry = lockEntry(e.lock);
        if (!entry) break;
        entry.ready = e.ready;
        entry.yours = day.time;
        break;
      }
      case 'cleared-lock': {
        const entry = lockEntry(e.lock);
        if (entry) entry.cleared = day.time;
        break;
      }
      case 'chose-way': {
        const fork = plan.junctions.find((j) => j.name === e.junction);
        if (fork) log.entries.push({ kind: 'way', at: day.time, junction: fork.name, turn: fork.turn, onto: fork.onto, to: day.ways.length === 1 ? plan.endName : '' });
        break;
      }
      case 'tied-up':
        log.entries.push({ kind: 'moored', at: day.time, spot: e.spot, mooring: plan.endName, about: plan.endAbout });
        break;
      case 'phase':
        if (e.phase === 'evening' && !log.written) {
          const miles = ((plan.end - plan.start) * METRES_PER_UNIT) / METRES_PER_MILE;
          const locks = log.entries.filter((x) => x.kind === 'lock' && x.cleared !== null).length;
          log.entries.push({ kind: 'evening', at: day.time, miles, locks });
          log.written = true;
        }
        break;
    }
  }
}

/** One line of the logbook: when, and what happened. */
export interface LogLine {
  readonly when: string;
  readonly text: string;
}

const inSentence = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
const minutes = (seconds: number): string => `${Math.max(1, Math.round(seconds / 60))} min`;
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (n: number, thing: string): string => `${NUMBERS[n] ?? n} ${thing}${n === 1 ? '' : 's'}`;

/** How long the boat waited for you on a call, by its key, when it's long enough to mention. */
function waitedFor(log: Logbook, call: string, what: string): string {
  const seconds = log.waited[call] ?? 0;
  return seconds >= 60 ? ` The boat waited ${minutes(seconds)} for you ${what}.` : '';
}

function lockWords(entry: Extract<LogEntry, { kind: 'lock' }>, log: Logbook): string {
  const dir = entry.goingUp ? 'Up' : 'Down';
  const name = entry.lock;
  const worked = entry.yours !== null && entry.cleared !== null ? minutes(entry.cleared - entry.yours) : null;
  let text: string;
  if (entry.cleared === null) text = `Tied up below ${name} to work it.`;
  else if (entry.other === 'down') text = `${dir} through ${name}. Another boat came down first and left it ready for you, with the gates open.`;
  else if (entry.other === 'up') text = `${dir} through ${name}. The boat ahead went up first and left it full, so you emptied it before you could go in.`;
  else if (entry.ready === false) text = `${dir} through ${name}. It was set against you, so you levelled it first.`;
  else text = `${dir} through ${name}, which was ready for you.`;
  if (worked) text += ` You worked it in ${worked}.`;
  return text + waitedFor(log, callKey('lock', entry.id), 'at the lock');
}

function wayWords(entry: Extract<LogEntry, { kind: 'way' }>, log: Logbook): string {
  const to = entry.to ? ` for ${entry.to}` : '';
  const text = entry.turn === 'straight' ? `Straight on at ${entry.junction}, along the ${entry.onto}${to}.` : `Turned ${entry.turn} at ${entry.junction} into the ${entry.onto}${to ? `,${to}` : ''}.`;
  return text + waitedFor(log, callKey('junction', entry.junction), 'to choose');
}

/**
 * The logbook as lines to read. Times are minutes after casting off, with the
 * morning and the evening named.
 */
export function logLines(log: Logbook): LogLine[] {
  const setOut = log.entries.find((e) => e.kind === 'set-out');
  const after = (at: number) => (setOut ? minutes(at - setOut.at) : '');
  return log.entries.map((e): LogLine => {
    switch (e.kind) {
      case 'set-out':
        return { when: 'Morning', text: `Cast off from ${e.from} and set out along the ${e.along}.` };
      case 'lock':
        return { when: after(e.at), text: lockWords(e, log) };
      case 'way':
        return { when: after(e.at), text: wayWords(e, log) };
      case 'moored':
        return { when: after(e.at), text: `Moored ${inSentence(e.spot)} at ${e.mooring}, ${e.about}, as the light went.${waitedFor(log, 'dusk', 'to choose a spot')}` };
      case 'evening':
        return { when: 'Evening', text: `The lamps are lit. ${e.miles.toFixed(1)} miles and ${count(e.locks, 'lock')} today, ${setOut ? `in ${minutes(e.at - setOut.at)} on the water` : 'and a quiet night ahead'}.` };
    }
  });
}
