// The keyboard: arrow keys (or WASD) for the tiller and throttle, M for the
// map, Space (or Enter) to work the lock, and Escape to go back.

import type { HeldKeys } from './closeup';
import type { Controls } from '../sim/trip';

// Key positions rather than letters, so WASD sits in the same place on any layout.
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const AHEAD = new Set(['ArrowUp', 'KeyW']);
const ASTERN = new Set(['ArrowDown', 'KeyS']);
const WORK = new Set(['Space', 'Enter', 'NumpadEnter']);

export type Command = 'toggle-map' | 'back' | 'work';

/** Space and Enter belong to a focused button or field, not the game. */
const ownsKeys = (target: EventTarget | null): boolean => target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLAnchorElement;

export class Keyboard {
  private readonly held = new Set<string>();

  constructor(target: Window, onCommand: (command: Command) => void) {
    target.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // M is a letter shortcut, so it follows the letter wherever the layout puts it.
      if (ev.key === 'm' || ev.key === 'M') {
        if (!ev.repeat) onCommand('toggle-map');
      } else if (ev.key === 'Escape') {
        onCommand('back');
        return;
      } else if (WORK.has(ev.code)) {
        if (ownsKeys(ev.target)) return;
        this.held.add(ev.code);
        if (!ev.repeat) onCommand('work');
      } else if (LEFT.has(ev.code) || RIGHT.has(ev.code) || AHEAD.has(ev.code) || ASTERN.has(ev.code)) {
        this.held.add(ev.code);
      } else {
        return;
      }
      ev.preventDefault();
    });
    target.addEventListener('keyup', (ev) => this.held.delete(ev.code));
    // Keys let go while the page is in the background never send a keyup.
    target.addEventListener('blur', () => this.held.clear());
    target.document.addEventListener('visibilitychange', () => this.held.clear());
  }

  private has(keys: Set<string>): boolean {
    return [...this.held].some((k) => keys.has(k));
  }

  controls(): Controls {
    const rudder = (this.has(RIGHT) ? 1 : 0) - (this.has(LEFT) ? 1 : 0);
    const throttle = (this.has(AHEAD) ? 1 : 0) - (this.has(ASTERN) ? 1 : 0);
    return { rudder: rudder as Controls['rudder'], throttle: throttle as Controls['throttle'] };
  }

  /** The keys for a close-up: Space held, and the arrows to wind anticlockwise (left) or clockwise (right). */
  closeupKeys(): HeldKeys {
    const turn = (this.has(RIGHT) || this.has(AHEAD) ? 1 : 0) - (this.has(LEFT) || this.has(ASTERN) ? 1 : 0);
    return { work: this.has(WORK), turn: turn as HeldKeys['turn'] };
  }
}
