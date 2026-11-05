/**
 * The page's side of worker generation: a pool of trusted generation lanes (gen.worker.ts) next to the locked-down
 * sandbox pool, so no generator, validation or vertex-stream work runs on the main thread.
 *
 * - Built-in generators run in a lane (`gen`), cache first.
 * - Custom generators: a lane looks the cache up (`lookup`); on a miss the sandbox runs the source and its raw reply is
 *   handed to a lane (`post`) to be validated, prepared and stored. The page only forwards transferred buffers.
 * - Jobs wait in one queue, lowest priority first (the caller passes the distance to the view), and a burst queued in
 *   one task is ordered before anything is sent. Each lane holds up to {@link LANE_DEPTH} jobs, so a busy page never
 *   leaves a lane idle between two replies. Lanes are spawned lazily, stopped after a while idle, and replaced after a
 *   crash or a job over its time budget.
 * - Every failure of the machinery (no workers, a crash, a timeout) is a {@link LaneFailure}: callers fall back to the
 *   old path. A generator's own error (invalid output) is an ordinary Error.
 */
import type { GeneratorDef, Json } from '@aether/core';
import { validateOutput, type GenerateJob, type WorkerLike } from '@aether/procgen';
import type { GeneratorOutput, SandboxRunner } from '../types';
import { checkOutputShape, parseGenReply, rawTransfer, type GenRequest, type LaneTimes } from './gen-protocol';

/** The generation machinery failed (not the generator): fall back. */
export class LaneFailure extends Error {
  override name = 'LaneFailure';
}

/** Options of {@link GenPool}. */
export interface GenPoolOptions {
  /** Number of lanes (default 2, clamped to 1..8). */
  lanes?: number;
  /** Time budget of one job once it runs, in ms (default 60000). A lane's start-up gets the same again. */
  timeoutMs?: number;
  /** Stop a lane after this long without work (default 30000; 0 keeps lanes). */
  idleTimeoutMs?: number;
  /**
   * Wall-clock budget of one custom generator run in the sandbox while a world builds (default 15000 ms). Runs share
   * the CPU with each other and with the page, so the sandbox's interactive budget (3 s) would fail heavy pieces
   * that take a second alone.
   */
  sandboxTimeoutMs?: number;
  /** Worker factory (tests, custom bundlers). */
  createWorker?: () => WorkerLike;
}

/** Counters for probes and the debug overlay. */
export interface GenPoolStats {
  /** Outputs served from the persistent cache. */
  hits: number;
  /** Built-in generator runs in lanes. */
  generated: number;
  /** Sandbox outputs validated and prepared in lanes. */
  posted: number;
  /** Lane failures that fell back to the old path. */
  fallbacks: number;
  /** Lane milliseconds per step, summed over jobs. */
  laneMs: LaneTimes;
}

/** Jobs a lane holds at once (one running, the next ones in its message queue; cache reads overlap). */
export const LANE_DEPTH = 3;
/** Lookups jump the queue: they are cheap and decide whether a sandbox run is needed at all. */
const LOOKUP_FIRST = -1e9;

interface Job {
  id: number;
  request: GenRequest;
  transfer: Transferable[];
  priority: number;
  resolve: (out: GeneratorOutput | null) => void;
  reject: (e: Error) => void;
}

interface Lane {
  worker: WorkerLike | null;
  ready: boolean;
  /** Jobs sent, oldest first (the lane answers in order). */
  jobs: Job[];
  timer: ReturnType<typeof setTimeout> | null;
  idle: ReturnType<typeof setTimeout> | null;
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module', name: 'aether-gen' }) as unknown as WorkerLike;
}

/** Trusted generation lanes with a persistent geometry cache behind them. */
export class GenPool {
  readonly stats: GenPoolStats = { hits: 0, generated: 0, posted: 0, fallbacks: 0, laneMs: { read: 0, generate: 0, validate: 0, prepare: 0, encode: 0 } };
  private readonly lanes: Lane[];
  private readonly queue: Job[] = [];
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly sandboxTimeoutMs: number;
  private readonly factory: () => WorkerLike;
  private nextId = 1;
  private pumpQueued = false;
  private disposed = false;

  constructor(opts: GenPoolOptions = {}) {
    const n = Math.min(8, Math.max(1, Math.round(opts.lanes ?? 2)));
    this.lanes = Array.from({ length: n }, () => ({ worker: null, ready: false, jobs: [], timer: null, idle: null }));
    this.timeoutMs = Math.max(100, opts.timeoutMs ?? 60_000);
    this.idleTimeoutMs = Math.max(0, opts.idleTimeoutMs ?? 30_000);
    this.sandboxTimeoutMs = Math.max(50, opts.sandboxTimeoutMs ?? 15_000);
    this.factory = opts.createWorker ?? defaultWorker;
  }

  /** Number of lanes. */
  get size(): number {
    return this.lanes.length;
  }

  /** Jobs waiting or running. */
  get pending(): number {
    let n = this.queue.length;
    for (const l of this.lanes) n += l.jobs.length;
    return n;
  }

  /** Run a built-in generator in a lane (cache first). Rejects with {@link LaneFailure} when the lanes cannot. */
  async builtin(generator: string, params: Record<string, Json>, seed: number, job: GenerateJob): Promise<GeneratorOutput> {
    const out = await this.submit({ type: 'gen', id: 0, key: job.key, generator: String(generator).slice(0, 64), params, seed }, [], job.priority);
    if (!out) throw new LaneFailure('no output');
    return out;
  }

  /**
   * Run a custom generator: cache, else the sandbox and a lane's validation. Falls back to the sandbox's own
   * (main-thread) validation when the lanes fail.
   */
  async custom(sandbox: SandboxRunner, def: GeneratorDef, params: Record<string, Json>, seed: number, job: GenerateJob): Promise<GeneratorOutput> {
    let lanes = true;
    try {
      const hit = await this.submit({ type: 'lookup', id: 0, key: job.key }, [], LOOKUP_FIRST + job.priority);
      if (hit) return hit;
    } catch (e) {
      if (!(e instanceof LaneFailure)) throw e;
      lanes = false;
    }
    const run = { priority: job.priority, timeoutMs: this.sandboxTimeoutMs };
    if (lanes && sandbox.runRaw) {
      const raw = await sandbox.runRaw(def, params, seed, run);
      try {
        const out = await this.submit({ type: 'post', id: 0, key: job.key, raw }, rawTransfer(raw), job.priority);
        if (!out) throw new LaneFailure('no output');
        return out;
      } catch (e) {
        if (!(e instanceof LaneFailure)) throw e;
        // The raw buffers went to the lane that failed: run again with validation on this thread.
      }
    }
    this.stats.fallbacks++;
    const out = await sandbox.run(def, params, seed, run);
    const v = validateOutput(out);
    if (!v.ok) throw new Error(`custom generator "${def.id}" returned invalid output: ${v.error}`);
    return v.output;
  }

  private submit(request: GenRequest, transfer: Transferable[], priority: number): Promise<GeneratorOutput | null> {
    if (this.disposed) return Promise.reject(new LaneFailure('generation pool disposed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.queue.push({ id, request: { ...request, id }, transfer, priority: Number.isFinite(priority) ? priority : 0, resolve, reject });
      this.pumpSoon();
    });
  }

  private pumpSoon(): void {
    if (this.pumpQueued) return;
    this.pumpQueued = true;
    queueMicrotask(() => {
      this.pumpQueued = false;
      this.pump();
    });
  }

  private takeNext(): Job | undefined {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) if (best < 0 || (this.queue[i] as Job).priority < (this.queue[best] as Job).priority) best = i;
    return best < 0 ? undefined : this.queue.splice(best, 1)[0];
  }

  private pump(): void {
    if (this.disposed) return;
    // Fill the emptiest lanes first, one job at a time, so work spreads over every lane before any lane takes a second.
    for (let depth = 0; depth < LANE_DEPTH; depth++) {
      for (const lane of this.lanes) {
        if (lane.jobs.length > depth) continue;
        const job = this.takeNext();
        if (!job) {
          if (lane.jobs.length === 0) this.scheduleIdle(lane);
          continue;
        }
        this.dispatch(lane, job);
      }
    }
  }

  private dispatch(lane: Lane, job: Job): void {
    if (lane.idle) clearTimeout(lane.idle);
    lane.idle = null;
    if (!lane.worker) {
      try {
        const w = this.factory();
        w.onmessage = (e: MessageEvent) => this.onMessage(lane, e.data);
        w.onerror = () => this.crash(lane, new LaneFailure('a generation worker crashed'));
        lane.worker = w;
        lane.ready = false;
      } catch (e) {
        job.reject(new LaneFailure(`no generation worker: ${e instanceof Error ? e.message : String(e)}`));
        this.pumpSoon();
        return;
      }
    }
    lane.jobs.push(job);
    if (lane.jobs.length === 1) this.arm(lane);
    try {
      lane.worker.postMessage(job.request, job.transfer);
    } catch (e) {
      this.crash(lane, new LaneFailure(`could not reach a generation worker: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  /** The clock of the oldest job of a lane (restarted by every reply). */
  private arm(lane: Lane): void {
    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = null;
    if (lane.jobs.length === 0) return;
    const ms = lane.ready ? this.timeoutMs : this.timeoutMs * 2;
    lane.timer = setTimeout(() => this.crash(lane, new LaneFailure(`a generation job took longer than ${Math.round(ms / 1000)} s`)), ms);
  }

  private onMessage(lane: Lane, data: unknown): void {
    const msg = parseGenReply(data);
    if (!msg) return;
    if (msg.type === 'ready') {
      lane.ready = true;
      return;
    }
    const at = lane.jobs.findIndex((j) => j.id === msg.id);
    if (at < 0) return;
    const job = lane.jobs.splice(at, 1)[0] as Job;
    this.arm(lane);
    if (!msg.ok) job.reject(new Error(msg.error));
    else {
      if (msg.times) {
        const t = this.stats.laneMs;
        t.read += msg.times.read;
        t.generate += msg.times.generate;
        t.validate += msg.times.validate;
        t.prepare += msg.times.prepare;
        t.encode += msg.times.encode;
      }
      if (msg.output === null) job.resolve(null);
      else if (!checkOutputShape(msg.output)) job.reject(new LaneFailure('a generation worker returned malformed output'));
      else {
        if (msg.hit) this.stats.hits++;
        else if (job.request.type === 'gen') this.stats.generated++;
        else if (job.request.type === 'post') this.stats.posted++;
        job.resolve(msg.output);
      }
    }
    this.pump();
  }

  private crash(lane: Lane, err: Error): void {
    const jobs = lane.jobs.splice(0);
    this.kill(lane);
    this.stats.fallbacks++;
    for (const job of jobs) job.reject(err);
    this.pumpSoon();
  }

  private kill(lane: Lane): void {
    if (lane.timer) clearTimeout(lane.timer);
    if (lane.idle) clearTimeout(lane.idle);
    lane.timer = null;
    lane.idle = null;
    if (lane.worker) {
      lane.worker.onmessage = null;
      lane.worker.onerror = null;
      try {
        lane.worker.terminate();
      } catch {
        // gone already
      }
    }
    lane.worker = null;
    lane.ready = false;
  }

  private scheduleIdle(lane: Lane): void {
    if (lane.idle || this.idleTimeoutMs === 0 || !lane.worker || lane.jobs.length > 0) return;
    lane.idle = setTimeout(() => {
      lane.idle = null;
      if (lane.jobs.length === 0) this.kill(lane);
    }, this.idleTimeoutMs);
  }

  /** Stop every lane; waiting and running jobs reject with {@link LaneFailure}. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const err = new LaneFailure('generation pool disposed');
    for (const lane of this.lanes) {
      const jobs = lane.jobs.splice(0);
      this.kill(lane);
      for (const job of jobs) job.reject(err);
    }
    for (const job of this.queue.splice(0)) job.reject(err);
  }
}
