/**
 * Default {@link GeometrySource}: primitives and procedural shapes through
 * `@aether/procgen`, so render, physics and the agent all see identical
 * geometry. Custom (LLM-written) generators run only inside the sandbox
 * runner supplied by the host.
 */
import { stableStringify } from '@aether/core';
import { fallbackOutput, generate, GeneratorCache, primitiveOutput, proceduralOutputKey } from '@aether/procgen';
/** Stable key of a primitive shape's geometry. */
export function primitiveKey(shape) {
    return `prim|${shape.primitive}|${stableStringify(shape.size)}`;
}
/** Create the procgen-backed geometry source. */
export function createProcgenGeometrySource(opts = {}) {
    const cache = opts.cache ?? new GeneratorCache(256);
    const maxPrimitives = Math.max(1, opts.maxPrimitives ?? 512);
    const primitives = new Map();
    let fallback;
    return {
        primitive(shape) {
            const key = primitiveKey(shape);
            const hit = primitives.get(key);
            if (hit)
                return hit;
            const keyed = { key, output: primitiveOutput(shape) };
            if (primitives.size >= maxPrimitives) {
                const oldest = primitives.keys().next();
                if (!oldest.done)
                    primitives.delete(oldest.value);
            }
            primitives.set(key, keyed);
            return keyed;
        },
        async procedural(shape, world) {
            // Same normalization as generate(): equivalent spellings share one GPU geometry.
            const key = `proc|${proceduralOutputKey(shape, world)}`;
            const output = await generate(shape, world, { cache, ...(opts.sandbox ? { sandbox: opts.sandbox } : {}), ...(opts.builtin ? { builtin: opts.builtin } : {}) });
            return { key, output };
        },
        fallback(reason) {
            // One shared placeholder geometry; the reason is logged by the caller.
            fallback ??= { key: 'fallback', output: fallbackOutput(reason) };
            return fallback;
        },
    };
}
