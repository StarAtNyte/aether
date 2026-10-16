/**
 * Browser sandbox: a small pool of locked-down module Workers running
 * LLM-written generator bodies. A watchdog terminates (and lazily respawns)
 * any worker that exceeds its time budget; outputs are re-validated on the
 * main thread. Workers have no network/storage/messaging globals.
 */
import { GeneratorDef, inspectUntrusted } from '@aether/core';
import { PROCGEN_LIMITS } from '../limits';
import { resolveParams } from '../params';
import { validateOutput } from '../output';
import { parseWorkerMessage } from './protocol';
import { staticCheckSource } from './static-check';
function defaultWorker() {
    if (typeof Worker === 'undefined')
        throw new Error('Web Workers are not available in this environment; use createNodeSandbox on the server');
    return new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module', name: 'aether-generator-sandbox' });
}
function clamp(v, def, min, max) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    return Math.min(max, Math.max(min, Math.round(n)));
}
/** Validate a run request on the main thread; returns resolved params or throws. */
export function prepareRun(def, params) {
    const parsed = GeneratorDef.safeParse(def);
    if (!parsed.success)
        throw new Error(`invalid generator definition: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`);
    const check = staticCheckSource(parsed.data.source);
    if (!check.ok)
        throw new Error(`generator "${parsed.data.id}" rejected: ${check.problems.join('; ')}`);
    const guard = inspectUntrusted(params ?? {}, { maxDepth: 16, maxNodes: 10_000, maxStringLength: 10_000 });
    if (!guard.ok)
        throw new Error(`invalid params at ${guard.path}: ${guard.message}`);
    return { def: parsed.data, params: resolveParams(parsed.data.params, params ?? {}) };
}
/**
 * Create the browser Worker sandbox. Workers are spawned lazily on first use.
 * Each run: static check → params resolution → worker run with watchdog →
 * main-thread output validation.
 */
export function createWorkerSandbox(opts = {}) {
    const defaultTimeout = clamp(opts.timeoutMs, PROCGEN_LIMITS.DEFAULT_TIMEOUT_MS, 50, PROCGEN_LIMITS.MAX_TIMEOUT_MS);
    const poolSize = clamp(opts.poolSize, 2, 1, 8);
    const bootTimeout = clamp(opts.bootTimeoutMs, 10_000, 100, 60_000);
    const maxRuns = clamp(opts.maxRunsPerWorker, 100, 1, 1_000_000);
    const maxQueue = clamp(opts.maxQueue, 256, 1, 10_000);
    const idleTimeout = clamp(opts.idleTimeoutMs, 60_000, 0, 3_600_000);
    const factory = opts.createWorker ?? defaultWorker;
    const slots = Array.from({ length: poolSize }, () => ({ worker: null, ready: false, runs: 0, task: null, timer: null, idleTimer: null }));
    const queue = [];
    let nextId = 1;
    let disposed = false;
    const clearIdle = (slot) => {
        if (slot.idleTimer)
            clearTimeout(slot.idleTimer);
        slot.idleTimer = null;
    };
    const kill = (slot) => {
        if (slot.timer)
            clearTimeout(slot.timer);
        slot.timer = null;
        clearIdle(slot);
        if (slot.worker) {
            slot.worker.onmessage = null;
            slot.worker.onerror = null;
            try {
                slot.worker.terminate();
            }
            catch {
                // already gone
            }
        }
        slot.worker = null;
        slot.ready = false;
        slot.runs = 0;
    };
    const finish = (slot) => {
        const task = slot.task;
        slot.task = null;
        if (slot.timer)
            clearTimeout(slot.timer);
        slot.timer = null;
        return task;
    };
    const startWatchdog = (slot, ms, message) => {
        if (slot.timer)
            clearTimeout(slot.timer);
        slot.timer = setTimeout(() => {
            const task = finish(slot);
            kill(slot);
            task?.reject(new Error(message));
            pump();
        }, ms);
    };
    const onMessage = (slot, e) => {
        const msg = parseWorkerMessage(e.data);
        if (!msg)
            return;
        if (msg.type === 'ready') {
            slot.ready = true;
            if (slot.task) {
                startWatchdog(slot, slot.task.timeoutMs, `generator timed out after ${slot.task.timeoutMs} ms`);
            }
            return;
        }
        if (!slot.task || msg.id !== slot.task.id)
            return;
        const task = finish(slot);
        if (!task)
            return;
        if (slot.runs >= maxRuns)
            kill(slot);
        if (!msg.ok)
            task.reject(new Error(`generator failed: ${msg.error}`));
        else {
            const v = validateOutput(msg.output);
            if (v.ok)
                task.resolve(v.output);
            else
                task.reject(new Error(`generator returned invalid output: ${v.error}`));
        }
        pump();
    };
    const onError = (slot, e) => {
        const task = finish(slot);
        kill(slot);
        const detail = typeof e.message === 'string' && e.message ? `: ${e.message}` : '';
        task?.reject(new Error(`generator worker crashed${detail}`));
        pump();
    };
    /** Release an idle worker's realm after `idleTimeout` (respawned lazily). */
    const scheduleIdle = (slot) => {
        clearIdle(slot);
        if (idleTimeout === 0 || disposed || !slot.worker || slot.task)
            return;
        slot.idleTimer = setTimeout(() => {
            slot.idleTimer = null;
            if (!slot.task)
                kill(slot);
        }, idleTimeout);
    };
    const dispatch = (slot, task) => {
        clearIdle(slot);
        slot.task = task;
        if (!slot.worker) {
            try {
                const w = factory();
                w.onmessage = (e) => onMessage(slot, e);
                w.onerror = (e) => onError(slot, e);
                slot.worker = w;
                slot.ready = false;
            }
            catch (err) {
                slot.task = null;
                task.reject(err instanceof Error ? err : new Error(String(err)));
                return;
            }
        }
        slot.runs++;
        if (slot.ready)
            startWatchdog(slot, task.timeoutMs, `generator timed out after ${task.timeoutMs} ms`);
        else
            startWatchdog(slot, bootTimeout, `generator sandbox failed to start within ${bootTimeout} ms`);
        try {
            slot.worker?.postMessage(task.request);
        }
        catch (err) {
            const t = finish(slot);
            kill(slot);
            t?.reject(new Error(`could not send generator to the sandbox: ${err instanceof Error ? err.message : String(err)}`));
        }
    };
    function pump() {
        if (disposed)
            return;
        for (const slot of slots) {
            if (slot.task)
                continue;
            const task = queue.shift();
            if (task)
                dispatch(slot, task);
            else
                scheduleIdle(slot);
        }
    }
    return {
        run(def, params, seed, runOpts) {
            if (disposed)
                return Promise.reject(new Error('sandbox disposed'));
            let prepared;
            try {
                prepared = prepareRun(def, params);
            }
            catch (err) {
                return Promise.reject(err instanceof Error ? err : new Error(String(err)));
            }
            if (queue.length >= maxQueue)
                return Promise.reject(new Error('generator sandbox queue is full'));
            const timeoutMs = clamp(runOpts?.timeoutMs, defaultTimeout, 50, PROCGEN_LIMITS.MAX_TIMEOUT_MS);
            return new Promise((resolve, reject) => {
                const id = nextId++;
                queue.push({
                    id,
                    timeoutMs,
                    resolve,
                    reject,
                    request: { type: 'run', id, source: prepared.def.source, params: prepared.params, seed: Number.isFinite(seed) ? Math.trunc(seed) : 0 },
                });
                pump();
            });
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            const err = new Error('sandbox disposed');
            for (const slot of slots) {
                const task = finish(slot);
                kill(slot);
                task?.reject(err);
            }
            for (const task of queue.splice(0))
                task.reject(err);
        },
    };
}
