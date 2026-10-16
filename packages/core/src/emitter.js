/**
 * Minimal typed event bus.
 *
 * - Listeners are invoked in subscription order on a snapshot, so (un)subscribing
 *   during `emit` is safe.
 * - A throwing listener does not prevent the others from running; the first
 *   error is re-thrown after every listener has been called.
 */
export class Emitter {
    listeners = new Map();
    /** Subscribe to `k`. Returns an idempotent unsubscribe function. */
    on(k, fn) {
        let set = this.listeners.get(k);
        if (!set) {
            set = new Set();
            this.listeners.set(k, set);
        }
        set.add(fn);
        return () => {
            const s = this.listeners.get(k);
            if (!s)
                return;
            s.delete(fn);
            if (s.size === 0)
                this.listeners.delete(k);
        };
    }
    /** Deliver `e` to every listener of `k`. */
    emit(k, e) {
        const set = this.listeners.get(k);
        if (!set || set.size === 0)
            return;
        let firstError;
        let failed = false;
        for (const fn of [...set]) {
            try {
                fn(e);
            }
            catch (err) {
                if (!failed) {
                    failed = true;
                    firstError = err;
                }
            }
        }
        if (failed)
            throw firstError;
    }
    /** Number of listeners for `k` (diagnostics / leak tests). */
    listenerCount(k) {
        return this.listeners.get(k)?.size ?? 0;
    }
    /** Remove every listener. */
    clear() {
        this.listeners.clear();
    }
}
