/**
 * Sandboxed custom behavior scripts (SECURITY CRITICAL).
 *
 * Scripts written by the coding model run inside QuickJS compiled to
 * WebAssembly (quickjs-emscripten, MIT) — a separate JavaScript engine with its
 * own heap. Nothing from the host realm is reachable from a script:
 *
 * - no host functions are exposed; data crosses the boundary only as JSON
 *   strings (snapshot in, intents out) and is re-validated on the host side;
 * - one QuickJS runtime per script with a memory limit, a stack limit and an
 *   interrupt handler enforcing a wall-clock budget per call (and per load);
 * - Date, Promise, Proxy and RegExp intrinsics are disabled, `eval` and the
 *   Function constructors are replaced by throwing stubs, and Math.random is
 *   replaced by a seeded PRNG so scripts stay deterministic;
 * - a script that overruns its budget 3 times (or errors repeatedly) is disabled;
 * - every QuickJS handle is disposed (leaks abort the WASM runtime);
 * - all runtimes share one WASM heap, so a module-wide budget caps the sum of
 *   per-script memory limits (abandoned runtimes keep their reservation), and
 *   after too many abandoned runtimes a fresh WASM module is loaded so the
 *   leaked memory is reclaimed with the old one.
 *
 * Usage: `await initScripting()` once (loads the WASM module), then
 * `createScriptRunner()` synchronously. Hosts normally reach this module
 * through `./lazy`, which imports it (and QuickJS) only on first use.
 */
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { hashString, ScriptDef } from '@aether/core';
import { validateIntents } from './intents';
import { MAX_ABANDONED_RUNTIMES, SCRIPT_HEAP_BUDGET_BYTES } from './config';
export { MAX_ABANDONED_RUNTIMES, SCRIPT_HEAP_BUDGET_BYTES };
const DEFAULTS = {
    budgetMs: 2,
    loadBudgetMs: 50,
    memoryLimitBytes: 8 * 1024 * 1024,
    maxStackBytes: 128 * 1024,
    maxOverruns: 3,
    maxErrors: 10,
    seed: 1,
};
/** Max serialized snapshot size handed to a script. */
const MAX_SNAPSHOT_CHARS = 256 * 1024;
/** Max serialized output accepted from a script. */
const MAX_OUTPUT_CHARS = 64 * 1024;
/** Hard cap for the interpreter stack (see {@link ScriptRunnerOptions.maxStackBytes}). */
const MAX_STACK_BYTES = 256 * 1024;
/** Max diagnostics kept between drains. */
const MAX_DIAGNOSTICS = 200;
/** Name of the frozen entry point inside the sandbox. */
const ENTRY = '__aetherRun';
const budgets = new WeakMap();
function budgetOf(m) {
    let b = budgets.get(m);
    if (!b)
        budgets.set(m, (b = { reserved: 0, abandoned: 0 }));
    return b;
}
let wasmModule;
let loading;
/**
 * Load the one QuickJS variant the sandbox uses (release build, synchronous
 * API). It is imported directly, so the bundle ships exactly one QuickJS
 * WASM file and no other variant can ever be fetched.
 */
function loadModule() {
    return newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
}
/** Load the QuickJS WebAssembly module (idempotent). Must resolve before {@link createScriptRunner}. */
export async function initScripting() {
    if (wasmModule)
        return;
    loading ??= loadModule();
    try {
        wasmModule = await loading;
    }
    catch (err) {
        loading = undefined;
        throw err;
    }
    finally {
        if (wasmModule)
            loading = undefined;
    }
}
/**
 * Replace the shared module once it holds too many abandoned runtimes. Existing
 * runners keep using the old module until disposed; new runners get the fresh
 * one, and the old heap is garbage-collected with its last runner.
 */
function retireModule(old) {
    if (wasmModule !== old || loading)
        return;
    loading = loadModule();
    loading.then((fresh) => {
        if (wasmModule === old)
            wasmModule = fresh;
        loading = undefined;
    }, () => {
        loading = undefined;
    });
}
/** Heap reservation of the current module (diagnostics/tests). */
export function scriptHeapUsage() {
    const b = wasmModule ? budgetOf(wasmModule) : { reserved: 0, abandoned: 0 };
    return { reservedBytes: b.reserved, abandonedRuntimes: b.abandoned };
}
/** True once {@link initScripting} has completed. */
export function isScriptingReady() {
    return wasmModule !== undefined;
}
const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
/**
 * JSON of a script snapshot. With `worldJson` (the runtime's once-per-tick
 * serialization of `snap.world`), only the small per-entity part is
 * serialized and the world state is spliced in, so N script calls per tick
 * no longer serialize the world state N times.
 */
export function serializeSnapshot(snap, worldJson) {
    if (typeof worldJson !== 'string' || worldJson.length === 0)
        return JSON.stringify(snap);
    const { world: _world, ...rest } = snap;
    const head = JSON.stringify(rest);
    // `rest` always has keys (dt, time, …), so `head` is "{…}" and a comma is valid.
    return `${head.slice(0, -1)},"world":${worldJson}}`;
}
/** Build the sandbox program for a script body. */
function buildProgram(body, seed) {
    // The body is placed inside a function; even if it closes the function early,
    // whatever it does still runs inside the sandbox and its output is validated.
    return `"use strict";
(function () {
  var s = ${seed >>> 0};
  var rand = function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(Math, 'random', { value: rand, writable: false, configurable: false });
  var blocked = function () { throw new TypeError('dynamic code evaluation is disabled'); };
  Object.defineProperty(globalThis, 'eval', { value: blocked, writable: false, configurable: false });
  Object.defineProperty(globalThis, 'Function', { value: blocked, writable: false, configurable: false });
  var samples = [function () {}, function* () {}];
  for (var i = 0; i < samples.length; i++) {
    Object.defineProperty(Object.getPrototypeOf(samples[i]), 'constructor', { value: blocked, writable: false, configurable: false });
  }
  var parse = JSON.parse, stringify = JSON.stringify;
  var update = function update(ctx) {
${body}
  };
  Object.defineProperty(globalThis, '${ENTRY}', {
    value: function (json) {
      var out = update(parse(json));
      return stringify(out === undefined ? [] : out);
    },
    writable: false, configurable: false, enumerable: false
  });
})();`;
}
function disposeSlot(slot) {
    try {
        if (slot.entry?.alive)
            slot.entry.dispose();
    }
    catch {
        /* already gone */
    }
    slot.entry = undefined;
    try {
        if (slot.context.alive)
            slot.context.dispose();
    }
    catch {
        /* already gone */
    }
    try {
        if (slot.runtime.alive)
            slot.runtime.dispose();
    }
    catch {
        /* already gone */
    }
}
function isInterrupt(message) {
    return /interrupted/i.test(message);
}
function isOutOfMemory(message) {
    return /out of memory|memory limit/i.test(message);
}
function errorMessage(dumped) {
    if (dumped && typeof dumped === 'object') {
        const o = dumped;
        const name = typeof o['name'] === 'string' ? o['name'] : 'Error';
        const msg = typeof o['message'] === 'string' ? o['message'] : JSON.stringify(dumped);
        return `${name}: ${msg}`.slice(0, 300);
    }
    return String(dumped).slice(0, 300);
}
class QuickJSScriptRunner {
    wasm;
    slots = new Map();
    abandoned = new WeakSet();
    diagnostics = [];
    opts;
    disposed = false;
    budget;
    constructor(wasm, opts) {
        this.wasm = wasm;
        this.budget = budgetOf(wasm);
        this.opts = {
            budgetMs: positive(opts.budgetMs, DEFAULTS.budgetMs),
            loadBudgetMs: positive(opts.loadBudgetMs, DEFAULTS.loadBudgetMs),
            memoryLimitBytes: positive(opts.memoryLimitBytes, DEFAULTS.memoryLimitBytes),
            maxStackBytes: Math.min(positive(opts.maxStackBytes, DEFAULTS.maxStackBytes), MAX_STACK_BYTES),
            maxOverruns: positive(opts.maxOverruns, DEFAULTS.maxOverruns),
            maxErrors: positive(opts.maxErrors, DEFAULTS.maxErrors),
            seed: Number.isFinite(opts.seed) ? opts.seed : DEFAULTS.seed,
        };
    }
    report(scriptId, text, entityId) {
        if (this.diagnostics.length >= MAX_DIAGNOSTICS)
            this.diagnostics.shift();
        this.diagnostics.push(entityId === undefined ? { scriptId, text } : { scriptId, entityId, text });
    }
    load(def) {
        if (this.disposed)
            throw new Error('ScriptRunner has been disposed');
        const parsed = ScriptDef.safeParse(def);
        if (!parsed.success) {
            const id = typeof def.id === 'string' ? String(def.id).slice(0, 64) : '?';
            this.report(id, `script rejected: ${parsed.error.issues[0]?.message ?? 'invalid definition'}`);
            return;
        }
        const valid = parsed.data;
        const existing = this.slots.get(valid.id);
        if (existing && existing.def.source === valid.source)
            return;
        if (existing) {
            this.freeSlot(existing);
            this.slots.delete(valid.id);
        }
        const limit = this.opts.memoryLimitBytes;
        if (this.budget.reserved + limit > SCRIPT_HEAP_BUDGET_BYTES) {
            this.report(valid.id, `script '${valid.id}' not loaded: script memory budget exhausted (${Math.round(SCRIPT_HEAP_BUDGET_BYTES / 1048576)} MB across all scripts)`);
            return;
        }
        this.budget.reserved += limit;
        const runtime = this.wasm.newRuntime();
        runtime.setMemoryLimit(this.opts.memoryLimitBytes);
        runtime.setMaxStackSize(this.opts.maxStackBytes);
        const context = runtime.newContext({
            intrinsics: {
                BaseObjects: true,
                JSON: true,
                MapSet: true,
                TypedArrays: true,
                StringNormalize: true,
                Date: false,
                // Required by the host to compile the script; `eval`/`Function` are
                // then removed inside the sandbox by the prelude.
                Eval: true,
                RegExp: false,
                Proxy: false,
                Promise: false,
            },
        });
        const slot = { def: valid, reservedBytes: limit, runtime, context, entry: undefined, deadline: Infinity, overruns: 0, errors: 0, disabled: false };
        runtime.setInterruptHandler(() => now() > slot.deadline);
        this.slots.set(valid.id, slot);
        slot.deadline = now() + this.opts.loadBudgetMs;
        let result;
        try {
            result = context.evalCode(buildProgram(valid.source, hashString(valid.id) ^ (this.opts.seed >>> 0)), `script:${valid.id}`);
        }
        catch (err) {
            this.abandon(slot, `failed to load: ${String(err).slice(0, 200)}`);
            return;
        }
        finally {
            slot.deadline = Infinity;
        }
        if (result.error) {
            const msg = errorMessage(context.dump(result.error));
            result.error.dispose();
            this.disable(slot, `failed to load: ${isInterrupt(msg) ? `took longer than ${this.opts.loadBudgetMs}ms` : msg}`);
            return;
        }
        result.value.dispose();
        const entry = context.getProp(context.global, ENTRY);
        if (context.typeof(entry) !== 'function') {
            entry.dispose();
            this.disable(slot, 'failed to load: entry point missing');
            return;
        }
        slot.entry = entry;
    }
    disable(slot, why, entityId) {
        slot.disabled = true;
        this.report(slot.def.id, `script '${slot.def.id}' disabled: ${why}`, entityId);
        // Free interpreter memory right away; the slot stays as a tombstone so the
        // same broken source is not recompiled every tick.
        this.freeSlot(slot);
    }
    /** Dispose a slot's interpreter and return its reservation (no-op for abandoned slots). */
    freeSlot(slot) {
        if (this.abandoned.has(slot))
            return;
        disposeSlot(slot);
        this.budget.reserved = Math.max(0, this.budget.reserved - slot.reservedBytes);
        slot.reservedBytes = 0;
    }
    /**
     * Disable a slot whose interpreter may be corrupted. Its handles are
     * deliberately not freed: freeing a corrupted QuickJS runtime aborts the
     * whole WASM module. The memory is reclaimed with the module.
     */
    abandon(slot, why, entityId) {
        slot.disabled = true;
        slot.entry = undefined;
        if (this.abandoned.has(slot))
            return;
        this.abandoned.add(slot);
        this.report(slot.def.id, `script '${slot.def.id}' disabled: ${why}`, entityId);
        // The reservation stays: its memory is only reclaimed with the module.
        this.budget.abandoned++;
        if (this.budget.abandoned > MAX_ABANDONED_RUNTIMES)
            retireModule(this.wasm);
    }
    update(scriptId, entityId, snap, prepared) {
        if (this.disposed)
            return [];
        const slot = this.slots.get(scriptId);
        if (!slot || slot.disabled || !slot.entry)
            return [];
        let json;
        try {
            json = serializeSnapshot(snap, prepared?.worldJson);
        }
        catch {
            this.report(scriptId, 'snapshot could not be serialized', entityId);
            return [];
        }
        if (json.length > MAX_SNAPSHOT_CHARS) {
            this.report(scriptId, `snapshot too large (${json.length} chars)`, entityId);
            return [];
        }
        const { context } = slot;
        const arg = context.newString(json);
        slot.deadline = now() + this.opts.budgetMs;
        let result;
        try {
            result = context.callFunction(slot.entry, context.undefined, arg);
        }
        catch (err) {
            // A host-level failure (e.g. WASM stack exhaustion) leaves the interpreter
            // in an undefined state: never touch it again.
            this.abandon(slot, `crashed: ${String(err).slice(0, 200)}`, entityId);
            return [];
        }
        finally {
            slot.deadline = Infinity;
        }
        arg.dispose();
        if (result.error) {
            const msg = errorMessage(context.dump(result.error));
            result.error.dispose();
            if (isInterrupt(msg)) {
                slot.overruns++;
                this.report(scriptId, `exceeded ${this.opts.budgetMs}ms budget (${slot.overruns}/${this.opts.maxOverruns})`, entityId);
                if (slot.overruns >= this.opts.maxOverruns)
                    this.disable(slot, `exceeded its time budget ${slot.overruns} times`, entityId);
            }
            else if (isOutOfMemory(msg)) {
                this.disable(slot, `out of memory (${msg})`, entityId);
            }
            else {
                slot.errors++;
                this.report(scriptId, `error: ${msg}`, entityId);
                if (slot.errors >= this.opts.maxErrors)
                    this.disable(slot, `${slot.errors} errors`, entityId);
            }
            return [];
        }
        const out = context.typeof(result.value) === 'string' ? context.getString(result.value) : undefined;
        result.value.dispose();
        if (out === undefined)
            return [];
        if (out.length > MAX_OUTPUT_CHARS) {
            this.report(scriptId, `output too large (${out.length} chars)`, entityId);
            return [];
        }
        let parsed;
        try {
            parsed = JSON.parse(out);
        }
        catch {
            this.report(scriptId, 'output is not valid JSON', entityId);
            return [];
        }
        const { intents, problems } = validateIntents(parsed);
        for (const p of problems)
            this.report(scriptId, p, entityId);
        return intents;
    }
    takeDiagnostics() {
        const out = this.diagnostics;
        this.diagnostics = [];
        return out;
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        for (const slot of this.slots.values())
            this.freeSlot(slot);
        this.slots.clear();
        this.diagnostics = [];
    }
    /** Script ids currently loaded and enabled. */
    activeScripts() {
        const out = [];
        for (const [id, s] of this.slots)
            if (!s.disabled)
                out.push(id);
        return out;
    }
    /** Remove a script (frees its interpreter). */
    unload(scriptId) {
        const slot = this.slots.get(scriptId);
        if (!slot)
            return;
        this.freeSlot(slot);
        this.slots.delete(scriptId);
    }
}
function positive(v, def) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : def;
}
/**
 * Create a QuickJS-backed script runner. Requires `await initScripting()`
 * first; throws a descriptive error otherwise.
 */
export function createScriptRunner(opts = {}) {
    if (!wasmModule) {
        throw new Error('@aether/logic: scripting is not initialized — call `await initScripting()` before createScriptRunner()');
    }
    return new QuickJSScriptRunner(wasmModule, opts);
}
