// The sound's controls: a switch on the start card beside Cast off, and a
// Sound button beside the bell that opens a small panel to turn sound on or
// off, set its volume, and choose which groups you hear. The bell keeps its
// own button.

import type { SoundSettings } from '../audio/settings';

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const found = doc.getElementById(id);
  if (!found) throw new Error(`The page is missing #${id}`);
  return found as T;
}

export class SoundControls {
  private readonly startSwitch: HTMLButtonElement;
  private readonly button: HTMLButtonElement;
  private readonly buttonText: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly on: HTMLInputElement;
  private readonly volume: HTMLInputElement;
  private readonly boat: HTMLInputElement;
  private readonly nature: HTMLInputElement;
  private settings: SoundSettings;

  constructor(doc: Document, settings: SoundSettings, onChange: (settings: SoundSettings) => void) {
    this.startSwitch = byId(doc, 'start-sound');
    this.button = byId(doc, 'sound-button');
    this.buttonText = byId(doc, 'sound-text');
    this.panel = byId(doc, 'sound-panel');
    this.on = byId(doc, 'sound-on');
    this.volume = byId(doc, 'sound-volume');
    this.boat = byId(doc, 'sound-boat');
    this.nature = byId(doc, 'sound-nature');
    this.settings = settings;
    this.show();

    const change = (next: SoundSettings) => {
      this.settings = next;
      this.show();
      onChange(next);
    };
    this.startSwitch.addEventListener('click', () => change({ ...this.settings, on: !this.settings.on }));
    this.button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.on.addEventListener('change', () => change({ ...this.settings, on: this.on.checked }));
    this.volume.addEventListener('input', () => change({ ...this.settings, volume: Number(this.volume.value) }));
    this.boat.addEventListener('change', () => change({ ...this.settings, boat: this.boat.checked }));
    this.nature.addEventListener('change', () => change({ ...this.settings, nature: this.nature.checked }));
    // A click anywhere else puts the panel away.
    doc.addEventListener('pointerdown', (ev) => {
      if (this.isOpen && ev.target instanceof Node && !this.panel.contains(ev.target) && !this.button.contains(ev.target)) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.on.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    const hadFocus = this.panel.contains(document.activeElement);
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (hadFocus) this.button.focus({ preventScroll: true });
  }

  private show(): void {
    const { on, volume, boat, nature } = this.settings;
    this.startSwitch.setAttribute('aria-pressed', String(on));
    this.startSwitch.textContent = on ? 'Sound on' : 'Sound off';
    this.button.dataset.on = String(on);
    this.buttonText.textContent = on ? 'Sound on' : 'Sound off';
    this.on.checked = on;
    this.volume.value = String(volume);
    this.boat.checked = boat;
    this.nature.checked = nature;
    for (const field of [this.volume, this.boat, this.nature]) field.disabled = !on;
  }
}
