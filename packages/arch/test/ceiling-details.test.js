import { describe, expect, it } from 'vitest';
import { compileBuilding } from '../src/compile';
import { downlightGrid } from '../src/compile';
import { buildCeiling } from '../src/elements';
import { CeilingParams } from '../src/params';
import { APARTMENT } from './fixtures';
describe('recessed downlights', () => {
    it('habitable rooms get a downlight grid inside their outline, wet rooms and halls too, outdoors none', () => {
        const b = compileBuilding(APARTMENT);
        const ceilings = b.entities.filter((e) => e.arch?.role === 'ceiling');
        expect(ceilings.length).toBeGreaterThan(4);
        for (const c of ceilings) {
            const shape = c.shape;
            const xs = shape.params.polygon.map((p) => p[0]);
            const zs = shape.params.polygon.map((p) => p[1]);
            expect(shape.params.downlights.length).toBeLessThanOrEqual(12);
            for (const [x, z] of shape.params.downlights) {
                expect(x).toBeGreaterThan(Math.min(...xs));
                expect(x).toBeLessThan(Math.max(...xs));
                expect(z).toBeGreaterThan(Math.min(...zs));
                expect(z).toBeLessThan(Math.max(...zs));
            }
        }
        const living = ceilings.find((c) => c.id?.endsWith('-living-ceil'));
        expect((living?.shape).params.downlights.length).toBeGreaterThanOrEqual(4);
    });
    it('grids scale with the room and skip tiny rooms and industrial style', () => {
        const big = downlightGrid([[0, 0], [8, 0], [8, 6], [0, 6]], 'living', 'modern');
        const small = downlightGrid([[0, 0], [2.4, 0], [2.4, 2.4], [0, 2.4]], 'bathroom', 'modern');
        expect(big.length).toBeGreaterThan(small.length);
        expect(small.length).toBeGreaterThanOrEqual(1);
        expect(downlightGrid([[0, 0], [1.2, 0], [1.2, 1.2], [0, 1.2]], 'bathroom', 'modern')).toEqual([]);
        expect(downlightGrid([[0, 0], [8, 0], [8, 6], [0, 6]], 'living', 'industrial')).toEqual([]);
        expect(downlightGrid([[0, 0], [8, 0], [8, 6], [0, 6]], 'terrace', 'modern')).toEqual([]);
    });
    it('draws a trim ring and an emissive lens per light, dark when unlit', () => {
        const base = { polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], downlights: [[1, 1], [3, 3]], cove: 0.08 };
        const lit = buildCeiling(CeilingParams.parse(base));
        const lens = lit.parts.find((p) => p.material.preset === 'emissive');
        expect(lens?.material.emissiveIntensity).toBeGreaterThan(0);
        expect(lit.parts.length).toBe(3);
        const dark = buildCeiling(CeilingParams.parse({ ...base, lit: false }));
        expect(dark.parts.find((p) => p.material.preset === 'emissive')?.material.emissiveIntensity).toBe(0);
        expect(buildCeiling(CeilingParams.parse({ ...base, downlights: [] })).parts.length).toBe(1);
    });
});
