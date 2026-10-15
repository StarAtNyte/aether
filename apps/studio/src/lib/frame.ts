/**
 * Frame alignment for GPU captures. A capture (agent critique views,
 * screenshots) draws the scene again, which can take a long time on a slow
 * GPU (pipeline compilation for the capture target). Started straight from
 * a promise chain it runs inside whatever task resolved that chain (a
 * worker message, a timer), stretching that task; started from an
 * animation frame it runs with the frame's own rendering work instead.
 */

/** Longest wait for a frame before giving up (hidden tabs deliver none; a slow GPU may draw only a few frames a second). */
export const FRAME_FALLBACK_MS = 1000;

/** Platform hooks (injectable for tests). */
export interface FrameScheduler {
  requestAnimationFrame?: (cb: () => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

function platform(): FrameScheduler {
  const g = globalThis as Partial<FrameScheduler> & typeof globalThis;
  return {
    ...(typeof g.requestAnimationFrame === 'function' ? { requestAnimationFrame: (cb: () => void) => g.requestAnimationFrame(cb) } : {}),
    ...(typeof g.cancelAnimationFrame === 'function' ? { cancelAnimationFrame: (id: number) => g.cancelAnimationFrame(id) } : {}),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

/**
 * Resolve inside the next animation frame callback, so the caller's
 * continuation (a microtask of that callback) runs as frame work; falls
 * back to a timer after `fallbackMs` when no frame comes (hidden tab, no
 * `requestAnimationFrame`). Never rejects.
 */
export function nextFrame(fallbackMs = FRAME_FALLBACK_MS, sched: FrameScheduler = platform()): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let raf = -1;
    let timer: unknown = null;
    const finish = (fromFrame: boolean): void => {
      if (done) return;
      done = true;
      if (timer !== null) sched.clearTimeout(timer);
      if (!fromFrame && raf >= 0) sched.cancelAnimationFrame?.(raf);
      resolve();
    };
    timer = sched.setTimeout(() => finish(false), Math.max(0, fallbackMs));
    if (sched.requestAnimationFrame) raf = sched.requestAnimationFrame(() => finish(true));
  });
}

/**
 * Run `fn` in the next animation frame (a zero-delay timer without
 * `requestAnimationFrame`). Returns a cancel function, so an effect can
 * coalesce bursts of updates into one run per frame.
 */
export function onNextFrame(fn: () => void, sched: FrameScheduler = platform()): () => void {
  if (sched.requestAnimationFrame) {
    const id = sched.requestAnimationFrame(fn);
    return () => sched.cancelAnimationFrame?.(id);
  }
  const t = sched.setTimeout(fn, 0);
  return () => sched.clearTimeout(t);
}
