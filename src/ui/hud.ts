// The words and buttons over the game: what's happening, who's steering, the
// speed, what's next, the lock part that needs you, the map key, and the
// cards at the start and end.

import type { Upcoming } from '../sim/status';
import type { TripPhase } from '../sim/trip';

export interface HudState {
  readonly phase: TripPhase;
  readonly status: string;
  readonly helm: 'auto' | 'you';
  /** Speed in miles per hour; negative going astern. */
  readonly mph: number;
  readonly next: Upcoming | null;
  readonly mapOpen: boolean;
  /** The lock part that needs you, as the work button's words, or null when there's nothing to work. */
  readonly work: string | null;
}

export interface HudOptions {
  readonly startName: string;
  readonly endName: string;
  readonly tripMinutes: number;
  /** How much faster than real time the game runs; 1 normally. */
  readonly rate: number;
  readonly onCastOff: () => void;
  readonly onStartAgain: () => void;
  readonly onToggleMap: () => void;
  readonly onWork: () => void;
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
  private readonly lockPanel: HTMLElement;
  private readonly workButton: HTMLButtonElement;
  private readonly workText: HTMLElement;
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
    this.lockPanel = byId(doc, 'lock-panel');
    this.workButton = byId(doc, 'work-button');
    this.workText = byId(doc, 'work-text');

    const minutes = Math.round(options.tripMinutes);
    byId(doc, 'start-text').textContent = `Your narrowboat is moored at ${options.startName}. Cast off and it cruises by itself to ${options.endName}, about ${minutes} minutes away, waiting at the lock for you to work it. Leave it running while you work, and look in when you like.`;
    byId(doc, 'end-title').textContent = `Moored at ${options.endName}`;
    byId(doc, 'end-text').textContent = "The boat is tied up for the night. That's the whole trip for now.";
    this.againButton.textContent = `Start again from ${options.startName}`;

    const rate = byId(doc, 'rate');
    if (options.rate !== 1) {
      rate.hidden = false;
      rate.textContent = `${options.rate}× speed`;
    }

    this.castOffButton.addEventListener('click', options.onCastOff);
    this.againButton.addEventListener('click', options.onStartAgain);
    this.mapButton.addEventListener('click', options.onToggleMap);
    this.workButton.addEventListener('click', options.onWork);
    this.castOffButton.focus();
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
    this.set(this.helmWho, 'helm', steering ? 'You have the tiller' : state.phase === 'cruising' || state.phase === 'in-lock' ? 'The boat is steering itself' : 'Moored');
    this.helmPanel.classList.toggle('steering', steering);

    const mph = Math.abs(state.mph);
    this.set(this.speed, 'speed', state.mph < -0.05 ? `${mph.toFixed(1)} mph astern` : `${mph.toFixed(1)} mph`);
    const next = state.next;
    let nextText = '';
    if (next && state.phase !== 'moored' && state.phase !== 'arrived') {
      nextText = next.minutes < 1 ? `Next: ${next.name}, just ahead` : `Next: ${next.name}, about ${Math.round(next.minutes)} min`;
    }
    this.set(this.next, 'next', nextText);

    this.lockPanel.hidden = state.work === null || state.mapOpen;
    if (state.work !== null) this.set(this.workText, 'work', state.work);

    if (this.shown.map !== String(state.mapOpen)) {
      this.shown.map = String(state.mapOpen);
      this.mapButton.setAttribute('aria-pressed', String(state.mapOpen));
      this.mapButtonText.textContent = state.mapOpen ? 'Back to the boat' : 'Map';
      this.mapKey.hidden = !state.mapOpen;
      this.root.classList.toggle('map-open', state.mapOpen);
    }

    if (this.shown.phase !== state.phase) {
      const was = this.shown.phase;
      this.shown.phase = state.phase;
      this.startCard.hidden = state.phase !== 'moored';
      this.endCard.hidden = state.phase !== 'arrived';
      if (state.phase === 'moored' && was) this.castOffButton.focus();
      if (state.phase === 'arrived') this.againButton.focus();
    }
  }

  /** Puts the keyboard back on the work button after a close-up, or on the game when there's nothing to work. */
  focusWork(): void {
    if (!this.lockPanel.hidden) this.workButton.focus({ preventScroll: true });
    else if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), TOAST_TIME);
  }
}
