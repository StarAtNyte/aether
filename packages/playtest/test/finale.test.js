/**
 * What the bot learned for games with a staged ending: a goal that a rule
 * switches on, a win behind "stand on the plate and press E", a lift that
 * carries the player up, and a low-gravity jump that hangs for seconds.
 */
import { describe, expect, it } from 'vitest';
import { deriveGoals, playtest } from '../src';
import { gameWorld, pickup, slab } from './helpers';
const goalOff = (id, at) => ({
    id,
    shape: { kind: 'primitive', primitive: 'box', size: [1.5, 2, 1.5] },
    transform: { position: at },
    physics: { body: 'static', sensor: true },
    behaviors: [{ type: 'goal', enabled: false, params: { text: 'You win!' } }],
});
describe('goals switched on by a rule', () => {
    const world = gameWorld([slab('floor', [0, -0.25, 0], [30, 0.5, 12]), pickup('p1', [3, 1, 0], 'orbs'), pickup('p2', [-3, 1, 0], 'orbs'), goalOff('gate', [10, 1, 0])], {
        state: { orbs: 0 },
        rules: [{ id: 'open', when: { on: 'state', key: 'orbs', op: '>=', value: 2 }, then: [{ do: 'enableBehavior', target: 'gate', behavior: 'goal', enabled: true }], once: true }],
    }, [0, 0.5, 0]);
    it('counts as the way to win, touched only after the rule fired', async () => {
        const g = deriveGoals(world);
        expect(g.winDefined).toBe(true);
        const goal = g.objectives.find((o) => o.id === 'goal:gate');
        expect(goal?.gated).toBe(true);
        const report = await playtest(world, { trace: false });
        expect(report.status).toBe('passed');
    }, 60_000);
});
describe('a win behind a key press on a plate', () => {
    const plate = {
        id: 'bell-plate',
        shape: { kind: 'primitive', primitive: 'box', size: [3, 0.4, 3] },
        transform: { position: [8, 0.2, 0] },
        physics: { body: 'static', sensor: true },
        behaviors: [{ type: 'pressurePlate', params: { stateKey: 'atBell', who: 'player', height: 3 } }],
    };
    const zone = { id: 'zone', shape: { kind: 'primitive', primitive: 'box', size: [3, 3, 3] }, transform: { position: [-6, 1.5, 0] }, physics: { body: 'static', sensor: true } };
    const world = gameWorld([slab('floor', [0, -0.25, 0], [30, 0.5, 12]), zone, plate], {
        state: { atBell: false, seen: 0 },
        rules: [
            { id: 'see', when: { on: 'enter', zone: 'zone', who: 'player' }, then: [{ do: 'add', key: 'seen', amount: 1 }], once: true },
            { id: 'ring', when: { on: 'key', key: 'e' }, if: [{ key: 'atBell', op: '==', value: true }, { key: 'seen', op: '>=', value: 1 }], then: [{ do: 'emit', event: 'rung' }], once: true },
            { id: 'end', when: { on: 'event', name: 'rung' }, then: [{ do: 'win', text: 'Done' }] },
        ],
    }, [0, 0.5, 0]);
    it('derives a press objective after the zone and the plate', () => {
        const g = deriveGoals(world);
        expect(g.winDefined).toBe(true);
        const press = g.objectives.find((o) => o.kind === 'press');
        expect(press?.pressKey).toBe('e');
        expect(g.objectives.some((o) => o.kind === 'zone' && o.entity === 'zone')).toBe(true);
    });
    it('walks to the zone, then the plate, presses E and wins', async () => {
        const report = await playtest(world, { trace: false });
        expect(report.status).toBe('passed');
        expect(report.objectives.some((o) => o.kind === 'press' && o.status === 'done')).toBe(true);
    }, 60_000);
    it('reports a win that no key press can reach', async () => {
        const broken = structuredClone(world);
        broken.rules = broken.rules.map((r) => (r.id === 'ring' ? { ...r, if: [{ key: 'atBell', op: '==', value: true }, { key: 'seen', op: '>=', value: 5 }] } : r));
        const report = await playtest(broken, { trace: false });
        expect(report.status).not.toBe('passed');
    }, 60_000);
});
describe('lifts and low gravity', () => {
    const lift = {
        id: 'lift',
        shape: { kind: 'primitive', primitive: 'box', size: [3, 0.4, 3] },
        transform: { position: [6, 0.2, 0] },
        physics: { body: 'kinematic' },
        behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, 8, 0]], relative: true, speed: 2, mode: 'pingpong', wait: 1, face: false } }],
    };
    const winOne = { id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 1 }, then: [{ do: 'win', text: 'Up!' }], once: true };
    it('rides a lift up to a ledge nobody can jump to', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [16, 0.5, 8]), slab('ledge', [12, 7.8, 0], [8, 0.5, 8]), lift, pickup('gem', [12, 9, 0], 'score')], { state: { score: 0 }, rules: [winOne] }, [-4, 0.5, 0]);
        const report = await playtest(world, { trace: false });
        expect(report.summary).toContain('Verified playable');
        expect(report.status).toBe('passed');
    }, 90_000);
    it('still fails when the lift does not reach the ledge', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [16, 0.5, 8]), slab('ledge', [12, 15.8, 0], [8, 0.5, 8]), lift, pickup('gem', [12, 17, 0], 'score')], { state: { score: 0 }, rules: [winOne] }, [-4, 0.5, 0]);
        const report = await playtest(world, { trace: false });
        expect(report.status).not.toBe('passed');
    }, 90_000);
    it('hops onto a block in low gravity without overshooting', async () => {
        const world = gameWorld([slab('floor', [0, -0.25, 0], [30, 0.5, 10]), slab('block', [8, 1.5, 0], [4, 3, 4]), pickup('gem', [8, 3.8, 0], 'score')], { environment: { gravity: [0, -3.2, 0] }, state: { score: 0 }, rules: [winOne] }, [0, 0.5, 0]);
        const report = await playtest(world, { trace: false });
        expect(report.status).toBe('passed');
    }, 90_000);
});
