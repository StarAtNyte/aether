import { workerColliders } from './colliders';
import { VerifyPool, VerifyTimeoutError, WorkerUnavailableError } from './pool';
/** Verification through workers with a main-thread fallback. */
export class VerificationService {
    pool;
    mainThread;
    constructor(pool, mainThread) {
        this.pool = pool;
        this.mainThread = mainThread;
    }
    /** True while verification runs off the main thread. */
    get usesWorkers() {
        return this.pool?.available ?? false;
    }
    /** Prefetch physics in a worker (idle time / intent). Never throws. */
    warm(scripting = false) {
        this.pool?.warm(scripting);
    }
    /** Verify `world`; never throws. */
    async run(world, opts) {
        const pool = this.pool;
        if (pool?.available) {
            try {
                const r = await pool.verify(world, {
                    colliders: workerColliders(world, opts.colliders),
                    maxSeconds: opts.maxSeconds,
                    budgetMs: opts.budgetMs,
                    ...(opts.signal ? { signal: opts.signal } : {}),
                    ...(opts.onResult ? { onResult: opts.onResult } : {}),
                    onPlan: (lanes) => opts.onPlan?.({ lanes, worker: true }),
                    ...(opts.trace ? { trace: true } : {}),
                });
                return { ok: true, report: r.report, lanes: r.lanes, worker: true };
            }
            catch (err) {
                const e = err instanceof Error ? err : new Error(String(err));
                if (e.name === 'AbortError')
                    return { ok: false, error: 'verification cancelled', cancelled: true, worker: true };
                if (e instanceof VerifyTimeoutError)
                    return { ok: false, error: e.message, cancelled: false, worker: true };
                if (!(e instanceof WorkerUnavailableError))
                    return { ok: false, error: e.message.slice(0, 600), cancelled: false, worker: true };
                // Workers unavailable or crashed: verify on the main thread instead.
            }
        }
        try {
            opts.onPlan?.({ lanes: 1, worker: false });
            const report = await this.mainThread(world, opts);
            return { ok: true, report, lanes: 1, worker: false };
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            const cancelled = e.name === 'AbortError';
            return { ok: false, error: cancelled ? 'verification cancelled' : e.message.slice(0, 600), cancelled, worker: false };
        }
    }
    /** Stop the workers. */
    dispose() {
        this.pool?.dispose();
    }
}
