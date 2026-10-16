/**
 * The level review: what a level designer checks before a game is shown, measured on the document.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { reviewLevel, runLevelTool, scoreLevel } from '../src';
import { coin, gameWorld, goalAt, pickup, slab, winAt } from './helpers';
beforeAll(async () => {
    await initPhysics();
});
describe('reviewLevel', () => {
    it('says nothing about scenery with no gameplay', async () => {
        const r = await reviewLevel(gameWorld([slab('floor', [0, -0.25, 0], [20, 0.5, 20])], {}, [0, 0.5, 0]));
        expect(r.applicable).toBe(false);
        expect(r.findings).toEqual([]);
        expect((await reviewLevel(createWorld())).applicable).toBe(false);
    });
    it('finds an objective nobody can reach, with the gap, a fix and a camera on the spot', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [20, 0.5, 20]), slab('tower', [40, 5, 0], [6, 10, 6]), coin('c-near', [3, 1, 0]), goalAt('exit', [40, 11.5, 0])], { rules: [winAt(1)], state: { score: 0 } }, [0, 0.5, 0]);
        const r = await reviewLevel(world);
        expect(r.applicable).toBe(true);
        const bad = r.findings.find((f) => f.code === 'unreachable_required');
        expect(bad?.severity).toBe('error');
        expect(bad?.message).toContain('too high');
        expect(bad?.fix).toContain('place_level_items');
        expect(bad?.entities).toEqual(['exit']);
        expect(r.score).toBeLessThanOrEqual(75);
        expect(r.poses.map((p) => p.name)).toEqual(['overview', 'player-view', 'problem']);
        const problem = r.poses.find((p) => p.name === 'problem');
        expect(Math.hypot((problem?.target[0] ?? 0) - 40, (problem?.target[2] ?? 0) - 0)).toBeLessThan(2);
    }, 60_000);
    it('is clean for a level the bot can win, and the score says so', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [30, 0.5, 12]), pickup('p1', [4, 1, 0], 'score'), pickup('p2', [-5, 1, 0], 'score'), goalAt('exit', [10, 1, 0])], { rules: [winAt(2)], state: { score: 0 } }, [0, 0.5, 0]);
        const r = await reviewLevel(world);
        expect(r.findings.filter((f) => f.severity !== 'info')).toEqual([]);
        expect(r.score).toBe(100);
    }, 60_000);
    it('flags a game with objectives and no way to win, and a spawn with nowhere to stand', async () => {
        const noWin = await reviewLevel(gameWorld([slab('floor', [0, -0.25, 0], [20, 0.5, 20]), coin('c', [3, 1, 0])], { state: { score: 0 } }, [0, 0.5, 0]));
        expect(noWin.findings.some((f) => f.code === 'no_win' && f.severity === 'error')).toBe(true);
        const buried = await reviewLevel(gameWorld([slab('floor', [0, -0.25, 0], [20, 0.5, 20]), slab('wall', [0, 1, 0], [10, 2, 10]), coin('c', [3, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }, [0, 0.9, 0]));
        expect(buried.findings.some((f) => f.code === 'spawn')).toBe(true);
    }, 60_000);
    it('warns when the first reward is far from the spawn', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [140, 0.5, 20]), pickup('a', [50, 1, 0], 'score'), pickup('b', [55, 1, 3], 'score'), pickup('c', [60, 1, -3], 'score'), goalAt('exit', [65, 1, 0])], { rules: [winAt(3)], state: { score: 0 } }, [-60, 0.5, 0]);
        const r = await reviewLevel(world);
        expect(r.findings.some((f) => f.code === 'first_reward_far' && f.severity === 'warning')).toBe(true);
    }, 60_000);
    it('scores errors and warnings', () => {
        expect(scoreLevel([])).toBe(100);
        expect(scoreLevel([{ code: 'spawn', severity: 'error', message: 'm', entities: [], fix: 'f' }, { code: 'first_reward_far', severity: 'warning', message: 'm', entities: [], fix: 'f' }])).toBe(69);
        expect(scoreLevel(Array.from({ length: 9 }, () => ({ code: 'spawn', severity: 'error', message: 'm', entities: [], fix: 'f' })))).toBe(0);
    });
});
describe('query_level review', () => {
    it('returns the readable text and the structured data', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [20, 0.5, 20]), coin('c', [3, 1, 0])], { state: { score: 0 } }, [0, 0.5, 0]);
        const r = await runLevelTool(world, 'query_level', { op: 'review' });
        expect(r.ok).toBe(true);
        expect(r.text).toContain('Level review: score');
        expect(r.data?.findings.some((f) => f.code === 'no_win')).toBe(true);
        expect(r.patches).toEqual([]);
    }, 60_000);
});
