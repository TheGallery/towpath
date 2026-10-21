import { describe, expect, it } from 'vitest';
import { answerLock, castOffDay, chooseSpot, chooseWay, newDay, planDay, stepDay } from '../src/sim/day';
import type { Day } from '../src/sim/day';
import { logLines } from '../src/sim/logbook';
import type { OtherWay } from '../src/sim/otherboat';
import { NO_CONTROLS, lockForYou } from '../src/sim/trip';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const plan = planDay(stretch);
const STEP = 0.25;

/** Runs the day until `until` says stop, answering each call as it rings unless told to leave it. */
function run(day: Day, until: (d: Day) => boolean, answer: { way?: string; spot?: number; leave?: string[] } = {}, limit = 4 * 3600): void {
  const end = day.time + limit;
  while (!until(day) && day.time < end) {
    for (const e of stepDay(day, plan, NO_CONTROLS, STEP)) {
      if (e.kind !== 'call' || e.again || answer.leave?.includes(e.call)) continue;
      if (e.call === 'cast-off') castOffDay(day);
      if (e.call === 'junction' && answer.way) chooseWay(day, plan, answer.way);
      if (e.call === 'dusk') chooseSpot(day, answer.spot ?? 0);
    }
  }
}

/** A whole day with the locks worked for you, down one way, to the morning. */
function wholeDay(way: string, other: OtherWay | null, spot = 0): Day {
  const day = newDay(plan, { other, crewed: true });
  run(day, (d) => d.phase === 'over', { way, spot });
  expect(day.phase).toBe('over');
  return day;
}

describe('the logbook', () => {
  it('notes setting out, the lock, the way at the junction and the mooring, then the evening', () => {
    const day = wholeDay('arm', 'down');
    expect(day.log.entries.map((e) => e.kind)).toEqual(['set-out', 'lock', 'way', 'moored', 'evening']);
    const lines = logLines(day.log);
    expect(lines.map((l) => l.when)).toEqual(['Morning', expect.stringMatching(/^\d+ min$/), expect.stringMatching(/^\d+ min$/), expect.stringMatching(/^\d+ min$/), 'Evening']);
    expect(lines[0].text).toBe('Cast off from Kingsbridge and set out along the Hallam Canal.');
    expect(lines[1].text).toMatch(/^Up through Brook Lock\. Another boat came down first and left it ready for you, with the gates open\. You worked it in \d+ min\.$/);
    expect(lines[2].text).toBe('Turned right at Wendle Junction into the Wendle Arm, for Wendle Basin.');
    expect(lines[3].text).toBe('Moored by the pub garden at Wendle Basin, by The Navigation pub, as the light went.');
    expect(lines[4].text).toMatch(/^The lamps are lit\. \d\.\d miles and one lock today, in \d+ min on the water\.$/);
  });

  it('keeps the times in order, as minutes after casting off', () => {
    const day = wholeDay('main', 'down');
    const ats = day.log.entries.map((e) => e.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    const minutes = logLines(day.log)
      .slice(1, -1)
      .map((l) => Number.parseInt(l.when, 10));
    expect(minutes[0]).toBeGreaterThanOrEqual(3);
    expect(minutes[minutes.length - 1]).toBeGreaterThan(minutes[0]);
    expect(minutes[minutes.length - 1]).toBeLessThan(25);
  });

  it('tells how the other boat left the lock, and the other way at the junction', () => {
    const lines = logLines(wholeDay('main', 'up', 2).log);
    expect(lines[1].text).toMatch(/^Up through Brook Lock\. The boat ahead went up first and left it full, so you emptied it before you could go in\./);
    expect(lines[2].text).toBe('Straight on at Wendle Junction, along the Hallam Canal for Coppice Wood bank.');
    expect(lines[3].text).toBe('Moored at the far end, looking over the fields at Coppice Wood bank, a quiet bank by the wood, as the light went.');
  });

  it('says when the lock was ready for you with no other boat about', () => {
    const lines = logLines(wholeDay('arm', null).log);
    expect(lines[1].text).toMatch(/^Up through Brook Lock, which was ready for you\. You worked it in \d+ min\.$/);
  });

  it('is written up in the evening, not before', () => {
    const day = newDay(plan, { other: 'down', crewed: true });
    run(day, (d) => d.phase === 'tying-up', { way: 'arm' });
    expect(day.log.written).toBe(false);
    expect(day.log.entries.map((e) => e.kind)).toEqual(['set-out', 'lock', 'way']);
    run(day, (d) => d.phase === 'evening');
    expect(day.log.written).toBe(true);
    expect(day.log.entries.at(-1)?.kind).toBe('evening');
    // Only once, however long the evening.
    run(day, (d) => d.phase === 'over');
    expect(day.log.entries.filter((e) => e.kind === 'evening')).toHaveLength(1);
  });

  it('notes how long the boat waited for you at the lock, while you are still working it', () => {
    const day = newDay(plan, { other: 'down' });
    run(day, (d) => lockForYou(d.trip) !== null && d.calls.open?.kind === 'lock');
    const rang = day.time;
    run(day, (d) => d.time >= rang + 5 * 60 + 10, { leave: ['lock'] });
    answerLock(day);
    expect(day.log.waited.lock).toBeCloseTo(5 * 60 + 10, 0);
    expect(logLines(day.log)[1].text).toBe('Tied up below Brook Lock to work it. The boat waited 5 min for you at the lock.');
  });

  it('notes the wait at the junction from when the boat pulled in, not when it called', () => {
    const day = newDay(plan, { other: 'down', crewed: true });
    run(day, (d) => d.held);
    const held = day.time;
    expect(day.log.waiting.junction).toBe(held);
    run(day, (d) => d.time >= held + 3 * 60);
    chooseWay(day, plan, 'arm');
    expect(logLines(day.log)[2].text).toBe('Turned right at Wendle Junction into the Wendle Arm, for Wendle Basin. The boat waited 3 min for you to choose.');
  });

  it("doesn't mention a short wait, or a choice made before the boat called", () => {
    const day = newDay(plan, { other: 'down', crewed: true });
    castOffDay(day);
    chooseWay(day, plan, 'main');
    run(day, (d) => d.phase === 'over', { spot: 1 });
    expect(day.log.waited.junction).toBeUndefined();
    for (const line of logLines(day.log)) expect(line.text).not.toMatch(/waited/);
  });
});
