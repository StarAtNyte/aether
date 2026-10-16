/**
 * Main entry points used by render/physics: built-in generators run
 * synchronously in-process; custom (LLM-written) generators from
 * `world.generators` only ever run through a {@link SandboxRunner}.
 */
import { hashString, stableStringify } from '@aether/core';
import { createGeneratorApi } from './api';
import { DEFAULT_SEED, GeneratorCache, generatorCacheKey } from './cache';
import { ARCH_GENERATOR_IDS, getBuiltinGenerator } from './generators/index';
import { resolveParams } from './params';
import { validateOutput } from './output';
/**
 * Run a built-in generator synchronously. Params are resolved (defaults,
 * clamping, unknown keys ignored). Throws for an unknown id.
 */
export function generateBuiltinSync(generatorId, params, seed) {
    const gen = getBuiltinGenerator(generatorId);
    if (!gen)
        throw new Error(`unknown built-in generator "${String(generatorId).slice(0, 64)}"`);
    return gen.generate(params ?? {}, createGeneratorApi(seed));
}
/** Content hash of a custom generator (source + param spec), used in cache keys. */
export function generatorSourceHash(def) {
    return hashString(`${def.source}\u0000${stableStringify(def.params ?? {})}`);
}
/**
 * Give the host a chance to render/handle input before a (possibly long)
 * synchronous generator run, so a world with many procedural entities does
 * not block the main thread in one uninterrupted chain of microtasks.
 */
export function yieldToEventLoop() {
    const g = globalThis;
    const scheduler = g.scheduler;
    if (scheduler && typeof scheduler.yield === 'function')
        return scheduler.yield();
    if (typeof setImmediate === 'function')
        return new Promise((resolve) => setImmediate(resolve));
    return new Promise((resolve) => setTimeout(resolve, 0));
}
/**
 * Normalized cache key of the output a procedural shape produces: params are
 * resolved against the generator spec (defaults, clamping, unknown keys
 * dropped) and the seed defaulted, so equivalent spellings share one key.
 * Render uses it to share GPU geometry exactly when `generate` shares output.
 */
export function proceduralOutputKey(shape, world) {
    const seed = shape.seed ?? DEFAULT_SEED;
    const params = shape.params ?? {};
    const custom = customGenerator(world, shape.generator);
    if (custom)
        return generatorCacheKey({ ...shape, params: resolveParams(custom.params ?? {}, params), seed }, generatorSourceHash(custom));
    const gen = getBuiltinGenerator(shape.generator);
    return generatorCacheKey({ ...shape, params: gen ? resolveBuiltin(gen, params) : params, seed });
}
/**
 * Resolve a built-in generator's params: its own resolver when it has one
 * (nested architecture params; invalid input falls back to the raw params,
 * which the generator then rejects with a readable error), else the spec.
 */
export function resolveBuiltin(gen, params) {
    if (gen.resolve) {
        try {
            return gen.resolve(params);
        }
        catch {
            return params;
        }
    }
    return resolveParams(gen.params, params);
}
const inflight = new WeakMap();
function customGenerator(world, id) {
    // Architecture generators are reserved: a custom generator may never shadow a building's walls.
    if (ARCH_GENERATOR_IDS.has(id))
        return undefined;
    const gens = world?.generators;
    if (!gens || typeof gens !== 'object')
        return undefined;
    return Object.hasOwn(gens, id) ? gens[id] : undefined;
}
/**
 * Generate geometry for a procedural shape. A custom generator defined in
 * `world.generators` takes precedence over a built-in with the same id and
 * requires `opts.sandbox`. Results are cached (when a cache is given) and
 * concurrent identical requests share one run. Rejects on unknown ids,
 * sandbox failures or invalid output — callers typically fall back to
 * {@link fallbackOutput}.
 */
export async function generate(shape, world, opts = {}) {
    const id = shape.generator;
    const seed = shape.seed ?? DEFAULT_SEED;
    const params = shape.params ?? {};
    const custom = customGenerator(world, id);
    const cache = opts.cache;
    let key;
    let run;
    if (custom) {
        const sandbox = opts.sandbox;
        if (!sandbox)
            throw new Error(`custom generator "${id}" requires a sandbox runner`);
        const resolved = resolveParams(custom.params ?? {}, params);
        key = cache?.key({ ...shape, params: resolved, seed }, generatorSourceHash(custom));
        run = async () => {
            const out = await sandbox.run(custom, resolved, seed);
            const v = validateOutput(out);
            if (!v.ok)
                throw new Error(`custom generator "${id}" returned invalid output: ${v.error}`);
            return v.output;
        };
    }
    else {
        const gen = getBuiltinGenerator(id);
        if (!gen)
            throw new Error(`unknown generator "${String(id).slice(0, 64)}"`);
        const resolved = resolveBuiltin(gen, params);
        key = cache?.key({ ...shape, params: resolved, seed });
        const remote = opts.builtin;
        run = async () => {
            if (remote) {
                try {
                    return await remote(gen.id, resolved, seed);
                }
                catch {
                    // Worker unavailable, crashed or timed out: same result inline.
                }
            }
            await yieldToEventLoop();
            return gen.generate(resolved, createGeneratorApi(seed));
        };
    }
    if (!cache || key === undefined)
        return run();
    const hit = cache.get(key);
    if (hit)
        return hit;
    let pending = inflight.get(cache);
    if (!pending) {
        pending = new Map();
        inflight.set(cache, pending);
    }
    const existing = pending.get(key);
    if (existing)
        return existing;
    const k = key;
    const map = pending;
    const promise = run().then((out) => {
        cache.set(k, out);
        map.delete(k);
        return out;
    }, (err) => {
        map.delete(k);
        throw err;
    });
    map.set(k, promise);
    return promise;
}
