import { describe, expect, it } from 'vitest';
import { playtest } from '../src';
import { coin, gameWorld, goalAt, pickup, slab, winAt } from './helpers';
function why(r) {
    return JSON.stringify({ status: r.status, summary: r.summary, findings: r.findings.map((f) => f.message), objectives: r.objectives.map((o) => `${o.id}:${o.status}`) });
}
/** A closed room (z 6..14) whose only way in is a doorway in the front wall; `door` fills it. */
function wallWithDoor(door) {
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
function slidingDoor(trigger, params = {}) {
    return {
        id: 'door',
        shape: { kind: 'primitive', primitive: 'box', size: [2, 2.5, 0.3] },
        transform: { position: [0, 1.25, 6] },
        physics: { body: 'kinematic' },
        behaviors: [{ type: 'door', params: { trigger, radius: 3.5, slide: [0, 2.6, 0], duration: 0.6, ...params } }],
    };
}
describe('playtest finds broken worlds', () => {
    it('flags a pickup that sits on a platform too high to reach', async () => {
        const world = gameWorld([coin('c1', [4, 1, 0]), slab('sky', [-4, 6, 0], [3, 0.4, 3]), coin('high', [-4, 7, 0])], { rules: [winAt(2)], state: { score: 0 } });
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        const f = r.findings.find((x) => x.code === 'unreachable_objective' && x.entities.includes('high'));
        expect(f, why(r)).toBeDefined();
        expect(f?.severity).toBe('error');
        expect(f?.message).toMatch(/cannot be reached/);
        expect(r.objectives.find((o) => o.id === 'collect:c1')?.status).toBe('done');
    }, 60_000);
    it('flags a floating platform with a gap too wide to jump', async () => {
        const world = gameWorld([slab('p1', [4, 0.4, 0], [3, 0.8, 3]), slab('p2', [16, 0.4, 0], [3, 0.8, 3]), coin('far', [16, 1.6, 0])], { rules: [winAt(1)], state: { score: 0 }, environment: { ground: null } }, [4, 1, 0]);
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        expect(r.findings.some((x) => x.code === 'unreachable_objective'), why(r)).toBe(true);
    }, 60_000);
    it('clears a gap that is jumpable', async () => {
        const world = gameWorld([slab('p1', [4, 0.4, 0], [3, 0.8, 3]), slab('p2', [8.6, 0.4, 0], [3, 0.8, 3]), coin('far', [8.6, 1.6, 0])], { rules: [winAt(1)], state: { score: 0 }, environment: { ground: null } }, [4, 1, 0]);
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('passed');
    }, 60_000);
    it('flags a locked door whose key nothing ever sets', async () => {
        const world = gameWorld([...wallWithDoor(slidingDoor('state', { stateKey: 'unlocked' })), goalAt('exit', [0, 1, 10])], { state: { unlocked: false } });
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        const f = r.findings.find((x) => x.code === 'door_locked');
        expect(f, why(r)).toBeDefined();
        expect(f?.entities).toContain('door');
        expect(f?.message).toMatch(/nothing in the game ever sets it/);
    }, 60_000);
    it('opens a proximity door and wins', async () => {
        const world = gameWorld([...wallWithDoor(slidingDoor('proximity')), goalAt('exit', [0, 1, 10])]);
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('passed');
        expect(r.trace?.events.some((e) => e.kind === 'door')).toBe(true);
    }, 60_000);
    it('solves key and door: fetches the key first', async () => {
        const world = gameWorld([
            ...wallWithDoor(slidingDoor('state', { stateKey: 'keys' })),
            pickup('key', [-6, 1, -4], 'keys'),
            goalAt('exit', [0, 1, 10]),
        ], { state: { keys: 0 } });
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('passed');
        const keyAt = r.objectives.find((o) => o.id === 'collect:key')?.at;
        const goalAtTime = r.objectives.find((o) => o.id === 'goal:exit')?.at;
        expect(keyAt).toBeDefined();
        expect((goalAtTime ?? 0) > (keyAt ?? 99)).toBe(true);
    }, 60_000);
    it('flags a key behind the locked door it opens (a circular lock)', async () => {
        const world = gameWorld([
            ...wallWithDoor(slidingDoor('state', { stateKey: 'keys' })),
            pickup('key', [0, 1, 9], 'keys'),
            goalAt('exit', [0, 1, 11]),
        ], { state: { keys: 0 } });
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        expect(r.findings.some((x) => x.code === 'door_locked' || x.code === 'unreachable_objective'), why(r)).toBe(true);
    }, 60_000);
    it('flags a win threshold that more pickups are needed for', async () => {
        const world = gameWorld([coin('c1', [3, 1, 0]), coin('c2', [-3, 1, 0]), coin('c3', [0, 1, 4])], { rules: [winAt(5)], state: { score: 0 } });
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        const f = r.findings.find((x) => x.code === 'unwinnable');
        expect(f, why(r)).toBeDefined();
        expect(f?.message).toMatch(/only 3 can ever be collected/);
    }, 60_000);
    it('flags a player spawning inside a wall', async () => {
        const world = gameWorld([slab('block', [0, 1.5, 0], [4, 3, 4]), coin('c', [8, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }, [0, 1, 0]);
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        expect(r.findings.some((x) => x.code === 'spawn_blocked'), why(r)).toBe(true);
    }, 60_000);
    it('reports a game with nothing to win as incomplete', async () => {
        const world = gameWorld([coin('c1', [3, 1, 0]), coin('c2', [-3, 1, 0])], { state: { score: 0 } });
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('failed');
        expect(r.findings.some((x) => x.code === 'no_win_condition')).toBe(true);
    }, 60_000);
    it('walks around lava instead of through it', async () => {
        const lava = {
            id: 'lava',
            shape: { kind: 'primitive', primitive: 'box', size: [3, 0.2, 14] },
            transform: { position: [0, 0.1, 0] },
            physics: { body: 'static', sensor: true },
            behaviors: [{ type: 'hazard', params: { mode: 'lose' } }],
        };
        const world = gameWorld([lava, coin('c1', [8, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }, [-8, 0.5, 0]);
        const r = await playtest(world);
        expect(r.status, why(r)).toBe('passed');
    }, 60_000);
});
