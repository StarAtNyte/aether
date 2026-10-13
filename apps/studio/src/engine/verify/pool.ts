/**
 * Main-thread client of the physics verification workers.
 *
 * - Up to {@link MAX_VERIFY_LANES} module workers ("lanes"), spawned lazily
 *   and terminated after a minute without work.
 * - A verification is planned into shards ({@link planShards}); shards run
 *   concurrently on separate lanes and stream per-test results back as they
 *   are decided, then merge into one report.
 * - Every request has an id, a timeout (the worker is terminated when it
 *   expires) and can be cancelled through an `AbortSignal`.
 * - Replies are validated ({@link parseVerifyReply}); unknown or late
 *   replies are ignored.
 * - When workers cannot run (no `Worker`, CSP, a crash), {@link VerifyPool.verify}
 *   rejects with {@link WorkerUnavailableError} and the caller falls back to
 *   the main thread.
 */
import type { WorldDoc } from '@aether/core';
import type { TestResult, VerifyReport } from '@aether/physics';
import type { ColliderDesc, WorkerLike } from '@aether/procgen';
import { parseVerifyReply, type VerifyReply } from './protocol';
import { mergeShardReports, planShards, type ShardReport } from './shards';

/** Raised when verification cannot run in a worker (the caller falls back to the main thread). */
export class WorkerUnavailableError extends Error {
  override name = 'WorkerUnavailableError';
}

/** Raised when a request exceeded its time budget (the worker was restarted). */
export class VerifyTimeoutError extends Error {
  override name = 'VerifyTimeoutError';
}

/** Options of {@link VerifyPool}. */
export interface VerifyPoolOptions {
  /** Worker factory (tests, custom bundlers); null disables workers. */
  createWorker?: (() => WorkerLike) | null;
  /** Lanes (1..2, default 1). */
  lanes?: number;
  /** Extra wall-clock time allowed on top of a request's compute budget (ms, default 20000: cold start). */
  slackMs?: number;
  /** Terminate idle workers after this long (ms, default 60000; 0 keeps them). */
  idleMs?: number;
}

/** Options of {@link VerifyPool.verify}. */
export interface PoolVerifyOptions {
  colliders: Array<[string, ColliderDesc[]]>;
  maxSeconds: number;
  budgetMs: number;
  signal?: AbortSignal;
  /** Called as soon as each test is decided (`index` into `world.tests`). */
  onResult?: (index: number, result: TestResult) => void;
}

/** Result of {@link VerifyPool.verify}. */
export interface PoolVerifyResult {
  report: VerifyReport;
  /** Lanes the run was split across. */
  lanes: number;
}

type Terminal = Extract<VerifyReply, { type: 'verified' | 'diagnosed' | 'settled' | 'warmed' | 'failed' }>;

interface Pending {
  resolve: (reply: Terminal) => void;
  reject: (err: Error) => void;
  onProgress?: (index: number, result: TestResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Lane {
  worker: WorkerLike;
  pending: Map<number, Pending>;
  /** Saw the worker's `ready` message (it started and evaluated its module). */
  started: boolean;
  /** Physics finished loading in this worker (a warm or completed request). */
  warm: boolean;
}

const MAX_LANES = 2;
/** Requests whose worker never said `ready` within this time count as a failed start. */
const START_TIMEOUT_MS = 15_000;

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./verify.worker.ts', import.meta.url), { type: 'module', name: 'aether-verify' }) as unknown as WorkerLike;
}

function abortError(): Error {
  return Object.assign(new Error('verification cancelled'), { name: 'AbortError' });
}

/** Pool of verification workers. */
export class VerifyPool {
  private readonly lanes: Array<Lane | null> = [];
  private readonly factory: (() => WorkerLike) | null;
  private readonly laneCount: number;
  private readonly slackMs: number;
  private readonly idleMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private broken = false;
  private disposed = false;

  constructor(opts: VerifyPoolOptions = {}) {
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    this.laneCount = Math.max(1, Math.min(MAX_LANES, Math.floor(opts.lanes ?? 1)));
    this.slackMs = Math.max(0, opts.slackMs ?? 20_000);
    this.idleMs = Math.max(0, opts.idleMs ?? 60_000);
  }

  /** True while workers can be used (false after a failed start or without `Worker`). */
  get available(): boolean {
    return this.factory !== null && !this.broken && !this.disposed;
  }

  /** Maximum lanes of this pool. */
  get maxLanes(): number {
    return this.laneCount;
  }

  /** Workers currently alive. */
  get liveWorkers(): number {
    return this.lanes.filter((l) => l !== null).length;
  }

  private lane(i: number): Lane {
    const existing = this.lanes[i];
    if (existing) return existing;
    if (!this.available || !this.factory) throw new WorkerUnavailableError('verification workers are unavailable');
    let worker: WorkerLike;
    try {
      worker = this.factory();
    } catch (err) {
      this.broken = true;
      throw new WorkerUnavailableError(`could not start a verification worker: ${err instanceof Error ? err.message : String(err)}`);
    }
    const lane: Lane = { worker, pending: new Map(), started: false, warm: false };
    worker.onmessage = (e: MessageEvent) => this.onMessage(lane, e.data);
    worker.onerror = () => {
      // A worker that never started (module workers unsupported, CSP) disables the pool.
      if (!lane.started) this.broken = true;
      this.killLane(lane, new WorkerUnavailableError(lane.started ? 'the verification worker crashed' : 'the verification worker failed to start'));
    };
    this.lanes[i] = lane;
    return lane;
  }

  private onMessage(lane: Lane, data: unknown): void {
    const msg = parseVerifyReply(data);
    if (!msg) return;
    if (msg.type === 'ready') {
      lane.started = true;
      return;
    }
    const p = lane.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      try {
        p.onProgress?.(msg.index, msg.result);
      } catch {
        /* listeners never break the protocol */
      }
      return;
    }
    lane.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type !== 'failed') lane.warm = true;
    p.resolve(msg);
    this.scheduleIdle();
  }

  /** Terminate a lane and reject its requests. */
  private killLane(lane: Lane, err: Error): void {
    const i = this.lanes.indexOf(lane);
    if (i >= 0) this.lanes[i] = null;
    for (const p of lane.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    lane.pending.clear();
    try {
      lane.worker.terminate();
    } catch {
      /* already gone */
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.idleMs === 0 || this.disposed) return;
    if (this.lanes.some((l) => l !== null && l.pending.size > 0)) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.lanes.some((l) => l !== null && l.pending.size > 0)) return;
      for (const l of this.lanes) if (l) this.killLane(l, new Error('idle'));
    }, this.idleMs);
  }

  /** Send one request on a lane; resolves with its terminal reply. */
  private request(laneIndex: number, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal, onProgress?: Pending['onProgress']): Promise<Terminal> {
    if (signal?.aborted) return Promise.reject(abortError());
    const lane = this.lane(laneIndex);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const id = this.nextId++;
    return new Promise<Terminal>((resolve, reject) => {
      const limit = lane.started ? timeoutMs : Math.max(timeoutMs, START_TIMEOUT_MS);
      const timer = setTimeout(() => {
        lane.pending.delete(id);
        reject(lane.started ? new VerifyTimeoutError(`verification took longer than ${Math.round(limit / 1000)} s and was stopped`) : new WorkerUnavailableError('the verification worker did not start'));
        if (!lane.started) this.broken = true;
        // A runaway request: restart the worker (other requests on it fail and are retried by callers).
        this.killLane(lane, new VerifyTimeoutError('the verification worker was restarted'));
      }, limit);
      const onAbort = (): void => {
        if (!lane.pending.delete(id)) return;
        clearTimeout(timer);
        try {
          lane.worker.postMessage({ type: 'cancel', id });
        } catch {
          /* worker gone */
        }
        reject(abortError());
        this.scheduleIdle();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = <T>(fn: (v: T) => void) => (v: T): void => {
        signal?.removeEventListener('abort', onAbort);
        fn(v);
      };
      lane.pending.set(id, { resolve: done(resolve), reject: done(reject), timer, ...(onProgress ? { onProgress } : {}) });
      try {
        lane.worker.postMessage({ ...body, id });
      } catch (err) {
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
  warm(scripting = false): void {
    if (!this.available) return;
    const lane = this.lanes[0];
    if (lane?.warm) return;
    this.request(0, { type: 'warm', scripting }, this.slackMs + START_TIMEOUT_MS).then(
      () => this.scheduleIdle(),
      () => undefined,
    );
  }

  /**
   * Verify `world` in the workers: planned into shards across lanes,
   * results streamed through `onResult`, merged into one report.
   * @throws WorkerUnavailableError when workers cannot run (fall back to the main thread)
   * @throws VerifyTimeoutError when a shard exceeded its time budget
   * @throws Error named `AbortError` when `signal` aborted
   */
  async verify(world: WorldDoc, opts: PoolVerifyOptions): Promise<PoolVerifyResult> {
    if (this.disposed) throw new WorkerUnavailableError('verification pool disposed');
    const shards = planShards(world.tests, this.laneCount, opts.maxSeconds);
    const timeoutMs = opts.budgetMs + this.slackMs;
    // One controller for all shards: the caller's abort or the first failure stops the rest.
    const ctrl = new AbortController();
    const forward = (): void => ctrl.abort();
    if (opts.signal?.aborted) throw abortError();
    opts.signal?.addEventListener('abort', forward, { once: true });
    let first: Error | null = null;
    const runs = shards.map(async (shard, laneIndex): Promise<ShardReport> => {
      try {
        const reply = await this.request(
          laneIndex,
          {
            type: 'verify',
            world,
            colliders: opts.colliders,
            options: { maxSeconds: opts.maxSeconds, budgetMs: opts.budgetMs, diagnostics: shard.diagnostics, ...(shards.length > 1 ? { tests: shard.tests } : {}) },
          },
          timeoutMs,
          ctrl.signal,
          opts.onResult,
        );
        if (reply.type === 'verified') return { tests: shard.tests, report: reply.report };
        if (reply.type === 'failed') throw reply.cancelled ? abortError() : new WorkerUnavailableError(reply.error);
        throw new WorkerUnavailableError(`unexpected verification reply '${reply.type}'`);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (!first && e.name !== 'AbortError') first = e;
        ctrl.abort();
        throw e;
      }
    });
    const settled = await Promise.allSettled(runs);
    opts.signal?.removeEventListener('abort', forward);
    if (opts.signal?.aborted) throw abortError();
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failure) throw first ?? (failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason)));
    const reports = settled.map((s) => (s as PromiseFulfilledResult<ShardReport>).value);
    const report = shards.length === 1 && reports[0] ? reports[0].report : mergeShardReports(world.tests, reports);
    return { report, lanes: shards.length };
  }

  /** Terminate every worker and reject pending work. */
  dispose(): void {
    this.disposed = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const l of this.lanes) if (l) this.killLane(l, new WorkerUnavailableError('verification pool disposed'));
  }
}
