/**
 * Level of detail of foliage card sets: far trees keep fewer, larger cards (and their trunk simplifies as
 * usual), instead of a QEM collapse that would shred disconnected quads.
 */
import { describe, expect, it } from 'vitest';
import { generateBuiltinSync } from '@aether/procgen';
import { buildLodChain, cardKeepRatio, isCardPart, thinCards } from '../src/virtual/lod-chain';
const tree = (id, params, seed = 3) => generateBuiltinSync(id, params, seed);
/** Total area of a card set (two triangles per card face counted once: every card has both faces). */
function cardArea(p) {
    let a = 0;
    for (let i = 0; i < p.indices.length; i += 3) {
        const [i0, i1, i2] = [p.indices[i], p.indices[i + 1], p.indices[i + 2]];
        const ux = p.positions[i1 * 3] - p.positions[i0 * 3];
        const uy = p.positions[i1 * 3 + 1] - p.positions[i0 * 3 + 1];
        const uz = p.positions[i1 * 3 + 2] - p.positions[i0 * 3 + 2];
        const vx = p.positions[i2 * 3] - p.positions[i0 * 3];
        const vy = p.positions[i2 * 3 + 1] - p.positions[i0 * 3 + 1];
        const vz = p.positions[i2 * 3 + 2] - p.positions[i0 * 3 + 2];
        a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    return a;
}
describe('card part detection', () => {
    it('recognises the generators card sets and nothing else', () => {
        const out = tree('tree-broadleaf', { height: 9 });
        const leaves = out.parts.find((p) => p.material.foliage !== undefined);
        const bark = out.parts.find((p) => p.material.finish === 'bark');
        expect(isCardPart(leaves)).toBe(true);
        expect(isCardPart(bark)).toBe(false);
        // Without the foliage material, or with a mangled index list, it is a plain mesh.
        expect(isCardPart({ ...leaves, material: {} })).toBe(false);
        const broken = { ...leaves, indices: Uint32Array.from(leaves.indices, (v, i) => (i === 5 ? v + 8 : v)) };
        expect(isCardPart(broken)).toBe(false);
    });
});
describe('thinning cards', () => {
    const out = tree('tree-spruce', { height: 14 });
    const needles = out.parts.find((p) => p.material.foliage !== undefined);
    it('keeps about the requested share, with valid indices and the same attributes', () => {
        const cards = needles.positions.length / 12;
        const thin = thinCards(needles, 0.25);
        const kept = thin.positions.length / 12;
        expect(kept).toBeGreaterThan(cards * 0.2);
        expect(kept).toBeLessThan(cards * 0.3);
        expect(thin.indices).toHaveLength(kept * 12);
        for (const i of thin.indices)
            expect(i).toBeLessThan(thin.positions.length / 3);
        expect(thin.normals).toHaveLength(thin.positions.length);
        expect(thin.uvs).toHaveLength(kept * 8);
        expect(thin.colors).toHaveLength(kept * 12);
        // UVs and colours are copied verbatim from the surviving cards.
        for (const v of thin.uvs) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
    it('grows the survivors so coverage is roughly kept, and is deterministic', () => {
        const full = cardArea(needles);
        const thin = thinCards(needles, 0.3);
        const ratio = cardArea(thin) / full;
        expect(ratio).toBeGreaterThan(0.7);
        expect(ratio).toBeLessThan(1.4);
        expect(Array.from(thinCards(needles, 0.3).positions.slice(0, 40))).toEqual(Array.from(thin.positions.slice(0, 40)));
    });
    it('never drops below two cards, never grows without bound and tolerates bad ratios', () => {
        expect(thinCards(needles, 0).positions.length / 12).toBe(2);
        const tiny = thinCards(needles, 0.001);
        for (const v of tiny.positions)
            expect(Number.isFinite(v)).toBe(true);
        expect(thinCards(needles, Number.NaN).positions.length / 12).toBe(2);
        expect(thinCards(needles, 5).positions.length / 12).toBe(needles.positions.length / 12);
        expect(cardKeepRatio(0.3)).toBeGreaterThan(0.3);
        expect(cardKeepRatio(-1)).toBe(0);
    });
});
describe('LOD chain of a tree', () => {
    it('gets strictly cheaper levels with a thinned crown and a simplified trunk', () => {
        const out = tree('tree-broadleaf', { height: 10 });
        const chain = buildLodChain(out.parts);
        expect(chain.length).toBeGreaterThan(1);
        for (let l = 1; l < chain.length; l++)
            expect(chain[l].triangles).toBeLessThan(chain[l - 1].triangles);
        const leafIndex = out.parts.findIndex((p) => p.material.foliage !== undefined);
        const last = chain[chain.length - 1];
        expect(last.parts[leafIndex].indices.length).toBeLessThan(out.parts[leafIndex].indices.length * 0.3);
        // The far crown is still there: its coverage is within a factor of the full crown's.
        const full = cardArea(out.parts[leafIndex]);
        const far = cardArea(last.parts[leafIndex]);
        expect(far / full).toBeGreaterThan(0.45);
        for (const level of chain) {
            for (const p of level.parts)
                for (const i of p.indices)
                    expect(i).toBeLessThan(p.positions.length / 3);
        }
    });
    it('leaves non-card parts to the usual simplifier', () => {
        const out = tree('boulder', { size: 2 });
        const chain = buildLodChain(out.parts);
        expect(chain.length).toBeGreaterThan(1);
    });
});
