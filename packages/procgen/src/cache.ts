/**
 * LRU cache of generator outputs keyed by generator id + stable params +
 * seed + source hash. Outputs are shared: treat them as immutable.
 */
import { stableStringify, type ProceduralShape } from '@aether/core';
import type { GeneratorOutput } from './types';

/** Seed used when a procedural shape does not specify one. */
export const DEFAULT_SEED = 1;

/** Stable cache key for a procedural shape (params serialized with sorted keys). */
export function generatorCacheKey(shape: ProceduralShape, sourceHash?: number): string {
  const seed = shape.seed ?? DEFAULT_SEED;
  return `${shape.generator}|${seed}|${sourceHash ?? 0}|${stableStringify(shape.params ?? {})}`;
}

/** Default byte budget of a {@link GeneratorCache} (typed-array payload of all entries). */
export const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;

/**
 * Bytes held by an output's typed arrays (mesh parts and colliders). This is
 * what a cache entry keeps alive; object overhead is negligible next to it.
 */
export function outputBytes(out: GeneratorOutput): number {
  let n = 0;
  for (const p of out.parts) {
    n += p.positions.byteLength + p.normals.byteLength + p.indices.byteLength + (p.uvs?.byteLength ?? 0) + (p.colors?.byteLength ?? 0) + (p.splat?.byteLength ?? 0);
  }
  for (const c of out.colliders) {
    if (c.kind === 'hull') n += c.points.byteLength;
    else if (c.kind === 'trimesh') n += c.positions.byteLength + c.indices.byteLength;
    else if (c.kind === 'heightfield') n += c.heights.byteLength;
  }
  return n;
}

/**
 * Least-recently-used cache of {@link GeneratorOutput}s, bounded both by
 * entry count and by the bytes of their typed arrays (a few large terrains
 * must not pin hundreds of megabytes). An entry larger than the whole byte
 * budget is not cached at all.
 */
export class GeneratorCache {
  private readonly entries = new Map<string, { out: GeneratorOutput; bytes: number }>();
  private readonly maxEntries: number;
  private maxBytes: number;
  private totalBytes = 0;

  /**
   * @param maxEntries entry cap (default 128)
   * @param maxBytes byte cap over all entries (default {@link DEFAULT_CACHE_BYTES})
   */
  constructor(maxEntries = 128, maxBytes = DEFAULT_CACHE_BYTES) {
    this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 128;
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : DEFAULT_CACHE_BYTES;
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Bytes currently held (see {@link outputBytes}). */
  get bytes(): number {
    return this.totalBytes;
  }

  /** Byte budget. */
  get byteLimit(): number {
    return this.maxBytes;
  }

  /** Change the byte budget (memory pressure); evicts least recently used entries immediately. */
  setByteLimit(maxBytes: number): void {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) return;
    this.maxBytes = Math.floor(maxBytes);
    this.evict();
  }

  /** Get and mark as most recently used. */
  get(key: string): GeneratorOutput | undefined {
    const v = this.entries.get(key);
    if (v !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, v);
    }
    return v?.out;
  }

  /** Insert/replace, evicting the least recently used entries beyond either cap. */
  set(key: string, v: GeneratorOutput): void {
    this.remove(key);
    const bytes = outputBytes(v);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { out: v, bytes });
    this.totalBytes += bytes;
    this.evict();
  }

  private remove(key: string): void {
    const old = this.entries.get(key);
    if (!old) return;
    this.entries.delete(key);
    this.totalBytes -= old.bytes;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
  }

  /** Stable cache key for a procedural shape (params serialized with sorted keys). */
  key(shape: ProceduralShape, sourceHash?: number): string {
    return generatorCacheKey(shape, sourceHash);
  }

  /** Drop everything. */
  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}
