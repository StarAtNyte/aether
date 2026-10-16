/**
 * The review loop for games and outdoor levels: the level tools are the checker, renders come from the
 * overview and the player's camera, the model fixes with the level tools, and the loop ends when the
 * measurements are clean (or stalls). Scenery with no gameplay is not reviewed as a level.
 */
import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { levelSnapshot, LevelReviewData } from '../src/level-review';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';
class Scripted {
    script;
    name = 'scripted';
    requests = [];
    constructor(script) {
        this.script = script;
    }
    async complete(req) {
        this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
        return this.script.shift() ?? { content: [{ type: 'text', text: 'done' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } };
    }
}
let seq = 0;
const call = (name, input) => ({ type: 'tool_use', id: `l-${++seq}`, name, input });
const turn = (...content) => ({ content, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });
const gem = (id, x) => ({
    op: 'add',
    entity: { id, shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] }, transform: { position: [x, 1, 0] }, behaviors: [{ type: 'collectible', params: { scoreKey: 'score', value: 1 } }] },
});
const POSES = [
    { name: 'overview', label: 'the whole level from above and in front', position: [0, 40, 50], target: [0, 0, 0], fov: 55 },
    { name: 'player-view', label: "the player's first view from the spawn", position: [0, 3, 8], target: [0, 2, -14], fov: 70 },
];
function review(findings) {
    return {
        ok: true,
        text: 'Level review',
        patches: [],
        message: 'Level review',
        data: { applicable: true, score: findings.length === 0 ? 100 : 75, findings: findings.map((f) => ({ code: 'unreachable_required', severity: f.severity, message: f.message, entities: ['gem-far'], fix: 'move it within reach', at: [60, 5, 0] })), poses: structuredClone(POSES) },
    };
}
describe('level review data', () => {
    it('accepts the tool answer and refuses anything malformed', () => {
        expect(LevelReviewData.safeParse(review([]).data).success).toBe(true);
        expect(LevelReviewData.safeParse({ applicable: true }).success).toBe(false);
        const bad = review([]).data;
        bad.poses[0].fov = 500;
        expect(LevelReviewData.safeParse(bad).success).toBe(false);
    });
    it('turns it into a snapshot with the two cameras, or nothing when there is no gameplay', async () => {
        const run = async () => review([{ severity: 'error', message: 'gem-far cannot be reached' }]);
        const snap = await levelSnapshot(run, createWorld(), { maxViews: 6, withViews: true });
        expect(snap?.findings).toHaveLength(1);
        expect(snap?.views.map((v) => v.name)).toEqual(['overview', 'player-view']);
        expect(snap?.views[1]?.pose.fov).toBe(70);
        const noViews = await levelSnapshot(run, createWorld(), { maxViews: 6, withViews: false });
        expect(noViews?.views).toEqual([]);
        expect(await levelSnapshot(async () => ({ ok: true, text: '', patches: [], message: '', data: { applicable: false, score: 100, findings: [], poses: [] } }), createWorld(), { maxViews: 3, withViews: true })).toBeNull();
        expect(await levelSnapshot(async () => ({ ok: true, text: '', patches: [], message: '' }), createWorld(), { maxViews: 3, withViews: true })).toBeNull();
        expect(await levelSnapshot(async () => { throw new Error('physics'); }, createWorld(), { maxViews: 3, withViews: true })).toBeNull();
    });
});
describe('the loop on a level', () => {
    function setup(runner) {
        const provider = new Scripted([
            turn(call('apply_patches', { patches: [gem('gem-near', 3), gem('gem-far', 60)], message: 'Two gems' }), call('finish', { message: 'Built.' })),
            // Review round 1: the model moves the unreachable gem, then approves.
            turn(call('place_level_items', { items: [{ id: 'gem-far', x: 6, z: 0 }] })),
            turn(call('finish', { message: 'Moved the far gem within reach.' })),
        ]);
        const host = new MemoryHost(createWorld());
        const captured = [];
        host.captureReview = async (views) => {
            captured.push(...views.map((v) => v.name));
            return views.map((v) => ({ name: v.name, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }));
        };
        const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools: runner, review: { vision: true, maxRounds: 6, stallRounds: 3 } });
        return { provider, host, captured, agent };
    }
    it('shows the model the findings and renders, lets it fix with the level tools, and approves when clean', async () => {
        let reviews = 0;
        const runner = async (world, name, input) => {
            if (name === 'place_level_items')
                return { ok: true, text: 'Placed 1 item(s): gem-far at 6, 1.05, 0', patches: [{ op: 'update', id: 'gem-far', set: { transform: { position: [6, 1, 0] } } }], message: 'Move gem-far' };
            if (input.op === 'review') {
                reviews++;
                const far = world.entities['gem-far']?.transform.position[0] ?? 0;
                return review(far > 20 ? [{ severity: 'error', message: 'Gem (gem-far) at 60, 1, 0 cannot be reached on foot: 54 m from the nearest place the player can stand' }] : []);
            }
            return { ok: true, text: 'fine', patches: [], message: '' };
        };
        const { provider, host, captured, agent } = setup(runner);
        const events = await collect(agent.run('a gem hunt', host));
        const reviewEvents = events.filter((e) => e.type === 'review');
        // Round 2 is clean but the model can see: it looks at the renders once more before approving.
        expect(reviewEvents.map((e) => e.phase)).toEqual(['checking', 'found', 'fixing', 'checking', 'fixing', 'approved']);
        expect(reviewEvents[0]?.text).toContain('level');
        expect(captured).toEqual(['overview', 'player-view', 'overview', 'player-view']);
        expect(host.world.entities['gem-far']?.transform.position[0]).toBe(6);
        expect(reviews).toBeGreaterThanOrEqual(2);
        // The model was shown the measured finding, the fix and the images' labels.
        const turnText = JSON.stringify(provider.requests.find((r) => JSON.stringify(r.messages).includes('LEVEL REVIEW round 1'))?.messages.at(-1)?.content);
        expect(turnText).toContain('gem-far');
        expect(turnText).toContain('place_level_items');
        expect(turnText).toContain('Image 1: overview');
    });
    it('stops when the same finding comes back round after round', async () => {
        const stuck = async (_world, name, input) => {
            if (name === 'place_level_items')
                return { ok: false, text: 'refused: still out of reach', patches: [], message: '' };
            if (input.op === 'review')
                return review([{ severity: 'error', message: 'gem-far cannot be reached' }]);
            return { ok: true, text: '', patches: [], message: '' };
        };
        const script = [turn(call('apply_patches', { patches: [gem('gem-far', 60)], message: 'Gem' }), call('finish', { message: 'Built.' }))];
        for (let i = 0; i < 6; i++)
            script.push(turn(call('place_level_items', { items: [{ id: 'gem-far', x: 61, z: 0 }] })), turn(call('finish', { message: 'tried' })));
        const provider = new Scripted(script);
        const host = new MemoryHost(createWorld());
        const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools: stuck, review: { maxRounds: 10, stallRounds: 2 } });
        const events = await collect(agent.run('a gem hunt', host));
        const phases = events.filter((e) => e.type === 'review').map((e) => e.phase);
        expect(phases).toContain('stalled');
        expect(phases).not.toContain('approved');
    });
    it('does not review scenery as a level', async () => {
        const calls = [];
        const runner = async (_w, name, input) => {
            calls.push(`${name}:${input.op ?? ''}`);
            return { ok: true, text: '', patches: [], message: '', data: { applicable: false, score: 100, findings: [], poses: [] } };
        };
        const provider = new Scripted([turn(call('apply_patches', { patches: [{ op: 'add', entity: { id: 'rock', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 0] } } }], message: 'A rock' }), call('finish', { message: 'A rock.' }))]);
        const host = new MemoryHost(createWorld());
        const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, levelTools: runner, review: { maxRounds: 3 } }).run('a rock', host));
        expect(events.filter((e) => e.type === 'review')).toEqual([]);
        expect(calls).toEqual(['query_level:review']);
    });
});
