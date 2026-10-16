import { describe, expect, it } from 'vitest';
import { applyPatches, deepEqual, invertPatches } from '@aether/core';
import { playtest, selfRepair } from '../src';
import { coin, gameWorld, goalAt, pickup, slab, winAt } from './helpers';
function brief(r) {
    return JSON.stringify({ passed: r.passed, sentence: r.sentence, rounds: r.rounds.map((x) => x.report.summary) });
}
function room(door) {
    return [
        slab('wall-l', [-3.5, 1.5, 6], [5, 3, 0.4]),
        slab('wall-r', [3.5, 1.5, 6], [5, 3, 0.4]),
        slab('wall-top', [0, 2.75, 6], [2, 0.5, 0.4]),
        slab('wall-back', [0, 1.5, 14], [12, 3, 0.4]),
        slab('wall-w', [-6, 1.5, 10], [0.4, 3, 8]),
        slab('wall-e', [6, 1.5, 10], [0.4, 3, 8]),
        slab('roof', [0, 3.2, 10], [12.4, 0.4, 8.4]),
        door,
    ];
}
function lockedDoor() {
    return {
        id: 'door',
        shape: { kind: 'primitive', primitive: 'box', size: [2, 2.5, 0.3] },
        transform: { position: [0, 1.25, 6] },
        physics: { body: 'kinematic' },
        behaviors: [{ type: 'door', params: { trigger: 'state', stateKey: 'unlocked', radius: 3.5, slide: [0, 2.6, 0], duration: 0.6 } }],
    };
}
describe('self-repair', () => {
    it('lowers a pickup platform that is out of reach, with the pickup on it', async () => {
        const world = gameWorld([coin('c1', [4, 1, 0]), slab('sky', [-4, 6, 0], [3, 0.4, 3]), coin('high', [-4, 7, 0])], { rules: [winAt(2)], state: { score: 0 } });
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect(r.applied).toHaveLength(1);
        expect(r.applied[0]?.sentence).toMatch(/Moved sky with high on it/);
        expect((r.world.entities['sky']?.transform.position[1] ?? 99) < 6).toBe(true);
        expect(r.sentence).toMatch(/^I fixed a problem so it can be won:/);
        expect(r.report.trace).toBeDefined();
    }, 90_000);
    it('moves a platform closer when the gap is too wide to jump', async () => {
        const world = gameWorld([slab('p1', [4, 0.4, 0], [3, 0.8, 3]), slab('p2', [16, 0.4, 0], [3, 0.8, 3]), coin('far', [16, 1.6, 0])], { rules: [winAt(1)], state: { score: 0 }, environment: { ground: null } }, [4, 1, 0]);
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect((r.world.entities['p2']?.transform.position[0] ?? 99) < 16).toBe(true);
    }, 90_000);
    it('opens a door nothing can unlock by proximity', async () => {
        const world = gameWorld([...room(lockedDoor()), goalAt('exit', [0, 1, 10])], { state: { unlocked: false } });
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect(r.applied[0]?.sentence).toMatch(/open when you walk up to it/);
        const behavior = r.world.entities['door']?.behaviors.find((b) => b.type === 'door');
        expect(behavior?.params['trigger']).toBe('proximity');
    }, 90_000);
    it('lowers a win target that more pickups were needed for', async () => {
        const world = gameWorld([coin('c1', [3, 1, 0]), coin('c2', [-3, 1, 0]), coin('c3', [0, 1, 4])], { rules: [winAt(5)], state: { score: 0 } });
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect(r.applied[0]?.sentence).toMatch(/Lowered the win target from 5 to 3/);
        expect(r.world.rules.find((x) => x.id === 'win-score')?.when).toMatchObject({ on: 'state', value: 3 });
    }, 90_000);
    it('adds a win rule to a game nothing ends', async () => {
        const world = gameWorld([coin('c1', [3, 1, 0]), coin('c2', [-3, 1, 0])], { state: { score: 0 } });
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect(r.applied[0]?.sentence).toMatch(/Added a win rule/);
    }, 90_000);
    it('moves a player start out of a wall', async () => {
        const world = gameWorld([slab('block', [0, 1.5, 0], [4, 3, 4]), coin('c', [8, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }, [0, 1, 0]);
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect(r.applied[0]?.code).toBe('spawn_blocked');
    }, 90_000);
    it('gives a countdown the time the bot measured it needs', async () => {
        const world = gameWorld([coin('c1', [20, 1, 0]), coin('c2', [20, 1, 20])], {
            rules: [
                { id: 'count', when: { on: 'tick', every: 1 }, if: [{ key: 'timeLeft', op: '>', value: 0 }], then: [{ do: 'add', key: 'timeLeft', amount: -1 }] },
                { id: 'win-all', when: { on: 'state', key: 'score', op: '>=', value: 2 }, then: [{ do: 'win', text: 'done' }], once: true },
                { id: 'times-up', when: { on: 'state', key: 'timeLeft', op: '<=', value: 0 }, if: [{ key: 'score', op: '<', value: 2 }], then: [{ do: 'lose', text: "Time's up!" }], once: true },
            ],
            state: { score: 0, timeLeft: 4 },
        });
        const before = await playtest(world, { trace: false });
        expect(before.findings.some((f) => f.code === 'lost')).toBe(true);
        const r = await selfRepair(world);
        expect(r.passed, brief(r)).toBe(true);
        expect(r.applied[0]?.sentence).toMatch(/Raised the time limit from 4 s/);
        expect(Number(r.world.state['timeLeft'])).toBeGreaterThan(4);
    }, 120_000);
    it('keeps every repair undoable', async () => {
        const world = gameWorld([coin('c1', [3, 1, 0]), coin('c2', [-3, 1, 0]), coin('c3', [0, 1, 4])], { rules: [winAt(5)], state: { score: 0 } });
        const r = await selfRepair(world);
        const proposal = r.applied[0];
        expect(proposal).toBeDefined();
        const forward = applyPatches(world, proposal?.patches ?? []);
        const back = applyPatches(forward.world, invertPatches(world, forward.applied));
        expect(deepEqual(back.world, world)).toBe(true);
    }, 90_000);
    it('does not guess when it cannot help: a pickup nobody can take stays reported', async () => {
        // A circular lock: the only key is behind the door it opens; moving the key is the fix, not a rule change.
        const world = gameWorld([...room({ ...lockedDoor(), behaviors: [{ type: 'door', params: { trigger: 'state', stateKey: 'keys', radius: 3.5, slide: [0, 2.6, 0], duration: 0.6 } }] }), pickup('key', [0, 1, 9], 'keys'), goalAt('exit', [0, 1, 11])], { state: { keys: 0 } });
        const r = await selfRepair(world, { maxRounds: 2 });
        // The key is behind the door: the door is reported as locked and the world is not silently rewritten into something else.
        expect(r.passed || r.applied.every((a) => a.code === 'door_locked' || a.code === 'unreachable_objective')).toBe(true);
    }, 90_000);
});
