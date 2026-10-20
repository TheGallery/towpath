// The keyboard: arrow keys (or WASD) for the tiller and throttle, M for the map.

import type { Controls } from '../sim/trip';

// Key positions rather than letters, so WASD sits in the same place on any layout.
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const AHEAD = new Set(['ArrowUp', 'KeyW']);
const ASTERN = new Set(['ArrowDown', 'KeyS']);

export type Command = 'toggle-map' | 'close-map';

export class Keyboard {
  private readonly held = new Set<string>();

  constructor(target: Window, onCommand: (command: Command) => void) {
    target.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // M is a letter shortcut, so it follows the letter wherever the layout puts it.
      if (ev.key === 'm' || ev.key === 'M') {
        if (!ev.repeat) onCommand('toggle-map');
      } else if (ev.key === 'Escape') {
        onCommand('close-map');
        return;
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

  controls(): Controls {
    const has = (keys: Set<string>) => [...this.held].some((k) => keys.has(k));
    const rudder = (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
    const throttle = (has(AHEAD) ? 1 : 0) - (has(ASTERN) ? 1 : 0);
    return { rudder: rudder as Controls['rudder'], throttle: throttle as Controls['throttle'] };
  }
}
