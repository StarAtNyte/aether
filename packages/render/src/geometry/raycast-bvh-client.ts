import type { TriangleBvh } from './raycast-bvh-build';

export type BvhBuffers = Pick<TriangleBvh, 'boxes' | 'nodes' | 'tris' | 'nodeCount' | 'triangleCount'>;
export interface BvhWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

/** Shared, lazy warmup worker. Source buffers are cloned, never detached from live meshes. */
export class BvhBuildClient {
  private worker: BvhWorker | null = null;
  private readonly pending = new Map<number, { positions: Float32Array; index: Uint16Array | Uint32Array | null; triangles: number; resolve(value: BvhBuffers | null): void }>();
  private active: number | null = null;
  private nextId = 1;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly factory: (() => BvhWorker) | null = typeof Worker === 'undefined' ? null :
    () => new Worker(new URL('./raycast-bvh.worker.ts', import.meta.url), { type: 'module', name: 'aether-raycast-bvh' }),
    private readonly timeoutMs = 30000, private readonly idleMs = 15000) {}

  get available(): boolean { return !this.failed && this.factory !== null; }

  build(positions: Float32Array, index: Uint16Array | Uint32Array | null, triangles: number): Promise<BvhBuffers | null> {
    if (this.failed || !this.factory) return Promise.resolve(null);
    try {
      if (!this.worker) {
        const worker = this.factory();
        this.worker = worker;
        worker.onmessage = event => { if (this.worker === worker) this.reply(event.data); };
        worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.fail(); };
      }
      const id = this.nextId++;
      return new Promise(resolve => {
        const idle = this.pending.size === 0;
        this.pending.set(id, { positions, index, triangles, resolve });
        if (idle) this.arm();
        this.submit();
      });
    } catch { this.fail(); return Promise.resolve(null); }
  }

  /** Only one copied input is resident in the worker; the rest retain existing source references. */
  private submit(): void {
    if (this.active !== null || !this.worker) return;
    const next = this.pending.entries().next().value;
    if (!next) return;
    const [id, job] = next;
    this.active = id;
    try { this.worker.postMessage({ id, positions: job.positions, index: job.index, triangles: job.triangles }); }
    catch { this.fail(); }
  }

  private reply(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const { id, result } = raw as { id?: number; result?: BvhBuffers | null };
    const job = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (!job || id !== this.active) return;
    if (result !== null && (!result || result.triangleCount !== job.triangles || !Number.isSafeInteger(result.nodeCount)
      || result.nodeCount < 1 || result.nodeCount > job.triangles * 2
      || !(result.boxes instanceof Float32Array) || result.boxes.length !== result.nodeCount * 6
      || !(result.nodes instanceof Uint32Array) || result.nodes.length !== result.nodeCount * 2
      || !(result.tris instanceof Uint32Array) || result.tris.length !== job.triangles)) { this.fail(); return; }
    this.pending.delete(id!);
    this.active = null;
    job.resolve(result);
    this.arm();
    this.submit();
  }

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.pending.size) this.fail(); else this.reset(); }, this.pending.size ? this.timeoutMs : this.idleMs);
  }
  private fail(): void { this.failed = true; this.reset(); }
  private reset(): void {
    clearTimeout(this.timer);
    const worker = this.worker; this.worker = null;
    if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
    for (const job of this.pending.values()) job.resolve(null);
    this.pending.clear();
    this.active = null;
  }
  dispose(): void { this.failed = true; this.reset(); }
}
