import { describe, expect, it } from 'vitest';
import { MAX_REMINDERS, REMIND_EVERY, answer, newCallBook, remind, ring, waitedFor } from '../src/sim/calls';

describe('the boat calling you', () => {
  it('rings a call once, and keeps it waiting until you answer', () => {
    const book = newCallBook();
    expect(ring(book, 'lock', 100)).toBe(true);
    expect(ring(book, 'lock', 101)).toBe(false);
    expect(book.open).toMatchObject({ kind: 'lock', since: 100 });
    expect(waitedFor(book, 160)).toBe(60);
    expect(answer(book, 'lock')?.kind).toBe('lock');
    expect(book.open).toBeNull();
    expect(waitedFor(book, 200)).toBe(0);
  });

  it('never rings the same call twice in a day', () => {
    const book = newCallBook();
    ring(book, 'lock', 0);
    answer(book, 'lock');
    expect(ring(book, 'lock', 10)).toBe(false);
  });

  it("never rings a call you've already answered", () => {
    const book = newCallBook();
    expect(answer(book, 'junction')).toBeNull();
    expect(ring(book, 'junction', 10)).toBe(false);
    expect(book.open).toBeNull();
  });

  it('waits for one call at a time', () => {
    const book = newCallBook();
    ring(book, 'junction', 0);
    expect(ring(book, 'dusk', 5)).toBe(false);
    answer(book, 'junction');
    expect(ring(book, 'dusk', 6)).toBe(true);
  });

  it('rings again now and then while you stay away, then lets you be', () => {
    const book = newCallBook();
    ring(book, 'cast-off', 0);
    const rang: number[] = [];
    for (let t = 0; t <= 60 * 60; t++) if (remind(book, t)) rang.push(t);
    expect(rang).toEqual(Array.from({ length: MAX_REMINDERS }, (_, i) => (i + 1) * REMIND_EVERY));
  });

  it("doesn't remind you of a call you've answered", () => {
    const book = newCallBook();
    ring(book, 'dusk', 0);
    answer(book, 'dusk');
    expect(remind(book, REMIND_EVERY * 2)).toBe(false);
  });
});
