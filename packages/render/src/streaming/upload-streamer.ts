/**
 * Uploads the large buffers of newly mounted geometry ahead of their first use, in slices under the frame budget, so
 * neither the preparation queue nor a compile walk (which prepares a whole view at once) meets a large upload.
 *
 * The scene is scanned for meshes with geometry not seen before when it changed (the host says so), at most every
 * {@link SCAN_INTERVAL_MS}; the scan itself is cheap (a WeakSet lookup per mesh). Work pauses while programs link: GL
 * commands issued then wait behind the link in the GPU process, and a 1 MB slice took a second.
 */
import type { FrameBudget } from './frame-budget';

/** Shortest time between two scans of the scene for new geometry. */
export const SCAN_INTERVAL_MS = 250;

interface Geometry {
  addEventListener?(type: string, listener: () => void): void;
}
interface Node {
  geometry?: Geometry;
  isMesh?: boolean;
  children?: Node[];
}

export interface UploadStreamerOptions {
  /** One slice of upload work for a geometry; true once nothing is left (streaming/sliced-upload.ts). */
  step(geometry: unknown): boolean;
  budget: FrameBudget;
  /** True while work should wait (programs linking). */
  blocked(): boolean;
  /** Timers (tests). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

export class UploadStreamer {
  private readonly seen = new WeakSet<object>();
  /** Disposed before their turn: skipped. */
  private readonly gone = new WeakSet<object>();
  private readonly queue: Array<Geometry | undefined> = [];
  private head = 0;
  private timer: unknown = null;
  private lastScan = -Infinity;
  private dirty = true;
  private disposed = false;
  private readonly later: (fn: () => void, ms: number) => unknown;
  private readonly now: () => number;

  constructor(private readonly root: Node, private readonly opts: UploadStreamerOptions) {
    this.later = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.now = opts.now ?? (() => performance.now());
  }

  /** Geometries waiting. */
  get pending(): number {
    return this.queue.length - this.head;
  }

  /** The scene changed: scan it for new geometry soon. */
  invalidate(): void {
    this.dirty = true;
    this.kick(0);
  }

  private kick(ms: number): void {
    if (this.disposed || this.timer !== null) return;
    this.timer = this.later(() => {
      this.timer = null;
      this.run();
    }, ms);
  }

  private scan(): void {
    this.dirty = false;
    this.lastScan = this.now();
    const stack: Node[] = [this.root];
    while (stack.length) {
      const n = stack.pop() as Node;
      const g = n.geometry;
      if (n.isMesh && g && typeof g === 'object' && !this.seen.has(g)) {
        this.seen.add(g);
        g.addEventListener?.('dispose', () => this.gone.add(g));
        this.queue.push(g);
      }
      if (n.children) for (const c of n.children) stack.push(c);
    }
  }

  /** One turn: scan if due, then upload slices within the budget. */
  run(): void {
    if (this.disposed) return;
    const t = this.now();
    if (this.dirty) {
      if (t - this.lastScan >= SCAN_INTERVAL_MS) this.scan();
      else {
        this.kick(Math.ceil(SCAN_INTERVAL_MS - (t - this.lastScan)));
        if (this.pending === 0) return;
      }
    }
    if (this.pending === 0) {
      this.queue.length = 0;
      this.head = 0;
      return;
    }
    if (this.opts.blocked()) {
      this.kick(16);
      return;
    }
    const wait = this.opts.budget.delayMs();
    if (wait > 0) {
      this.kick(wait);
      return;
    }
    const start = this.now();
    const slice = this.opts.budget.sliceMs();
    do {
      const g = this.queue[this.head];
      if (!g || this.gone.has(g) || this.opts.step(g)) this.queue[this.head++] = undefined;
    } while (this.head < this.queue.length && this.now() - start < slice && !this.opts.blocked());
    this.opts.budget.spend(this.now() - start);
    if (this.pending > 0) this.kick(0);
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.head = 0;
  }
}
