/**
 * The walking map is built once per distinct gameplay content and shared by the questions that follow.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applyPatches } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { clearProbeCache, probeCacheStats, runLevelTool } from '../src';
import { gameWorld, pickup, slab, winAt } from './helpers';
beforeAll(async () => {
    await initPhysics();
});
afterEach(() => clearProbeCache());
const world = () => gameWorld([slab('floor', [0, -0.25, 0], [30, 0.5, 12]), pickup('p1', [4, 1, 0], 'score'), pickup('p2', [-5, 1, 0], 'score')], { rules: [winAt(2)], state: { score: 0 } }, [0, 0.5, 0]);
const orb = { shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] } };
describe('probe cache', () => {
    it('answers a run of questions about one world from a single walking map', async () => {
        clearProbeCache();
        const before = probeCacheStats();
        const w = world();
        await runLevelTool(w, 'query_level', { op: 'objectives' });
        await runLevelTool(w, 'query_level', { op: 'review' });
        await runLevelTool(w, 'query_level', { op: 'reach', points: [{ x: 2, z: 2 }] });
        await runLevelTool(w, 'query_level', { op: 'summary' });
        const after = probeCacheStats();
        expect(after.builds - before.builds).toBe(1);
        expect(after.hits - before.hits).toBe(3);
    }, 90_000);
    it('builds a new map when the gameplay content changes, and not for cosmetic changes', async () => {
        clearProbeCache();
        const base = probeCacheStats().builds;
        const w = world();
        await runLevelTool(w, 'query_level', { op: 'objectives' });
        const moved = applyPatches(w, [{ op: 'update', id: 'p1', set: { transform: { position: [6, 1, 0] } } }]).world;
        await runLevelTool(moved, 'query_level', { op: 'objectives' });
        expect(probeCacheStats().builds - base).toBe(2);
        const renamed = applyPatches(moved, [{ op: 'update', id: 'p1', set: { name: 'Gem', material: { color: '#ff0000' } } }]).world;
        await runLevelTool(renamed, 'query_level', { op: 'objectives' });
        expect(probeCacheStats().builds - base).toBe(2);
    }, 90_000);
    it('serialises concurrent questions: one build, every answer complete', async () => {
        clearProbeCache();
        const base = probeCacheStats().builds;
        const w = world();
        const all = await Promise.all([runLevelTool(w, 'query_level', { op: 'objectives' }), runLevelTool(w, 'query_level', { op: 'review' }), runLevelTool(w, 'query_level', { op: 'summary' })]);
        expect(all.every((r) => r.ok)).toBe(true);
        expect(all[0]?.text).toContain('2 objectives, 2 reachable');
        expect(probeCacheStats().builds - base).toBe(1);
    }, 90_000);
    it('placing items and then asking about the result reuses the map the placement built', async () => {
        clearProbeCache();
        const base = probeCacheStats();
        const w = world();
        const placed = await runLevelTool(w, 'place_level_items', { items: [{ id: 'p3', role: 'pickup', x: 8, z: 3, entity: orb }] });
        expect(placed.accepted).toBe(1);
        const next = applyPatches(w, placed.patches).world;
        await runLevelTool(next, 'query_level', { op: 'objectives' });
        const after = probeCacheStats();
        expect(after.builds - base.builds).toBe(1);
        expect(after.hits - base.hits).toBe(1);
    }, 90_000);
    it('a cleared cache builds again', async () => {
        const w = world();
        await runLevelTool(w, 'query_level', { op: 'objectives' });
        clearProbeCache();
        const base = probeCacheStats().builds;
        await runLevelTool(w, 'query_level', { op: 'objectives' });
        expect(probeCacheStats().builds - base).toBe(1);
    }, 90_000);
});
