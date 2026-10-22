// A gallery of canals made from seeds, for eyeballing what the generator
// makes: a page of small sketches, each linking to the game on that canal.
// Only the development server serves it, at `?gallery`; `&from=N` starts the
// page at seed N. Canals are made one at a time, so the page stays
// responsive on a phone.

import { poseAt } from './core/track';
import type { Track } from './core/track';
import { makeCanal } from './sim/playable';
import { MADE_SIZE, dayShape } from './world/generate';
import { resolveStretch } from './world/stretch';

/** How many canals a page shows. */
const PER_PAGE = 24;

const params = new URLSearchParams(window.location.search);
const asked = params.has('from') ? Number(params.get('from')) : NaN;
const from = Number.isSafeInteger(asked) && asked >= 0 ? asked : 1;

document.title = `Canals from seed ${from} · Towpath`;
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
    body { margin: 0; padding: 16px; background: #f2e9d4; color: #2b3a3f; font: 14px/1.4 system-ui, sans-serif; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    nav { display: flex; gap: 16px; margin: 8px 0 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    a.canal { display: block; color: inherit; text-decoration: none; background: #fbf6ea; border-radius: 8px; padding: 8px; }
    a.canal:hover { outline: 2px solid #5b95ab; }
    svg { display: block; width: 100%; height: auto; background: #f7f0dd; border-radius: 4px; }
    p { margin: 6px 0 0; }
    .about { color: #5d6b6e; font-size: 12.5px; }
  </style>`,
);
document.body.innerHTML = `
  <h1>Canals made from seeds ${from} to ${from + PER_PAGE - 1}</h1>
  <p class="about">Each opens the game on that canal. Blue: canals; grey: roads; dark ticks: locks; red: pubs; green: woods.</p>
  <nav>${from > 0 ? `<a href="?gallery&from=${Math.max(0, from - PER_PAGE)}">Earlier seeds</a>` : ''}<a href="?gallery&from=${from + PER_PAGE}">Later seeds</a></nav>
  <div class="grid" id="grid"></div>`;

/** A track as an SVG path, every few samples, which is plenty at this size. */
const pathOf = (track: Track): string => {
  const points: string[] = [];
  for (let i = 0; i < track.xs.length; i += 6) points.push(`${Math.round(track.xs[i])} ${Math.round(track.ys[i])}`);
  points.push(`${Math.round(track.xs[track.xs.length - 1])} ${Math.round(track.ys[track.ys.length - 1])}`);
  return `M${points.join('L')}`;
};

function sketch(seed: number): HTMLElement {
  const made = makeCanal(seed);
  const stretch = resolveStretch(made.data);
  const { data } = stretch;
  const { width, height } = MADE_SIZE;
  const shape = dayShape(seed);
  const parts: string[] = [];
  for (const w of data.woods) parts.push(`<ellipse cx="${w.centre[0]}" cy="${w.centre[1]}" rx="${w.radius[0]}" ry="${w.radius[1]}" fill="#cfe0a9"/>`);
  for (const road of stretch.roads.values()) parts.push(`<path d="${pathOf(road)}" stroke="#b9ae97" stroke-width="22" fill="none"/>`);
  for (const track of stretch.waterways.values()) parts.push(`<path d="${pathOf(track)}" stroke="#3a7a96" stroke-width="44" fill="none"/>`);
  for (const f of data.features) {
    const track = stretch.waterways.get(f.waterway);
    if (!track) continue;
    if (f.kind === 'basin') parts.push(`<rect x="${f.area.x}" y="${f.area.y}" width="${f.area.width}" height="${f.area.height}" rx="26" fill="#3a7a96"/>`);
    if (f.kind === 'lock') {
      const p = poseAt(track, f.at);
      parts.push(`<path d="M${Math.round(p.x - p.nx * 90)} ${Math.round(p.y - p.ny * 90)}L${Math.round(p.x + p.nx * 90)} ${Math.round(p.y + p.ny * 90)}" stroke="#2b3a3f" stroke-width="36"/>`);
    }
    if (f.kind === 'bank' || f.kind === 'basin') {
      const p = f.kind === 'bank' ? poseAt(track, f.at) : { x: f.area.x + f.area.width / 2, y: f.area.y + f.area.height / 2 };
      parts.push(`<circle cx="${Math.round(p.x)}" cy="${Math.round(p.y)}" r="70" fill="#fbf6ea" stroke="#2b3a3f" stroke-width="20"/>`);
    }
  }
  for (const pub of data.pubs) parts.push(`<circle cx="${pub.at[0]}" cy="${pub.at[1]}" r="60" fill="#a8402f"/>`);
  const locks = data.features.filter((f) => f.kind === 'lock').length;
  const threeWay = shape.junctions.filter(Boolean).length;
  const link = document.createElement('a');
  link.className = 'canal';
  link.href = `?seed=${seed}&fresh`;
  link.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${data.name}">${parts.join('')}</svg>
    <p><strong>${seed}</strong> · ${made.fellBack ? 'no try played, so the Hallam Canal' : data.name}</p>
    <p class="about">${shape.junctions.length} junction${shape.junctions.length === 1 ? '' : 's'}${threeWay ? ` (${threeWay} three-way)` : ''}, ${locks} lock${locks === 1 ? '' : 's'}, ${data.trip.ways.length} way${data.trip.ways.length === 1 ? '' : 's'} · ${made.tries} ${made.tries === 1 ? 'try' : 'tries'}</p>`;
  return link;
}

const grid = document.getElementById('grid');
let seed = from;
/** Makes the next canal, then waits a moment before the one after, so the page can draw and scroll in between. */
function next(): void {
  if (!grid || seed >= from + PER_PAGE) return;
  grid.append(sketch(seed++));
  window.setTimeout(next, 0);
}
next();
