// The boat's calls for you: four short moments in a day when it needs you.
// A call rings once with the bell and changes the tab title, then waits for
// you, ringing again now and then if you still haven't come. Each kind rings
// at most once a day, and answering one you haven't heard yet stops it ever
// ringing. Times are game seconds, from the day's clock.

/** Cast off in the morning, work the lock, choose a way at the junction, and moor at dusk. */
export type CallKind = 'cast-off' | 'lock' | 'junction' | 'dusk';

/** Seconds of waiting before the bell rings again for a call you haven't answered. */
export const REMIND_EVERY = 5 * 60;
/** The most times the bell rings again for one call, so a boat left all day stays quiet. */
export const MAX_REMINDERS = 2;

export interface Call {
  readonly kind: CallKind;
  /** When it first rang. */
  readonly since: number;
  /** When the bell last rang for it. */
  rang: number;
  reminders: number;
}

export interface CallBook {
  /** The call waiting for you, if there is one. */
  open: Call | null;
  readonly answered: Set<CallKind>;
}

export function newCallBook(): CallBook {
  return { open: null, answered: new Set() };
}

/** Rings a call, unless it has already rung today or another call is waiting. True if the bell should ring. */
export function ring(book: CallBook, kind: CallKind, now: number): boolean {
  if (book.answered.has(kind) || book.open) return false;
  book.open = { kind, since: now, rang: now, reminders: 0 };
  return true;
}

/** Answers a call, whether or not it has rung yet. Returns the call if it was waiting. */
export function answer(book: CallBook, kind: CallKind): Call | null {
  book.answered.add(kind);
  const open = book.open?.kind === kind ? book.open : null;
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
