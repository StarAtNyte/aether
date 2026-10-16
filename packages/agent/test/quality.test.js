import { applyPatches, createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { assessWorld, viewStatsFromPixels, blendCritique, buildCriticRequest, improvementPatches, needsRefinement, paletteStats, promptKeywords, QUALITY_CRITERIA, refineInstruction } from '../src/quality/index';
import { mockApply } from './helpers';
function world(entities, env = {}) {
    const r = applyPatches(createWorld(), [{ op: 'setEnvironment', set: env }, ...entities.map((entity) => ({ op: 'add', entity }))], { atomic: true });
    expect(r.errors).toEqual([]);
    return r.world;
}
const box = (id, pos, size = [1, 1, 1], extra = {}) => ({
    id,
    name: id,
    shape: { kind: 'primitive', primitive: 'box', size },
    transform: { position: pos },
    ...extra,
});
describe('palette and keywords', () => {
    it('palette harmony rewards clustered hues and flags greys', () => {
        expect(paletteStats(['#e63946', '#f1835a', '#f4a261']).harmony).toBeGreaterThan(0.9);
        expect(paletteStats(['#888888', '#999999', '#777777']).greyShare).toBe(1);
        expect(paletteStats(['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8000', '#8000ff']).hueFamilies).toBeGreaterThanOrEqual(7);
    });
    it('prompt keywords drop stop words and duplicates', () => {
        expect(promptKeywords('Build a cozy lighthouse on a rocky island at night with a lighthouse keeper')).toEqual(['cozy', 'lighthouse', 'rocky', 'island', 'night', 'keeper']);
    });
});
describe('assessWorld', () => {
    it('an empty world scores low on detail and composition and is refinable', () => {
        const r = assessWorld({ world: createWorld(), prompt: 'a medieval village with a castle' });
        expect(r.criteria.detail.score).toBeLessThan(4);
        expect(r.criteria.coherence.score).toBeLessThan(4);
        expect(r.score).toBeLessThan(60);
        expect(needsRefinement(r)).toBe(true);
        expect(r.issues.some((i) => i.fix === 'densify')).toBe(true);
    });
    it('detects floating and interpenetrating static objects', () => {
        const w = world([box('crate-a', [0, 3, 0]), box('crate-b', [5, 0.5, 0], [2, 1, 2]), box('crate-c', [5.3, 0.5, 0.2], [2, 1, 2])]);
        const r = assessWorld({ world: w, prompt: 'crates' });
        const floating = r.issues.find((i) => i.fix === 'ground');
        const overlap = r.issues.find((i) => i.fix === 'separate');
        expect(floating?.entities).toEqual(['crate-a']);
        expect(overlap?.entities?.length).toBe(1);
        expect(r.criteria.physical.score).toBeLessThan(9);
    });
    it('objects resting on others or allowed to hover are not floating', () => {
        const w = world([
            box('table', [0, 0.5, 0], [2, 1, 2]),
            box('vase', [0, 1.25, 0], [0.3, 0.5, 0.3]),
            box('drone', [4, 5, 0], [1, 0.3, 1], { behaviors: [{ type: 'bob' }] }),
        ]);
        expect(assessWorld({ world: w, prompt: 'x' }).issues.filter((i) => i.fix === 'ground')).toEqual([]);
    });
    it('night scenes without lights are flagged; with lights they are not', () => {
        const dark = world([box('hut', [0, 1, 0], [3, 2, 3])], { sky: 'night' });
        expect(assessWorld({ world: dark, prompt: 'a hut at night' }).issues.some((i) => i.fix === 'light-night')).toBe(true);
        const lit = world([box('hut', [0, 1, 0], [3, 2, 3]), { id: 'lamp', light: { type: 'point', intensity: 3, range: 10 }, transform: { position: [2, 2, 0] } }], { sky: 'night' });
        expect(assessWorld({ world: lit, prompt: 'a hut at night' }).issues.some((i) => i.fix === 'light-night')).toBe(false);
    });
    it('coherence matches nouns via ids, generators, synonyms and moods', () => {
        const w = world([{ id: 'pine-1', shape: { kind: 'procedural', generator: 'tree-pine', params: {} } }], { sky: 'night', weather: 'snow' });
        const r = assessWorld({ world: w, prompt: 'snowy forest at night' });
        expect(r.criteria.coherence.score).toBe(10);
        const miss = assessWorld({ world: w, prompt: 'a dragon castle' });
        expect(miss.criteria.coherence.notes[0]).toContain('dragon');
    });
    it('view statistics influence composition and lighting', () => {
        const w = world([box('statue', [0, 1, 0], [1, 2, 1], { tags: ['focus'] })]);
        const good = assessWorld({ world: w, prompt: 'statue', views: Array.from({ length: 4 }, () => ({ coverage: 0.4, edgeDensity: 0.15, luminance: 0.5, contrast: 0.2, colorfulness: 0.3 })) });
        const bad = assessWorld({ world: w, prompt: 'statue', views: Array.from({ length: 4 }, () => ({ coverage: 0.01, edgeDensity: 0.0, luminance: 0.02, contrast: 0.01, colorfulness: 0 })) });
        expect(good.criteria.composition.score).toBeGreaterThan(bad.criteria.composition.score);
        expect(good.criteria.lighting.score).toBeGreaterThan(bad.criteria.lighting.score);
    });
    it('a mock-built themed world scores well (regression guard for the offline planner)', async () => {
        const { result } = await mockApply('a cozy village by a lake at sunset');
        const r = assessWorld({ world: result.world, prompt: 'a cozy village by a lake at sunset', verifyPassed: true });
        expect(r.score).toBeGreaterThanOrEqual(65);
        for (const c of QUALITY_CRITERIA)
            expect(r.criteria[c].score).toBeGreaterThanOrEqual(0);
    });
    it('is deterministic', () => {
        const w = world([box('a', [0, 2, 0]), box('b', [0.2, 0.5, 0])]);
        expect(assessWorld({ world: w, prompt: 'p' })).toEqual(assessWorld({ world: w, prompt: 'p' }));
    });
});
describe('improvementPatches', () => {
    it('grounds, separates, dresses and lights; the result re-scores higher and applies cleanly', () => {
        const w = world([box('crate-a', [0, 3, 0]), box('crate-b', [5, 0.5, 0], [2, 1, 2]), box('crate-c', [5.3, 0.5, 0.2], [2, 1, 2])], { sky: 'night' });
        const before = assessWorld({ world: w, prompt: 'crates at night' });
        const imp = improvementPatches(w, before);
        expect(imp.applied.join(' ')).toMatch(/grounded 1/);
        expect(imp.applied.join(' ')).toMatch(/separated/);
        expect(imp.applied.join(' ')).toMatch(/lanterns/);
        const r = applyPatches(w, imp.patches, { atomic: true });
        expect(r.errors).toEqual([]);
        const after = assessWorld({ world: r.world, prompt: 'crates at night' });
        expect(after.score).toBeGreaterThan(before.score);
        expect(after.issues.some((i) => i.fix === 'ground')).toBe(false);
        expect(after.issues.some((i) => i.fix === 'light-night')).toBe(false);
    });
    it('golden hour only replaces an unset noon sun', () => {
        const w = world([box('a', [0, 0.5, 0])]);
        const rep = assessWorld({ world: w, prompt: 'a box' });
        expect(improvementPatches(w, rep).patches).toContainEqual({ op: 'setEnvironment', set: { timeOfDay: 16.5 } });
        const sunset = world([box('a', [0, 0.5, 0])], { sky: 'sunset' });
        expect(improvementPatches(sunset, assessWorld({ world: sunset, prompt: 'a box' })).patches.some((p) => p.op === 'setEnvironment')).toBe(false);
    });
});
describe('critic', () => {
    const heuristic = () => assessWorld({ world: world([box('a', [0, 0.5, 0])]), prompt: 'a red box' });
    it('builds a critic request with the views and the rubric', () => {
        const req = buildCriticRequest('a red box', heuristic(), ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
        expect(req.role).toBe('critic');
        expect(req.tools).toBeUndefined();
        expect(req.system).toContain('composition');
        const blocks = req.messages[0]?.content;
        expect(Array.isArray(blocks) && blocks.filter((b) => b.type === 'image').length).toBe(2);
    });
    it('blends critic scores (physical stays heuristic) and keeps the heuristic on garbage', () => {
        const h = heuristic();
        const reply = JSON.stringify({ scores: { composition: 2, materials: 2, lighting: 2, scale: 2, detail: 2, coherence: 2, physical: 0 }, issues: [{ criterion: 'detail', severity: 'major', message: 'Only one box.' }], summary: 'Bare.' });
        const b = blendCritique(h, reply);
        expect(b.source).toBe('blend');
        expect(b.criteria.physical).toEqual(h.criteria.physical);
        expect(b.criteria.composition.score).toBeLessThan(h.criteria.composition.score);
        expect(b.issues.some((i) => i.message === 'Only one box.')).toBe(true);
        expect(blendCritique(h, 'I cannot see')).toBe(h);
        expect(blendCritique(h, '{"scores": {"bogus": 3}}')).toBe(h);
    });
    it('refine instructions name the weakest criteria and concrete issues', () => {
        const text = refineInstruction(assessWorld({ world: createWorld(), prompt: 'a castle' }));
        expect(text).toContain('Quality review');
        expect(text).toContain('apply_patches');
        expect(text).toMatch(/- (detail|coherence|composition)/);
    });
});
describe('viewStatsFromPixels', () => {
    const img = (w, h, f) => {
        const a = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const [r, g, b] = f(x, y);
                a.set([r, g, b, 255], (y * w + x) * 4);
            }
        return a;
    };
    it('a flat image has no coverage, edges or contrast', () => {
        const s = viewStatsFromPixels(img(64, 64, () => [120, 160, 220]), 64, 64);
        expect(s.coverage).toBe(0);
        expect(s.edgeDensity).toBe(0);
        expect(s.contrast).toBeCloseTo(0, 5);
    });
    it('a detailed object in the middle covers the centre cells', () => {
        const s = viewStatsFromPixels(img(64, 64, (x, y) => (x > 16 && x < 48 && y > 16 && y < 48 ? ((x + y) % 4 < 2 ? [200, 40, 40] : [40, 40, 40]) : [120, 160, 220])), 64, 64);
        expect(s.coverage).toBeGreaterThan(0.15);
        expect(s.coverage).toBeLessThan(0.6);
        expect(s.edgeDensity).toBeGreaterThan(0.05);
        expect(s.colorfulness).toBeGreaterThan(0);
    });
    it('rejects short buffers', () => {
        expect(viewStatsFromPixels(new Uint8ClampedArray(10), 64, 64).coverage).toBe(0);
    });
});
describe('improvementPatches allow-list', () => {
    it('applies only the allowed fixes', () => {
        const w = applyPatches(createWorld(), [{ op: 'setEnvironment', set: { sky: 'night' } }, { op: 'add', entity: { id: 'crate', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 3, 0] } } }]).world;
        const rep = assessWorld({ world: w, prompt: 'a crate' });
        const imp = improvementPatches(w, rep, undefined, new Set(['ground']));
        expect(imp.applied).toEqual(['grounded 1 floating object']);
    });
});
