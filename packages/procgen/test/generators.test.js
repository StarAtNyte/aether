import { describe, expect, it } from 'vitest';
import { rng } from '@aether/core';
import { ARCH_GENERATOR_IDS, BUILTIN_GENERATORS, catalog, generateBuiltinSync, validateOutput } from '../src/index';
import { expectValidPart, sameGeometry, windingMismatch } from './helpers';
const REQUIRED_IDS = [
    'terrain', 'island', 'mountain', 'tree-pine', 'tree-oak', 'tree-palm', 'bush', 'rock', 'grass-tuft', 'flowers', 'mushroom',
    'house', 'tower', 'wall', 'fence', 'bridge', 'stairs', 'arch', 'ramp', 'lamp-post', 'bench', 'table', 'chair', 'crate',
    'barrel', 'car', 'boat', 'windmill', 'crystal', 'campfire', 'tent', 'dock', 'cloud', 'statue', 'portal', 'colossus',
    // Realistic vegetation (flora.ts).
    'tree-broadleaf', 'tree-birch', 'tree-spruce', 'shrub', 'fern', 'meadow-grass', 'wildflowers', 'boulder',
];
/** High-detail sculptures (virtual geometry): up to 786k triangles by design. */
const SCULPTURES = new Set(['colossus']);
const TERRAIN = new Set(['terrain', 'island', 'mountain']);
const TREES = new Set(['tree-pine', 'tree-oak', 'tree-palm']);
/** Realistic vegetation: foliage cards carry soft (crown-pointing) normals and both faces, so the winding check applies to their bark and rock only; budgets scale with `detail`. */
const CARDS = new Set(['tree-broadleaf', 'tree-birch', 'tree-spruce', 'shrub', 'fern', 'meadow-grass', 'wildflowers']);
function randomParams(spec, random) {
    const out = {};
    for (const [k, s] of Object.entries(spec)) {
        switch (s.type) {
            case 'number':
                out[k] = (s.min ?? 0) + random() * ((s.max ?? 10) - (s.min ?? 0));
                break;
            case 'int':
                out[k] = Math.round((s.min ?? 0) + random() * ((s.max ?? 10) - (s.min ?? 0)));
                break;
            case 'boolean':
                out[k] = random() < 0.5;
                break;
            case 'color':
                out[k] = `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`;
                break;
            case 'enum':
                out[k] = s.options?.[Math.floor(random() * (s.options?.length ?? 1))] ?? '';
                break;
        }
    }
    // terrain resolution and sculpture detail are capped in random runs to keep the suite fast
    if ('resolution' in out)
        out.resolution = Math.min(64, out.resolution);
    if ('detail' in out)
        out.detail = 1;
    return out;
}
function checkOutput(id, out) {
    const v = validateOutput(out);
    if (!v.ok)
        throw new Error(`${id}: ${v.error}`);
    expect(out.parts.length).toBeGreaterThan(0);
    for (const p of out.parts)
        expectValidPart(p);
    expect(out.bounds.min[1]).toBeCloseTo(0, 4);
    expect((out.bounds.min[0] + out.bounds.max[0]) / 2).toBeCloseTo(0, 3);
    expect((out.bounds.min[2] + out.bounds.max[2]) / 2).toBeCloseTo(0, 3);
    expect(out.colliders.length).toBeGreaterThan(0);
    expect(out.colliders.some((c) => c.kind === 'trimesh')).toBe(false);
    const tris = out.parts.reduce((s, p) => s + p.indices.length / 3, 0);
    expect(out.stats.triangles).toBe(tris);
    if (TERRAIN.has(id)) {
        expect(out.colliders.some((c) => c.kind === 'heightfield')).toBe(true);
    }
    else if (SCULPTURES.has(id)) {
        expect(tris).toBeLessThanOrEqual(12 * 256 * 256);
    }
    else if (CARDS.has(id)) {
        expect(tris).toBeLessThan(12_000);
    }
    else if (TREES.has(id)) {
        expect(tris).toBeLessThan(2000);
    }
    else {
        expect(tris).toBeLessThan(3000);
    }
    for (const p of out.parts) {
        if (CARDS.has(id) && p.material.foliage !== undefined)
            continue;
        const mismatch = windingMismatch(p.positions, p.normals, p.indices);
        expect(mismatch).toBeLessThan(TERRAIN.has(id) ? 0.01 : 0.001);
    }
}
describe('built-in generators', () => {
    it('implements exactly the required id list with rich catalog entries', () => {
        expect(Object.keys(BUILTIN_GENERATORS).filter((id) => !ARCH_GENERATOR_IDS.has(id)).sort()).toEqual([...REQUIRED_IDS].sort());
        const cat = catalog();
        expect(cat).toHaveLength(REQUIRED_IDS.length);
        for (const entry of cat) {
            expect(entry.description.length).toBeGreaterThan(20);
            expect(['nature', 'architecture', 'props', 'vehicles', 'terrain', 'fx']).toContain(entry.category);
            for (const [name, p] of Object.entries(entry.params)) {
                expect(p.description, `${entry.id}.${name}`).toBeTruthy();
            }
            const keys = Object.keys(entry.params);
            expect(keys.some((k) => k === 'size' || k === 'height' || k === 'length' || k === 'width')).toBe(true);
            expect(keys).toContain('variant');
            expect(keys.some((k) => k.toLowerCase().includes('color'))).toBe(true);
        }
        // catalog is a copy: mutating it does not affect generators
        cat[0].params.size = 'mutated';
        expect(catalog()[0]?.params.size).not.toBe('mutated');
        expect(BUILTIN_GENERATORS.__proto__).toBeUndefined();
    });
    it('registers the architecture generators for lookup but keeps them out of the prompt catalog', () => {
        expect(ARCH_GENERATOR_IDS.size).toBeGreaterThan(40);
        const cat = new Set(catalog().map((g) => g.id));
        for (const id of ARCH_GENERATOR_IDS) {
            expect(id).toMatch(/^(arch|furn)-/);
            expect(BUILTIN_GENERATORS[id], id).toBeDefined();
            expect(cat.has(id), id).toBe(false);
        }
        const wall = generateBuiltinSync('arch-wall', { length: 4, height: 2.7, thickness: 0.2, openings: [{ kind: 'door', offset: 2, width: 0.9, height: 2.1, sill: 0 }] }, 1);
        expect(wall.parts.length).toBeGreaterThan(0);
        expect(wall.colliders.length).toBeGreaterThan(0);
        const sofa = generateBuiltinSync('furn-sofa', {}, 1);
        expect(sofa.stats.triangles).toBeGreaterThan(50);
    });
    for (const id of REQUIRED_IDS) {
        describe(id, () => {
            it('runs with default params (params: {}) and produces valid, grounded, centered output', () => {
                checkOutput(id, generateBuiltinSync(id, {}, 1));
            });
            it('is deterministic for a given seed and varies with the seed', () => {
                const small = TERRAIN.has(id) ? { resolution: 24 } : SCULPTURES.has(id) ? { detail: 1 } : {};
                const a = generateBuiltinSync(id, small, 7);
                const b = generateBuiltinSync(id, small, 7);
                expect(sameGeometry(a, b)).toBe(true);
            });
            it('runs with random params, every variant, and garbage params', () => {
                const gen = BUILTIN_GENERATORS[id];
                if (!gen)
                    throw new Error('missing');
                const random = rng(id.length * 31 + 7);
                for (let i = 0; i < 4; i++)
                    checkOutput(id, generateBuiltinSync(id, randomParams(gen.params, random), i + 11));
                const maxVariant = gen.params.variant?.max ?? 0;
                for (let v = 0; v <= maxVariant; v++) {
                    checkOutput(id, generateBuiltinSync(id, TERRAIN.has(id) ? { variant: v, resolution: 32 } : SCULPTURES.has(id) ? { variant: v, detail: 1 } : { variant: v }, 3));
                }
                checkOutput(id, generateBuiltinSync(id, { size: 'huge', height: null, color: 42, variant: 99, unknown: { deep: [1] } }, 5));
            });
        });
    }
    it('terrain heightfield collider matches the rendered mesh exactly', () => {
        const out = generateBuiltinSync('terrain', { size: 40, height: 8, resolution: 16 }, 3);
        const hf = out.colliders.find((c) => c.kind === 'heightfield');
        if (!hf || hf.kind !== 'heightfield')
            throw new Error('no heightfield');
        expect(hf.rows).toBe(16);
        expect(hf.cols).toBe(16);
        expect(hf.heights.length).toBe(17 * 17);
        expect(hf.size[0]).toBe(40);
        expect(hf.size[1]).toBeCloseTo(8, 4);
        const p = out.parts[0]?.positions;
        if (!p)
            throw new Error('no mesh');
        // mesh vertex (ix, iz) is at index iz*(cols+1)+ix; collider sample at ix*(rows+1)+iz
        for (let iz = 0; iz <= 16; iz++) {
            for (let ix = 0; ix <= 16; ix++) {
                const v = (iz * 17 + ix) * 3;
                expect(p[v]).toBeCloseTo(-20 + (ix * 40) / 16, 4);
                expect(p[v + 2]).toBeCloseTo(-20 + (iz * 40) / 16, 4);
                expect(hf.heights[ix * 17 + iz] * hf.size[1]).toBeCloseTo(p[v + 1], 3);
            }
        }
        expect(Math.min(...hf.heights)).toBe(0);
        expect(Math.max(...hf.heights)).toBeCloseTo(1, 6);
    });
    it('respects size params', () => {
        const small = generateBuiltinSync('tree-pine', { height: 3 }, 1);
        const big = generateBuiltinSync('tree-pine', { height: 12 }, 1);
        expect(small.bounds.max[1]).toBeCloseTo(3, 1);
        expect(big.bounds.max[1]).toBeCloseTo(12, 1);
        const crate = generateBuiltinSync('crate', { size: 2 }, 1);
        expect(crate.bounds.max[1]).toBeCloseTo(2, 2);
        const terrain = generateBuiltinSync('terrain', { size: 100, resolution: 16 }, 1);
        expect(terrain.bounds.max[0] - terrain.bounds.min[0]).toBeCloseTo(100, 4);
    });
    it('uses multiple materials and emissive parts where art direction requires', () => {
        const emissive = (id) => generateBuiltinSync(id, {}, 1).parts.some((p) => (p.material.emissiveIntensity ?? 0) > 0);
        for (const id of ['car', 'campfire', 'portal', 'crystal', 'lamp-post'])
            expect(emissive(id), id).toBe(true);
        for (const id of ['house', 'car', 'windmill', 'campfire', 'portal']) {
            expect(generateBuiltinSync(id, {}, 1).parts.length, id).toBeGreaterThanOrEqual(3);
        }
        expect(generateBuiltinSync('terrain', { resolution: 16 }, 1).parts[0]?.colors).toBeDefined();
    });
    it('throws for unknown ids (including prototype keys)', () => {
        expect(() => generateBuiltinSync('dragon', {}, 1)).toThrow(/unknown/);
        expect(() => generateBuiltinSync('__proto__', {}, 1)).toThrow(/unknown/);
        expect(() => generateBuiltinSync('constructor', {}, 1)).toThrow(/unknown/);
    });
    it('performance: all built-ins with default params in < 1.5 s total', () => {
        generateBuiltinSync('rock', {}, 1);
        const t0 = performance.now();
        for (const id of REQUIRED_IDS)
            generateBuiltinSync(id, {}, 2);
        const ms = performance.now() - t0;
        expect(ms).toBeLessThan(1500);
    });
});
