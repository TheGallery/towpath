// The boat's calls for you: the moments in a day when it needs you. A call
// rings once with the bell and changes the tab title, then waits for you,
// ringing again now and then if you still haven't come. Each call rings at
// most once a day: casting off, every lock, every junction where you choose a
// way, and dusk. Answering one you haven't heard yet stops it ever ringing.
// Times are game seconds, from the day's clock.

/** Cast off in the morning, work a lock, choose a way at a junction, and moor at dusk. */
export type CallKind = 'cast-off' | 'lock' | 'junction' | 'dusk';

/** Seconds of waiting before the bell rings again for a call you haven't answered. */
export const REMIND_EVERY = 5 * 60;
/** The most times the bell rings again for one call, so a boat left all day stays quiet. */
export const MAX_REMINDERS = 2;

export interface Call {
  readonly kind: CallKind;
  /** Which lock, by its id, or which junction, by its name; none for casting off and dusk. */
  readonly place?: string;
  /** When it first rang. */
  readonly since: number;
  /** When the bell last rang for it. */
  rang: number;
  reminders: number;
}

export interface CallBook {
  /** The call waiting for you, if there is one. */
  open: Call | null;
  /** Every call answered today, by its key. */
  readonly answered: Set<string>;
}

/** One call's name for the day: its kind, and its place if it has one, as "lock:brook-lock". */
export const callKey = (kind: CallKind, place?: string): string => (place === undefined ? kind : `${kind}:${place}`);

export function newCallBook(): CallBook {
  return { open: null, answered: new Set() };
}

/** Rings a call, unless it has already rung today or another call is waiting. True if the bell should ring. */
export function ring(book: CallBook, kind: CallKind, now: number, place?: string): boolean {
  if (book.answered.has(callKey(kind, place)) || book.open) return false;
  book.open = place === undefined ? { kind, since: now, rang: now, reminders: 0 } : { kind, place, since: now, rang: now, reminders: 0 };
  return true;
}

/** Answers a call, whether or not it has rung yet. Returns the call if it was waiting. */
export function answer(book: CallBook, kind: CallKind, place?: string): Call | null {
  const key = callKey(kind, place);
  book.answered.add(key);
  const open = book.open && callKey(book.open.kind, book.open.place) === key ? book.open : null;
  if (open) book.open = null;
  return open;
}

/** True when the bell should ring again for the call that's still waiting. */
export function remind(book: CallBook, now: number): boolean {
  const call = book.open;
  if (!call || call.reminders >= MAX_REMINDERS || now - call.rang < REMIND_EVERY) return false;
  call.rang = now;
  call.reminders++;
  return true;
}

/** How long the waiting call has waited, in seconds, or 0 if none is waiting. */
export function waitedFor(book: CallBook, now: number): number {
  return book.open ? Math.max(0, now - book.open.since) : 0;
}
