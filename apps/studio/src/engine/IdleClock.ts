/**
 * Tracks user activity for the edit-mode render loop. After
 * {@link IDLE_PAUSE_MS} without input the self-animating environment
 * (weather particles) stops redrawing, so an untouched editor costs no GPU
 * time; any input, edit or agent step wakes it. Pure (time is passed in).
 */

/** Edit-mode inactivity after which animated environments stop redrawing (ms). */
export const IDLE_PAUSE_MS = 30_000;

/** Activity clock. */
export class IdleClock {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly thresholdMs = IDLE_PAUSE_MS) {}

  /** Record activity at `now` (ms). */
  touch(now: number): void {
    if (Number.isFinite(now) && now > this.last) this.last = now;
  }

  /** True when nothing happened for longer than the threshold (and something ever happened). */
  idle(now: number): boolean {
    return Number.isFinite(this.last) && now - this.last > this.thresholdMs;
  }
}
