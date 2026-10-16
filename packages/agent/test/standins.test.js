import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog, setCatalog } from '@aether/assets';
import { findStandIns } from '@aether/core';
import { mockApply } from './helpers';
/** Prompts that make the offline planner place people, creatures and vehicles. */
const PROMPTS = [
    'a village with a friendly villager to talk to',
    'a haunted graveyard with ghosts',
    'a zombie chasing me in a dark forest',
    'a busy city street with pedestrians and taxis',
    'a camp with a dog and a wolf pack',
    'a medieval market with a merchant and a guard',
    'a farm with sheep, cows and a horse',
    'a racing track with cars',
    'a town square with some people',
];
beforeAll(async () => {
    await loadCatalog();
});
afterAll(() => {
    setCatalog(null);
});
describe('the planner never leaves a stand-in for a person, an animal or a vehicle', () => {
    for (const prompt of PROMPTS) {
        it(prompt, async () => {
            const { result } = await mockApply(prompt);
            expect(result.errors).toEqual([]);
            expect(findStandIns(result.world).map((s) => `${s.id}: ${s.reason}`)).toEqual([]);
        });
    }
});
describe('quality assessment', () => {
    it('reports a stand-in person as a major coherence issue', async () => {
        const { assessWorld } = await import('../src/quality/heuristics');
        const { createWorld } = await import('@aether/core');
        const world = createWorld({ entities: { 'villager-1': { id: 'villager-1', tags: ['npc'], shape: { kind: 'primitive', primitive: 'capsule', size: [0.6, 1.7, 0.6] } } } });
        const report = assessWorld({ world, prompt: 'a village' });
        expect(report.issues.some((i) => i.criterion === 'coherence' && i.severity === 'major' && /Characters must be real/.test(i.message))).toBe(true);
    });
});
