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
import { parseComputeReply, type ComputeRequest } from './protocol';

/** Options of {@link ComputeClient}. */
export interface ComputeClientOptions {
  /** Per-request budget in ms (default 20000). */
  timeoutMs?: number;
  /** Terminate the worker after this long without work (default 60000; 0 keeps it). */
  idleTimeoutMs?: number;
  /** Worker factory (tests, custom bundlers); null forces inline execution. */
  createWorker?: (() => WorkerLike) | null;
}

interface Pending {
  type: 'mesh' | 'generate';
  resolve: (v: MeshOpResult | GeneratorOutput) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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

  /** True when work runs in a worker (false: inline fallback). */
  get usesWorker(): boolean {
    return this.factory !== null && !this.workerFailed;
  }

  private ensure(): WorkerLike | null {
    if (this.disposed || !this.factory || this.workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      const w = this.factory();
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
    if (!msg || msg.type === 'ready') return;
    const p = this.pending.get(msg.id);
    if (!p || p.type !== msg.type) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    this.scheduleIdle();
    if (!msg.ok) {
      p.reject(new Error(msg.error));
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
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
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

  private send<T extends MeshOpResult | GeneratorOutput>(req: ComputeRequest, transfer: Transferable[]): Promise<T> | null {
    const w = this.ensure();
    if (!w) return null;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new Error(`the operation took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped`));
        // A runaway computation: restart the worker (other requests are retried by their callers).
        this.fail(new Error('the compute worker was restarted'), true);
      }, this.timeoutMs);
      this.pending.set(req.id, { type: req.type, resolve: resolve as Pending['resolve'], reject, timer });
      try {
        w.postMessage(req, transfer);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(req.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
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

  /** Stop the worker and reject pending work. */
  dispose(): void {
    this.disposed = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.fail(new Error('compute client disposed'), true);
  }
}
