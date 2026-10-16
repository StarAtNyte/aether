import { describe, expect, it } from 'vitest';
import { generateBuiltinSync, validateOutput } from '../src/index';
/** Directed edges without a reverse edge (0 for a closed surface). */
function openEdges(indices, positions) {
    const key = (v) => `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    const edges = new Set();
    for (let i = 0; i < indices.length; i += 3) {
        for (let k = 0; k < 3; k++)
            edges.add(`${key(indices[i + k])}|${key(indices[i + ((k + 1) % 3)])}`);
    }
    let open = 0;
    for (const e of edges) {
        const [a, b] = e.split('|');
        if (!edges.has(`${b}|${a}`))
            open++;
    }
    return open;
}
describe('colossus (high-detail sculpture)', () => {
    it('builds a closed, smooth, grounded mesh per variant with the requested height', () => {
        for (const variant of [0, 1, 2]) {
            const out = generateBuiltinSync('colossus', { variant, detail: 1, height: 10 }, 4);
            const v = validateOutput(out);
            expect(v.ok).toBe(true);
            expect(out.parts).toHaveLength(1);
            const p = out.parts[0];
            expect(p.indices.length / 3).toBe(12 * 64 * 64);
            expect(openEdges(p.indices, p.positions)).toBe(0);
            expect(out.bounds.min[1]).toBeCloseTo(0, 3);
            expect(out.bounds.max[1]).toBeCloseTo(10, 3);
            expect(p.material.flatShading).toBeUndefined();
            expect(p.colors?.length).toBe(p.positions.length);
            expect(out.colliders.length).toBeGreaterThan(0);
            expect(out.colliders.some((c) => c.kind === 'trimesh')).toBe(false);
        }
    });
    it('scales tessellation with detail and stays deterministic', () => {
        const a = generateBuiltinSync('colossus', { detail: 2 }, 9);
        expect(a.parts[0].indices.length / 3).toBe(12 * 128 * 128);
        const b = generateBuiltinSync('colossus', { detail: 2 }, 9);
        expect(Array.from(b.parts[0].positions.subarray(0, 300))).toEqual(Array.from(a.parts[0].positions.subarray(0, 300)));
    });
});
describe('terrain canyon variant', () => {
    it('has a flat floor at exactly y = 0 along Z and high walls', () => {
        const out = generateBuiltinSync('terrain', { variant: 3, size: 400, height: 50, resolution: 64 }, 2);
        const p = out.parts[0].positions;
        let floor = 0;
        let high = 0;
        for (let i = 0; i < p.length; i += 3) {
            if (Math.abs(p[i]) < 4) {
                expect(p[i + 1]).toBe(0);
                floor++;
            }
            if (Math.abs(p[i]) > 150 && p[i + 1] > 30)
                high++;
        }
        expect(floor).toBeGreaterThan(0);
        expect(high).toBeGreaterThan(0);
        expect(out.colliders.some((c) => c.kind === 'heightfield')).toBe(true);
    });
});
describe('terrain river valley variant', () => {
    it('carves a flat riverbed at y = 0 that follows riverMeander, with banks rising away from it', async () => {
        const { riverMeander, riverHalfWidth } = await import('@aether/core');
        const size = 400;
        const out = generateBuiltinSync('terrain', { variant: 4, size, height: 30, resolution: 96 }, 5);
        const p = out.parts[0].positions;
        let bed = 0;
        let bank = 0;
        for (let i = 0; i < p.length; i += 3) {
            const x = p[i];
            const z = p[i + 2];
            const d = Math.abs(x - riverMeander(z, size));
            if (d < riverHalfWidth(size) * 0.6) {
                expect(p[i + 1]).toBe(0);
                bed++;
            }
            if (d > size * 0.25 && p[i + 1] > 6)
                bank++;
        }
        expect(bed).toBeGreaterThan(50);
        expect(bank).toBeGreaterThan(50);
        expect(out.colliders.some((c) => c.kind === 'heightfield')).toBe(true);
    });
});
