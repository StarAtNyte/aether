import { buildLodChain } from '../virtual/lod-chain';
/** Default field budget (integrated-GPU class). */
export const DEFAULT_FIELD_BUDGET = Object.freeze({ maxInstances: 1_200_000, triangles: 2_500_000 });
/** LOD chains kept for reuse (vegetation meshes are small). */
const MAX_CHAINS = 24;
/** Small LRU of LOD chains keyed by generator-output key. */
export class LodChainCache {
    chains = new Map();
    /** The chain of `output` (built on first use). */
    get(key, output) {
        const hit = this.chains.get(key);
        if (hit) {
            this.chains.delete(key);
            this.chains.set(key, hit);
            return hit;
        }
        const chain = buildLodChain(output.parts);
        if (this.chains.size >= MAX_CHAINS) {
            const oldest = this.chains.keys().next();
            if (!oldest.done)
                this.chains.delete(oldest.value);
        }
        this.chains.set(key, chain);
        return chain;
    }
    get size() {
        return this.chains.size;
    }
}
/** Output key of LOD level `level` (level 0 is the source output itself). */
export function lodOutputKey(key, level) {
    return level === 0 ? key : `${key}@lod${level}`;
}
/** MeshPart of LOD level `level` for source part `index` (material carried over). */
export function lodPart(chain, level, index, source) {
    if (level === 0)
        return source;
    const p = chain[level].parts[index];
    if (!p)
        return source;
    return { positions: p.positions, normals: p.normals, indices: p.indices, ...(p.colors ? { colors: p.colors } : {}), ...(p.uvs ? { uvs: p.uvs } : {}), material: source.material };
}
/** Bounding radius of an output around its origin (instance pivot) at scale 1. */
export function outputRadius(output) {
    let r2 = 0;
    for (const part of output.parts) {
        const p = part.positions;
        for (let i = 0; i + 2 < p.length; i += 3) {
            const d = p[i] ** 2 + p[i + 1] ** 2 + p[i + 2] ** 2;
            if (d > r2)
                r2 = d;
        }
    }
    return Math.sqrt(r2);
}
/** Split a global triangle budget between fields in proportion to their instances (min 5 % each). */
export function shareBudget(total, instances) {
    const sum = instances.reduce((s, n) => s + n, 0);
    if (sum <= 0)
        return instances.map(() => 0);
    return instances.map((n) => Math.max(total * 0.05, Math.floor((total * n) / sum)));
}
