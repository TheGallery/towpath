// The words and buttons over the game: what's happening, who's steering, the
// speed, what's next, what the boat is calling you for, the choices it asks
// you to make, the map key, the bell, and the cards at the start and end of
// the day, which can start a new canal.

import type { DayPhase } from '../sim/day';
import { canalNumber } from '../sim/playable';
import type { Upcoming } from '../sim/status';

export interface HudState {
  readonly phase: DayPhase;
  readonly status: string;
  readonly helm: 'auto' | 'you';
  /** Speed in miles per hour; negative going astern. */
  readonly mph: number;
  readonly next: Upcoming | null;
  readonly mapOpen: boolean;
  /** True once the day is written up in the logbook, ready to read. */
  readonly logbook: boolean;
  /** What the boat needs you for, as the call button's words, or null when it needs nothing. */
  readonly call: string | null;
  /** How long it has waited for you, in words, once that's long enough to say. */
  readonly waited: string | null;
  /** The words on the card at the end of the day. */
  readonly endTitle: string;
  readonly endText: string;
}

/** A choice the boat asks you to make: a question and its answers. */
export interface Choice {
  readonly title: string;
  readonly options: readonly { readonly label: string; readonly detail?: string }[];
  readonly onPick: (index: number) => void;
}

export interface HudOptions {
  readonly startName: string;
  /** Which canal it is, in a few words for the start card. */
  readonly canal: string;
  readonly dayMinutes: number;
  /** How much faster than real time the game runs; 1 normally. */
  readonly rate: number;
  readonly onCastOff: () => void;
  readonly onStartAgain: () => void;
  /** Starts a new game on the canal with the number typed, or a random one if none is. */
  readonly onNewCanal: (number: number | null) => void;
  readonly onToggleMap: () => void;
  readonly onCall: () => void;
  readonly onBell: (on: boolean) => void;
  readonly onLogbook: () => void;
}

const TOAST_TIME = 4500;

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const found = doc.getElementById(id);
  if (!found) throw new Error(`The page is missing #${id}`);
  return found as T;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly helmPanel: HTMLElement;
  private readonly helmWho: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly next: HTMLElement;
  private readonly mapButton: HTMLButtonElement;
  private readonly mapButtonText: HTMLElement;
  private readonly mapKey: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly startCard: HTMLElement;
  private readonly endCard: HTMLElement;
  private readonly castOffButton: HTMLButtonElement;
  private readonly againButton: HTMLButtonElement;
  private readonly callPanel: HTMLElement;
  private readonly callButton: HTMLButtonElement;
  private readonly callText: HTMLElement;
  private readonly waited: HTMLElement;
  private readonly choicePanel: HTMLElement;
  private readonly choiceTitle: HTMLElement;
  private readonly choiceOptions: HTMLElement;
  private readonly bellButton: HTMLButtonElement;
  private readonly bellText: HTMLElement;
  private readonly logbookButton: HTMLButtonElement;
  private readonly endTitle: HTMLElement;
  private readonly endText: HTMLElement;
  private choice: Choice | null = null;
  private toastTimer = 0;
  private shown: Partial<Record<string, string>> = {};

  constructor(doc: Document, options: HudOptions) {
    this.root = byId(doc, 'game');
    this.status = byId(doc, 'status');
    this.helmPanel = byId(doc, 'helm-panel');
    this.helmWho = byId(doc, 'helm-who');
    this.speed = byId(doc, 'speed');
    this.next = byId(doc, 'next');
    this.mapButton = byId(doc, 'map-button');
    this.mapButtonText = byId(doc, 'map-button-text');
    this.mapKey = byId(doc, 'map-key');
    this.toastEl = byId(doc, 'toast');
    this.startCard = byId(doc, 'start-card');
    this.endCard = byId(doc, 'end-card');
    this.castOffButton = byId(doc, 'cast-off');
    this.againButton = byId(doc, 'again');
    this.callPanel = byId(doc, 'call-panel');
    this.callButton = byId(doc, 'call-button');
    this.callText = byId(doc, 'call-text');
    this.waited = byId(doc, 'waited');
    this.choicePanel = byId(doc, 'choice-panel');
    this.choiceTitle = byId(doc, 'choice-title');
    this.choiceOptions = byId(doc, 'choice-options');
    this.bellButton = byId(doc, 'bell-button');
    this.bellText = byId(doc, 'bell-text');
    this.logbookButton = byId(doc, 'logbook-button');
    this.endTitle = byId(doc, 'end-title');
    this.endText = byId(doc, 'end-text');

    const minutes = Math.round(options.dayMinutes);
    byId(doc, 'start-canal').textContent = options.canal;
    for (const id of ['start-new-canal', 'end-new-canal']) {
      const form = byId<HTMLFormElement>(doc, id);
      const field = form.elements.namedItem('canal') as HTMLInputElement;
      field.addEventListener('input', () => field.setCustomValidity(''));
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const number = canalNumber(field.value);
        if (number === null && field.value.trim() !== '') {
          field.setCustomValidity('A canal number is a whole number from 0 to 4294967295. Leave it empty for any canal.');
          field.reportValidity();
          return;
        }
        options.onNewCanal(number);
      });
    }
    byId(doc, 'start-text').textContent = `Your narrowboat is moored at ${options.startName}. Cast off and it cruises by itself. When it needs you, at the lock, at the junction and at dusk, a soft bell rings and the tab's title says so. If you're busy, it waits, and if you close the tab it keeps your place. A day, from morning to morning, takes about ${minutes} minutes.`;
    this.againButton.textContent = `Start a new day from ${options.startName}`;

    const rate = byId(doc, 'rate');
    if (options.rate !== 1) {
      rate.hidden = false;
      rate.textContent = `${options.rate}× speed`;
    }

    this.castOffButton.addEventListener('click', options.onCastOff);
    this.againButton.addEventListener('click', options.onStartAgain);
    this.mapButton.addEventListener('click', options.onToggleMap);
    this.callButton.addEventListener('click', options.onCall);
    this.bellButton.addEventListener('click', () => {
      const on = this.bellButton.getAttribute('aria-pressed') !== 'true';
      this.setBell(on);
      options.onBell(on);
    });
    this.logbookButton.addEventListener('click', options.onLogbook);
    byId(doc, 'end-logbook').addEventListener('click', options.onLogbook);
    this.castOffButton.focus();
  }

  /** Shows the bell as on or off. */
  setBell(on: boolean): void {
    this.bellButton.setAttribute('aria-pressed', String(on));
    this.bellText.textContent = on ? 'Bell on' : 'Bell off';
  }

  /** Changes the text of an element only when it differs, so screen readers aren't flooded. */
  private set(el: HTMLElement, key: string, text: string): void {
    if (this.shown[key] === text) return;
    this.shown[key] = text;
    el.textContent = text;
  }

  update(state: HudState): void {
    this.set(this.status, 'status', state.status);

    const steering = state.helm === 'you';
    this.set(this.helmWho, 'helm', steering ? 'You have the tiller' : state.phase === 'underway' ? 'The boat is steering itself' : state.phase === 'tying-up' ? 'Tying up' : 'Moored');
    this.helmPanel.classList.toggle('steering', steering);

    const mph = Math.abs(state.mph);
    this.set(this.speed, 'speed', state.mph < -0.05 ? `${mph.toFixed(1)} mph astern` : `${mph.toFixed(1)} mph`);
    const next = state.next;
    let nextText = '';
    if (next && state.phase === 'underway') {
      nextText = next.minutes < 1 ? `Next: ${next.name}, just ahead` : `Next: ${next.name}, about ${Math.round(next.minutes)} min`;
    }
    this.set(this.next, 'next', nextText);

    // While you're choosing, the choice is what needs you.
    this.callPanel.hidden = state.call === null || this.choice !== null || (state.mapOpen && state.phase !== 'underway');
    if (state.call !== null) this.set(this.callText, 'call', state.call);
    this.set(this.waited, 'waited', state.waited ?? '');
    this.waited.hidden = state.waited === null;

    if (this.shown.map !== String(state.mapOpen)) {
      this.shown.map = String(state.mapOpen);
      this.mapButton.setAttribute('aria-pressed', String(state.mapOpen));
      this.mapButtonText.textContent = state.mapOpen ? 'Back to the boat' : 'Map';
      this.root.classList.toggle('map-open', state.mapOpen);
    }
    this.mapKey.hidden = !state.mapOpen || this.choice !== null;
    this.logbookButton.hidden = !state.logbook;

    if (this.shown.phase !== state.phase) {
      const was = this.shown.phase;
      this.shown.phase = state.phase;
      this.startCard.hidden = state.phase !== 'morning';
      this.endCard.hidden = state.phase !== 'over';
      this.root.dataset.phase = state.phase;
      if (state.phase === 'morning' && was) this.castOffButton.focus();
      if (state.phase === 'over') {
        this.set(this.endTitle, 'end-title', state.endTitle);
        this.set(this.endText, 'end-text', state.endText);
        this.againButton.focus();
      }
    }
  }

  /** Asks you to choose, or puts the question away when given null. The first answer takes the keyboard. */
  showChoice(choice: Choice | null): void {
    if (choice === this.choice) return;
    this.choice = choice;
    this.choicePanel.hidden = choice === null;
    this.choiceOptions.replaceChildren();
    if (!choice) return;
    this.choiceTitle.textContent = choice.title;
    for (const [i, option] of choice.options.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-option';
      button.setAttribute('aria-keyshortcuts', String(i + 1));
      const key = document.createElement('kbd');
      key.textContent = String(i + 1);
      const words = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = option.label;
      words.append(label);
      if (option.detail) {
        const detail = document.createElement('small');
        detail.textContent = option.detail;
        words.append(detail);
      }
      button.append(key, words);
      button.addEventListener('click', () => choice.onPick(i));
      this.choiceOptions.append(button);
    }
    (this.choiceOptions.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** Picks an answer to the open question by its number, from 1, as the number keys do. */
  pick(number: number): void {
    if (this.choice && number >= 1 && number <= this.choice.options.length) this.choice.onPick(number - 1);
  }

  /** Puts the keyboard back on the call button after a close-up, or on the game when nothing needs you. */
  focusCall(): void {
    if (!this.callPanel.hidden) this.callButton.focus({ preventScroll: true });
    else if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), TOAST_TIME);
  }
}
