// The towpath runs along the right-hand bank of the first way, and on along
// any canal that way turns off, which the other ways follow. People come onto
// it and leave it at its ends and where a bridge or footbridge crosses it.

import { distanceTo, nearestDistance, poseAt } from '../core/track';
import type { Track } from '../core/track';
import type { Stretch } from './stretch';

/** One unbroken length of towpath, beside a canal's curve between two distances along it. */
export interface TowpathRun {
  readonly track: Track;
  readonly from: number;
  readonly to: number;
  /** Where people come onto it and leave it, by distance along the curve, in order. */
  readonly exits: readonly number[];
}

/** How near a bridge must be to a run's curve to cross it. */
const CROSSES = 8;

export function towpathRuns(stretch: Stretch): TowpathRun[] {
  const [first] = stretch.ways;
  // It stops short of a basin, where the pub garden meets the water.
  const spans: { track: Track; from: number; to: number }[] = [{ track: first.route, from: 0, to: first.mooring.kind === 'basin' ? first.end - 120 : first.route.length }];
  for (const j of first.junctions) {
    if (!j.turns) continue;
    const parentId = j.branch.leaves?.waterway;
    const parent = parentId ? stretch.waterways.get(parentId) : undefined;
    if (parent) spans.push({ track: parent, from: nearestDistance(parent, j.point) + 70, to: parent.length });
  }
  return spans.map((span) => {
    const exits = [span.from, span.to];
    for (const f of stretch.data.features) {
      if (f.kind !== 'bridge' && f.kind !== 'footbridge') continue;
      const track = stretch.waterways.get(f.waterway);
      if (!track) continue;
      const p = poseAt(track, f.at);
      if (distanceTo(span.track, [p.x, p.y]) > CROSSES) continue;
      const s = nearestDistance(span.track, [p.x, p.y]);
      if (s > span.from + 20 && s < span.to - 20) exits.push(s);
    }
    return { ...span, exits: exits.sort((a, b) => a - b) };
  });
}
