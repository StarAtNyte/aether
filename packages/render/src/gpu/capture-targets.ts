import { RenderTarget } from 'three';

/** LRU of capture targets. Active readbacks retain their target until they settle. */
export class CaptureTargets {
  private readonly targets = new Map<string, { target: RenderTarget; bytes: number; reads: number }>();
  constructor(private readonly maxBytes = 32 * 1024 * 1024, private readonly maxCount = 2) {}

  get(width: number, height: number): RenderTarget {
    const key = `${width}x${height}`;
    let entry = this.targets.get(key);
    if (entry) this.targets.delete(key);
    else entry = { target: new RenderTarget(width, height, { depthBuffer: true, generateMipmaps: false }), bytes: width * height * 8, reads: 0 };
    this.targets.set(key, entry);
    this.trim(entry.target);
    return entry.target;
  }

  retain(target: RenderTarget): () => void {
    const entry = [...this.targets.values()].find(value => value.target === target);
    if (!entry) throw new Error('capture target is not cached');
    entry.reads++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.reads--;
      this.trim();
    };
  }

  /** Approximate color plus depth bytes; excludes driver overhead. */
  get bytes(): number { let bytes = 0; for (const entry of this.targets.values()) bytes += entry.bytes; return bytes; }

  trim(protectedTarget?: RenderTarget): void {
    let bytes = this.bytes;
    for (const [key, entry] of this.targets) {
      if (bytes <= this.maxBytes && this.targets.size <= this.maxCount) break;
      if (entry.reads || entry.target === protectedTarget) continue;
      this.targets.delete(key);
      bytes -= entry.bytes;
      entry.target.dispose();
    }
  }

  dispose(): void {
    for (const entry of this.targets.values()) entry.target.dispose();
    this.targets.clear();
  }
}
