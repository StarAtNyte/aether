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
import type { GeneratorDef } from '@aether/core';
import type { Logger } from './logger';

/** Outcome of a generator validation. `unavailable` means "try again later" (queue full / worker down). */
export type GeneratorCheck = { ok: true } | { ok: false; error: string; unavailable?: true };

/** Validates a schema-valid generator def by actually running it. */
export type GeneratorValidator = (def: GeneratorDef) => Promise<GeneratorCheck>;

/** A validator backed by a worker that must be disposed on shutdown. */
export interface DisposableGeneratorValidator extends GeneratorValidator {
  /** Terminate the worker and fail any pending checks. */
  dispose(): Promise<void>;
}

/** Tunables of {@link GeneratorValidationPool}. */
export interface ValidationPoolOptions {
  /** Sandbox time budget per dry run (ms). */
  timeoutMs: number;
  /** Maximum queued (not yet running) checks. Default 8. */
  maxQueue?: number;
  /** Time allowed for the worker to boot (ms). Default 20 000. */
  startupTimeoutMs?: number;
  /** Worker V8 heap caps. */
  resourceLimits?: { maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number };
  logger: Logger;
}

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

interface Job {
  id: number;
  def: GeneratorDef;
  resolve: (check: GeneratorCheck) => void;
}

type WorkerMessage = { type: 'ready' } | { type: 'fatal'; error: string } | { type: 'result'; id: number; ok: boolean; error?: string };

function parseMessage(raw: unknown): WorkerMessage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'ready') return { type: 'ready' };
  if (m.type === 'fatal') return { type: 'fatal', error: typeof m.error === 'string' ? m.error : 'worker failed' };
  if (m.type === 'result' && typeof m.id === 'number' && typeof m.ok === 'boolean') {
    return { type: 'result', id: m.id, ok: m.ok, ...(typeof m.error === 'string' ? { error: m.error } : {}) };
  }
  return null;
}

/** Serial worker-thread pool (size 1) running generator dry runs off the event loop. */
export class GeneratorValidationPool {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private readonly queue: Job[] = [];
  private active: Job | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private nextId = 1;
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly maxQueue: number;
  private readonly startupTimeoutMs: number;
  private readonly limits: { maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number };
  private readonly logger: Logger;

  constructor(opts: ValidationPoolOptions) {
    this.timeoutMs = Math.max(10, Math.min(5_000, Math.round(opts.timeoutMs)));
    this.maxQueue = Math.max(1, opts.maxQueue ?? 8);
    this.startupTimeoutMs = opts.startupTimeoutMs ?? 20_000;
    this.limits = opts.resourceLimits ?? DEFAULT_WORKER_LIMITS;
    this.logger = opts.logger;
  }

  /** Boot the worker; resolves false when it cannot start (e.g. procgen missing). */
  start(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) this.killWorker();
        resolve(ok);
      };
      let worker: Worker;
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
      } catch (err) {
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
      worker.on('message', (raw: unknown) => {
        const msg = parseMessage(raw);
        if (!msg) return;
        if (msg.type === 'ready') done(true);
        else if (msg.type === 'fatal') {
          this.logger.warn('generator validation worker failed to load', { error: msg.error });
          done(false);
        } else this.onResult(msg.id, msg.ok, msg.error);
      });
      worker.on('error', (err: unknown) => {
        this.logger.warn('generator validation worker error', { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      });
      worker.on('exit', () => {
        if (this.worker !== worker) return;
        this.worker = null;
        this.ready = null;
        done(false);
        this.failActive('generator crashed the sandbox (resource limit exceeded)');
      });
    });
    return this.ready;
  }

  /** Queue a dry run of `def`. */
  validate(def: GeneratorDef): Promise<GeneratorCheck> {
    if (this.disposed) return Promise.resolve({ ok: false, error: 'validator is shut down', unavailable: true });
    if (this.queue.length >= this.maxQueue) {
      return Promise.resolve({ ok: false, error: 'too many generator checks in progress', unavailable: true });
    }
    return new Promise<GeneratorCheck>((resolve) => {
      this.queue.push({ id: this.nextId++, def, resolve });
      void this.pump();
    });
  }

  /** Terminate the worker and fail everything pending. */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const job of this.queue.splice(0)) job.resolve({ ok: false, error: 'validator is shut down', unavailable: true });
    this.failActive('validator is shut down');
    await this.killWorker();
  }

  private async pump(): Promise<void> {
    if (this.active || this.queue.length === 0 || this.disposed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    const ok = await this.start();
    if (this.active !== job) return;
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

  private onResult(id: number, ok: boolean, error: string | undefined): void {
    const job = this.active;
    if (!job || job.id !== id) return;
    this.finish(job, ok ? { ok: true } : { ok: false, error: error ?? 'generator failed to run' });
  }

  private failActive(error: string): void {
    if (this.active) this.finish(this.active, { ok: false, error });
  }

  private finish(job: Job, check: GeneratorCheck): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.active === job) this.active = null;
    job.resolve(check);
    void this.pump();
  }

  private async killWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    if (worker) await worker.terminate();
  }
}

/**
 * Build a worker-backed validator. Resolves to `null` (validation skipped)
 * when the worker cannot boot, e.g. because `@aether/procgen` is unavailable.
 */
export async function loadSandboxValidator(
  logger: Logger,
  timeoutMs: number,
  opts: { maxQueue?: number; resourceLimits?: ValidationPoolOptions['resourceLimits'] } = {},
): Promise<DisposableGeneratorValidator | null> {
  const pool = new GeneratorValidationPool({ logger, timeoutMs, ...opts });
  if (!(await pool.start())) {
    logger.warn('generator sandbox unavailable; skipping execution checks');
    await pool.dispose();
    return null;
  }
  const validator = ((def: GeneratorDef) => pool.validate(def)) as DisposableGeneratorValidator;
  validator.dispose = () => pool.dispose();
  return validator;
}
