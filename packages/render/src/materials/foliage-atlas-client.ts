import { gateWorker } from '@aether/core';
import type { FoliageKind } from '@aether/procgen/foliage';

interface AtlasWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}
interface Pending { size: number; resolve(pixels: Uint8Array | null): void }

/** One lazy worker per foliage cache. Pixel buffers transfer ownership instead of being copied. */
export class FoliageAtlasClient {
  private worker: AtlasWorker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private failed = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly factory: (() => AtlasWorker) | null = typeof Worker === 'undefined' ? null :
    () => gateWorker(new Worker(new URL('./foliage-atlas.worker.ts', import.meta.url), { type: 'module', name: 'aether-foliage-atlas' }), 'load') as AtlasWorker,
    private readonly timeoutMs = 30000) {}

  compose(kind: FoliageKind, size: number, base: string | null): Promise<Uint8Array | null> {
    if (this.disposed || this.failed || !this.factory || !Number.isInteger(size) || size < 32 || size > 1024 || (size & (size - 1)) !== 0) return Promise.resolve(null);
    try {
      // Worker fetch URLs otherwise resolve relative to the worker module, not the document.
      if (base !== null && typeof document !== 'undefined') base = new URL(base, document.baseURI).href;
      if (!this.worker) {
        const worker = this.factory();
        this.worker = worker;
        worker.onmessage = event => { if (this.worker === worker) this.reply(event.data); };
        worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.fail(); };
      }
      const worker = this.worker;
      const id = this.nextId++;
      return new Promise(resolve => {
        const idle = this.pending.size === 0;
        this.pending.set(id, { size, resolve });
        if (idle) this.arm();
        try { worker.postMessage({ id, kind, size, base }); }
        catch { this.fail(); }
      });
    } catch { this.fail(); return Promise.resolve(null); }
  }

  private reply(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const { id, data } = raw as { id?: unknown; data?: unknown };
    if (typeof id !== 'number') return;
    const request = this.pending.get(id);
    if (!request) return;
    // Null means unsupported canvas, unavailable photos, or failed composition.
    if (data !== null && (!(data instanceof ArrayBuffer) || data.byteLength !== request.size * request.size * 4)) {
      this.fail(); return;
    }
    this.pending.delete(id);
    request.resolve(data === null ? null : new Uint8Array(data as ArrayBuffer));
    this.arm();
  }

  /** Progress watchdog: queued requests get a full budget after every completed atlas. */
  private arm(): void {
    clearTimeout(this.timer);
    this.timer = this.pending.size ? setTimeout(() => this.fail(), this.timeoutMs) : undefined;
  }

  private fail(): void { this.failed = true; this.reset(); }

  /** Changing photo sources cancels old work and releases the worker's decoded sprite sheet. */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    for (const request of this.pending.values()) request.resolve(null);
    this.pending.clear();
  }

  dispose(): void { this.disposed = true; this.reset(); }
}
