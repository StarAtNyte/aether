/**
 * Clustered natural ground cover: the point process itself, and flagship builders (realistic nature) using
 * it for undergrowth while leaving explicitly stylised worlds alone.
 */
import { describe, expect, it } from 'vitest';
import { clusterPoints, CLUSTERED_GENERATORS } from '../src/providers/mock/cluster';
import { Builder } from '../src/providers/mock/builder';
import { flagshipBuilder } from '../src/providers/mock/showcase/kit';
import { realisticStandIn } from '../src/providers/mock/realistic';
/** Mean nearest-neighbour distance of a point set. */
function meanNearest(pts) {
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
        let best = Infinity;
        for (let j = 0; j < pts.length; j++)
            if (i !== j)
                best = Math.min(best, Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2]));
        total += best;
    }
    return total / pts.length;
}
/** Uniform random reference layout with the same count and area. */
function uniform(count, w, d) {
    let s = 12345;
    const r = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
    return Array.from({ length: count }, () => [(r() - 0.5) * w, 0, (r() - 0.5) * d]);
}
describe('clusterPoints', () => {
    it('is deterministic per seed and differs between seeds', () => {
        expect(clusterPoints(200, 40, 40, 7)).toEqual(clusterPoints(200, 40, 40, 7));
        expect(clusterPoints(200, 40, 40, 7)).not.toEqual(clusterPoints(200, 40, 40, 8));
    });
    it('stays inside the area, on y = 0, with the requested count (no spacing)', () => {
        const pts = clusterPoints(300, 30, 18, 3);
        expect(pts).toHaveLength(300);
        for (const p of pts) {
            expect(Math.abs(p[0])).toBeLessThanOrEqual(15);
            expect(Math.abs(p[2])).toBeLessThanOrEqual(9);
            expect(p[1]).toBe(0);
        }
    });
    it('is genuinely clumped: nearer neighbours than a uniform layout of the same size', () => {
        const clustered = clusterPoints(400, 60, 60, 11);
        expect(meanNearest(clustered)).toBeLessThan(meanNearest(uniform(400, 60, 60)) * 0.8);
    });
    it('keeps some lone plants away from the clumps (background share)', () => {
        const none = clusterPoints(400, 60, 60, 11, { background: 0 });
        const some = clusterPoints(400, 60, 60, 11, { background: 0.4 });
        expect(meanNearest(some)).toBeGreaterThan(meanNearest(none));
    });
    it('honours minSpacing and may return fewer points when the area is full', () => {
        const pts = clusterPoints(500, 20, 20, 5, { minSpacing: 1.2 });
        expect(pts.length).toBeLessThanOrEqual(500);
        expect(pts.length).toBeGreaterThan(50);
        for (let i = 0; i < pts.length; i++)
            for (let j = i + 1; j < pts.length; j++)
                expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2])).toBeGreaterThanOrEqual(1.2 - 0.011);
    });
    it('survives degenerate input', () => {
        expect(clusterPoints(0, 10, 10, 1)).toEqual([]);
        expect(clusterPoints(10, 0, 10, 1)).toEqual([]);
        expect(clusterPoints(Number.NaN, 10, 10, 1)).toEqual([]);
        expect(clusterPoints(1e9, 10, 10, 1).length).toBeLessThanOrEqual(20_000);
        expect(clusterPoints(50, -4, 4, 1)).toHaveLength(50);
    });
});
describe('Builder.scatter with realistic nature', () => {
    const scatterOf = (b) => {
        const patch = b.build().find((p) => p.op === 'add' && p.entity.shape?.kind === 'scatter');
        return patch.entity;
    };
    it('lays out meadow grass as clustered points under a flagship builder, and swaps the stylised generator', () => {
        const b = flagshipBuilder(1);
        b.scatter('grass', 'grass-tuft', { size: 0.5 }, 200, [30, 30], [0, 0, 0]);
        const s = scatterOf(b).shape;
        expect(s.of.generator).toBe('meadow-grass');
        expect(s.points?.length).toBe(s.count);
        expect(s.count).toBeGreaterThan(100);
    });
    it('leaves stylised builders (and non-clustered generators) alone', () => {
        const stylised = flagshipBuilder(1, {}, { stylised: true });
        stylised.scatter('grass', 'grass-tuft', { size: 0.5 }, 200, [30, 30], [0, 0, 0]);
        const s = scatterOf(stylised).shape;
        expect(s.of.generator).toBe('grass-tuft');
        expect(s.points).toBeUndefined();
        expect(s.count).toBe(200);
        const b = flagshipBuilder(1);
        b.scatter('trees', 'house', {}, 50, [30, 30], [0, 0, 0]);
        expect(scatterOf(b).shape.points).toBeUndefined();
    });
    it('small scatters are not clustered, and the layout is reproducible', () => {
        const b = flagshipBuilder(2);
        b.scatter('few', 'shrub', {}, 5, [10, 10], [0, 0, 0]);
        expect(scatterOf(b).shape.points).toBeUndefined();
        const one = flagshipBuilder(9);
        one.scatter('g', 'fern', {}, 80, [20, 20], [0, 0, 0]);
        const two = flagshipBuilder(9);
        two.scatter('g', 'fern', {}, 80, [20, 20], [0, 0, 0]);
        expect(scatterOf(one).shape.points).toEqual(scatterOf(two).shape.points);
    });
});
describe('flagship nature stand-ins', () => {
    it('trees, flowers and cherry trees map to their realistic counterparts', () => {
        expect(realisticStandIn('flowers', { color: '#ffcc00', size: 0.5 })).toMatchObject({ generator: 'wildflowers', params: { color: '#ffcc00' } });
        expect(realisticStandIn('hero-cherry-tree', { height: 5.5 })).toMatchObject({ generator: 'tree-broadleaf', params: { blossom: 1, variant: 2 } });
        for (const g of CLUSTERED_GENERATORS)
            expect(typeof g).toBe('string');
    });
    it('builders for ordinary prompts keep their generators; nature() and gen() swap only when asked', () => {
        const plain = new Builder(1, [], { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });
        expect(plain.nature('tree-oak', { height: 6 }).generator).toBe('tree-oak');
        const real = flagshipBuilder(1);
        expect(real.nature('tree-oak', { height: 6 }).generator).toBe('tree-broadleaf');
        expect(real.nature('house', {}).generator).toBe('house');
    });
});
