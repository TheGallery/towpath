// The logbook as a page to read: which day it is and where, the day's lines
// with their times, and the stretch's seed, quietly, at the foot.

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
  private readonly closeButton: HTMLButtonElement;
  /** Where the keyboard was before the logbook opened, to put it back after. */
  private returnTo: HTMLElement | null = null;

  constructor(doc: Document) {
    this.root = byId(doc, 'logbook');
    this.day = byId(doc, 'logbook-day');
    this.lines = byId(doc, 'logbook-lines');
    this.seed = byId(doc, 'logbook-seed');
    this.closeButton = byId(doc, 'logbook-close');
    this.closeButton.addEventListener('click', () => this.close());
    // A click on the dim around the page closes it too.
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(page: LogbookPage): void {
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
    if (!this.isOpen) this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.closeButton.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    if (this.returnTo?.isConnected && !this.returnTo.closest('[hidden]')) this.returnTo.focus({ preventScroll: true });
    this.returnTo = null;
  }
}
