/**
 * Realistic vegetation: valid, budgeted, deterministic output with the foliage and bark materials the
 * renderer knows, plus the cut-out card textures behind them.
 */
import { describe, expect, it } from 'vitest';
import { FOLIAGE_ALPHA_CUT, foliagePixels, generateBuiltinSync, validateOutput } from '../src/index';
import { sanitizeMaterial } from '../src/material';
const TREES = [
    ['tree-broadleaf', { height: 10 }, 5000],
    ['tree-birch', { height: 8 }, 4000],
    ['tree-spruce', { height: 14 }, 4500],
];
describe('realistic trees', () => {
    for (const [id, params, budget] of TREES) {
        it(`${id} is valid, within ${budget} triangles, roughly its height, with bark and foliage parts`, () => {
            const out = generateBuiltinSync(id, params, 4);
            expect(validateOutput(out).ok).toBe(true);
            const tris = out.parts.reduce((a, p) => a + p.indices.length / 3, 0);
            expect(tris).toBeGreaterThan(300);
            expect(tris).toBeLessThan(budget);
            const h = Number(params['height']);
            expect(out.bounds.min[1]).toBeCloseTo(0, 1);
            expect(out.bounds.max[1]).toBeGreaterThan(h * 0.75);
            expect(out.bounds.max[1]).toBeLessThan(h * 1.25);
            const bark = out.parts.find((p) => p.material.finish === 'bark');
            const leaves = out.parts.find((p) => p.material.foliage !== undefined);
            expect(bark?.colors).toBeDefined();
            expect(leaves?.colors).toBeDefined();
            expect(leaves?.uvs).toBeDefined();
            // Cards carry 0..1 UVs; the soft normals are unit vectors.
            for (const v of leaves.uvs) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
            for (let i = 0; i < leaves.normals.length; i += 3)
                expect(Math.hypot(leaves.normals[i], leaves.normals[i + 1], leaves.normals[i + 2])).toBeCloseTo(1, 3);
            expect(out.colliders.length).toBeGreaterThan(0);
        });
        it(`${id} is deterministic per seed and differs between seeds`, () => {
            const a = generateBuiltinSync(id, params, 9);
            const b = generateBuiltinSync(id, params, 9);
            const c = generateBuiltinSync(id, params, 10);
            expect(Array.from(a.parts[0].positions.slice(0, 60))).toEqual(Array.from(b.parts[0].positions.slice(0, 60)));
            expect(Array.from(a.parts[1].positions.slice(0, 60))).not.toEqual(Array.from(c.parts[1].positions.slice(0, 60)));
        });
        it(`${id} gets lighter with a lower detail`, () => {
            const full = generateBuiltinSync(id, { ...params, detail: 1 }, 2);
            const lean = generateBuiltinSync(id, { ...params, detail: 0.4 }, 2);
            const tris = (o) => o.parts.reduce((a, p) => a + p.indices.length / 3, 0);
            expect(tris(lean)).toBeLessThan(tris(full));
        });
    }
    it('the spruce takes snow and the broadleaf an autumn colour', () => {
        const snowy = generateBuiltinSync('tree-spruce', { height: 10, snow: 1 }, 3);
        const plain = generateBuiltinSync('tree-spruce', { height: 10, snow: 0 }, 3);
        const mean = (o) => {
            const c = o.parts.find((p) => p.material.foliage).colors;
            let s = 0;
            for (const v of c)
                s += v;
            return s / c.length;
        };
        expect(mean(snowy)).toBeGreaterThan(mean(plain));
        const autumn = generateBuiltinSync('tree-broadleaf', { height: 9, color: '#b8662b' }, 3).parts.find((p) => p.material.foliage).colors;
        let r = 0;
        let g = 0;
        for (let i = 0; i < autumn.length; i += 3) {
            r += autumn[i];
            g += autumn[i + 1];
        }
        expect(r).toBeGreaterThan(g * 0.7);
    });
});
describe('small vegetation and rock', () => {
    it('shrub, fern and meadow grass are light, valid and sit on the ground', () => {
        const budgets = [['shrub', 1500], ['fern', 200], ['meadow-grass', 40]];
        for (const [id, budget] of budgets) {
            const out = generateBuiltinSync(id, {}, 5);
            expect(validateOutput(out).ok, id).toBe(true);
            expect(out.parts.reduce((a, p) => a + p.indices.length / 3, 0), id).toBeLessThan(budget);
            expect(out.bounds.min[1], id).toBeGreaterThanOrEqual(-0.01);
            expect(out.parts.some((p) => p.material.foliage !== undefined), id).toBe(true);
        }
    });
    it('the boulder has a flat base, the rock surface and lichen only on upward faces when asked', () => {
        const out = generateBuiltinSync('boulder', { size: 2, lichen: 1 }, 6);
        expect(validateOutput(out).ok).toBe(true);
        expect(out.bounds.min[1]).toBeCloseTo(0, 1);
        expect(out.parts[0].material.finish).toBe('rock');
        expect(out.colliders[0]?.kind).toBe('hull');
        const bare = generateBuiltinSync('boulder', { size: 2, lichen: 0 }, 6).parts[0].colors;
        const mossy = out.parts[0].colors;
        let diff = 0;
        for (let i = 0; i < mossy.length; i++)
            diff += Math.abs(mossy[i] - bare[i]);
        expect(diff).toBeGreaterThan(1);
    });
});
describe('foliage card textures', () => {
    const kinds = ['broadleaf', 'shrub', 'needles', 'grass', 'fern'];
    for (const kind of kinds) {
        it(`${kind}: a cut-out with real coverage, no dark halo and deterministic pixels`, () => {
            const a = foliagePixels(kind, 128);
            const b = foliagePixels(kind, 128);
            expect(a.size).toBe(128);
            expect(a.rgba.length).toBe(128 * 128 * 4);
            expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
            let solid = 0;
            let lumSolid = 0;
            let lumVoid = 0;
            let voids = 0;
            for (let i = 0; i < 128 * 128; i++) {
                const lum = (a.rgba[i * 4] + a.rgba[i * 4 + 1] + a.rgba[i * 4 + 2]) / 3;
                if (a.rgba[i * 4 + 3] >= FOLIAGE_ALPHA_CUT) {
                    solid++;
                    lumSolid += lum;
                }
                else {
                    voids++;
                    lumVoid += lum;
                }
            }
            const cover = solid / (128 * 128);
            expect(cover).toBeGreaterThan(0.06);
            expect(cover).toBeLessThan(0.85);
            // The colour under the transparent area is the card's mean colour, not black: mips never darken the edges.
            expect(lumVoid / Math.max(1, voids)).toBeGreaterThan((lumSolid / Math.max(1, solid)) * 0.5);
        });
    }
    it('clamps sizes to a power of two in range', () => {
        expect(foliagePixels('grass', 1).size).toBe(32);
        expect(foliagePixels('grass', 100).size).toBe(128);
        expect(foliagePixels('grass', 99999).size).toBe(1024);
    });
    it('is a valid material flag only for known kinds', () => {
        expect(sanitizeMaterial({ foliage: 'needles' }).foliage).toBe('needles');
        expect(() => sanitizeMaterial({ foliage: 'cactus' })).toThrow(/foliage/);
    });
});
