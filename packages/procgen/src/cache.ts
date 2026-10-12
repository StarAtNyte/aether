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

/** Least-recently-used cache of {@link GeneratorOutput}s. */
export class GeneratorCache {
  private readonly entries = new Map<string, GeneratorOutput>();
  private readonly maxEntries: number;

  constructor(maxEntries = 128) {
    this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 128;
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Get and mark as most recently used. */
  get(key: string): GeneratorOutput | undefined {
    const v = this.entries.get(key);
    if (v !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, v);
    }
    return v;
  }

  /** Insert/replace, evicting the least recently used entries beyond capacity. */
  set(key: string, v: GeneratorOutput): void {
    this.entries.delete(key);
    this.entries.set(key, v);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Stable cache key for a procedural shape (params serialized with sorted keys). */
  key(shape: ProceduralShape, sourceHash?: number): string {
    return generatorCacheKey(shape, sourceHash);
  }

  /** Drop everything. */
  clear(): void {
    this.entries.clear();
  }
}
