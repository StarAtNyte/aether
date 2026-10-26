/**
 * Main-thread client of the compute worker. Runs mesh operations and
 * built-in generator previews off the main thread; falls back to running
 * them inline when module workers are unavailable. Every reply is validated
 * (mesh data re-checked, generator output re-validated); a request that
 * exceeds its time budget terminates the worker (it is respawned lazily).
 */
import { cloneMeshData, type Json, type MeshData } from '@aether/core';
import type { GeneratorOutput } from '../types';
import { generateBuiltinSync, yieldToEventLoop } from '../generate';
import { validateOutput } from '../output';
import { MeshOp, parseMeshMessage, runMeshOp, type MeshOpInput, type MeshOpResult } from '../mesh-edit/run';
import type { WorkerLike } from '../sandbox/worker-sandbox';
import { parseComputeReply, parseFinishPixels, type ComputeRequest } from './protocol';
import { finishPixels, type FinishPixels } from '../finish-pixels';
import type { MaterialFinish } from '@aether/core';

/** Options of {@link ComputeClient}. */
export interface ComputeClientOptions {
  /**
   * How long the worker may go without finishing anything while it has work (default 20000). Requests wait in the
   * worker's queue, so the clock is the time since the last reply (or since the request, when it was idle), never
   * the time spent waiting behind other requests: a slow CPU that needs a minute for a hundred fast jobs is fine, a
   * job that runs 20 s is not. The worker's own start-up gets three times as long.
   */
  timeoutMs?: number;
  /** Terminate the worker after this long without work (default 60000; 0 keeps it). */
  idleTimeoutMs?: number;
  /** Worker factory (tests, custom bundlers); null forces inline execution. */
  createWorker?: (() => WorkerLike) | null;
}

interface Pending {
  type: 'mesh' | 'generate' | 'finish';
  /** Expected texture edge of a finish request (reply validation). */
  size?: number;
  resolve: (v: MeshOpResult | GeneratorOutput | FinishPixels) => void;
  reject: (e: Error) => void;
  /** The request, kept so that it can be sent again to a fresh worker when another request stalled it (none: it carried transferables). */
  retry: { req: ComputeRequest; attempts: number } | null;
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module', name: 'aether-compute' }) as unknown as WorkerLike;
}

/** Off-main-thread mesh operations and generator previews. */
export class ComputeClient {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** One watchdog for the worker: re-armed by every reply, see {@link ComputeClientOptions.timeoutMs}. */
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private booted = false;
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly factory: (() => WorkerLike) | null;
  private workerFailed = false;
  private disposed = false;

  constructor(opts: ComputeClientOptions = {}) {
    this.timeoutMs = Math.min(120_000, Math.max(100, opts.timeoutMs ?? 20_000));
    this.idleTimeoutMs = Math.max(0, opts.idleTimeoutMs ?? 60_000);
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
  }

  /** Requests still being processed by the compute worker. */
  get pendingCount(): number { return this.pending.size; }

  /** True when work runs in a worker (false: inline fallback). */
  get usesWorker(): boolean {
    return this.factory !== null && !this.workerFailed;
  }

  private ensure(): WorkerLike | null {
    if (this.disposed || !this.factory || this.workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      const w = this.factory();
      this.booted = false;
      w.onmessage = (e: MessageEvent) => this.onMessage(e.data);
      w.onerror = () => this.fail(new Error('the compute worker crashed'), true);
      this.worker = w;
      return w;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private onMessage(data: unknown): void {
    const msg = parseComputeReply(data);
    if (!msg) return;
    this.booted = true;
    if (msg.type === 'ready') {
      this.arm();
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p || p.type !== msg.type) return;
    this.pending.delete(msg.id);
    this.arm();
    this.scheduleIdle();
    if (!msg.ok) {
      p.reject(new Error(msg.error));
      return;
    }
    if (msg.type === 'finish') {
      const pixels = parseFinishPixels(msg.pixels, p.size ?? -1);
      if (!pixels) p.reject(new Error('the compute worker returned invalid texture data'));
      else p.resolve(pixels);
      return;
    }
    if (msg.type === 'mesh') {
      const mesh = parseMeshMessage(msg.mesh);
      if (!mesh) p.reject(new Error('the compute worker returned invalid mesh data'));
      else p.resolve({ mesh, ...(msg.note ? { note: msg.note } : {}) });
      return;
    }
    const v = validateOutput(msg.output);
    if (!v.ok) p.reject(new Error(`invalid generator output: ${v.error}`));
    else p.resolve(v.output);
  }

  /** Reject everything in flight; with `terminate`, drop the worker (respawned on next use). */
  private fail(err: Error, terminate: boolean): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
    this.disarm();
    if (terminate && this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* already gone */
      }
      this.worker = null;
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.idleTimeoutMs === 0 || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0 && this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    }, this.idleTimeoutMs);
  }

  private send<T extends MeshOpResult | GeneratorOutput | FinishPixels>(req: ComputeRequest, transfer: Transferable[]): Promise<T> | null {
    const w = this.ensure();
    if (!w) return null;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.id, { type: req.type, ...(req.type === 'finish' ? { size: req.size } : {}), resolve: resolve as Pending['resolve'], reject, retry: transfer.length === 0 ? { req, attempts: 0 } : null });
      try {
        w.postMessage(req, transfer);
        // Idle until now: this request starts the clock. Busy: the clock already runs from the last reply.
        if (this.watchdog === null) this.arm();
      } catch (err) {
        this.pending.delete(req.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private disarm(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /** (Re)start the stall clock while there is work in the worker. */
  private arm(): void {
    this.disarm();
    if (this.pending.size === 0 || !this.worker) return;
    const ms = this.booted ? this.timeoutMs : this.timeoutMs * 3;
    this.watchdog = setTimeout(() => this.stalled(), ms);
  }

  /**
   * Nothing came back for a whole budget. The request that has waited longest is the one that was running: it fails,
   * the worker is replaced, and the requests queued behind it are sent again (those that carried buffers cannot be).
   */
  private stalled(): void {
    this.watchdog = null;
    const first = this.pending.entries().next();
    if (first.done) return;
    const [id, culprit] = first.value;
    this.pending.delete(id);
    culprit.reject(new Error(`the operation took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped`));
    const queued = [...this.pending.entries()];
    this.pending.clear();
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
    for (const [qid, p] of queued) {
      if (!p.retry || p.retry.attempts >= 1 || this.disposed) {
        p.reject(new Error('the compute worker was restarted'));
        continue;
      }
      const w = this.ensure();
      if (!w) {
        p.reject(new Error('the compute worker was restarted'));
        continue;
      }
      this.pending.set(qid, { ...p, retry: { req: p.retry.req, attempts: p.retry.attempts + 1 } });
      try {
        w.postMessage(p.retry.req, []);
      } catch (err) {
        this.pending.delete(qid);
        p.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    this.arm();
  }

  /**
   * Run a mesh operation. The input mesh is copied (never transferred), so
   * cached document data stays intact. Rejects with a readable message.
   */
  async meshOp(op: MeshOpInput, mesh: MeshData): Promise<MeshOpResult> {
    if (this.disposed) throw new Error('compute client disposed');
    const parsed = MeshOp.safeParse(op);
    if (!parsed.success) throw new Error(`invalid mesh operation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    const copy = cloneMeshData(mesh);
    const transfer = [copy.positions.buffer, copy.indices.buffer, copy.colors?.buffer, copy.uvs?.buffer, copy.faceMaterials?.buffer].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
    const sent = this.send<MeshOpResult>({ type: 'mesh', id: this.nextId++, op: parsed.data, mesh: copy }, transfer);
    if (sent) return sent;
    await yieldToEventLoop();
    return runMeshOp(parsed.data, copy);
  }

  /** Generate a built-in generator's output off the main thread (validated). */
  async generate(generator: string, params: Record<string, Json>, seed: number): Promise<GeneratorOutput> {
    if (this.disposed) throw new Error('compute client disposed');
    const sent = this.send<GeneratorOutput>({ type: 'generate', id: this.nextId++, generator: String(generator).slice(0, 64), params, seed }, []);
    if (sent) return sent;
    await yieldToEventLoop();
    return generateBuiltinSync(generator, params, seed);
  }

  /** Synthesise the texture maps of a finish off the main thread (validated; inline fallback). */
  async finish(finish: MaterialFinish, size: number): Promise<FinishPixels> {
    if (this.disposed) throw new Error('compute client disposed');
    const n = Math.min(1024, Math.max(16, 2 ** Math.round(Math.log2(Number.isFinite(size) ? size : 256))));
    const sent = this.send<FinishPixels>({ type: 'finish', id: this.nextId++, finish, size: n }, []);
    if (sent) return sent;
    await yieldToEventLoop();
    return finishPixels(finish, n);
  }

  /** Stop the worker and reject pending work. */
  dispose(): void {
    this.disposed = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.fail(new Error('compute client disposed'), true);
  }
}
