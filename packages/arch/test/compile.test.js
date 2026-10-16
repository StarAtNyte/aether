import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { compileBuilding, navigableVerdict, PlanError } from '../src/index';
import { APARTMENT } from './fixtures';
function build(plan) {
    const c = compileBuilding(plan);
    const world = createWorld({ environment: { ground: { material: { preset: 'grass' }, size: 200 } } });
    const res = applyPatches(world, c.patches, { atomic: true });
    return { c, world: res.world, errors: res.errors };
}
describe('compileBuilding', () => {
    it('compiles a valid World IR building', () => {
        const { c, errors, world } = build(APARTMENT);
        expect(errors).toEqual([]);
        expect(c.stats.rooms).toBe(6);
        expect(c.stats.walls).toBeGreaterThan(6);
        expect(c.stats.doors).toBeGreaterThanOrEqual(6);
        expect(c.stats.windows).toBeGreaterThan(2);
        expect(c.stats.furniture).toBeGreaterThan(15);
        expect(c.stats.lights).toBeGreaterThan(3);
        expect(c.stats.lights).toBeLessThanOrEqual(14);
        expect(Object.keys(world.entities).length).toBe(c.entities.length);
        // Every door leaf swings with the door behaviour on E.
        const leaves = Object.values(world.entities).filter((e) => e.arch?.role === 'door');
        expect(leaves.length).toBe(4);
        for (const l of leaves)
            expect(l.behaviors[0]?.params['key']).toBe('e');
    });
    it('is deterministic', () => {
        expect(JSON.stringify(compileBuilding(APARTMENT).entities)).toBe(JSON.stringify(compileBuilding(APARTMENT).entities));
    });
    it('produces a physically usable apartment (reachable rooms, free door swings, no overlaps)', () => {
        const { world } = build(APARTMENT);
        const v = navigableVerdict(world, 'apt', 0.8);
        expect(v.message).toMatch(/.*/);
        expect(v.passed, v.message).toBe(true);
    });
    it('detects a blocked room', () => {
        const plan = structuredClone(APARTMENT);
        plan.levels[0].doors = plan.levels[0].doors.filter((d) => JSON.stringify(d) !== JSON.stringify({ between: ['hall', 'bed2'] }));
        const { world } = build(plan);
        const v = navigableVerdict(world, 'apt', 0.8);
        expect(v.passed).toBe(false);
        expect(v.message).toMatch(/bed2|Bedroom/);
    });
    it('rejects bad plans with a code and hint', () => {
        try {
            compileBuilding({ levels: [] });
            expect.unreachable();
        }
        catch (e) {
            expect(e).toBeInstanceOf(PlanError);
            expect(e.code).toBe('invalid_plan');
            expect(e.hint.length).toBeGreaterThan(10);
        }
    });
    it('compiles a two-storey house with a stair, pitched roof, terrace and pool', () => {
        const { c, errors, world } = build(villa(0.5));
        expect(errors).toEqual([]);
        expect(c.stats.stairs).toBe(1);
        // The top floor is a rectangle, so the requested gable roof is built (no flat-roof fallback).
        expect(c.notes.join(' ')).not.toMatch(/flat roof/);
        const roof = world.entities['villa-roof'];
        expect(roof?.shape.kind === 'procedural' ? roof.shape.generator : null).toBe('arch-roof');
        const v = navigableVerdict(world, 'villa', 0.8);
        expect(v.passed, v.message).toBe(true);
    });
    it('flags a stair whose top arrives boxed in against a wall', () => {
        // From x = 1 the 4.6 m flight ends 0.4 m short of the landing's east wall: no 0.8 m walkway onward.
        const { world } = build(villa(1));
        const v = navigableVerdict(world, 'villa', 0.8);
        expect(v.passed).toBe(false);
        expect(v.message).toMatch(/master|Bedroom/);
    });
});
/** Two-storey house; `stairX` is where the straight flight starts on the ground floor. */
function villa(stairX) {
    return {
        id: 'villa',
        style: 'japandi',
        levels: [
            { height: 3.1, rooms: [{ id: 'living', type: 'living', rect: [0, 0, 8, 6] }, { id: 'kitchen', type: 'kitchen', rect: [8, 0, 12, 6] }], doors: [{ between: ['living', 'outside'], side: 'south', main: true }, { between: ['living', 'kitchen'], kind: 'opening', width: 2 }], stairs: [{ at: [stairX, 1.2], heading: 'east', width: 1 }] },
            { height: 2.9, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 6, 3] }, { id: 'master', type: 'bedroom', rect: [0, 3, 6, 6] }, { id: 'bath', type: 'bathroom', rect: [6, 0, 9, 6] }], doors: [{ between: ['landing', 'master'] }, { between: ['landing', 'bath'] }] },
        ],
        roof: { shape: 'gable', pitch: 30 },
        site: { terrace: [[-2, 6], [14, 6], [14, 14], [-2, 14]], pool: { at: [6, 10.5], width: 7, length: 3 } },
    };
}
