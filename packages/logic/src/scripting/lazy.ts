/**
 * Lazy entry point of the script sandbox. QuickJS (its JavaScript glue and
 * a ~500 KB WASM module that compiles to several MB) is imported only by
 * {@link initScripting}, i.e. the first time a world with scripts is played,
 * verified or validated. Worlds without scripts never load it.
 */
import type { ManagedScriptRunner, ScriptRunnerOptions } from './config';

type RunnerModule = typeof import('./runner');

let runner: RunnerModule | undefined;
let importing: Promise<RunnerModule> | undefined;

/**
 * Load the sandbox (idempotent; concurrent calls share one load). Must
 * resolve before {@link createScriptRunner}. A failed load can be retried.
 */
export async function initScripting(): Promise<void> {
  if (!runner) {
    importing ??= import('./runner');
    try {
      runner = await importing;
    } finally {
      importing = undefined;
    }
  }
  await runner.initScripting();
}

/** True once {@link initScripting} resolved. */
export function isScriptingReady(): boolean {
  return runner?.isScriptingReady() ?? false;
}

/**
 * Create a QuickJS-backed script runner. Requires `await initScripting()`
 * first; throws a descriptive error otherwise.
 */
export function createScriptRunner(opts: ScriptRunnerOptions = {}): ManagedScriptRunner {
  if (!runner) {
    throw new Error('@aether/logic: scripting is not initialized — call `await initScripting()` before createScriptRunner()');
  }
  return runner.createScriptRunner(opts);
}

/** Heap reservation of the current QuickJS module (zero before it is loaded). */
export function scriptHeapUsage(): { reservedBytes: number; abandonedRuntimes: number } {
  return runner?.scriptHeapUsage() ?? { reservedBytes: 0, abandonedRuntimes: 0 };
}
