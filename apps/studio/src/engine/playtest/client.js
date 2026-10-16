import { parsePlaytestReply } from './protocol';
/** Raised when the playtest cannot run in a worker (the caller falls back to the main thread). */
export class PlaytestWorkerUnavailableError extends Error {
    name = 'PlaytestWorkerUnavailableError';
}
/** Raised when a run exceeded its time budget (the worker was restarted). */
export class PlaytestTimeoutError extends Error {
    name = 'PlaytestTimeoutError';
}
const START_TIMEOUT_MS = 15_000;
const DEFAULT_SIM = 240;
const DEFAULT_BUDGET = 20_000;
function defaultWorker() {
    return new Worker(new URL('./playtest.worker.ts', import.meta.url), { type: 'module', name: 'aether-playtest' });
}
function abortError() {
    return Object.assign(new Error('playtest cancelled'), { name: 'AbortError' });
}
/** Runs playtests in a worker with a main-thread fallback. */
export class PlaytestClient {
    worker = null;
    started = false;
    pending = new Map();
    factory;
    mainThread;
    slackMs;
    idleMs;
    idleTimer = null;
    nextId = 1;
    broken = false;
    disposed = false;
    constructor(opts = {}) {
        this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
        this.mainThread = opts.mainThread;
        this.slackMs = Math.max(0, opts.slackMs ?? 20_000);
        this.idleMs = Math.max(0, opts.idleMs ?? 60_000);
    }
    /** True while the worker can be used. */
    get usesWorkers() {
        return this.factory !== null && !this.broken && !this.disposed;
    }
    ensure() {
        if (this.worker)
            return this.worker;
        if (!this.usesWorkers || !this.factory)
            throw new PlaytestWorkerUnavailableError('the playtest worker is unavailable');
        let worker;
        try {
            worker = this.factory();
        }
        catch (err) {
            this.broken = true;
            throw new PlaytestWorkerUnavailableError(`could not start the playtest worker: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.worker = worker;
        this.started = false;
        worker.onmessage = (e) => this.onMessage(worker, e.data);
        worker.onerror = () => {
            if (this.worker !== worker)
                return;
            if (!this.started)
                this.broken = true;
            this.kill(new PlaytestWorkerUnavailableError(this.started ? 'the playtest worker crashed' : 'the playtest worker failed to start'));
        };
        return worker;
    }
    onMessage(from, data) {
        if (this.worker !== from)
            return;
        const msg = parsePlaytestReply(data);
        if (!msg)
            return;
        if (msg.type === 'ready') {
            this.started = true;
            return;
        }
        const p = this.pending.get(msg.id);
        if (!p)
            return;
        if (msg.type === 'progress') {
            try {
                p.onProgress?.(msg.progress);
            }
            catch {
                /* listeners never break the protocol */
            }
            return;
        }
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg);
        this.scheduleIdle();
    }
    kill(err) {
        const w = this.worker;
        this.worker = null;
        this.started = false;
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
        try {
            w?.terminate();
        }
        catch {
            /* already gone */
        }
    }
    scheduleIdle() {
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        if (this.idleMs === 0 || this.disposed || this.pending.size > 0)
            return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.pending.size === 0)
                this.kill(new Error('idle'));
        }, this.idleMs);
    }
    request(body, timeoutMs, signal, onProgress) {
        if (signal?.aborted)
            return Promise.reject(abortError());
        const worker = this.ensure();
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const limit = this.started ? timeoutMs : Math.max(timeoutMs, START_TIMEOUT_MS);
            const timer = setTimeout(() => {
                this.pending.delete(id);
                const wasStarted = this.started;
                if (!wasStarted)
                    this.broken = true;
                reject(wasStarted ? new PlaytestTimeoutError(`the playtest took longer than ${Math.round(limit / 1000)} s and was stopped`) : new PlaytestWorkerUnavailableError('the playtest worker did not start'));
                this.kill(new PlaytestTimeoutError('the playtest worker was restarted'));
            }, limit);
            const onAbort = () => {
                if (!this.pending.delete(id))
                    return;
                clearTimeout(timer);
                try {
                    worker.postMessage({ type: 'cancel', id });
                }
                catch {
                    /* worker gone */
                }
                reject(abortError());
                this.scheduleIdle();
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            const done = (fn) => (v) => {
                signal?.removeEventListener('abort', onAbort);
                fn(v);
            };
            this.pending.set(id, { resolve: done(resolve), reject: done(reject), timer, ...(onProgress ? { onProgress } : {}) });
            try {
                worker.postMessage({ ...body, id });
            }
            catch (err) {
                this.pending.delete(id);
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                reject(new PlaytestWorkerUnavailableError(`could not send to the playtest worker: ${err instanceof Error ? err.message : String(err)}`));
            }
        });
    }
    /** Load the bot in the worker ahead of time (idle prefetch). Never throws. */
    warm() {
        if (!this.usesWorkers)
            return;
        this.request({ type: 'warm' }, this.slackMs + START_TIMEOUT_MS).then(() => this.scheduleIdle(), () => undefined);
    }
    /** Play `world`; never throws. */
    async run(world, opts) {
        const maxSim = opts.maxSimSeconds ?? DEFAULT_SIM;
        const budget = opts.budgetMs ?? DEFAULT_BUDGET;
        if (this.usesWorkers) {
            try {
                const reply = await this.request({ type: 'run', kind: opts.kind, world, options: { maxSimSeconds: maxSim, budgetMs: budget, trace: opts.trace !== false } }, budget + this.slackMs, opts.signal, opts.onProgress);
                if (reply.type === 'done')
                    return { ok: true, report: reply.report, worker: true };
                if (reply.type === 'failed')
                    return { ok: false, error: reply.error, cancelled: reply.cancelled, worker: true };
                return { ok: false, error: `unexpected playtest reply '${reply.type}'`, cancelled: false, worker: true };
            }
            catch (err) {
                const e = err instanceof Error ? err : new Error(String(err));
                if (e.name === 'AbortError')
                    return { ok: false, error: 'playtest cancelled', cancelled: true, worker: true };
                if (e instanceof PlaytestTimeoutError)
                    return { ok: false, error: e.message, cancelled: false, worker: true };
                if (!(e instanceof PlaytestWorkerUnavailableError))
                    return { ok: false, error: e.message.slice(0, 600), cancelled: false, worker: true };
                // Worker unavailable or crashed: play on the main thread instead.
            }
        }
        if (!this.mainThread)
            return { ok: false, error: 'the playtest worker is unavailable', cancelled: false, worker: false };
        try {
            const report = await this.mainThread(world, opts);
            return { ok: true, report, worker: false };
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            const cancelled = e.name === 'AbortError';
            return { ok: false, error: cancelled ? 'playtest cancelled' : e.message.slice(0, 600), cancelled, worker: false };
        }
    }
    /** Stop the worker. */
    dispose() {
        this.disposed = true;
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        this.kill(new PlaytestWorkerUnavailableError('the playtest client was disposed'));
    }
}
