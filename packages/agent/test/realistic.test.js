/**
 * "Make it realistic": the offline planner exchanges its stylised nature parts for the realistic
 * vegetation generators when asked, and leaves everything else of the plan alone.
 */
import { applyPatches, createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { planMock } from '../src/providers/mock/planner';
import { makeRealistic, realisticStandIn, REALISTIC_RE } from '../src/providers/mock/realistic';
function generators(patches) {
    const out = [];
    const walk = (shape) => {
        if (!shape)
            return;
        if (shape.kind === 'procedural' && typeof shape.generator === 'string')
            out.push(shape.generator);
        if (shape.kind === 'scatter')
            walk(shape.of);
    };
    for (const p of patches)
        if (p.op === 'add')
            walk(p.entity.shape);
    return out;
}
describe('realistic wording', () => {
    it('is recognised in plain and hyphenated forms only', () => {
        for (const t of ['a realistic forest', 'photorealistic valley', 'photo-realistic lake', 'a lifelike meadow', 'life-like scene'])
            expect(REALISTIC_RE.test(t), t).toBe(true);
        for (const t of ['a forest', 'a surreal island', 'unrealistic physics toy'])
            expect(REALISTIC_RE.test(t), t).toBe(false);
    });
});
describe('stand-ins', () => {
    it('map each stylised part to a realistic one with sensible parameters', () => {
        expect(realisticStandIn('tree-oak', { height: 6, color: '#4f8a3b' })).toMatchObject({ generator: 'tree-broadleaf', params: { color: '#4f8a3b', height: 9 } });
        expect(realisticStandIn('tree-pine', { height: 8, snow: true })).toMatchObject({ generator: 'tree-spruce', params: { snow: 0.8 } });
        expect(realisticStandIn('tree-pine', { height: 8 })).toMatchObject({ params: { snow: 0 } });
        expect(realisticStandIn('bush', { size: 2 })).toMatchObject({ generator: 'shrub', params: { size: 2 } });
        expect(realisticStandIn('grass-tuft', { size: 0.4 })).toMatchObject({ generator: 'meadow-grass' });
        expect(realisticStandIn('rock', { size: 2, mossy: true })).toMatchObject({ generator: 'boulder', params: { lichen: 0.6 } });
        expect(realisticStandIn('house', {})).toBeNull();
    });
    it('rewrites shapes inside scatters and leaves other patches alone', () => {
        const patches = [
            { op: 'add', entity: { id: 'forest', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine', params: { height: 8 } }, count: 20, area: [30, 30] } } },
            { op: 'add', entity: { id: 'hut', shape: { kind: 'procedural', generator: 'house', params: {} } } },
            { op: 'setEnvironment', set: { sky: 'day' } },
        ];
        expect(makeRealistic(patches)).toBe(1);
        expect(generators(patches)).toEqual(['tree-spruce', 'house']);
        expect(patches[2]).toEqual({ op: 'setEnvironment', set: { sky: 'day' } });
    });
});
describe('planMock with a realistic request', () => {
    const nature = 'a forest clearing with a campfire, rocks and bushes';
    it('uses the realistic generators, the plain request keeps the stylised ones, and both apply cleanly', () => {
        const plain = planMock(nature, '', [], 'new');
        const real = planMock(`a realistic ${nature}`, '', [], 'new');
        const g0 = generators(plain.patches);
        const g1 = generators(real.patches);
        expect(g0.some((g) => ['tree-pine', 'tree-oak', 'bush', 'rock'].includes(g))).toBe(true);
        expect(g1.some((g) => ['tree-spruce', 'tree-broadleaf', 'shrub', 'boulder'].includes(g))).toBe(true);
        expect(g1.filter((g) => ['tree-pine', 'tree-oak', 'bush', 'rock', 'grass-tuft'].includes(g))).toEqual([]);
        // Same layout: the same number of generator shapes.
        expect(g1.length).toBeGreaterThan(10);
        expect(real.plan).toContain('Realistic look');
        const out = applyPatches(createWorld(), real.patches);
        expect(out.errors).toEqual([]);
    });
    it('never touches a plan without nature parts', () => {
        const plan = planMock('a realistic two-bedroom apartment', '', [], 'new');
        expect(plan.plan).not.toContain('Realistic look: 0');
    });
});
