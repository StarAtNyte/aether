/**
 * Bounded waits for user-facing transitions: navigation must never hang on a
 * best-effort task (a thumbnail capture of a heavy world on a slow GPU).
 */
/**
 * Wait for `task`, but at most `ms` milliseconds. Resolves `true` when the
 * task settled in time (either way), `false` on timeout. Never rejects; the
 * task keeps running after a timeout.
 */
export function settleWithin(task, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), Math.max(0, ms));
        const done = () => {
            clearTimeout(timer);
            resolve(true);
        };
        task.then(done, done);
    });
}
