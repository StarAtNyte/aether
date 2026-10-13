/**
 * Script sandbox options and module-wide budgets. Kept apart from the runner
 * so importing them (or the package index) never pulls in QuickJS: the WASM
 * engine is loaded only when a world actually runs or validates a script.
 */
import type { ScriptDiagnostic, ScriptRunner } from '../types';

/** Options for {@link createScriptRunner}. */
export interface ScriptRunnerOptions {
  /** Wall-clock budget per update call in ms (default 2). */
  budgetMs?: number;
  /** Budget for compiling/loading a script in ms (default 50). */
  loadBudgetMs?: number;
  /** Heap limit per script runtime in bytes (default 8 MB). */
  memoryLimitBytes?: number;
  /**
   * Max interpreter stack per script runtime in bytes (default 128 KB, capped
   * at 256 KB: larger values let deep recursion exhaust the host WASM stack
   * before QuickJS can raise a catchable stack-overflow error).
   */
  maxStackBytes?: number;
  /** Overruns before a script is disabled (default 3). */
  maxOverruns?: number;
  /** Errors before a script is disabled (default 10). */
  maxErrors?: number;
  /** Seed for the in-sandbox Math.random (default 1). */
  seed?: number;
}

/**
 * Sum of per-script memory limits that may be reserved at once on one WASM
 * module (all QuickJS runtimes share its heap). Bounds a hostile world to
 * ~128 MB instead of MAX_SCRIPTS × the per-script limit.
 */
export const SCRIPT_HEAP_BUDGET_BYTES = 128 * 1024 * 1024;
/** Abandoned (unfreeable) runtimes tolerated before a fresh WASM module is loaded. */
export const MAX_ABANDONED_RUNTIMES = 4;

/** A {@link ScriptRunner} with extra management methods. */
export interface ManagedScriptRunner extends ScriptRunner {
  takeDiagnostics(): ScriptDiagnostic[];
  activeScripts(): string[];
  unload(scriptId: string): void;
}

