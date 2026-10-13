/**
 * Building blocks SceneSync uses to mount a scatter layer as a
 * {@link ScatterField}: LOD chains (cached per generator output), packed
 * placements and per-field triangle budgets.
 */
import type { BufferGeometry } from 'three';
import type { GeneratorOutput, MeshPart } from '../types';
import { buildLodChain, type LodLevel } from '../virtual/lod-chain';

/** Field budgets of a renderer (see `renderBudget`). */
export interface FieldBudget {
  /** Instances all fields together may hold. */
  maxInstances: number;
  /** Triangles all fields together may draw per frame. */
  triangles: number;
}

/** Default field budget (integrated-GPU class). */
export const DEFAULT_FIELD_BUDGET: FieldBudget = Object.freeze({ maxInstances: 1_200_000, triangles: 2_500_000 });
/** LOD chains kept for reuse (vegetation meshes are small). */
const MAX_CHAINS = 24;

/** Small LRU of LOD chains keyed by generator-output key. */
export class LodChainCache {
  private readonly chains = new Map<string, LodLevel[]>();

  /** The chain of `output` (built on first use). */
  get(key: string, output: GeneratorOutput): LodLevel[] {
    const hit = this.chains.get(key);
    if (hit) {
      this.chains.delete(key);
      this.chains.set(key, hit);
      return hit;
    }
    const chain = buildLodChain(output.parts);
    if (this.chains.size >= MAX_CHAINS) {
      const oldest = this.chains.keys().next();
      if (!oldest.done) this.chains.delete(oldest.value);
    }
    this.chains.set(key, chain);
    return chain;
  }

  get size(): number {
    return this.chains.size;
  }
}

/** Output key of LOD level `level` (level 0 is the source output itself). */
export function lodOutputKey(key: string, level: number): string {
  return level === 0 ? key : `${key}@lod${level}`;
}

/** MeshPart of LOD level `level` for source part `index` (material carried over). */
export function lodPart(chain: readonly LodLevel[], level: number, index: number, source: MeshPart): MeshPart {
  if (level === 0) return source;
  const p = (chain[level] as LodLevel).parts[index];
  if (!p) return source;
  return { positions: p.positions, normals: p.normals, indices: p.indices, ...(p.colors ? { colors: p.colors } : {}), ...(p.uvs ? { uvs: p.uvs } : {}), material: source.material };
}

/** Bounding radius of an output around its origin (instance pivot) at scale 1. */
export function outputRadius(output: GeneratorOutput): number {
  let r2 = 0;
  for (const part of output.parts) {
    const p = part.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const d = (p[i] as number) ** 2 + (p[i + 1] as number) ** 2 + (p[i + 2] as number) ** 2;
      if (d > r2) r2 = d;
    }
  }
  return Math.sqrt(r2);
}

/** Split a global triangle budget between fields in proportion to their instances (min 5 % each). */
export function shareBudget(total: number, instances: readonly number[]): number[] {
  const sum = instances.reduce((s, n) => s + n, 0);
  if (sum <= 0) return instances.map(() => 0);
  return instances.map((n) => Math.max(total * 0.05, Math.floor((total * n) / sum)));
}

/** Geometry handle list of one field level (keys to release, geometries per part). */
export interface FieldLevelGeometry {
  keys: string[];
  geometries: BufferGeometry[];
  triangles: number;
}
