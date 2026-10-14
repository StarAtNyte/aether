/**
 * Verification service of the studio: runs `@aether/physics` verification
 * in the worker pool (sharded across lanes when the world has several tests)
 * and falls back to the cooperative main-thread path when workers cannot
 * run. Results stream through `onResult`; the outcome says where it ran.
 */
import type { WorldDoc } from '@aether/core';
import type { ColliderProvider, TestResult, VerifyReport } from '@aether/physics';
import { workerColliders } from './colliders';
import { VerifyPool, VerifyTimeoutError, WorkerUnavailableError } from './pool';

/** Options of {@link VerificationService.run}. */
export interface VerifyRunOptions {
  /** Renderer colliders of the exact world (undefined when not synced). */
  colliders?: ColliderProvider | undefined;
  maxSeconds: number;
  budgetMs: number;
  signal?: AbortSignal;
  onResult?: (index: number, result: TestResult) => void;
  /** Called once the run is planned: lane count and whether it runs in workers. */
  onPlan?: (plan: { lanes: number; worker: boolean }) => void;
  /** Record a motion trace of the bodies that move (`report.trace`) for the proof replay. */
  trace?: boolean;
}

/** Outcome of {@link VerificationService.run}. */
export type VerifyOutcome =
  | { ok: true; report: VerifyReport; lanes: number; worker: boolean }
  | { ok: false; error: string; cancelled: boolean; worker: boolean };

/** The main-thread fallback (the cooperative, yielding verifier). */
export type MainThreadVerify = (world: WorldDoc, opts: VerifyRunOptions) => Promise<VerifyReport>;

/** Verification through workers with a main-thread fallback. */
export class VerificationService {
  constructor(
    private readonly pool: VerifyPool | null,
    private readonly mainThread: MainThreadVerify,
  ) {}

  /** True while verification runs off the main thread. */
  get usesWorkers(): boolean {
    return this.pool?.available ?? false;
  }

  /** Prefetch physics in a worker (idle time / intent). Never throws. */
  warm(scripting = false): void {
    this.pool?.warm(scripting);
  }

  /** Verify `world`; never throws. */
  async run(world: WorldDoc, opts: VerifyRunOptions): Promise<VerifyOutcome> {
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
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (e.name === 'AbortError') return { ok: false, error: 'verification cancelled', cancelled: true, worker: true };
        if (e instanceof VerifyTimeoutError) return { ok: false, error: e.message, cancelled: false, worker: true };
        if (!(e instanceof WorkerUnavailableError)) return { ok: false, error: e.message.slice(0, 600), cancelled: false, worker: true };
        // Workers unavailable or crashed: verify on the main thread instead.
      }
    }
    try {
      opts.onPlan?.({ lanes: 1, worker: false });
      const report = await this.mainThread(world, opts);
      return { ok: true, report, lanes: 1, worker: false };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const cancelled = e.name === 'AbortError';
      return { ok: false, error: cancelled ? 'verification cancelled' : e.message.slice(0, 600), cancelled, worker: false };
    }
  }

  /** Stop the workers. */
  dispose(): void {
    this.pool?.dispose();
  }
}
