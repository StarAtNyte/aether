import { describe, expect, it } from 'vitest';
import { mergeMaterial, resolveMaterial, SOFT_SHADED_PRESETS } from '../src/materials/presets';
import { creaseFor, softenKeyed } from '../src/geometry/soften';
/** A flat-shaded fan of shallow triangles: the way generators emit organic parts. */
function facetedPart(material) {
    const positions = [];
    const normals = [];
    const indices = [];
    for (let i = 0; i < 8; i++) {
        const h0 = Math.sin(i * 0.5) * 0.3;
        const h1 = Math.sin((i + 1) * 0.5) * 0.3;
        const q = [
            [i, h0, 0],
            [i + 1, h1, 0],
            [i + 1, h1, 1],
            [i, h0, 1],
        ];
        for (const t of [
            [0, 1, 2],
            [0, 2, 3],
        ]) {
            const [p0, p1, p2] = t.map((k) => q[k]);
            const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const l = Math.hypot(n[0], n[1], n[2]);
            for (const p of [p0, p1, p2]) {
                positions.push(...p);
                normals.push(n[0] / l, n[1] / l, n[2] / l);
                indices.push(indices.length);
            }
        }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: Uint32Array.from(indices), material };
}
describe('generator flat shading on organic presets', () => {
    it('is a default, not an intent: the merged material turns it off for organic presets', () => {
        for (const preset of SOFT_SHADED_PRESETS) {
            const merged = mergeMaterial({ preset: preset, vertexColors: true, flatShading: true }, undefined, 1);
            expect(merged.flatShading, preset).toBe(false);
            expect(resolveMaterial(merged).flatShading, preset).toBe(false);
        }
    });
    it('an entity that asks for flat shading keeps it (the low-poly look is still available on request)', () => {
        const merged = mergeMaterial({ preset: 'leaf', flatShading: true }, { flatShading: true }, 1);
        expect(merged.flatShading).toBe(true);
        const multi = mergeMaterial({ preset: 'stone', flatShading: true }, { flatShading: true }, 3);
        expect(multi.flatShading).toBe(true);
        expect(creaseFor(multi)).toBeNull();
    });
    it('non-organic presets keep the generator choice, and unflagged parts stay unflagged', () => {
        expect(mergeMaterial({ preset: 'brick', flatShading: true }, undefined, 1).flatShading).toBe(true);
        expect(mergeMaterial({ preset: 'crystal', flatShading: true }, undefined, 1).flatShading).toBe(true);
        expect(mergeMaterial({ preset: 'leaf' }, undefined, 1).flatShading).toBeUndefined();
        expect(mergeMaterial(undefined, { preset: 'grass' }, 1)).toEqual({ preset: 'grass' });
    });
    it('does not mutate the inputs', () => {
        const part = Object.freeze({ preset: 'leaf', flatShading: true });
        const out = mergeMaterial(part, undefined, 1);
        expect(part.flatShading).toBe(true);
        expect(out).not.toBe(part);
    });
    it('end to end: a flat-shaded leaf part of a generator is softened, a brick one is not', () => {
        const leaf = facetedPart({ preset: 'leaf', vertexColors: true, flatShading: true });
        const keyed = { key: 'proc|tree', output: { parts: [leaf], colliders: [], bounds: { min: [0, 0, 0], max: [8, 1, 1] }, stats: { triangles: 8, ms: 0 } } };
        const soft = softenKeyed(keyed, undefined);
        expect(soft.key).toContain('|soft');
        expect(soft.output.parts[0].normals).not.toBe(leaf.normals);
        const brick = facetedPart({ preset: 'brick', vertexColors: true, flatShading: true });
        const keyedBrick = { key: 'proc|wall', output: { ...keyed.output, parts: [brick] } };
        expect(softenKeyed(keyedBrick, undefined)).toBe(keyedBrick);
        // The entity's own flat-shading request wins.
        expect(softenKeyed(keyed, { flatShading: true })).toBe(keyed);
    });
});
