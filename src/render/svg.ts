// Small helpers for writing SVG, as strings for the static painting and as
// elements for the parts that move.

import { segmentControls } from '../core/track';
import type { Point, Pose, Track } from '../core/track';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** A number with at most one decimal place, which keeps the markup short. */
export const f1 = (n: number): string => String(Math.round(n * 10) / 10);

export const degrees = (radians: number): number => (radians * 180) / Math.PI;

/** Attribute values. Numbers are written as they are, so round computed ones with `f1` first. */
type Attrs = Record<string, string | number>;

const attrText = (attrs: Attrs): string =>
  Object.entries(attrs)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? v : escapeText(v)}"`)
    .join(' ');

export const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** One SVG tag as markup. */
export const tag = (name: string, attrs: Attrs, inner?: string): string =>
  inner === undefined ? `<${name} ${attrText(attrs)}/>` : `<${name} ${attrText(attrs)}>${inner}</${name}>`;

/** A group moved to a pose and turned to face along it. */
export const placed = (pose: { x: number; y: number; angle: number }, inner: string): string =>
  `<g transform="translate(${f1(pose.x)} ${f1(pose.y)}) rotate(${f1(degrees(pose.angle))})">${inner}</g>`;

/** A circle as path data, so many can share one path. */
export const circlePath = (x: number, y: number, r: number): string =>
  `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;

/** The track's curve as SVG cubics: the same curve as the samples, in far less markup. */
export function smoothPath(track: Track): string {
  const pts = track.points;
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = segmentControls(pts, i, track.before);
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}

/** A line running alongside the track at `offset`, between two distances. */
export function offsetPath(track: Track, offset: number, from: number, to: number): string {
  const out: string[] = [];
  for (let i = 0; i < track.ss.length; i++) {
    const s = track.ss[i];
    if (s < from || s > to) continue;
    const h = track.headings[i];
    out.push(`${f1(track.xs[i] - Math.sin(h) * offset)} ${f1(track.ys[i] + Math.cos(h) * offset)}`);
  }
  return out.length > 1 ? `M${out.join('L')}` : '';
}

export const polygonPath = (points: readonly Point[]): string => `M${points.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L')}Z`;

export function element<K extends keyof SVGElementTagNameMap>(name: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

export const transformFor = (pose: Pose | { x: number; y: number; angle: number }, extraDegrees = 0): string =>
  `translate(${f1(pose.x)} ${f1(pose.y)}) rotate(${f1(degrees(pose.angle) + extraDegrees)})`;
