/**
 * Clear a render target once after it is allocated (pure apart from the renderer calls, unit-tested with a fake).
 *
 * A target the first frame samples before anything drew into it (the water's scene copy and planar reflection) is
 * allocated lazily by the driver. Firefox clears such a texture on the first sampling and says "incurring lazy
 * initialization" on every draw that does; clearing it ourselves once, right after (re)allocation, leaves nothing to
 * warn about. Resizing a target reallocates it, so the size is part of what was primed.
 */
export interface ClearableRenderer {
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): unknown;
}

/** A render target as far as priming needs it. */
export interface PrimeableTarget {
  width: number;
  height: number;
}

const primed = new WeakMap<object, string>();

/** True when `target` still needs a clear (never primed, or reallocated at another size since). */
export function needsPriming(target: PrimeableTarget): boolean {
  return primed.get(target) !== `${target.width}x${target.height}`;
}

/** Clear `target` if {@link needsPriming}; restores the renderer's target. Never throws. Returns true when it cleared. */
export function primeTarget(renderer: ClearableRenderer, target: PrimeableTarget): boolean {
  if (!needsPriming(target)) return false;
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    const pending = renderer.clear(true, true, false);
    if (pending && typeof (pending as Promise<unknown>).catch === 'function') (pending as Promise<unknown>).catch(() => undefined);
    primed.set(target, `${target.width}x${target.height}`);
    return true;
  } catch {
    return false;
  } finally {
    try {
      renderer.setRenderTarget(previous);
    } catch {
      /* the renderer is going away */
    }
  }
}
