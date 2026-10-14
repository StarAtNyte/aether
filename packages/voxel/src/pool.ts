/**
 * VoxelJobPool — runs terrain generation and chunk meshing in up to two
 * module workers (one on low-memory or dual-core devices), with an inline
 * fallback that runs the very same handler on the main thread when workers
 * are unavailable (no module workers, Node tests) or keep failing.
 *
 * - Jobs queue on the main thread; each worker has at most
 *   {@link IN_FLIGHT} jobs at a time, so urgent work (a block edit's
 *   remesh) jumps the queue and is picked up within one job.
 * - Every reply is validated (`ChunkData.fromPacked`, `checkMesh`) and
 *   tagged with the terrain key it was computed for; replies for an older
 *   configuration resolve to null and are dropped by the caller.
 * - A job that exceeds its time budget terminates its worker (the lane is
 *   restarted for the next job); after {@link MAX_FAILURES} failures the
 *   pool switches to inline execution for the rest of the session.
 */
import type { ChunkData } from './chunk';
import { ChunkData as Chunk } from './chunk';
import { identityKey, type TerrainIdentity } from './jobs';
import type { ChunkMesh } from './mesher';
import { checkMesh, FromWorker, packedTransfer, type ToWorker } from './protocol';
import { VoxelWorkerHandler } from './worker/handler';

/** Minimal worker surface (tests inject fakes). */
export interface VoxelWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
}

/** Options of {@link VoxelJobPool}. */
export interface VoxelPoolOptions {
  /** Worker factory; null forces inline jobs. Default: a module worker when available. */
  createWorker?: (() => VoxelWorkerLike) | null;
  /** Worker count (clamped to 1…2). Default: from `navigator.deviceMemory` / `hardwareConcurrency`. */
  workers?: number;
  /** Per-job budget in ms (default 20 000). */
  timeoutMs?: number;
}

/** A generated chunk. */
export interface GeneratedChunk {
  chunk: ChunkData;
  top: number;
  ms: number;
}

/** Jobs a worker may have in flight. */
export const IN_FLIGHT = 2;
/** Worker failures after which the pool runs jobs inline. */
export const MAX_FAILURES = 3;

interface Job {
  id: number;
  key: string;
  message: ToWorker;
  transfer: ArrayBuffer[];
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  kind: 'generate' | 'mesh';
}

interface Lane {
  worker: VoxelWorkerLike;
  jobs: Map<number, { job: Job; timer: ReturnType<typeof setTimeout> }>;
  configured: string;
}

/** Workers the device can afford (1 or 2). */
export function defaultWorkerCount(): number {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const mem = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : 8;
  const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;
  return mem <= 4 || cores <= 2 ? 1 : 2;
}

function defaultWorker(): VoxelWorkerLike {
  return new Worker(new URL('./worker/voxel.worker.ts', import.meta.url), { type: 'module', name: 'aether-voxel' }) as unknown as VoxelWorkerLike;
}

/** See the module docs. */
export class VoxelJobPool {
  private readonly factory: (() => VoxelWorkerLike) | null;
  private readonly laneCount: number;
  private readonly timeoutMs: number;
  private readonly lanes: Array<Lane | null> = [];
  private readonly queue: Job[] = [];
  private readonly inline = new VoxelWorkerHandler();
  private inlineBusy = false;
  private failures = 0;
  private nextId = 1;
  private disposed = false;
  private identity: TerrainIdentity | null = null;
  private maxId = 0;
  /** Current terrain key ('' before {@link configure}). */
  key = '';
  /** Counters (tests, stats overlay). */
  readonly stats = { generated: 0, meshed: 0, genMs: 0, meshMs: 0, dropped: 0, errors: 0 };

  constructor(opts: VoxelPoolOptions = {}) {
    this.factory = opts.createWorker === null ? null : (opts.createWorker ?? (typeof Worker !== 'undefined' ? defaultWorker : null));
    this.laneCount = Math.max(1, Math.min(2, Math.floor(opts.workers ?? defaultWorkerCount())));
    this.timeoutMs = Math.max(100, opts.timeoutMs ?? 20_000);
  }

  /** True while jobs run on the main thread (no usable workers). */
  get inlineMode(): boolean {
    return this.factory === null || this.failures >= MAX_FAILURES;
  }

  /** Queued + running jobs. */
  get pending(): number {
    let n = this.queue.length;
    for (const l of this.lanes) n += l ? l.jobs.size : 0;
    return n + (this.inlineBusy ? 1 : 0);
  }

  /** Jobs the pool can usefully hold before callers should wait (keeps queues short). */
  get capacity(): number {
    return (this.inlineMode ? 1 : this.laneCount * IN_FLIGHT) + 2;
  }

  /**
   * Set the terrain configuration (registry size bounds decoded block ids).
   * Queued jobs of an older configuration resolve to null.
   */
  configure(identity: TerrainIdentity, maxBlockId: number): string {
    const key = identityKey(identity);
    this.identity = identity;
    this.maxId = maxBlockId;
    if (key === this.key) return key;
    this.key = key;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const j = this.queue[i] as Job;
      if (j.key !== key) {
        this.queue.splice(i, 1);
        this.stats.dropped++;
        j.resolve(null);
      }
    }
    this.inline.handle({ type: 'config', key, identity }) ;
    this.pump();
    return key;
  }

  /** Generate chunk (cx, cz). Resolves null when the configuration changed meanwhile. */
  generate(cx: number, cz: number, urgent = false): Promise<GeneratedChunk | null> {
    return this.submit('generate', { type: 'generate', id: 0, key: this.key, cx, cz }, [], urgent) as Promise<GeneratedChunk | null>;
  }

  /**
   * Mesh chunk (cx, cz) from its 3 × 3 neighbourhood (`chunks[(dz+1)*3+(dx+1)]`,
   * null = air) and their top heights. Resolves null when outdated.
   */
  mesh(cx: number, cz: number, chunks: ReadonlyArray<ChunkData | null>, tops: ArrayLike<number>, urgent = false): Promise<ChunkMesh | null> {
    const packed = chunks.map((c) => (c ? c.pack() : null));
    const transfer: ArrayBuffer[] = [];
    for (const p of packed) if (p) transfer.push(...packedTransfer(p));
    const t: number[] = [];
    for (let i = 0; i < 9; i++) t.push(Math.max(-1, Math.min(1024, Math.floor((tops[i] as number) ?? -1))));
    return this.submit('mesh', { type: 'mesh', id: 0, key: this.key, cx, cz, chunks: packed, tops: t }, transfer, urgent) as Promise<ChunkMesh | null>;
  }

  private submit(kind: Job['kind'], message: ToWorker, transfer: ArrayBuffer[], urgent: boolean): Promise<unknown> {
    if (this.disposed) return Promise.resolve(null);
    if (!this.key) return Promise.reject(new Error('voxel pool not configured'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      (message as { id: number }).id = id;
      const job: Job = { id, key: this.key, message, transfer, resolve, reject, kind };
      if (urgent) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed) return;
    if (this.inlineMode) {
      this.pumpInline();
      return;
    }
    for (let i = 0; i < this.laneCount && this.queue.length > 0; i++) {
      let lane = this.lanes[i] ?? null;
      if (!lane) {
        lane = this.startLane(i);
        if (!lane) {
          if (this.inlineMode) this.pumpInline();
          return;
        }
      }
      while (lane.jobs.size < IN_FLIGHT && this.queue.length > 0) {
        const job = this.queue.shift() as Job;
        if (job.key !== this.key) {
          this.stats.dropped++;
          job.resolve(null);
          continue;
        }
        this.send(i, lane, job);
      }
    }
  }

  private startLane(i: number): Lane | null {
    if (!this.factory) return null;
    let worker: VoxelWorkerLike;
    try {
      worker = this.factory();
    } catch {
      this.failures = MAX_FAILURES;
      return null;
    }
    const lane: Lane = { worker, jobs: new Map(), configured: '' };
    worker.onmessage = (e: MessageEvent) => this.onReply(i, lane, e.data);
    worker.onerror = () => this.killLane(i, lane, 'the voxel worker crashed');
    this.lanes[i] = lane;
    return lane;
  }

  private send(i: number, lane: Lane, job: Job): void {
    try {
      if (lane.configured !== this.key && this.identity) {
        lane.worker.postMessage({ type: 'config', key: this.key, identity: this.identity });
        lane.configured = this.key;
      }
      lane.worker.postMessage(job.message, job.transfer);
    } catch {
      this.queue.unshift(job);
      this.killLane(i, lane, 'could not post to the voxel worker');
      return;
    }
    const timer = setTimeout(() => this.killLane(i, lane, 'voxel job timed out'), this.timeoutMs);
    lane.jobs.set(job.id, { job, timer });
  }

  private killLane(i: number, lane: Lane, reason: string): void {
    if (this.lanes[i] !== lane) return;
    this.lanes[i] = null;
    this.failures++;
    try {
      lane.worker.terminate();
    } catch {
      /* already gone */
    }
    // Requeue its jobs at the front (they will run on a fresh lane or inline).
    const jobs = [...lane.jobs.values()];
    for (const { timer } of jobs) clearTimeout(timer);
    for (let k = jobs.length - 1; k >= 0; k--) this.queue.unshift((jobs[k] as { job: Job }).job);
    this.stats.errors++;
    if (this.failures >= MAX_FAILURES) {
      // eslint-disable-next-line no-console
      if (typeof console !== 'undefined') console.warn(`[voxel] ${reason}; running voxel jobs on the main thread`);
    }
    queueMicrotask(() => this.pump());
  }

  private onReply(i: number, lane: Lane, raw: unknown): void {
    if (this.lanes[i] !== lane) return;
    const parsed = FromWorker.safeParse(raw);
    if (!parsed.success) {
      this.killLane(i, lane, 'malformed voxel worker reply');
      return;
    }
    const msg = parsed.data;
    const entry = lane.jobs.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    lane.jobs.delete(msg.id);
    this.settle(entry.job, msg);
    this.pump();
  }

  private settle(job: Job, msg: FromWorker): void {
    if (msg.type === 'error') {
      this.stats.errors++;
      job.reject(new Error(msg.message));
      return;
    }
    if (msg.key !== this.key || job.key !== this.key) {
      this.stats.dropped++;
      job.resolve(null);
      return;
    }
    if (msg.type === 'generated') {
      const chunk = Chunk.fromPacked(msg.chunk, this.maxId);
      if (!chunk) {
        this.stats.errors++;
        job.reject(new Error('malformed generated chunk'));
        return;
      }
      this.stats.generated++;
      this.stats.genMs += msg.ms;
      job.resolve({ chunk, top: msg.top, ms: msg.ms } satisfies GeneratedChunk);
      return;
    }
    const mesh = checkMesh(msg.mesh);
    if (!mesh) {
      this.stats.errors++;
      job.reject(new Error('malformed chunk mesh'));
      return;
    }
    this.stats.meshed++;
    this.stats.meshMs += msg.ms;
    job.resolve(mesh);
  }

  /** Inline mode: one job per macrotask, so the page stays responsive between jobs. */
  private pumpInline(): void {
    if (this.inlineBusy || this.queue.length === 0 || this.disposed) return;
    this.inlineBusy = true;
    setTimeout(() => {
      this.inlineBusy = false;
      if (this.disposed) return;
      const job = this.queue.shift();
      if (job) {
        if (job.key !== this.key) {
          this.stats.dropped++;
          job.resolve(null);
        } else {
          const reply = this.inline.handle(job.message);
          if (reply) this.settle(job, reply.message);
          else job.resolve(null);
        }
      }
      this.pumpInline();
    }, 0);
  }

  /** Stop the workers; pending jobs resolve to null. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.lanes.length; i++) {
      const lane = this.lanes[i];
      if (!lane) continue;
      for (const { job, timer } of lane.jobs.values()) {
        clearTimeout(timer);
        job.resolve(null);
      }
      try {
        lane.worker.terminate();
      } catch {
        /* ignore */
      }
      this.lanes[i] = null;
    }
    for (const j of this.queue.splice(0)) j.resolve(null);
  }
}
