/**
 * Optional execution check for LLM-written generator defs before they enter
 * the shared content-addressed cache.
 *
 * The dry run (static source check + `@aether/procgen/node` sandbox) runs in a
 * dedicated `worker_threads` Worker, never on the HTTP event loop:
 * - V8 `resourceLimits` cap the worker heap, so a generator that allocates
 *   without bound kills only the worker (which is respawned on demand);
 * - a watchdog `terminate()`s the worker when a run overshoots its budget;
 * - at most `maxQueue` runs may wait; further requests are refused (503).
 *
 * `node:vm` is still not a security boundary, which is why the check is off
 * by default (`AETHER_VALIDATE_GENERATORS`). Browsers always run generators in
 * their own Worker sandbox regardless.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
/** Default V8 heap caps for the validation worker. */
export const DEFAULT_WORKER_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 });
/** Extra time on top of the sandbox budget before the watchdog terminates the worker. */
const WATCHDOG_GRACE_MS = 500;
/**
 * Bootstrap evaluated as the worker's main script: register the tsx loader
 * (the server runs TypeScript sources) and import the real entry.
 */
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.tsxApi)
  .then((m) => { m.register(); return import(workerData.entry); })
  .catch((e) => parentPort.postMessage({ type: 'fatal', error: String(e && e.message ? e.message : e).slice(0, 300) }));
`;
function parseMessage(raw) {
    if (raw === null || typeof raw !== 'object')
        return null;
    const m = raw;
    if (m.type === 'ready')
        return { type: 'ready' };
    if (m.type === 'fatal')
        return { type: 'fatal', error: typeof m.error === 'string' ? m.error : 'worker failed' };
    if (m.type === 'result' && typeof m.id === 'number' && typeof m.ok === 'boolean') {
        return { type: 'result', id: m.id, ok: m.ok, ...(typeof m.error === 'string' ? { error: m.error } : {}) };
    }
    return null;
}
/** Serial worker-thread pool (size 1) running generator dry runs off the event loop. */
export class GeneratorValidationPool {
    worker = null;
    ready = null;
    queue = [];
    active = null;
    watchdog = null;
    nextId = 1;
    disposed = false;
    timeoutMs;
    maxQueue;
    startupTimeoutMs;
    limits;
    logger;
    constructor(opts) {
        this.timeoutMs = Math.max(10, Math.min(5_000, Math.round(opts.timeoutMs)));
        this.maxQueue = Math.max(1, opts.maxQueue ?? 8);
        this.startupTimeoutMs = opts.startupTimeoutMs ?? 20_000;
        this.limits = opts.resourceLimits ?? DEFAULT_WORKER_LIMITS;
        this.logger = opts.logger;
    }
    /** Boot the worker; resolves false when it cannot start (e.g. procgen missing). */
    start() {
        if (this.disposed)
            return Promise.resolve(false);
        if (this.ready)
            return this.ready;
        this.ready = new Promise((resolve) => {
            let settled = false;
            const done = (ok) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (!ok)
                    this.killWorker();
                resolve(ok);
            };
            let worker;
            try {
                const require = createRequire(import.meta.url);
                worker = new Worker(BOOTSTRAP, {
                    eval: true,
                    execArgv: [],
                    resourceLimits: this.limits,
                    workerData: {
                        tsxApi: pathToFileURL(require.resolve('tsx/esm/api')).href,
                        entry: pathToFileURL(fileURLToPath(new URL('./generator-worker.ts', import.meta.url))).href,
                    },
                });
            }
            catch (err) {
                this.logger.warn('generator validation worker failed to start', { error: err instanceof Error ? err.message : 'unknown' });
                resolve(false);
                return;
            }
            const timer = setTimeout(() => {
                this.logger.warn('generator validation worker startup timed out');
                done(false);
            }, this.startupTimeoutMs);
            this.worker = worker;
            worker.unref();
            worker.on('message', (raw) => {
                const msg = parseMessage(raw);
                if (!msg)
                    return;
                if (msg.type === 'ready')
                    done(true);
                else if (msg.type === 'fatal') {
                    this.logger.warn('generator validation worker failed to load', { error: msg.error });
                    done(false);
                }
                else
                    this.onResult(msg.id, msg.ok, msg.error);
            });
            worker.on('error', (err) => {
                this.logger.warn('generator validation worker error', { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
            });
            worker.on('exit', () => {
                if (this.worker !== worker)
                    return;
                this.worker = null;
                this.ready = null;
                done(false);
                this.failActive('generator crashed the sandbox (resource limit exceeded)');
            });
        });
        return this.ready;
    }
    /** Queue a dry run of `def`. */
    validate(def) {
        if (this.disposed)
            return Promise.resolve({ ok: false, error: 'validator is shut down', unavailable: true });
        if (this.queue.length >= this.maxQueue) {
            return Promise.resolve({ ok: false, error: 'too many generator checks in progress', unavailable: true });
        }
        return new Promise((resolve) => {
            this.queue.push({ id: this.nextId++, def, resolve });
            void this.pump();
        });
    }
    /** Terminate the worker and fail everything pending. */
    async dispose() {
        this.disposed = true;
        for (const job of this.queue.splice(0))
            job.resolve({ ok: false, error: 'validator is shut down', unavailable: true });
        this.failActive('validator is shut down');
        await this.killWorker();
    }
    async pump() {
        if (this.active || this.queue.length === 0 || this.disposed)
            return;
        const job = this.queue.shift();
        if (!job)
            return;
        this.active = job;
        const ok = await this.start();
        if (this.active !== job)
            return;
        const worker = this.worker;
        if (!ok || !worker) {
            this.finish(job, { ok: false, error: 'generator validation is temporarily unavailable', unavailable: true });
            return;
        }
        this.watchdog = setTimeout(() => {
            this.logger.warn('generator dry run overran its budget; terminating worker');
            this.finish(job, { ok: false, error: `generator timed out after ${this.timeoutMs} ms` });
            void this.killWorker();
        }, this.timeoutMs + WATCHDOG_GRACE_MS);
        worker.postMessage({ id: job.id, def: job.def, timeoutMs: this.timeoutMs });
    }
    onResult(id, ok, error) {
        const job = this.active;
        if (!job || job.id !== id)
            return;
        this.finish(job, ok ? { ok: true } : { ok: false, error: error ?? 'generator failed to run' });
    }
    failActive(error) {
        if (this.active)
            this.finish(this.active, { ok: false, error });
    }
    finish(job, check) {
        if (this.watchdog)
            clearTimeout(this.watchdog);
        this.watchdog = null;
        if (this.active === job)
            this.active = null;
        job.resolve(check);
        void this.pump();
    }
    async killWorker() {
        const worker = this.worker;
        this.worker = null;
        this.ready = null;
        if (worker)
            await worker.terminate();
    }
}
/**
 * Build a worker-backed validator. Resolves to `null` (validation skipped)
 * when the worker cannot boot, e.g. because `@aether/procgen` is unavailable.
 */
export async function loadSandboxValidator(logger, timeoutMs, opts = {}) {
    const pool = new GeneratorValidationPool({ logger, timeoutMs, ...opts });
    if (!(await pool.start())) {
        logger.warn('generator sandbox unavailable; skipping execution checks');
        await pool.dispose();
        return null;
    }
    const validator = ((def) => pool.validate(def));
    validator.dispose = () => pool.dispose();
    return validator;
}
