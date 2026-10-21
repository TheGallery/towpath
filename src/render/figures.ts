// Boats and people, drawn facing along +x at the origin.

import { COLOURS } from './palette';
import type { Livery } from './palette';
import { tag } from './svg';

/** A narrowboat, bow to the right, 74 units long. */
export function boatMarkup(paint: Livery, steerer?: string): string {
  return [
    tag('path', { d: 'M-34 -3.4H24Q36 -3.4 39 2Q36 7.4 24 7.4H-34Z', fill: '#000', opacity: 0.16 }),
    tag('path', { d: 'M-35 -5H23Q34 -5 37 0Q34 5 23 5H-35Q-37 5 -37 3V-3Q-37 -5 -35 -5Z', fill: '#1f2629' }),
    tag('rect', { x: -28, y: -4.2, width: 46, height: 8.4, rx: 1.6, fill: paint.side }),
    tag('rect', { x: -27, y: -3.1, width: 44, height: 6.2, rx: 1.2, fill: paint.roof }),
    tag('path', { d: 'M-21 2H9', stroke: '#8b5a2b', 'stroke-width': 0.9 }),
    tag('circle', { cx: -14, cy: -1.4, r: 1.3, fill: '#222' }),
    tag('circle', { cx: 3, cy: -1.2, r: 1, fill: COLOURS.brass }),
    tag('path', { d: 'M18 -4L28 -2.6L31 0L28 2.6L18 4Z', fill: '#24543a' }),
    tag('rect', { x: -35, y: -3.6, width: 7, height: 7.2, fill: '#3a312b' }),
    tag('path', { d: 'M-36 0H-42', stroke: COLOURS.brass, 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
    steerer ? tag('ellipse', { cx: -31.5, cy: 0, rx: 2, ry: 3.4, fill: steerer }) + tag('circle', { cx: -31, cy: 0, r: 1.9, fill: COLOURS.skin }) : '',
  ].join('');
}

/** The ripples behind a moving boat. */
export const WAKE_PATH = 'M-38 -4L-80 -15M-38 4L-80 15M-38 0L-70 0';

/** A person seen from above: shoulders and a head. */
export const personMarkup = (coat: string, hat: string): string =>
  tag('ellipse', { rx: 2.3, ry: 4, fill: coat }) + tag('circle', { r: 2, fill: hat });

/** A dog seen from above, nose to the right. */
export const dogMarkup = (coat: string, ears: string): string =>
  [
    tag('path', { d: 'M-4 0Q-7 -0.6 -8.4 -2.2', stroke: coat, 'stroke-width': 1.1, 'stroke-linecap': 'round', fill: 'none' }),
    tag('ellipse', { rx: 4.2, ry: 1.9, fill: coat }),
    tag('circle', { cx: 4.3, r: 1.7, fill: coat }),
    tag('ellipse', { cx: 3.9, cy: -1.5, rx: 0.9, ry: 0.6, fill: ears }),
    tag('ellipse', { cx: 3.9, cy: 1.5, rx: 0.9, ry: 0.6, fill: ears }),
  ].join('');
