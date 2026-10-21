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

/** A mallard on the water, bill to the right: the drake with his green head, or the brown duck. */
export const mallardMarkup = (drake: boolean): string =>
  drake
    ? [
        tag('ellipse', { rx: 4, ry: 2.2, fill: '#a39a8a' }),
        tag('path', { d: 'M-4 -1L-6 0L-4 1Z', fill: '#2b2b2b' }),
        tag('ellipse', { cx: 2.2, rx: 1.6, ry: 1.9, fill: '#7a4a32' }),
        tag('circle', { cx: 4.2, r: 1.5, fill: '#2f6b4a' }),
        tag('ellipse', { cx: 5.9, rx: 0.9, ry: 0.55, fill: '#e0b030' }),
      ].join('')
    : [
        tag('ellipse', { rx: 3.8, ry: 2.1, fill: '#8b6a45' }),
        tag('path', { d: 'M-2 -1.2L1 -1.6M-2 1.2L1 1.6', stroke: '#6b4f33', 'stroke-width': 0.6 }),
        tag('circle', { cx: 4, r: 1.4, fill: '#7a5a3a' }),
        tag('ellipse', { cx: 5.6, rx: 0.9, ry: 0.5, fill: '#c9862b' }),
      ].join('');

export const ducklingMarkup = (): string => tag('ellipse', { rx: 1.7, ry: 1.1, fill: '#c9a24a' }) + tag('circle', { cx: 1.8, r: 0.8, fill: '#8b6a2b' });

/** A mute swan, neck held in a curve and its orange bill to the right. */
export const swanMarkup = (): string =>
  [
    tag('ellipse', { rx: 7, ry: 3.6, fill: '#f6f3ea' }),
    tag('path', { d: 'M-4 -2.4Q0 -3.2 3 -2M-4 2.4Q0 3.2 3 2', stroke: '#dcd8cc', 'stroke-width': 0.8, fill: 'none' }),
    tag('path', { d: 'M5 0Q8 -0.6 9.5 0', stroke: '#f6f3ea', 'stroke-width': 2.2, 'stroke-linecap': 'round', fill: 'none' }),
    tag('circle', { cx: 10, r: 1.4, fill: '#f6f3ea' }),
    tag('path', { d: 'M10.8 0H13', stroke: '#e07b39', 'stroke-width': 1.1, 'stroke-linecap': 'round' }),
    tag('circle', { cx: 10.9, r: 0.5, fill: '#2b2b2b' }),
  ].join('');

/** The little V of ripples behind a swimming bird, `length` long. */
export const swimRipplesMarkup = (length: number): string =>
  tag('path', { d: `M-3 -1.6L${-3 - length} ${-2 - length * 0.45}M-3 1.6L${-3 - length} ${2 + length * 0.45}`, stroke: '#eaf7fb', 'stroke-width': 0.6, opacity: 0.4, fill: 'none', 'stroke-linecap': 'round' });

/** A sheep seen from above, its black face to the right. */
export const sheepMarkup = (): string =>
  [
    tag('ellipse', { cx: 0.8, cy: 1, rx: 4.6, ry: 3.2, fill: '#000', opacity: 0.12 }),
    tag('ellipse', { rx: 4.4, ry: 3.1, fill: '#f2efe6', stroke: '#d8d2c4', 'stroke-width': 0.6 }),
    tag('ellipse', { cx: 4.6, rx: 1.7, ry: 1.25, fill: '#2b2b2b' }),
    tag('path', { d: 'M4 -1.3L3.6 -2.3M4 1.3L3.6 2.3', stroke: '#2b2b2b', 'stroke-width': 0.8, 'stroke-linecap': 'round' }),
  ].join('');

/** A cow seen from above, head to the right: black and white, or brown. */
export function cowMarkup(brown: boolean): string {
  const dark = brown ? '#7a4a22' : '#2b2b2b';
  const patches = brown
    ? tag('ellipse', { cx: -2, rx: 3, ry: 2.6, fill: dark })
    : tag('ellipse', { cx: -3, cy: -1, rx: 3, ry: 2.2, fill: dark }) + tag('ellipse', { cx: 3, cy: 1.4, rx: 2.4, ry: 1.8, fill: dark }) + tag('ellipse', { cx: -6.4, cy: 1.8, rx: 1.4, ry: 1.2, fill: dark });
  return [
    tag('ellipse', { cx: 1, cy: 1.2, rx: 8.4, ry: 4.2, fill: '#000', opacity: 0.13 }),
    tag('ellipse', { rx: 8, ry: 3.9, fill: brown ? '#8b5a2b' : '#f2efe6' }),
    patches,
    tag('path', { d: 'M-8 0Q-10.5 0.8 -11 2.4', stroke: dark, 'stroke-width': 0.7, fill: 'none' }),
    tag('ellipse', { cx: 9.4, rx: 2.2, ry: 1.9, fill: dark }),
    tag('ellipse', { cx: 11.2, rx: 0.9, ry: 1.3, fill: '#d9a7a0' }),
    tag('path', { d: 'M9 -1.8L8.4 -3.2M9 1.8L8.4 3.2', stroke: dark, 'stroke-width': 1, 'stroke-linecap': 'round' }),
  ].join('');
}
