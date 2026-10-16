/**
 * Library generators on demand: when a patch batch places a procedural shape
 * whose generator is neither built in nor defined in the world, the host's
 * resolver (the shipped generator library) is asked for its definition and a
 * `defineGenerator` patch is prepended, so models and the offline planner can
 * use library ids exactly like built-ins.
 */
import { GeneratorDef, hasOwn } from '@aether/core';
/** Bounds of the reference scan (patches are untrusted model output). */
export const LIBRARY_REF_LIMITS = Object.freeze({ MAX_DEPTH: 8, MAX_NODES: 50_000, MAX_RESOLVED: 8 });
const ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
/** Generator ids referenced by procedural shapes anywhere in `patches` (bounded walk, own keys only). */
export function referencedGenerators(patches) {
    const ids = new Set();
    let nodes = 0;
    const walk = (v, depth) => {
        if (++nodes > LIBRARY_REF_LIMITS.MAX_NODES || depth > LIBRARY_REF_LIMITS.MAX_DEPTH || typeof v !== 'object' || v === null)
            return;
        if (Array.isArray(v)) {
            for (const item of v)
                walk(item, depth + 1);
            return;
        }
        const rec = v;
        if (hasOwn(rec, 'kind') && rec['kind'] === 'procedural' && hasOwn(rec, 'generator') && typeof rec['generator'] === 'string' && ID_RE.test(rec['generator']))
            ids.add(rec['generator']);
        for (const key of Object.keys(rec))
            walk(rec[key], depth + 1);
    };
    for (const p of patches)
        walk(p, 0);
    return ids;
}
/** Ids defined by `defineGenerator` patches in the batch itself. */
function definedInBatch(patches) {
    const ids = new Set();
    for (const p of patches) {
        if (typeof p !== 'object' || p === null)
            continue;
        const rec = p;
        if (rec['op'] !== 'defineGenerator' || typeof rec['generator'] !== 'object' || rec['generator'] === null)
            continue;
        const id = rec['generator']['id'];
        if (typeof id === 'string')
            ids.add(id);
    }
    return ids;
}
/**
 * `defineGenerator` patches for the library generators `patches` need (not
 * built in, not in the world, not defined in the batch). Unknown ids are left
 * alone so the host reports them as usual. Resolver failures are ignored.
 */
export async function libraryDefinitions(patches, world, builtin, resolve) {
    const batch = definedInBatch(patches);
    const wanted = [...referencedGenerators(patches)].filter((id) => !builtin.has(id) && !hasOwn(world.generators, id) && !batch.has(id)).slice(0, LIBRARY_REF_LIMITS.MAX_RESOLVED);
    const defs = await Promise.all(wanted.map(async (id) => {
        try {
            const def = await resolve(id);
            const parsed = def ? GeneratorDef.safeParse(def) : null;
            return parsed?.success && parsed.data.id === id ? parsed.data : null;
        }
        catch {
            return null;
        }
    }));
    return defs.filter((d) => d !== null).map((generator) => ({ op: 'defineGenerator', generator }));
}
