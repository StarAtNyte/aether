/**
 * Fixed-timestep accumulator ("fix your timestep"): converts variable frame
 * deltas into a whole number of fixed simulation steps, with a stall clamp
 * and a substep cap (spiral-of-death guard). Pure and allocation-free.
 */
export class FixedStepper {
  private acc = 0;

  /**
   * @param dt fixed step in seconds
   * @param maxSubsteps most steps returned per frame; surplus time is dropped
   * @param maxFrameDt largest frame delta accepted (longer stalls are clamped)
   */
  constructor(
    readonly dt: number,
    readonly maxSubsteps: number,
    readonly maxFrameDt: number,
  ) {
    if (!(dt > 0) || !Number.isFinite(dt)) throw new RangeError('FixedStepper: dt must be a positive number');
  }

  /** Feed a frame delta (seconds); returns how many fixed steps to run now. */
  advance(frameDt: number): number {
    const d = Number.isFinite(frameDt) && frameDt > 0 ? Math.min(frameDt, this.maxFrameDt) : 0;
    this.acc += d;
    let steps = Math.floor(this.acc / this.dt + 1e-9);
    if (steps > this.maxSubsteps) {
      steps = this.maxSubsteps;
      // Drop the backlog instead of trying to catch up forever.
      this.acc = 0;
      return steps;
    }
    this.acc -= steps * this.dt;
    if (this.acc < 0) this.acc = 0;
    return steps;
  }

  /** Leftover fraction of a step (0..1) for render interpolation. */
  get alpha(): number {
    return Math.min(1, this.acc / this.dt);
  }

  /** Clear accumulated time. */
  reset(): void {
    this.acc = 0;
  }
}
