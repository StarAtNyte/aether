import { parseVerifyReply } from './protocol';
import { mergeShardReports, planShards } from './shards';
/** Raised when verification cannot run in a worker (the caller falls back to the main thread). */
export class WorkerUnavailableError extends Error {
    name = 'WorkerUnavailableError';
}
/** Raised when a request exceeded its time budget (the worker was restarted). */
export class VerifyTimeoutError extends Error {
    name = 'VerifyTimeoutError';
}
const MAX_LANES = 2;
/** Requests whose worker never said `ready` within this time count as a failed start. */
const START_TIMEOUT_MS = 15_000;
function defaultWorker() {
    return new Worker(new URL('./verify.worker.ts', import.meta.url), { type: 'module', name: 'aether-verify' });
}
function abortError() {
    return Object.assign(new Error('verification cancelled'), { name: 'AbortError' });
}
/** Pool of verification workers. */
export class VerifyPool {
    lanes = [];
    factory;
    laneCount;
    slackMs;
    idleMs;
    idleTimer = null;
    nextId = 1;
    broken = false;
    disposed = false;
    constructor(opts = {}) {
        this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
        this.laneCount = Math.max(1, Math.min(MAX_LANES, Math.floor(opts.lanes ?? 1)));
        this.slackMs = Math.max(0, opts.slackMs ?? 20_000);
        this.idleMs = Math.max(0, opts.idleMs ?? 60_000);
    }
    /** True while workers can be used (false after a failed start or without `Worker`). */
    get available() {
        return this.factory !== null && !this.broken && !this.disposed;
    }
    /** Maximum lanes of this pool. */
    get maxLanes() {
        return this.laneCount;
    }
    /** Workers currently alive. */
    get liveWorkers() {
        return this.lanes.filter((l) => l !== null).length;
    }
    lane(i) {
        const existing = this.lanes[i];
        if (existing)
            return existing;
        if (!this.available || !this.factory)
            throw new WorkerUnavailableError('verification workers are unavailable');
        let worker;
        try {
            worker = this.factory();
        }
        catch (err) {
            this.broken = true;
            throw new WorkerUnavailableError(`could not start a verification worker: ${err instanceof Error ? err.message : String(err)}`);
        }
        const lane = { worker, pending: new Map(), started: false, warm: false };
        worker.onmessage = (e) => this.onMessage(lane, e.data);
        worker.onerror = () => {
            // A worker that never started (module workers unsupported, CSP) disables the pool.
            if (!lane.started)
                this.broken = true;
            this.killLane(lane, new WorkerUnavailableError(lane.started ? 'the verification worker crashed' : 'the verification worker failed to start'));
        };
        this.lanes[i] = lane;
        return lane;
    }
    onMessage(lane, data) {
        const msg = parseVerifyReply(data);
        if (!msg)
            return;
        if (msg.type === 'ready') {
            lane.started = true;
            return;
        }
        const p = lane.pending.get(msg.id);
        if (!p)
            return;
        if (msg.type === 'progress') {
            try {
                p.onProgress?.(msg.index, msg.result);
            }
            catch {
                /* listeners never break the protocol */
            }
            return;
        }
        lane.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.type !== 'failed')
            lane.warm = true;
        p.resolve(msg);
        this.scheduleIdle();
    }
    /** Terminate a lane and reject its requests. */
    killLane(lane, err) {
        const i = this.lanes.indexOf(lane);
        if (i >= 0)
            this.lanes[i] = null;
        for (const p of lane.pending.values()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        lane.pending.clear();
        try {
            lane.worker.terminate();
        }
        catch {
            /* already gone */
        }
    }
    scheduleIdle() {
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        if (this.idleMs === 0 || this.disposed)
            return;
        if (this.lanes.some((l) => l !== null && l.pending.size > 0))
            return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.lanes.some((l) => l !== null && l.pending.size > 0))
                return;
            for (const l of this.lanes)
                if (l)
                    this.killLane(l, new Error('idle'));
        }, this.idleMs);
    }
    /** Send one request on a lane; resolves with its terminal reply. */
    request(laneIndex, body, timeoutMs, signal, onProgress) {
        if (signal?.aborted)
            return Promise.reject(abortError());
        const lane = this.lane(laneIndex);
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const limit = lane.started ? timeoutMs : Math.max(timeoutMs, START_TIMEOUT_MS);
            const timer = setTimeout(() => {
                lane.pending.delete(id);
                reject(lane.started ? new VerifyTimeoutError(`verification took longer than ${Math.round(limit / 1000)} s and was stopped`) : new WorkerUnavailableError('the verification worker did not start'));
                if (!lane.started)
                    this.broken = true;
                // A runaway request: restart the worker (other requests on it fail and are retried by callers).
                this.killLane(lane, new VerifyTimeoutError('the verification worker was restarted'));
            }, limit);
            const onAbort = () => {
                if (!lane.pending.delete(id))
                    return;
                clearTimeout(timer);
                try {
                    lane.worker.postMessage({ type: 'cancel', id });
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
            lane.pending.set(id, { resolve: done(resolve), reject: done(reject), timer, ...(onProgress ? { onProgress } : {}) });
            try {
                lane.worker.postMessage({ ...body, id });
            }
            catch (err) {
                lane.pending.delete(id);
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                reject(new WorkerUnavailableError(`could not send to the verification worker: ${err instanceof Error ? err.message : String(err)}`));
            }
        });
    }
    /**
     * Load physics in the first worker ahead of time (idle prefetch). Never
     * throws; does nothing when workers are unavailable.
     */
    warm(scripting = false) {
        if (!this.available)
            return;
        const lane = this.lanes[0];
        if (lane?.warm)
            return;
        this.request(0, { type: 'warm', scripting }, this.slackMs + START_TIMEOUT_MS).then(() => this.scheduleIdle(), () => undefined);
    }
    /**
     * Verify `world` in the workers: planned into shards across lanes,
     * results streamed through `onResult`, merged into one report.
     * @throws WorkerUnavailableError when workers cannot run (fall back to the main thread)
     * @throws VerifyTimeoutError when a shard exceeded its time budget
     * @throws Error named `AbortError` when `signal` aborted
     */
    async verify(world, opts) {
        if (this.disposed)
            throw new WorkerUnavailableError('verification pool disposed');
        const shards = planShards(world.tests, this.laneCount, opts.maxSeconds);
        const timeoutMs = opts.budgetMs + this.slackMs;
        try {
            opts.onPlan?.(shards.length);
        }
        catch {
            /* listeners never break verification */
        }
        // One controller for all shards: the caller's abort or the first failure stops the rest.
        const ctrl = new AbortController();
        const forward = () => ctrl.abort();
        if (opts.signal?.aborted)
            throw abortError();
        opts.signal?.addEventListener('abort', forward, { once: true });
        let first = null;
        const traceLane = opts.trace ? longestShard(shards) : -1;
        const runs = shards.map(async (shard, laneIndex) => {
            try {
                const reply = await this.request(laneIndex, {
                    type: 'verify',
                    world,
                    colliders: opts.colliders,
                    options: { maxSeconds: opts.maxSeconds, budgetMs: opts.budgetMs, diagnostics: shard.diagnostics, ...(shards.length > 1 ? { tests: shard.tests } : {}), ...(laneIndex === traceLane ? { trace: true } : {}) },
                }, timeoutMs, ctrl.signal, opts.onResult);
                if (reply.type === 'verified')
                    return { tests: shard.tests, report: reply.report };
                if (reply.type === 'failed')
                    throw reply.cancelled ? abortError() : new WorkerUnavailableError(reply.error);
                throw new WorkerUnavailableError(`unexpected verification reply '${reply.type}'`);
            }
            catch (err) {
                const e = err instanceof Error ? err : new Error(String(err));
                if (!first && e.name !== 'AbortError')
                    first = e;
                ctrl.abort();
                throw e;
            }
        });
        const settled = await Promise.allSettled(runs);
        opts.signal?.removeEventListener('abort', forward);
        if (opts.signal?.aborted)
            throw abortError();
        const failure = settled.find((s) => s.status === 'rejected');
        if (failure)
            throw first ?? (failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason)));
        const reports = settled.map((s) => s.value);
        const report = shards.length === 1 && reports[0] ? reports[0].report : mergeShardReports(world.tests, reports);
        return { report, lanes: shards.length };
    }
    /** Terminate every worker and reject pending work. */
    dispose() {
        this.disposed = true;
        if (this.idleTimer !== null)
            clearTimeout(this.idleTimer);
        this.idleTimer = null;
        for (const l of this.lanes)
            if (l)
                this.killLane(l, new WorkerUnavailableError('verification pool disposed'));
    }
}
/** Index of the shard with the most simulated seconds (its trace covers the longest motion). */
export function longestShard(shards) {
    let best = 0;
    for (let i = 1; i < shards.length; i++)
        if ((shards[i]?.load ?? 0) > (shards[best]?.load ?? 0))
            best = i;
    return best;
}
