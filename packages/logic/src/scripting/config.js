/**
 * Sum of per-script memory limits that may be reserved at once on one WASM
 * module (all QuickJS runtimes share its heap). Bounds a hostile world to
 * ~128 MB instead of MAX_SCRIPTS × the per-script limit.
 */
export const SCRIPT_HEAP_BUDGET_BYTES = 128 * 1024 * 1024;
/** Abandoned (unfreeable) runtimes tolerated before a fresh WASM module is loaded. */
export const MAX_ABANDONED_RUNTIMES = 4;
