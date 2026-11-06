import { gateWorker } from '@aether/core';
import type { TintMasks } from './tint';

export interface TintOperation { target: readonly [number, number, number]; ref: number; half?: 0 | 1; channel?: 0 | 1 }
export interface TintBakeResult { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> }
export interface TintBakeWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
interface Job { image: ImageBitmap; width: number; height: number; masks: TintMasks | null; operations: TintOperation[]; resolve(result: TintBakeResult | null): void }

/** Bounded pixel baking: shared source bitmaps/masks remain owned by their caller. */
export class TintBakeClient {
  private worker: TintBakeWorker | null = null;
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;
  private active: number | null = null;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly factory: (() => TintBakeWorker) | null = typeof Worker === 'undefined' ? null :
    () => gateWorker(new Worker(new URL('./tint-bake.worker.ts', import.meta.url), { type: 'module', name: 'aether-tint-bake' }), 'load'),
    private readonly timeoutMs = 30000, private readonly idleMs = 15000) {}

  get available(): boolean { return !this.failed && this.factory !== null; }
  bake(image: ImageBitmap, masks: TintMasks | null, operations: TintOperation[]): Promise<TintBakeResult | null> {
    if (!this.available) return Promise.resolve(null);
    try {
      if (!this.worker) {
        const worker = this.factory!(); this.worker = worker;
        worker.onmessage = event => { if (this.worker === worker) this.reply(event.data); };
        worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.fail(); };
      }
      return new Promise(resolve => {
        const idle = this.jobs.size === 0;
        this.jobs.set(this.nextId++, { image, width: image.width, height: image.height, masks, operations, resolve });
        if (idle) this.arm();
        this.submit();
      });
    } catch { this.fail(); return Promise.resolve(null); }
  }
  private submit(): void {
    if (this.active !== null || !this.worker) return;
    const entry = this.jobs.entries().next().value;
    if (!entry) return;
    const [id, job] = entry; this.active = id;
    try { this.worker.postMessage({ id, image: job.image, masks: job.masks, operations: job.operations }); }
    catch { this.fail(); }
  }
  private reply(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const { id, result } = raw as { id?: number; result?: TintBakeResult | null };
    const job = typeof id === 'number' ? this.jobs.get(id) : undefined;
    if (!job || id !== this.active) return;
    if (result !== null && (!result || result.width !== job.width || result.height !== job.height
      || !(result.pixels instanceof Uint8ClampedArray) || !(result.pixels.buffer instanceof ArrayBuffer) || result.pixels.length !== job.width * job.height * 4)) { this.fail(); return; }
    this.jobs.delete(id!); this.active = null; job.resolve(result); this.arm(); this.submit();
  }
  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.jobs.size) this.fail(); else this.reset(); }, this.jobs.size ? this.timeoutMs : this.idleMs);
  }
  private fail(): void { this.failed = true; this.reset(); }
  private reset(): void {
    clearTimeout(this.timer); const worker = this.worker; this.worker = null;
    if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
    for (const job of this.jobs.values()) job.resolve(null);
    this.jobs.clear(); this.active = null;
  }
  dispose(): void { this.failed = true; this.reset(); }
}
