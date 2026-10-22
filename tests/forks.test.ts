import { describe, expect, it } from 'vitest';
import { distanceTo, nearestDistance, poseAt } from '../src/core/track';
import { hullSpanWithin } from '../src/sim/boat';
import { callKey } from '../src/sim/calls';
import { castOffDay, chooseSpot, chooseWay, dayTimeline, forkAhead, needsYou, newDay, planDay, stepDay } from '../src/sim/day';
import type { Day, DayEvent } from '../src/sim/day';
import { logLines } from '../src/sim/logbook';
import { loadGame, saveGame } from '../src/sim/save';
import { callTitle, describeDay, forkWords } from '../src/sim/status';
import { NO_CONTROLS } from '../src/sim/trip';
import { planWalkers } from '../src/sim/walkers';
import { CHAMBER_HALF } from '../src/sim/lock';
import { BOAT_BEAM, BOAT_LENGTH, CANAL_WIDTH, LOCK_REACH, LOCK_STRAIGHT, LOCK_WIDTH, MOORED_OFFSET, TOWPATH_OFFSET } from '../src/world/dimensions';
import { JUNCTION_ROUND, checkStretch, resolveStretch } from '../src/world/stretch';
import type { StretchData } from '../src/world/stretch';
import { towpathRuns } from '../src/world/towpath';
import { FORKS } from './fixtures/forks';
import { byHand } from './fixtures/hands';

const stretch = resolveStretch(FORKS);
const plan = planDay(stretch);
const STEP = 1 / 30;
/** Long enough for a whole day played through on a slow machine. */
const DAY_TIMEOUT = 20_000;
const ids = (ways: readonly { way: string }[]) => ways.map((w) => w.way);

/** Runs the day until `until` says stop, or a time limit in seconds, and gathers its events. */
function run(day: Day, until: (d: Day) => boolean, limit = 3600, each?: (d: Day) => void): DayEvent[] {
  const events: DayEvent[] = [];
  const end = day.time + limit;
  while (!until(day) && day.time < end) {
    events.push(...stepDay(day, plan, NO_CONTROLS, STEP));
    each?.(day);
  }
  return events;
}

/** A day played by hand: casting off, working every lock, taking `way` at every fork, and mooring at the first spot. */
function playDay(way: string, other: 'down' | 'up' = 'down', each?: (d: Day) => void): { day: Day; rang: string[] } {
  const day = newDay(plan, { other });
  const you = byHand(STEP);
  const rang: string[] = [];
  run(day, (d) => d.phase === 'over', 3 * 3600, (d) => {
    const open = d.calls.open;
    if (open && rang.at(-1) !== callKey(open.kind, open.place)) rang.push(callKey(open.kind, open.place));
    you(d);
    if (open?.kind === 'cast-off') castOffDay(d);
    if (open?.kind === 'junction') chooseWay(d, plan, way);
    if (open?.kind === 'dusk') chooseSpot(d, 0);
    each?.(d);
  });
  return { day, rang };
}

describe('a day with more than one choice', () => {
  it('parts first at Elm Junction, three ways, then again at Bramble Junction for the ways straight on', () => {
    const day = newDay(plan);
    const elm = forkAhead(day, plan)!;
    expect(elm.name).toBe('Elm Junction');
    expect(elm.options.map(ids)).toEqual([['mill', 'east'], ['north'], ['south']]);
    expect(day.trip.hold).toBe(elm.hold);
    expect(forkAhead({ ways: ['mill', 'east'], plan: plan.ways[0] }, plan)?.name).toBe('Bramble Junction');
    expect(forkAhead({ ways: ['north'], plan: plan.ways[2] }, plan)).toBeNull();
  });

  it('keeps every lock on every way, once each', () => {
    expect(plan.locks.map((l) => l.id)).toEqual(['bottom-lock', 'top-lock', 'ferry-lock']);
    expect([...newDay(plan).trip.locks.keys()]).toEqual(['bottom-lock', 'top-lock', 'ferry-lock']);
  });

  it("says what's down each way at a fork: where it leads, about how long, and how many locks", () => {
    const elm = forkAhead(newDay(plan), plan)!;
    expect(elm.options.map((o) => forkWords(elm, o, plan))).toEqual([
      { way: 'Straight on along the Ashby Canal', to: 'to Mill Basin or Hob Hill bank, choosing again at Bramble Junction, about 6 min on' },
      { way: 'Turn left into the Kent Canal', to: 'to Kent Common, an open common, about 4 min with no locks' },
      { way: 'Turn right into the Ferry Arm', to: 'to Ferry Meadow, a meadow by the old ferry, about 4 min and one lock' },
    ]);
    const bramble = forkAhead({ ways: ['mill', 'east'], plan: plan.ways[0] }, plan)!;
    expect(bramble.options.map((o) => forkWords(bramble, o, plan).to)).toEqual(['to Mill Basin, by The Mill pub, about 3 min with no locks', 'to Hob Hill bank, a quiet bank under the hill, about 2 min with no locks']);
  });

  it("doesn't count a lock past where the way moors, as at a mooring below one", () => {
    const below: StretchData = { ...FORKS, features: FORKS.features.map((f) => (f.kind === 'bank' && f.id === 'ferry-bank' ? { ...f, at: 250, spots: [{ name: 'Below the lock', at: 330 }] } : f)) };
    const belowPlan = planDay(resolveStretch(below));
    const elm = forkAhead(newDay(belowPlan), belowPlan)!;
    expect(forkWords(elm, elm.options[2], belowPlan).to).toBe('to Ferry Meadow, a meadow by the old ferry, about 1 min with no locks');
  });

  it.each([
    { way: 'mill', calls: ['cast-off', 'lock:bottom-lock', 'junction:Elm Junction', 'lock:top-lock', 'junction:Bramble Junction', 'dusk'] },
    { way: 'east', calls: ['cast-off', 'lock:bottom-lock', 'junction:Elm Junction', 'lock:top-lock', 'junction:Bramble Junction', 'dusk'] },
    { way: 'north', calls: ['cast-off', 'lock:bottom-lock', 'junction:Elm Junction', 'dusk'] },
    { way: 'south', calls: ['cast-off', 'lock:bottom-lock', 'junction:Elm Junction', 'lock:ferry-lock', 'dusk'] },
  ])('calls you to every lock and every junction on the way $way, once each, and plays to the next morning', ({ way, calls }) => {
    const { day, rang } = playDay(way, way === 'south' ? 'up' : 'down');
    expect(rang, way).toEqual(calls);
    expect(day.phase, way).toBe('over');
    expect(day.plan.way).toBe(way);
    expect(day.ways).toEqual([way]);
    expect(day.log.entries.filter((e) => e.kind === 'lock' && e.cleared !== null)).toHaveLength(calls.filter((c) => c.startsWith('lock')).length);
  }, DAY_TIMEOUT);

  it('works a lock past the junction on a way the day only takes once you choose it', () => {
    // Before every way's locks were kept, the boat stopped below Ferry Lock for good.
    const { day } = playDay('south');
    const ferry = day.log.entries.find((e) => e.kind === 'lock' && e.id === 'ferry-lock');
    expect(ferry).toMatchObject({ lock: 'Ferry Lock', goingUp: false });
    expect(ferry?.kind === 'lock' && ferry.cleared).toBeGreaterThan(0);
    const timeline = dayTimeline(plan, 'south', 'down');
    expect(timeline.calls.map((c) => c.call)).toEqual(['cast-off', 'junction', 'dusk']);
    expect(timeline.end / 60).toBeLessThan(25);
  }, DAY_TIMEOUT);

  it('waits before each junction until you choose, and asks by name', () => {
    const day = newDay(plan, { other: 'down', crewed: true });
    castOffDay(day);
    const elm = forkAhead(day, plan)!;
    const events = run(day, (d) => d.held);
    expect(events).toContainEqual({ kind: 'held', junction: 'Elm Junction' });
    expect(day.trip.boat.s).toBeCloseTo(elm.hold, 0);
    expect(needsYou(day, plan)).toBe('way');
    expect(callTitle('junction', day, plan)).toBe('Which way at Elm Junction?');
    expect(describeDay(day, plan)).toBe('Waiting before Elm Junction for you to choose a way.');
    expect(chooseWay(day, plan, 'east')).toEqual([
      { kind: 'chose-way', way: 'east', junction: 'Elm Junction' },
      { kind: 'answered', call: 'junction', place: 'Elm Junction' },
    ]);
    expect(day.ways).toEqual(['mill', 'east']);
    expect(day.held).toBe(false);
    const bramble = forkAhead(day, plan)!;
    expect(day.trip.hold).toBe(bramble.hold);
    run(day, (d) => d.held);
    expect(callTitle('junction', day, plan)).toBe('Which way at Bramble Junction?');
    expect(day.trip.boat.s).toBeCloseTo(bramble.hold, 0);
    chooseWay(day, plan, 'mill');
    expect(day.ways).toEqual(['mill']);
    expect(day.trip.hold).toBeNull();
    expect(forkAhead(day, plan)).toBeNull();
  });

  it('writes up each lock and each choice in the logbook, naming the mooring once it is decided', () => {
    const { day } = playDay('mill');
    expect(logLines(day.log).map((l) => l.text.split('.')[0])).toEqual([
      'Cast off from Ashby Wharf and set out along the Ashby Canal',
      'Up through Bottom Lock',
      'Straight on at Elm Junction, along the Ashby Canal',
      'Up through Top Lock, which was ready for you',
      'Turned right at Bramble Junction into the Mill Arm, for Mill Basin',
      'Moored by the pub garden at Mill Basin, by The Mill pub, as the light went',
      'The lamps are lit',
    ]);
    expect(logLines(day.log)[6].text).toMatch(/two locks today/);
  }, DAY_TIMEOUT);

  it('keeps your place between two forks, with every lock, and carries on from it', () => {
    const day = newDay(plan, { other: 'up', crewed: true });
    castOffDay(day);
    run(day, (d) => d.held);
    chooseWay(day, plan, 'mill');
    run(day, (d) => d.trip.boat.s > (d.plan.locks[1]?.s ?? 0) + 400);
    const text = saveGame({ canal: { number: null, data: FORKS }, day, pages: [], other: 'up', bell: true });
    expect(Object.keys(JSON.parse(text).day.trip.locks)).toEqual(['bottom-lock', 'top-lock', 'ferry-lock']);
    const kept = loadGame(text)!.day;
    expect(kept).toEqual(day);
    run(day, (d) => d.held);
    expect(kept.ways).toEqual(['mill', 'east']);
    const loaded = loadGame(text)!;
    const again = loaded.day;
    while (!again.held && again.time < day.time + 1) stepDay(again, loaded.plan, NO_CONTROLS, STEP);
    expect(again.held).toBe(true);
    expect(again.trip.boat.s).toBeCloseTo(day.trip.boat.s, 3);
  });

  it.each([2750, 2930, 2960])('turns down a lock %i along, too near the junction for the ways that turn there to round the corner clear of it', (at) => {
    const near = { ...FORKS, features: FORKS.features.map((f) => (f.id === 'bottom-lock' ? { ...f, at } : f)) };
    expect(checkStretch(near)).toEqual(['north', 'south'].map((way) => `bottom-lock is too near Elm Junction for the way ${way} to round the corner clear of it`));
    expect(() => resolveStretch(near)).toThrow();
  });

  it('waits for a junction past a lock just before it, never back inside it', () => {
    const data: StretchData = { ...FORKS, features: FORKS.features.map((f) => (f.id === 'bottom-lock' ? { ...f, at: 2680 } : f)) };
    const near = planDay(resolveStretch(data));
    const day = newDay(near, { other: null, crewed: true });
    const lock = day.plan.locks.find((l) => l.id === 'bottom-lock')!;
    const elm = forkAhead(day, near)!;
    expect(elm.s - lock.s).toBeLessThan(LOCK_STRAIGHT + JUNCTION_ROUND + 10);
    expect(elm.hold).toBeGreaterThan(lock.s + CHAMBER_HALF + BOAT_LENGTH / 2);
    castOffDay(day);
    let last = day.trip.boat.s;
    let cleared = false;
    while (!day.held && day.time < 3600) {
      for (const e of stepDay(day, near, NO_CONTROLS, STEP)) if (e.kind === 'cleared-lock') cleared = true;
      expect(day.trip.boat.s).toBeGreaterThanOrEqual(last - 1e-9);
      last = day.trip.boat.s;
    }
    expect(cleared).toBe(true);
    expect(day.held).toBe(true);
    expect(day.trip.boat.s).toBeCloseTo(elm.hold, 0);
  });

  it('moors on a bank against the towpath, whichever side of its canal that is', () => {
    const north = stretch.ways.find((w) => w.id === 'north')!;
    for (const spot of north.spots) {
      const s = nearestDistance(north.route, [spot.x, spot.y]);
      const p = poseAt(north.route, s);
      // The Kent Canal turns off left, and its towpath is on its left bank.
      expect((spot.x - p.x) * p.nx + (spot.y - p.y) * p.ny).toBeCloseTo(-MOORED_OFFSET, 0);
    }
  });
});

describe('keeping the whole hull on the water, every way', () => {
  const canals = [...stretch.waterways.values()];
  const basins = FORKS.features.flatMap((f) => (f.kind === 'basin' ? [f.area] : []));
  // Square to the nearest canal's centre line, so the corners of a hull on the water are within half its width.
  const offCanal = (x: number, y: number) =>
    Math.min(
      ...canals.map((c) => {
        const q = poseAt(c, nearestDistance(c, [x, y]));
        return Math.abs((x - q.x) * q.nx + (y - q.y) * q.ny) - CANAL_WIDTH / 2;
      }),
    );
  const inBasin = (x: number, y: number) => basins.some((a) => x > a.x && x < a.x + a.width && y > a.y && y < a.y + a.height);

  it.each(['mill', 'east', 'north', 'south'])('never runs the hull over a bank or a lock wall on the way %s, through every lock and round every junction', (way) => {
    let [overBank, overWalls, n] = [-Infinity, 0, 0];
    const { day } = playDay(way, way === 'south' ? 'up' : 'down', (d) => {
      if (n++ % 15) return;
      const { boat } = d.trip;
      for (const l of d.plan.locks) {
        const span = hullSpanWithin(boat, l.s - LOCK_REACH, l.s + LOCK_REACH);
        if (span) overWalls = Math.max(overWalls, span.right - LOCK_WIDTH / 2, -LOCK_WIDTH / 2 - span.left);
      }
      const p = poseAt(d.plan.route, boat.s, boat.d);
      const a = p.angle + boat.psi;
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = p.x + (u * BOAT_LENGTH * Math.cos(a)) / 2 - (v * BOAT_BEAM * Math.sin(a)) / 2;
        const y = p.y + (u * BOAT_LENGTH * Math.sin(a)) / 2 + (v * BOAT_BEAM * Math.cos(a)) / 2;
        if (!inBasin(x, y)) overBank = Math.max(overBank, offCanal(x, y));
      }
    });
    expect(day.phase).toBe('over');
    expect(overWalls).toBeLessThan(1e-6);
    expect(overBank).toBeLessThan(0.5);
  }, DAY_TIMEOUT);
});

describe('the towpath along every canal', () => {
  const runs = towpathRuns(stretch);
  const canal = (id: string) => stretch.waterways.get(id)!;
  const foot = (id: string, side: 1 | -1) => {
    const f = FORKS.features.find((x) => x.id === id)!;
    return poseAt(canal(f.waterway), f.at, side * TOWPATH_OFFSET);
  };
  const near = (p: { x: number; y: number }, q: { x: number; y: number }, by = 4) => Math.hypot(p.x - q.x, p.y - q.y) < by;

  it('runs along each canal, on the bank each branch turns off to', () => {
    expect(runs).toHaveLength(4);
    const [ashby, kent, ferry, mill] = runs;
    // The main line's run goes on to the edge of the stretch, along its right bank.
    expect(near(poseAt(ashby.track, ashby.track.length), poseAt(canal('ashby'), canal('ashby').length, TOWPATH_OFFSET))).toBe(true);
    // The Kent Canal's starts on the main line's run, crosses the footbridge before Elm Junction, and goes up its left bank to the edge.
    const start = poseAt(kent.track, 0);
    expect(distanceTo(ashby.track, [start.x, start.y])).toBeLessThan(1);
    for (const side of [1, -1] as const) expect(distanceTo(kent.track, [foot('elm-footbridge', side).x, foot('elm-footbridge', side).y])).toBeLessThan(4);
    expect(near(poseAt(kent.track, kent.track.length), poseAt(canal('kent'), canal('kent').length, -TOWPATH_OFFSET))).toBe(true);
    // The arms' runs start at their footbridges' feet on the towpath side, which the main line's run crosses.
    expect(near(poseAt(ferry.track, 0), foot('ferry-footbridge', 1))).toBe(true);
    expect(near(poseAt(mill.track, 0), foot('mill-footbridge', 1))).toBe(true);
    for (const id of ['ferry-footbridge', 'mill-footbridge']) for (const side of [1, -1] as const) expect(distanceTo(ashby.track, [foot(id, side).x, foot(id, side).y])).toBeLessThan(4);
    // And the Mill Arm's goes round the basin's quay to the pub.
    const [pub] = FORKS.pubs;
    expect(near(poseAt(mill.track, mill.track.length), { x: pub.at[0], y: pub.at[1] }, 60)).toBe(true);
  });

  it('never ends in the open, but at a footbridge, another run, the edge of the stretch or the pub, and has a way on and off where each run joins another', () => {
    const ends = FORKS.features.filter((f) => f.kind === 'footbridge').flatMap((f) => [foot(f.id, 1), foot(f.id, -1)]);
    const { width, height } = FORKS.size;
    for (const run of runs) {
      for (const s of [0, run.track.length]) {
        const p = poseAt(run.track, s);
        const offEdge = p.x < 0 || p.x > width || p.y < 0 || p.y > height;
        const atPub = FORKS.pubs.some((pub) => Math.hypot(p.x - pub.at[0], p.y - pub.at[1]) < 60);
        const onAnother = runs.some((other) => other !== run && distanceTo(other.track, [p.x, p.y]) < 4);
        expect(offEdge || atPub || onAnother || ends.some((q) => near(p, q))).toBe(true);
      }
    }
    // Both ends, and where the Kent Canal's, the Ferry Arm's and the Mill Arm's runs join it.
    expect(runs[0].exits).toHaveLength(5);
  });

  it('keeps to the bank, out of the water but on the footbridges', () => {
    const decks = FORKS.features.filter((f) => f.kind === 'footbridge').map((f) => foot(f.id, 1));
    for (const run of runs) {
      for (let s = 0; s <= run.track.length; s += 5) {
        const p = poseAt(run.track, s);
        if (decks.some((d) => near(p, d, 2 * TOWPATH_OFFSET + 6))) continue;
        for (const water of stretch.waterways.values()) expect(distanceTo(water, [p.x, p.y])).toBeGreaterThan(CANAL_WIDTH / 2 + 4);
      }
    }
  });

  it('has people walking every canal', () => {
    const walkers = planWalkers(runs, FORKS.seed);
    for (let i = 0; i < runs.length; i++) expect(walkers.filter((w) => w.run === i).length, `run ${i}`).toBeGreaterThan(0);
  });
});

describe('where a way can moor', () => {
  it('not short of a junction where ways that share its route still part', () => {
    const short: StretchData = {
      ...FORKS,
      features: [...FORKS.features, { kind: 'bank', id: 'near-bank', name: 'Near bank', waterway: 'ashby', at: 4400, about: 'a bank', spots: [{ name: 'Here', at: 4480 }] }],
      trip: { ...FORKS.trip, ways: FORKS.trip.ways.map((w) => (w.id === 'east' ? { ...w, to: 'near-bank' } : w)) },
    };
    expect(checkStretch(short)).toEqual(['the way east ends at near-bank before Bramble Junction, where ways that share its route part']);
  });
});

describe('the footbridges a towpath needs at a junction', () => {
  const without = (id: string): StretchData => ({ ...FORKS, features: FORKS.features.filter((f) => f.id !== id) });

  it('needs one over a branch that leaves on the towpath side, by its mouth', () => {
    expect(checkStretch(FORKS)).toEqual([]);
    expect(checkStretch(without('ferry-footbridge'))).toEqual(['no footbridge carries the towpath over ferry-arm by its junction']);
  });

  it('needs one over the main line just before a branch that leaves on the far side', () => {
    expect(checkStretch(without('elm-footbridge'))).toEqual(['no footbridge carries the towpath over ashby before kent leaves it']);
  });
});
