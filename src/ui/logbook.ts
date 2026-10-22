// The logbook as a page to read: which day it is and where, the day's lines
// with their times, and the stretch's seed, quietly, at the foot. It opens at
// the latest page, and turns back through every earlier day's.

import type { LogLine } from '../sim/logbook';

export interface LogbookPage {
  readonly day: string;
  readonly lines: readonly LogLine[];
  readonly seed: string;
}

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const found = doc.getElementById(id);
  if (!found) throw new Error(`The page is missing #${id}`);
  return found as T;
}

export class LogbookView {
  private readonly root: HTMLElement;
  private readonly day: HTMLElement;
  private readonly lines: HTMLElement;
  private readonly seed: HTMLElement;
  private readonly earlier: HTMLButtonElement;
  private readonly later: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private pages: readonly LogbookPage[] = [];
  private at = 0;
  /** Where the keyboard was before the logbook opened, to put it back after. */
  private returnTo: HTMLElement | null = null;

  constructor(doc: Document) {
    this.root = byId(doc, 'logbook');
    this.day = byId(doc, 'logbook-day');
    this.lines = byId(doc, 'logbook-lines');
    this.seed = byId(doc, 'logbook-seed');
    this.earlier = byId(doc, 'logbook-earlier');
    this.later = byId(doc, 'logbook-later');
    this.closeButton = byId(doc, 'logbook-close');
    this.earlier.addEventListener('click', () => this.turn(-1));
    this.later.addEventListener('click', () => this.turn(1));
    this.closeButton.addEventListener('click', () => this.close());
    // A click on the dim around the page closes it too.
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens the logbook at the latest of its pages, oldest first. */
  open(pages: readonly LogbookPage[]): void {
    this.pages = pages;
    this.show(pages.length - 1);
    if (!this.isOpen) this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.closeButton.focus({ preventScroll: true });
  }

  /** Turns to the day before or after, keeping the keyboard on the button that turned it while there's another page that way. */
  private turn(by: -1 | 1): void {
    const button = by < 0 ? this.earlier : this.later;
    this.show(this.at + by);
    if (button.hidden) this.closeButton.focus({ preventScroll: true });
  }

  private show(at: number): void {
    const page = this.pages[at];
    if (!page) return;
    this.at = at;
    this.earlier.hidden = at === 0;
    this.later.hidden = at === this.pages.length - 1;
    this.day.textContent = page.day;
    this.seed.textContent = page.seed;
    this.lines.replaceChildren(
      ...page.lines.map((line) => {
        const li = document.createElement('li');
        const when = document.createElement('span');
        when.className = 'logbook-when';
        when.textContent = line.when;
        const text = document.createElement('span');
        text.textContent = line.text;
        li.append(when, text);
        return li;
      }),
    );
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    if (this.returnTo?.isConnected && !this.returnTo.closest('[hidden]')) this.returnTo.focus({ preventScroll: true });
    this.returnTo = null;
  }
}
