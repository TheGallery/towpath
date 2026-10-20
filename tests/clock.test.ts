import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/core/clock';

describe('FixedStepClock', () => {
  it('starts on the first call without running any steps', () => {
    const clock = new FixedStepClock(0.1, 60);
    expect(clock.advance(1000)).toBe(0);
  });

  it('runs one step per step of real time passed', () => {
    const clock = new FixedStepClock(0.1, 60);
    clock.advance(0);
    expect(clock.advance(1000)).toBe(10);
  });

  it('carries leftover time into the next call', () => {
    const clock = new FixedStepClock(0.1, 60);
    clock.advance(0);
    expect(clock.advance(250)).toBe(2);
    expect(clock.advance(300)).toBe(1);
  });

  it('keeps time the same whether called often or rarely, as when a tab is hidden', () => {
    const often = new FixedStepClock(1 / 30, 600);
    const rarely = new FixedStepClock(1 / 30, 600);
    often.advance(0);
    rarely.advance(0);
    let steps = 0;
    for (let t = 16; t <= 60_000; t += 16) steps += often.advance(t);
    steps += often.advance(60_000);
    expect(steps).toBe(rarely.advance(60_000));
    expect(steps).toBe(1800);
  });

  it('speeds the game up by the rate', () => {
    const clock = new FixedStepClock(0.1, 600);
    clock.advance(0);
    expect(clock.advance(1000, 20)).toBe(200);
  });

  it('catches up on at most its limit after a long sleep', () => {
    const clock = new FixedStepClock(1, 600);
    clock.advance(0);
    expect(clock.advance(5 * 60 * 60 * 1000)).toBe(600);
  });

  it('ignores time going backwards', () => {
    const clock = new FixedStepClock(0.1, 60);
    clock.advance(5000);
    expect(clock.advance(1000)).toBe(0);
    expect(clock.advance(1500)).toBe(5);
  });
});
