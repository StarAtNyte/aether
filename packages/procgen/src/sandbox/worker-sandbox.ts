/**
 * Browser sandbox: a small pool of locked-down module Workers running
 * LLM-written generator bodies. A watchdog terminates (and lazily respawns)
 * any worker that exceeds its time budget; outputs are re-validated on the
 * main thread. Workers have no network/storage/messaging globals.
 */
import { GeneratorDef, inspectUntrusted, type Json } from '@aether/core';
import type { GeneratorOutput, SandboxRunner, SandboxRunOptions } from '../types';
import { PROCGEN_LIMITS } from '../limits';
import { resolveParams } from '../params';
import { validateOutput } from '../output';
import { parseWorkerMessage, type RunRequest } from './protocol';
import { staticCheckSource } from './static-check';

/** The subset of the Worker interface the pool uses (injectable for tests). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
}

/** Options of {@link createWorkerSandbox}. */
export interface WorkerSandboxOptions {
  /** Per-run wall-clock budget in ms (default 3000, clamped to 50..30000). */
  timeoutMs?: number;
  /** Number of workers (default 2, clamped to 1..8). */
  poolSize?: number;
  /** Max time for a fresh worker to load and report ready (default 10000 ms). */
  bootTimeoutMs?: number;
  /** Recycle a worker after this many runs (default 100). */
  maxRunsPerWorker?: number;
  /** Max queued runs before new runs are rejected (default 256). */
  maxQueue?: number;
  /**
   * Terminate a worker after this long without work (default 60000 ms; 0
   * keeps workers alive). An idle worker still holds a whole JavaScript
   * realm; it is respawned lazily on the next run.
   */
  idleTimeoutMs?: number;
  /** Worker factory (tests / custom bundlers). Defaults to the bundled module worker. */
  createWorker?: () => WorkerLike;
}

interface Task {
  id: number;
  request: RunRequest;
  timeoutMs: number;
  priority: number;
  /** False: resolve with the raw reply (validated by the caller, see SandboxRunner.runRaw). */
  validate: boolean;
  resolve: (out: unknown) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: WorkerLike | null;
  ready: boolean;
  runs: number;
  task: Task | null;
  timer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function defaultWorker(): WorkerLike {
  if (typeof Worker === 'undefined') throw new Error('Web Workers are not available in this environment; use createNodeSandbox on the server');
  return new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module', name: 'aether-generator-sandbox' }) as unknown as WorkerLike;
}

function clamp(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Validate a run request on the main thread; returns resolved params or throws. */
export function prepareRun(def: unknown, params: Record<string, Json>): { def: GeneratorDef; params: Record<string, Json> } {
  const parsed = GeneratorDef.safeParse(def);
  if (!parsed.success) throw new Error(`invalid generator definition: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`);
  const check = staticCheckSource(parsed.data.source);
  if (!check.ok) throw new Error(`generator "${parsed.data.id}" rejected: ${check.problems.join('; ')}`);
  const guard = inspectUntrusted(params ?? {}, { maxDepth: 16, maxNodes: 10_000, maxStringLength: 10_000 });
  if (!guard.ok) throw new Error(`invalid params at ${guard.path}: ${guard.message}`);
  return { def: parsed.data, params: resolveParams(parsed.data.params, params ?? {}) };
}

/**
 * Create the browser Worker sandbox. Workers are spawned lazily on first use.
 * Each run: static check → params resolution → worker run with watchdog →
 * main-thread output validation.
 */
export function createWorkerSandbox(opts: WorkerSandboxOptions = {}): SandboxRunner {
  const defaultTimeout = clamp(opts.timeoutMs, PROCGEN_LIMITS.DEFAULT_TIMEOUT_MS, 50, PROCGEN_LIMITS.MAX_TIMEOUT_MS);
  const poolSize = clamp(opts.poolSize, 2, 1, 8);
  const bootTimeout = clamp(opts.bootTimeoutMs, 10_000, 100, 60_000);
  const maxRuns = clamp(opts.maxRunsPerWorker, 100, 1, 1_000_000);
  const maxQueue = clamp(opts.maxQueue, 256, 1, 10_000);
  const idleTimeout = clamp(opts.idleTimeoutMs, 60_000, 0, 3_600_000);
  const factory = opts.createWorker ?? defaultWorker;
  const slots: Slot[] = Array.from({ length: poolSize }, () => ({ worker: null, ready: false, runs: 0, task: null, timer: null, idleTimer: null }));
  const queue: Task[] = [];
  let nextId = 1;
  let disposed = false;

  const clearIdle = (slot: Slot): void => {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
  };

  const kill = (slot: Slot): void => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    clearIdle(slot);
    if (slot.worker) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      try {
        slot.worker.terminate();
      } catch {
        // already gone
      }
    }
    slot.worker = null;
    slot.ready = false;
    slot.runs = 0;
  };

  const finish = (slot: Slot): Task | null => {
    const task = slot.task;
    slot.task = null;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    return task;
  };

  const startWatchdog = (slot: Slot, ms: number, message: string): void => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      const task = finish(slot);
      kill(slot);
      task?.reject(new Error(message));
      pump();
    }, ms);
  };

  const onMessage = (slot: Slot, e: MessageEvent): void => {
    const msg = parseWorkerMessage(e.data);
    if (!msg) return;
    if (msg.type === 'ready') {
      slot.ready = true;
      if (slot.task) {
        startWatchdog(slot, slot.task.timeoutMs, `generator timed out after ${slot.task.timeoutMs} ms`);
      }
      return;
    }
    if (!slot.task || msg.id !== slot.task.id) return;
    const task = finish(slot);
    if (!task) return;
    if (slot.runs >= maxRuns) kill(slot);
    if (!msg.ok) task.reject(new Error(`generator failed: ${msg.error}`));
    else if (!task.validate) task.resolve(msg.output);
    else {
      const v = validateOutput(msg.output);
      if (v.ok) task.resolve(v.output);
      else task.reject(new Error(`generator returned invalid output: ${v.error}`));
    }
    pump();
  };

  const onError = (slot: Slot, e: Event): void => {
    const task = finish(slot);
    kill(slot);
    const detail = typeof (e as ErrorEvent).message === 'string' && (e as ErrorEvent).message ? `: ${(e as ErrorEvent).message}` : '';
    task?.reject(new Error(`generator worker crashed${detail}`));
    pump();
  };

  /** Release an idle worker's realm after `idleTimeout` (respawned lazily). */
  const scheduleIdle = (slot: Slot): void => {
    clearIdle(slot);
    if (idleTimeout === 0 || disposed || !slot.worker || slot.task) return;
    slot.idleTimer = setTimeout(() => {
      slot.idleTimer = null;
      if (!slot.task) kill(slot);
    }, idleTimeout);
  };

  const dispatch = (slot: Slot, task: Task): void => {
    clearIdle(slot);
    slot.task = task;
    if (!slot.worker) {
      try {
        const w = factory();
        w.onmessage = (e) => onMessage(slot, e);
        w.onerror = (e) => onError(slot, e);
        slot.worker = w;
        slot.ready = false;
      } catch (err) {
        slot.task = null;
        task.reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }
    slot.runs++;
    if (slot.ready) startWatchdog(slot, task.timeoutMs, `generator timed out after ${task.timeoutMs} ms`);
    else startWatchdog(slot, bootTimeout, `generator sandbox failed to start within ${bootTimeout} ms`);
    try {
      slot.worker?.postMessage(task.request);
    } catch (err) {
      const t = finish(slot);
      kill(slot);
      t?.reject(new Error(`could not send generator to the sandbox: ${err instanceof Error ? err.message : String(err)}`));
    }
  };

  /** The queued task to run next: lowest priority first, then the oldest. */
  const takeNext = (): Task | undefined => {
    let best = -1;
    for (let i = 0; i < queue.length; i++) {
      if (best < 0 || (queue[i] as Task).priority < (queue[best] as Task).priority) best = i;
    }
    return best < 0 ? undefined : queue.splice(best, 1)[0];
  };

  function pump(): void {
    if (disposed) return;
    for (const slot of slots) {
      if (slot.task) continue;
      const task = takeNext();
      if (task) dispatch(slot, task);
      else scheduleIdle(slot);
    }
  }

  // A burst of runs (a whole world) is queued in one go and ordered before the first one is sent.
  let pumpQueued = false;
  const pumpSoon = (): void => {
    if (pumpQueued) return;
    pumpQueued = true;
    queueMicrotask(() => {
      pumpQueued = false;
      pump();
    });
  };

  const enqueue = (def: GeneratorDef, params: Record<string, Json>, seed: number, runOpts: SandboxRunOptions | undefined, validate: boolean): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error('sandbox disposed'));
    let prepared: { def: GeneratorDef; params: Record<string, Json> };
    try {
      prepared = prepareRun(def, params);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    // Runs about to be sent to an idle worker (the pump is one microtask away) do not count as waiting.
    if (queue.length - slots.filter((s) => !s.task).length >= maxQueue) return Promise.reject(new Error('generator sandbox queue is full'));
    const timeoutMs = clamp(runOpts?.timeoutMs, defaultTimeout, 50, PROCGEN_LIMITS.MAX_TIMEOUT_MS);
    const priority = typeof runOpts?.priority === 'number' && Number.isFinite(runOpts.priority) ? runOpts.priority : 0;
    return new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      queue.push({
        id,
        timeoutMs,
        priority,
        validate,
        resolve,
        reject,
        request: { type: 'run', id, source: prepared.def.source, params: prepared.params, seed: Number.isFinite(seed) ? Math.trunc(seed) : 0 },
      });
      pumpSoon();
    });
  };

  return {
    run(def: GeneratorDef, params: Record<string, Json>, seed: number, runOpts?: SandboxRunOptions): Promise<GeneratorOutput> {
      return enqueue(def, params, seed, runOpts, true) as Promise<GeneratorOutput>;
    },
    runRaw(def: GeneratorDef, params: Record<string, Json>, seed: number, runOpts?: SandboxRunOptions): Promise<unknown> {
      return enqueue(def, params, seed, runOpts, false);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const err = new Error('sandbox disposed');
      for (const slot of slots) {
        const task = finish(slot);
        kill(slot);
        task?.reject(err);
      }
      for (const task of queue.splice(0)) task.reject(err);
    },
  };
}

/**
 * Generator worker lanes for this device: one per hardware thread but one (the page keeps a core), and few enough that a
 * low-end PC keeps its memory (each lane holds a JavaScript realm and its output in flight): at most 4 at ≤ 8 GB of
 * device memory, 2 at ≤ 4 GB, 8 above (`navigator.deviceMemory`; Chrome reports at most 8, and a browser that does not
 * report it counts as 8). `globalThis.__AETHER_GEN_WORKERS` overrides it (tests, shared machines).
 */
export function generationLanes(): number {
  const g = globalThis as { __AETHER_GEN_WORKERS?: unknown; navigator?: { hardwareConcurrency?: number; deviceMemory?: number } };
  const forced = Number(g.__AETHER_GEN_WORKERS);
  if (Number.isFinite(forced) && forced >= 1) return Math.min(8, Math.floor(forced));
  const threads = Number(g.navigator?.hardwareConcurrency) || 2;
  const memory = Number(g.navigator?.deviceMemory) || 8;
  const byMemory = memory <= 4 ? 2 : memory <= 8 ? 4 : 8;
  return Math.max(1, Math.min(8, threads - 1, byMemory));
}
