/**
 * A generation lane's view of a cooked package (gen.worker.ts): the entries of the package's packs, read by geometry-cache
 * key. A pack is fetched once per lane (the browser's HTTP cache serves the other lanes and later visits; the files are
 * immutable) and kept while it is useful, under a byte cap. Every failure reads as a miss: the lane then generates.
 */
import type { GeneratorOutput } from '../types';
import { decodeEntry } from '../geometry/ddc-codec';
import type { LaneCookIndex } from './format';

/** Pack bytes a lane keeps in memory at once (least recently used dropped first). */
export const LANE_PACK_CACHE_BYTES = 16 * 1024 * 1024;

/** An entry read from a pack: the decoded output, and its encoded bytes (to seed the geometry cache with). */
export interface CookedEntry {
  output: GeneratorOutput;
  encoded: Uint8Array;
}

type Fetcher = (url: string) => Promise<ArrayBuffer | null>;

const defaultFetch: Fetcher = async (url) => {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
};

export class LaneCookSource {
  private readonly packs = new Map<number, Promise<ArrayBuffer | null>>();
  private readonly sizes = new Map<number, number>();
  private held = 0;
  /** Entries served and packs fetched (diagnostics). */
  readonly stats = { hits: 0, misses: 0, fetches: 0, failed: 0 };

  constructor(
    private readonly index: LaneCookIndex,
    private readonly fetchPack: Fetcher = defaultFetch,
    private readonly capBytes = LANE_PACK_CACHE_BYTES,
  ) {}

  /** The geometry fingerprint the manifest gives `key` (spot check), or null. */
  fingerprint(key: string): string | null {
    const f = this.index.fingerprints;
    return f && Object.prototype.hasOwnProperty.call(f, key) ? (f[key] ?? null) : null;
  }

  /** Byte length of `key`'s entry in its pack (0: not cooked). */
  entryBytes(key: string): number {
    return this.has(key) ? (this.index.entries[key]?.[2] ?? 0) : 0;
  }

  /** Every entry key of the package. */
  keys(): string[] {
    return Object.keys(this.index.entries);
  }

  /** True when the package holds `key` (a geometry-cache key). */
  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.index.entries, key);
  }

  /** The cooked entry of `key`, or null (not cooked, a pack that cannot be fetched, a malformed entry). */
  async get(key: string): Promise<CookedEntry | null> {
    if (!this.has(key)) return null;
    const [pack, off, len] = this.index.entries[key] as [number, number, number, number];
    const buf = await this.pack(pack);
    if (!buf || off + len > buf.byteLength) {
      this.stats.misses++;
      return null;
    }
    try {
      const output = await decodeEntry(buf, off, len);
      this.stats.hits++;
      return { output, encoded: new Uint8Array(buf, off, len) };
    } catch {
      this.stats.misses++;
      return null;
    }
  }

  /** The stored bytes of `key` (a copy), or null: what seeds the geometry cache when it could not be written at once. */
  async encoded(key: string): Promise<Uint8Array | null> {
    if (!this.has(key)) return null;
    const [pack, off, len] = this.index.entries[key] as [number, number, number, number];
    const buf = await this.pack(pack);
    return buf && off + len <= buf.byteLength ? new Uint8Array(buf.slice(off, off + len)) : null;
  }

  private pack(i: number): Promise<ArrayBuffer | null> {
    let p = this.packs.get(i);
    if (p) {
      // Most recently used last.
      this.packs.delete(i);
      this.packs.set(i, p);
      return p;
    }
    const url = this.index.packs[i];
    if (url === undefined) return Promise.resolve(null);
    this.stats.fetches++;
    p = this.fetchPack(url).then((buf) => {
      if (!buf) {
        this.stats.failed++;
        this.packs.delete(i);
        return null;
      }
      this.sizes.set(i, buf.byteLength);
      this.held += buf.byteLength;
      this.trim(i);
      return buf;
    });
    this.packs.set(i, p);
    return p;
  }

  /** Drop the least recently used packs over the cap (never `keep`, the one just fetched). */
  private trim(keep: number): void {
    for (const k of this.packs.keys()) {
      if (this.held <= this.capBytes) break;
      if (k === keep || !this.sizes.has(k)) continue;
      this.held -= this.sizes.get(k) as number;
      this.sizes.delete(k);
      this.packs.delete(k);
    }
  }
}
