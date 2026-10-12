/**
 * Minimal typed event bus.
 *
 * - Listeners are invoked in subscription order on a snapshot, so (un)subscribing
 *   during `emit` is safe.
 * - A throwing listener does not prevent the others from running; the first
 *   error is re-thrown after every listener has been called.
 */
export class Emitter<E extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof E, Set<(e: never) => void>>();

  /** Subscribe to `k`. Returns an idempotent unsubscribe function. */
  on<K extends keyof E>(k: K, fn: (e: E[K]) => void): () => void {
    let set = this.listeners.get(k);
    if (!set) {
      set = new Set();
      this.listeners.set(k, set);
    }
    set.add(fn as (e: never) => void);
    return () => {
      const s = this.listeners.get(k);
      if (!s) return;
      s.delete(fn as (e: never) => void);
      if (s.size === 0) this.listeners.delete(k);
    };
  }

  /** Deliver `e` to every listener of `k`. */
  emit<K extends keyof E>(k: K, e: E[K]): void {
    const set = this.listeners.get(k);
    if (!set || set.size === 0) return;
    let firstError: unknown;
    let failed = false;
    for (const fn of [...set] as Array<(e: E[K]) => void>) {
      try {
        fn(e);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
    if (failed) throw firstError;
  }

  /** Number of listeners for `k` (diagnostics / leak tests). */
  listenerCount<K extends keyof E>(k: K): number {
    return this.listeners.get(k)?.size ?? 0;
  }

  /** Remove every listener. */
  clear(): void {
    this.listeners.clear();
  }
}
