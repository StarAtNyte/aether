let runner;
let importing;
/**
 * Load the sandbox (idempotent; concurrent calls share one load). Must
 * resolve before {@link createScriptRunner}. A failed load can be retried.
 */
export async function initScripting() {
    if (!runner) {
        importing ??= import('./runner');
        try {
            runner = await importing;
        }
        finally {
            importing = undefined;
        }
    }
    await runner.initScripting();
}
/** True once {@link initScripting} resolved. */
export function isScriptingReady() {
    return runner?.isScriptingReady() ?? false;
}
/**
 * Create a QuickJS-backed script runner. Requires `await initScripting()`
 * first; throws a descriptive error otherwise.
 */
export function createScriptRunner(opts = {}) {
    if (!runner) {
        throw new Error('@aether/logic: scripting is not initialized — call `await initScripting()` before createScriptRunner()');
    }
    return runner.createScriptRunner(opts);
}
/** Heap reservation of the current QuickJS module (zero before it is loaded). */
export function scriptHeapUsage() {
    return runner?.scriptHeapUsage() ?? { reservedBytes: 0, abandonedRuntimes: 0 };
}
