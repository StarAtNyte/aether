import { describe, expect, it, vi } from 'vitest';
import { ProceduralShape } from '@aether/core';
import { createGeneratorApi, DEFAULT_SEED, generate, GeneratorCache, outputBytes, generatorSourceHash, proceduralOutputKey } from '../src/index';
const shape = (generator, params = {}, seed) => ProceduralShape.parse({ kind: 'procedural', generator, params, ...(seed === undefined ? {} : { seed }) });
function boxOutput() {
    const api = createGeneratorApi(1);
    api.add(api.box(1, 1, 1), {});
    return api.build();
}
const customDef = {
    id: 'my-thing',
    description: 'test',
    params: { size: { type: 'number', default: 1, min: 0.1, max: 5 } },
    source: 'api.add(api.box(params.size, 1, 1), {}); return api.build();',
};
describe('GeneratorCache', () => {
    it('evicts least recently used entries', () => {
        const c = new GeneratorCache(2);
        const o = boxOutput();
        c.set('a', o);
        c.set('b', o);
        expect(c.get('a')).toBe(o);
        c.set('c', o);
        expect(c.get('b')).toBeUndefined();
        expect(c.get('a')).toBe(o);
        expect(c.get('c')).toBe(o);
        expect(c.size).toBe(2);
        c.clear();
        expect(c.size).toBe(0);
        expect(new GeneratorCache(Number.NaN).size).toBe(0);
    });
    it('bounds the cached bytes, evicting least recently used outputs', () => {
        const o = boxOutput();
        const size = outputBytes(o);
        expect(size).toBeGreaterThan(0);
        const c = new GeneratorCache(100, size * 2);
        c.set('a', o);
        c.set('b', o);
        expect(c.bytes).toBe(size * 2);
        c.get('a');
        c.set('c', o);
        expect(c.get('b')).toBeUndefined();
        expect(c.get('a')).toBe(o);
        expect(c.bytes).toBe(size * 2);
        // Replacing a key does not double count.
        c.set('a', o);
        expect(c.bytes).toBe(size * 2);
        // Shrinking the budget evicts immediately; an output above the budget is never cached.
        c.setByteLimit(size);
        expect(c.size).toBe(1);
        expect(c.bytes).toBe(size);
        c.setByteLimit(size - 1);
        expect(c.size).toBe(0);
        c.set('d', o);
        expect(c.get('d')).toBeUndefined();
        expect(c.bytes).toBe(0);
        c.setByteLimit(Number.NaN);
        expect(c.byteLimit).toBe(size - 1);
    });
    it('counts collider arrays in outputBytes', () => {
        const o = boxOutput();
        const base = outputBytes(o);
        const withHull = { ...o, colliders: [...o.colliders, { kind: 'hull', points: new Float32Array(30), offset: [0, 0, 0] }] };
        expect(outputBytes(withHull)).toBe(base + 120);
    });
    it('builds stable keys independent of param key order', () => {
        const c = new GeneratorCache();
        const k1 = c.key(shape('rock', { a: 1, b: 2 }, 3));
        const k2 = c.key(shape('rock', { b: 2, a: 1 }, 3));
        expect(k1).toBe(k2);
        expect(c.key(shape('rock', { a: 1 }, 4))).not.toBe(c.key(shape('rock', { a: 1 }, 3)));
        expect(c.key(shape('rock'), 5)).not.toBe(c.key(shape('rock'), 6));
    });
});
describe('generate', () => {
    it('runs built-ins and caches by resolved params', async () => {
        const cache = new GeneratorCache();
        const a = await generate(shape('crate', { size: 1 }), { generators: {} }, { cache });
        const b = await generate(shape('crate', { size: 1.0, junk: true }), { generators: {} }, { cache });
        const defaults = await generate(shape('crate'), { generators: {} }, { cache });
        expect(b).toBe(a);
        expect(defaults).toBe(a);
        expect(cache.size).toBe(1);
    });
    it('exposes the normalized output key so equivalent spellings share render geometry', () => {
        const w = { generators: {} };
        const k = proceduralOutputKey(shape('crate', { size: 1 }), w);
        expect(proceduralOutputKey(shape('crate', { size: 1.0, junk: true }), w)).toBe(k);
        expect(proceduralOutputKey(shape('crate'), w)).toBe(k);
        expect(proceduralOutputKey({ ...shape('crate'), seed: DEFAULT_SEED }, w)).toBe(k);
        expect(proceduralOutputKey(shape('crate', { size: 2 }), w)).not.toBe(k);
        const custom = { generators: { 'my-thing': customDef } };
        expect(proceduralOutputKey(shape('my-thing'), custom)).toContain(String(generatorSourceHash(customDef)));
    });
    it('yields to the event loop before each built-in run (no monolithic main-thread block)', async () => {
        let done = false;
        const p = generate(shape('crate', { size: 1.5 }), { generators: {} }).then(() => {
            done = true;
        });
        for (let i = 0; i < 50; i++)
            await Promise.resolve();
        expect(done).toBe(false); // microtasks alone cannot complete it: a macrotask boundary is required
        await p;
        expect(done).toBe(true);
    });
    it('rejects unknown generators and custom generators without a sandbox', async () => {
        await expect(generate(shape('nope'), { generators: {} })).rejects.toThrow(/unknown generator/);
        await expect(generate(shape('__proto__'), { generators: {} })).rejects.toThrow(/unknown generator/);
        await expect(generate(shape('my-thing'), { generators: { 'my-thing': customDef } })).rejects.toThrow(/requires a sandbox/);
    });
    it('routes custom generators through the sandbox with resolved params, validates, caches and dedupes', async () => {
        const run = vi.fn(async (_def, params, seed) => {
            expect(params).toEqual({ size: 5 });
            expect(seed).toBe(9);
            await new Promise((r) => setTimeout(r, 5));
            return boxOutput();
        });
        const sandbox = { run, dispose: () => undefined };
        const cache = new GeneratorCache();
        const world = { generators: { 'my-thing': customDef } };
        const [x, y] = await Promise.all([
            generate(shape('my-thing', { size: 50 }, 9), world, { sandbox, cache }),
            generate(shape('my-thing', { size: 99 }, 9), world, { sandbox, cache }),
        ]);
        expect(x).toBe(y);
        expect(run).toHaveBeenCalledTimes(1);
        await generate(shape('my-thing', { size: 5 }, 9), world, { sandbox, cache });
        expect(run).toHaveBeenCalledTimes(1);
        // changing the source invalidates the cache
        const world2 = { generators: { 'my-thing': { ...customDef, source: `${customDef.source}\n` } } };
        await generate(shape('my-thing', { size: 5 }, 9), world2, { sandbox, cache });
        expect(run).toHaveBeenCalledTimes(2);
        expect(generatorSourceHash(customDef)).not.toBe(generatorSourceHash(world2.generators['my-thing']));
    });
    it('custom definitions shadow built-ins and invalid sandbox output is rejected (and not cached)', async () => {
        const bad = { run: async () => ({ parts: [] }), dispose: () => undefined };
        const cache = new GeneratorCache();
        const world = { generators: { rock: { ...customDef, id: 'rock' } } };
        await expect(generate(shape('rock'), world, { sandbox: bad, cache })).rejects.toThrow(/invalid output/);
        expect(cache.size).toBe(0);
        const failing = { run: async () => Promise.reject(new Error('kaput')), dispose: () => undefined };
        await expect(generate(shape('rock'), world, { sandbox: failing, cache })).rejects.toThrow('kaput');
    });
});
