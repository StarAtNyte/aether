/**
 * Per-frame budget of background work on the main thread (docs/ARCHITECTURE-STREAMING.md, section 3.8): render
 * preparation, sliced uploads and mounts of streamed content share a few milliseconds of every frame, so a frame never
 * carries a long task of them.
 *
 * - **moving** (the camera or the player moves): 2 ms a frame;
 * - **rest**: 8 ms a frame;
 * - **loading** (behind the load screen, or while a capture waits for the scene to be ready): 40 ms slices, back to back,
 *   as before the budget existed.
 *
 * The renderer calls {@link FrameBudget.beginFrame} at the start of every animation frame. The page does not draw while
 * nothing changes, so the budget also refills once a frame's worth of time has passed without one.
 */

/** Milliseconds of work per frame (moving, rest) or per slice (loading). */
export const FRAME_BUDGET_MS = Object.freeze({ moving: 2, rest: 8, loading: 40 });
/** Motion keeps the small budget this long after the last moving frame (a drag pauses between pointer events). */
export const MOTION_HOLD_MS = 300;
/** A frame's length when no frame is drawn (the budget refills at this pace). */
const IDLE_FRAME_MS = 1000 / 60;

export type FrameBudgetMode = 'moving' | 'rest' | 'loading';

export class FrameBudget {
  private frameStart: number;
  private spent = 0;
  private movingUntil = -Infinity;
  private loadingScreen = false;
  private urgent = 0;

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.frameStart = clock();
  }

  /** The mode the budget is in now. */
  get mode(): FrameBudgetMode {
    if (this.loadingScreen || this.urgent > 0) return 'loading';
    return this.clock() < this.movingUntil ? 'moving' : 'rest';
  }

  /** Start of an animation frame: the frame's budget refills. `moving`: the view moved in this frame. */
  beginFrame(moving: boolean): void {
    const t = this.clock();
    this.frameStart = t;
    this.spent = 0;
    if (moving) this.movingUntil = t + MOTION_HOLD_MS;
  }

  /** The load screen is up (true) or gone. */
  setLoading(on: boolean): void {
    this.loadingScreen = on;
  }

  /**
   * Work that something waits on to finish (a capture, a still): loading-sized slices until `wait` settles. Returns
   * `wait`.
   */
  hurry<T>(wait: Promise<T>): Promise<T> {
    this.urgent++;
    const done = (): void => {
      this.urgent--;
    };
    wait.then(done, done);
    return wait;
  }

  private refill(): void {
    const t = this.clock();
    if (t - this.frameStart >= IDLE_FRAME_MS) {
      // No frame started for a frame's time (the page draws on demand): a new frame's worth of budget.
      this.frameStart = t - ((t - this.frameStart) % IDLE_FRAME_MS);
      this.spent = 0;
    }
  }

  /** Milliseconds one task may work for now (0: wait for {@link delayMs}). */
  sliceMs(): number {
    const mode = this.mode;
    if (mode === 'loading') return FRAME_BUDGET_MS.loading;
    this.refill();
    return Math.max(0, FRAME_BUDGET_MS[mode] - this.spent);
  }

  /** Account `ms` of work done in this frame. */
  spend(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.spent += ms;
  }

  /** How long to wait before the next slice: 0 while budget is left, else until the next frame's budget. */
  delayMs(): number {
    if (this.sliceMs() > 0) return 0;
    return Math.max(1, Math.ceil(this.frameStart + IDLE_FRAME_MS - this.clock()));
  }
}
