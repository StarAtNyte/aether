/**
 * Main-thread client of the playtest worker.
 *
 * - One module worker, spawned lazily and terminated after a minute without work.
 * - Every request has an id, a wall-clock timeout (the worker is terminated
 *   when it expires), reports progress, and can be cancelled with an
 *   `AbortSignal`.
 * - Replies are validated ({@link parsePlaytestReply}); unknown or late replies
 *   are ignored.
 * - When workers cannot run (no `Worker`, CSP, a crash) the run falls back to
 *   the main thread: the bot yields to the event loop every few milliseconds,
 *   so the page stays usable, just not as smooth.
 */
import type { WorldDoc } from '@aether/core';
import type { PlaytestKind, PlaytestProgress, PlaytestReport } from '@aether/playtest';
import type { WorkerLike } from '@aether/procgen';
import { parsePlaytestReply, type PlaytestReply } from './protocol';

/** Raised when the playtest cannot run in a worker (the caller falls back to the main thread). */
export class PlaytestWorkerUnavailableError extends Error {
  override name = 'PlaytestWorkerUnavailableError';
}

/** Raised when a run exceeded its time budget (the worker was restarted). */
export class PlaytestTimeoutError extends Error {
  override name = 'PlaytestTimeoutError';
}

/** Options of {@link PlaytestClient.run}. */
export interface PlaytestRunOptions {
  kind: PlaytestKind;
  /** Longest simulated play time in seconds (default 240). */
  maxSimSeconds?: number;
  /** Wall-clock compute budget in ms (default 20 000). */
  budgetMs?: number;
  /** Record the replay trace (default true). */
  trace?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: PlaytestProgress) => void;
}

/** Outcome of {@link PlaytestClient.run}; never rejects. */
export type PlaytestOutcome =
  | { ok: true; report: PlaytestReport; worker: boolean }
  | { ok: false; error: string; cancelled: boolean; worker: boolean };

/** The main-thread fallback. */
export type MainThreadPlaytest = (world: WorldDoc, opts: PlaytestRunOptions) => Promise<PlaytestReport>;

/** Options of {@link PlaytestClient}. */
export interface PlaytestClientOptions {
  /** Worker factory (tests, custom bundlers); null disables workers. */
  createWorker?: (() => WorkerLike) | null;
  /** Fallback run on the main thread. */
  mainThread?: MainThreadPlaytest;
  /** Extra wall-clock time allowed on top of the compute budget (ms, default 20000: cold start). */
  slackMs?: number;
  /** Terminate the idle worker after this long (ms, default 60000; 0 keeps it). */
  idleMs?: number;
}

interface Pending {
  resolve: (reply: Extract<PlaytestReply, { type: 'done' | 'failed' | 'warmed' }>) => void;
  reject: (err: Error) => void;
  onProgress?: (p: PlaytestProgress) => void;
  timer: ReturnType<typeof setTimeout>;
}

const START_TIMEOUT_MS = 15_000;
const DEFAULT_SIM = 240;
const DEFAULT_BUDGET = 20_000;

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./playtest.worker.ts', import.meta.url), { type: 'module', name: 'aether-playtest' }) as unknown as WorkerLike;
}

function abortError(): Error {
  return Object.assign(new Error('playtest cancelled'), { name: 'AbortError' });
}

/** Runs playtests in a worker with a main-thread fallback. */
export class PlaytestClient {
  private worker: WorkerLike | null = null;
  private started = false;
  private readonly pending = new Map<number, Pending>();
  private readonly factory: (() => WorkerLike) | null;
  private readonly mainThread: MainThreadPlaytest | undefined;
  private readonly slackMs: number;
  private readonly idleMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private broken = false;
  private disposed = false;

  constructor(opts: PlaytestClientOptions = {}) {
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    this.mainThread = opts.mainThread;
    this.slackMs = Math.max(0, opts.slackMs ?? 20_000);
    this.idleMs = Math.max(0, opts.idleMs ?? 60_000);
  }

  /** True while the worker can be used. */
  get usesWorkers(): boolean {
    return this.factory !== null && !this.broken && !this.disposed;
  }

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    if (!this.usesWorkers || !this.factory) throw new PlaytestWorkerUnavailableError('the playtest worker is unavailable');
    let worker: WorkerLike;
    try {
      worker = this.factory();
    } catch (err) {
      this.broken = true;
      throw new PlaytestWorkerUnavailableError(`could not start the playtest worker: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.worker = worker;
    this.started = false;
    worker.onmessage = (e: MessageEvent) => this.onMessage(worker, e.data);
    worker.onerror = () => {
      if (this.worker !== worker) return;
      if (!this.started) this.broken = true;
      this.kill(new PlaytestWorkerUnavailableError(this.started ? 'the playtest worker crashed' : 'the playtest worker failed to start'));
    };
    return worker;
  }

  private onMessage(from: WorkerLike, data: unknown): void {
    if (this.worker !== from) return;
    const msg = parsePlaytestReply(data);
    if (!msg) return;
    if (msg.type === 'ready') {
      this.started = true;
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      try {
        p.onProgress?.(msg.progress);
      } catch {
        /* listeners never break the protocol */
      }
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
    this.scheduleIdle();
  }

  private kill(err: Error): void {
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
    } catch {
      /* already gone */
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.idleMs === 0 || this.disposed || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) this.kill(new Error('idle'));
    }, this.idleMs);
  }

  private request(body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal, onProgress?: Pending['onProgress']): Promise<Extract<PlaytestReply, { type: 'done' | 'failed' | 'warmed' }>> {
    if (signal?.aborted) return Promise.reject(abortError());
    const worker = this.ensure();
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const limit = this.started ? timeoutMs : Math.max(timeoutMs, START_TIMEOUT_MS);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const wasStarted = this.started;
        if (!wasStarted) this.broken = true;
        reject(wasStarted ? new PlaytestTimeoutError(`the playtest took longer than ${Math.round(limit / 1000)} s and was stopped`) : new PlaytestWorkerUnavailableError('the playtest worker did not start'));
        this.kill(new PlaytestTimeoutError('the playtest worker was restarted'));
      }, limit);
      const onAbort = (): void => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        try {
          worker.postMessage({ type: 'cancel', id });
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
      this.pending.set(id, { resolve: done(resolve), reject: done(reject), timer, ...(onProgress ? { onProgress } : {}) });
      try {
        worker.postMessage({ ...body, id });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new PlaytestWorkerUnavailableError(`could not send to the playtest worker: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  /** Load the bot in the worker ahead of time (idle prefetch). Never throws. */
  warm(): void {
    if (!this.usesWorkers) return;
    this.request({ type: 'warm' }, this.slackMs + START_TIMEOUT_MS).then(
      () => this.scheduleIdle(),
      () => undefined,
    );
  }

  /** Play `world`; never throws. */
  async run(world: WorldDoc, opts: PlaytestRunOptions): Promise<PlaytestOutcome> {
    const maxSim = opts.maxSimSeconds ?? DEFAULT_SIM;
    const budget = opts.budgetMs ?? DEFAULT_BUDGET;
    if (this.usesWorkers) {
      try {
        const reply = await this.request(
          { type: 'run', kind: opts.kind, world, options: { maxSimSeconds: maxSim, budgetMs: budget, trace: opts.trace !== false } },
          budget + this.slackMs,
          opts.signal,
          opts.onProgress,
        );
        if (reply.type === 'done') return { ok: true, report: reply.report as PlaytestReport, worker: true };
        if (reply.type === 'failed') return { ok: false, error: reply.error, cancelled: reply.cancelled, worker: true };
        return { ok: false, error: `unexpected playtest reply '${reply.type}'`, cancelled: false, worker: true };
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (e.name === 'AbortError') return { ok: false, error: 'playtest cancelled', cancelled: true, worker: true };
        if (e instanceof PlaytestTimeoutError) return { ok: false, error: e.message, cancelled: false, worker: true };
        if (!(e instanceof PlaytestWorkerUnavailableError)) return { ok: false, error: e.message.slice(0, 600), cancelled: false, worker: true };
        // Worker unavailable or crashed: play on the main thread instead.
      }
    }
    if (!this.mainThread) return { ok: false, error: 'the playtest worker is unavailable', cancelled: false, worker: false };
    try {
      const report = await this.mainThread(world, opts);
      return { ok: true, report, worker: false };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const cancelled = e.name === 'AbortError';
      return { ok: false, error: cancelled ? 'playtest cancelled' : e.message.slice(0, 600), cancelled, worker: false };
    }
  }

  /** Stop the worker. */
  dispose(): void {
    this.disposed = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.kill(new PlaytestWorkerUnavailableError('the playtest client was disposed'));
  }
}
