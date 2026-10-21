import { describe, expect, it } from 'vitest';
import { DAWN_TIME, castOffDay, chooseSpot, chooseWay, newDay, planDay, stepDay } from '../src/sim/day';
import type { Day, DayPhase } from '../src/sim/day';
import { NO_CONTROLS } from '../src/sim/trip';
import { DRIZZLE_FADE, MIST_LIFT, SKY_REPEAT, cloudAt, planClouds, planWeather, weatherAt } from '../src/sim/weather';
import { HALLAM } from '../src/world/hallam';
import { resolveStretch } from '../src/world/stretch';

const stretch = resolveStretch(HALLAM);
const plan = planDay(stretch);
const DAYS = Array.from({ length: 200 }, (_, i) => planWeather(HALLAM.seed, i + 1));

/** A day at a phase, so far into it. */
const at = (phase: DayPhase, phaseTime: number): Day => ({ ...newDay(plan), phase, phaseTime });

describe("the day's weather", () => {
  it('is the same every time for the same seed and day', () => {
    expect(planWeather(HALLAM.seed, 4)).toEqual(planWeather(HALLAM.seed, 4));
    expect(planWeather(HALLAM.seed + 1, 4)).not.toEqual(planWeather(HALLAM.seed, 4));
  });

  it('changes from day to day: some misty mornings, some drizzle, and plenty of clear days', () => {
    const misty = DAYS.filter((w) => w.mist > 0).length;
    const drizzly = DAYS.filter((w) => w.drizzle).length;
    const clear = DAYS.filter((w) => w.mist === 0 && !w.drizzle).length;
    expect(misty).toBeGreaterThan(80);
    expect(misty).toBeLessThan(140);
    expect(drizzly).toBeGreaterThan(50);
    expect(drizzly).toBeLessThan(110);
    expect(clear).toBeGreaterThan(30);
  });

  it('keeps drizzle to a spell part way through the trip', () => {
    for (const w of DAYS) {
      if (!w.drizzle) continue;
      expect(w.drizzle.from).toBeGreaterThanOrEqual(120);
      expect(w.drizzle.to - w.drizzle.from).toBeGreaterThanOrEqual(150);
      expect(w.drizzle.to).toBeLessThan(1000);
    }
  });

  it('can be asked for, for trying things out', () => {
    expect(planWeather(HALLAM.seed, 1, 'mist')).toMatchObject({ mist: 1, drizzle: null });
    expect(planWeather(HALLAM.seed, 1, 'drizzle')).toMatchObject({ mist: 0, drizzle: { from: 0, to: Infinity } });
    expect(planWeather(HALLAM.seed, 1, 'clear')).toMatchObject({ mist: 0, drizzle: null });
  });
});

describe('how the weather looks through the day', () => {
  const misty = { ...planWeather(HALLAM.seed, 1), mist: 0.8, nextMist: 0.8, drizzle: { from: 200, to: 500 } };

  it('lies misty over the morning, and the mist lifts after casting off', () => {
    expect(weatherAt(at('morning', 400), misty).mist).toBeCloseTo(0.8);
    expect(weatherAt(at('underway', 0), misty).mist).toBeCloseTo(0.8);
    expect(weatherAt(at('underway', MIST_LIFT / 2), misty).mist).toBeCloseTo(0.4);
    expect(weatherAt(at('underway', MIST_LIFT), misty).mist).toBe(0);
    for (const phase of ['dusk', 'tying-up', 'evening', 'night'] as const) expect(weatherAt(at(phase, 10), misty).mist).toBe(0);
  });

  it('gathers again at dawn, ready for the next morning', () => {
    expect(weatherAt(at('dawn', 0), misty).mist).toBe(0);
    expect(weatherAt(at('dawn', 30), misty).mist).toBeCloseTo(0.8);
    expect(weatherAt(at('over', 0), misty).mist).toBeCloseTo(0.8);
  });

  it('drizzles only through the spell, coming on and clearing gently', () => {
    const wet = (t: number) => weatherAt(at('underway', t), misty).drizzle;
    expect(wet(150)).toBe(0);
    expect(wet(200 + DRIZZLE_FADE / 2)).toBeCloseTo(0.5);
    expect(wet(350)).toBe(1);
    expect(wet(500 - DRIZZLE_FADE / 2)).toBeCloseTo(0.5);
    expect(wet(520)).toBe(0);
    expect(weatherAt(at('morning', 350), misty).drizzle).toBe(0);
    expect(weatherAt(at('dusk', 10), misty).drizzle).toBe(0);
  });

  it('clears gently from where it was when the boat arrives part way through a spell', () => {
    const arrivedAfter = (underway: number, since: number, phase: DayPhase = 'dusk'): Day => {
      const day = at(phase, since);
      day.log.entries.push({ kind: 'set-out', at: 100, from: 'here', along: 'canal' });
      day.log.waiting.dusk = 100 + underway;
      day.time = 100 + underway + since;
      return day;
    };
    expect(weatherAt(arrivedAfter(350, 0), misty).drizzle).toBe(1);
    expect(weatherAt(arrivedAfter(350, DRIZZLE_FADE / 2), misty).drizzle).toBeCloseTo(0.5);
    expect(weatherAt(arrivedAfter(350, DRIZZLE_FADE / 2, 'tying-up'), misty).drizzle).toBeCloseTo(0.5);
    expect(weatherAt(arrivedAfter(350, DRIZZLE_FADE / 2, 'evening'), misty).drizzle).toBeCloseTo(0.5);
    expect(weatherAt(arrivedAfter(350, DRIZZLE_FADE), misty).drizzle).toBe(0);
    expect(weatherAt(arrivedAfter(200 + DRIZZLE_FADE / 2, 0), misty).drizzle).toBeCloseTo(0.5);
    expect(weatherAt(arrivedAfter(150, 0), misty).drizzle).toBe(0);
  });

  it('keeps drizzling to the evening when asked to drizzle all day', () => {
    const wet = planWeather(HALLAM.seed, 1, 'drizzle');
    expect(weatherAt(at('underway', 10), wet).drizzle).toBeGreaterThan(0);
    expect(weatherAt(at('underway', 3000), wet).drizzle).toBe(1);
    expect(weatherAt(at('dusk', 10), wet).drizzle).toBe(1);
    expect(weatherAt(at('evening', 60), wet).drizzle).toBe(0);
  });

  it('gathers at dawn as thick as the next morning, so starting the next day keeps the same mist', () => {
    for (const asked of [null, 'mist', 'clear'] as const) {
      for (let n = 1; n <= 40; n++) {
        const today = planWeather(HALLAM.seed, n, asked);
        const tomorrow = planWeather(HALLAM.seed, n + 1, asked);
        const next = { ...newDay(plan, { number: n + 1 }), phase: 'morning' as const };
        expect(weatherAt(at('dawn', DAWN_TIME), today).mist).toBeCloseTo(weatherAt(next, tomorrow).mist);
        expect(weatherAt(at('over', 0), today).mist).toBe(weatherAt(next, tomorrow).mist);
        castOffDay(next);
        expect(weatherAt(next, tomorrow).mist).toBe(weatherAt(at('over', 0), today).mist);
      }
    }
  });

  it('stays between 0 and 1 through a whole day', () => {
    const day = newDay(plan, { other: 'down', crewed: true });
    const weather = { ...misty, mist: 1 };
    while (day.phase !== 'over' && day.time < 4 * 3600) {
      for (const e of stepDay(day, plan, NO_CONTROLS, 0.5)) {
        if (e.kind !== 'call' || e.again) continue;
        if (e.call === 'cast-off') castOffDay(day);
        if (e.call === 'junction') chooseWay(day, plan, 'arm');
        if (e.call === 'dusk') chooseSpot(day, 0);
      }
      const now = weatherAt(day, weather);
      for (const v of [now.mist, now.drizzle]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(day.phase).toBe('over');
  });
});

describe('the clouds going over', () => {
  const clouds = planClouds(HALLAM.seed);
  const weather = planWeather(HALLAM.seed, 1);

  it('are the same every day for the same seed', () => {
    expect(planClouds(HALLAM.seed)).toEqual(clouds);
    expect(clouds.length).toBeGreaterThan(0);
  });

  it('drift with the wind, at its speed', () => {
    const near = [2000, 1500] as const;
    const [x0, y0] = cloudAt(clouds[0], weather, 100, near);
    const [x1, y1] = cloudAt(clouds[0], weather, 101, near);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(weather.windSpeed, 5);
    expect(Math.atan2(y1 - y0, x1 - x0)).toBeCloseTo(Math.atan2(Math.sin(weather.wind), Math.cos(weather.wind)), 5);
  });

  it('always have a copy near wherever you are looking', () => {
    for (const near of [[0, 0], [5600, 3360], [2800, 900]] as const) {
      for (const time of [0, 500, 5000]) {
        const [x, y] = cloudAt(clouds[1], weather, time, near);
        expect(Math.abs(x - near[0])).toBeLessThanOrEqual(SKY_REPEAT / 2);
        expect(Math.abs(y - near[1])).toBeLessThanOrEqual(SKY_REPEAT / 2);
      }
    }
  });
});
