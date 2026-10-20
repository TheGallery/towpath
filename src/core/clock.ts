// The game keeps time by the wall clock, not by screen refreshes. Each call
// says how much real time has passed, and the game catches up in fixed steps,
// so it runs the same whether the tab is visible, hidden or slow.

export class FixedStepClock {
  private last: number | null = null;
  private carry = 0;

  /**
   * @param step seconds of game time per step
   * @param maxCatchUp the most game time one call will catch up on, so a long
   *   sleep cannot freeze the page
   */
  constructor(
    readonly step: number,
    readonly maxCatchUp: number,
  ) {}

  /** How many steps to run for the time since the last call; `rate` speeds the game up. */
  advance(nowMs: number, rate = 1): number {
    if (this.last === null) {
      this.last = nowMs;
      return 0;
    }
    const elapsed = (Math.max(0, nowMs - this.last) / 1000) * rate;
    this.last = nowMs;
    this.carry = Math.min(this.carry + elapsed, this.maxCatchUp);
    const steps = Math.floor(this.carry / this.step + 1e-9);
    this.carry = Math.max(0, this.carry - steps * this.step);
    return steps;
  }
}
