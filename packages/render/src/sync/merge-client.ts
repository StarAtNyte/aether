import type { BufferGeometry } from 'three';
import { readMergeOutput, type MergeRequest } from './merge-wire';
export interface MergeWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
export interface MergeJob { promise: Promise<BufferGeometry | null>; cancel(): void }
interface Job { request: MergeRequest | null; resolve(value: BufferGeometry | null): void; cancelled: boolean }

/** One copied merge input in flight; canceled queued requests release source references immediately. */
export class MergeBuildClient {
  private worker: MergeWorker | null = null;
  private readonly jobs = new Map<number, Job>();
  private active: number | null = null;
  private nextId = 1;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly factory: (() => MergeWorker) | null = typeof Worker === 'undefined' ? null :
    () => new Worker(new URL('./merge.worker.ts', import.meta.url), { type: 'module', name: 'aether-merge' }),
    private readonly timeoutMs = 30000, private readonly idleMs = 15000) {}
  get available(): boolean { return !this.failed && this.factory !== null; }
  build(request: MergeRequest): MergeJob {
    if (!this.available) return { promise: Promise.resolve(null), cancel() {} };
    let id = 0;
    const promise = new Promise<BufferGeometry | null>(resolve => {
      try {
        if (!this.worker) {
          const worker = this.factory!(); this.worker = worker;
          worker.onmessage = event => { if (this.worker === worker) this.reply(event.data); };
          worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.fail(); };
        }
        id = this.nextId++; const idle = this.jobs.size === 0;
        this.jobs.set(id, { request, resolve, cancelled: false });
        if (idle) this.arm(); this.submit();
      } catch { this.fail(); resolve(null); }
    });
    return { promise, cancel: () => {
      const job = this.jobs.get(id); if (!job || job.cancelled) return;
      job.cancelled = true; job.request = null; job.resolve(null);
      if (this.active !== id) this.jobs.delete(id);
    } };
  }
  private submit(): void {
    if (this.active !== null || !this.worker) return;
    const entry = this.jobs.entries().next().value; if (!entry) return;
    const [id, job] = entry; this.active = id;
    try { this.worker.postMessage({ id, request: job.request }); }
    catch { this.fail(); }
  }
  private reply(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const { id, output } = raw as { id?: number; output?: unknown };
    const job = typeof id === 'number' ? this.jobs.get(id) : undefined;
    if (!job || id !== this.active) return;
    let geometry: BufferGeometry | null = null;
    if (!job.cancelled && output !== null) {
      geometry = readMergeOutput(output, job.request!);
      if (!geometry) { this.fail(); return; }
    }
    this.jobs.delete(id!); this.active = null; job.resolve(geometry); this.arm(); this.submit();
  }
  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.jobs.size) this.fail(); else this.reset(); }, this.jobs.size ? this.timeoutMs : this.idleMs);
  }
  private fail(): void { this.failed = true; this.reset(); }
  reset(): void {
    clearTimeout(this.timer); const worker = this.worker; this.worker = null;
    if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
    for (const job of this.jobs.values()) job.resolve(null);
    this.jobs.clear(); this.active = null;
  }
  dispose(): void { this.failed = true; this.reset(); }
}
