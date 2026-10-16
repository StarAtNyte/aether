import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { buildingIdsOf, hasBuilding, isDesignTool, readScene, reviewFindings, runDesignTool } from '../src/index';
const PLAN = {
    id: 'home',
    name: 'Test home',
    style: 'scandinavian',
    brief: 'A calm bedroom with a window onto the garden.',
    levels: [
        {
            height: 2.9,
            rooms: [
                { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
                { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
            ],
            openings: [
                { kind: 'window', room: 'bedroom', wall: 'north', along: 2, width: 1.4, height: 1.3, sill: 0.9, id: 'win-n' },
                { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9, id: 'door-bed' },
                { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true, id: 'front' },
            ],
        },
    ],
    furniture: [
        { id: 'bed', kind: 'bed', room: 'bedroom', intent: 'bed centred on the north wall', relations: [{ type: 'against_wall', wall: 'north' }, { type: 'centred_on_wall', wall: 'north' }] },
        { id: 'picture', kind: 'art', room: 'bedroom', intent: 'picture centred above the bed', relations: [{ type: 'above_centred', target: 'bed', gap: 0.3 }] },
    ],
};
function commit(world, r) {
    const res = applyPatches(world, r.patches);
    expect(res.errors).toEqual([]);
    return res.world;
}
function shell() {
    const r = runDesignTool(createWorld({}), 'design_plan', { plan: PLAN });
    expect(r.ok, r.text).toBe(true);
    return commit(createWorld({}), r);
}
describe('design_plan tool', () => {
    it('builds the shell and describes it', () => {
        const r = runDesignTool(createWorld({}), 'design_plan', { plan: PLAN });
        expect(r.ok).toBe(true);
        expect(r.text).toContain('room bedroom');
        expect(r.text).toContain('Planned pieces to place');
        expect(hasBuilding(r.world)).toBe(true);
        expect(buildingIdsOf(r.world)).toEqual(['home']);
    });
    it('drops relations the checker cannot measure instead of refusing the plan, and says so', () => {
        const plan = { ...PLAN, furniture: [{ id: 'bed', kind: 'bed', room: 'bedroom', relations: [{ type: 'centred' }, { type: 'against_wall', wall: 'north' }, { type: 5 }, 'x'] }] };
        const r = runDesignTool(createWorld({}), 'design_plan', { plan });
        expect(r.ok, r.text).toBe(true);
        expect(r.text).toMatch(/Ignored relations/);
        expect(r.text).toMatch(/"centred"/);
    });
    it('refuses a malformed or physically wrong plan without building anything', () => {
        const w = createWorld({});
        expect(runDesignTool(w, 'design_plan', { plan: { nope: 1 } }).ok).toBe(false);
        expect(runDesignTool(w, 'design_plan', {}).ok).toBe(false);
        const bad = { ...PLAN, levels: [{ ...PLAN.levels[0], openings: PLAN.levels[0].openings.filter((o) => o.to !== 'outside') }] };
        const r = runDesignTool(w, 'design_plan', { plan: bad });
        expect(r.ok).toBe(false);
        expect(r.patches).toEqual([]);
        expect(r.text).toMatch(/no door leads outside/);
    });
});
describe('opening ids chosen in the plan', () => {
    const aliased = {
        ...PLAN,
        levels: [{ ...PLAN.levels[0], openings: PLAN.levels[0].openings.map((o, i) => ({ ...o, id: ['win-n', 'door-bed', 'front'][i] })) }],
        furniture: [{ id: 'curt', kind: 'curtain', room: 'bedroom', intent: 'curtains at the window', relations: [{ type: 'centred_on_opening', target: 'win-n' }] }],
    };
    const w0 = createWorld({});
    const r0 = runDesignTool(w0, 'design_plan', { plan: aliased });
    const world = commit(w0, r0);
    it('tells the model which built ids they became', () => {
        expect(r0.text).toMatch(/win-n = home-l0-win0/);
    });
    it('accepts the plan id in place_items, edit_items and measure', () => {
        const placed = runDesignTool(world, 'place_items', { items: [{ kind: 'curtain', room: 'bedroom', id: 'curt', opening: 'win-n' }] });
        expect(placed.accepted, placed.text).toBe(1);
        const q = runDesignTool(world, 'query_scene', { queries: [{ q: 'measure', a: 'win-n', b: 'door-bed' }] });
        expect(q.text).not.toMatch(/cannot resolve/);
        expect(q.text).toMatch(/window home-l0-win0/);
    });
});
describe('revising the plan keeps pieces consistent', () => {
    it('hangs placed ceiling lights from the new ceiling when the storey height changes', () => {
        const w0 = shell();
        const placed = runDesignTool(w0, 'place_items', { items: [{ kind: 'ceiling-light', room: 'bedroom', id: 'l', at: [2, 1.8] }] });
        const w1 = commit(w0, placed);
        const lower = { ...PLAN, levels: [{ ...PLAN.levels[0], height: 2.6 }] };
        const r = runDesignTool(w1, 'design_plan', { plan: lower });
        expect(r.ok, r.text).toBe(true);
        const w2 = commit(w1, r);
        const s = readScene(w2, 'home');
        const light = s.items.find((i) => i.id === 'home-l');
        expect(light.pos[1]).toBeCloseTo(s.rooms[0].ceiling, 2);
        expect(reviewFindings(w2, 'home').some((f) => f.code === 'floating')).toBe(false);
    });
});
describe('place_items and edit_items tools', () => {
    const world = shell();
    it('places a batch, reports each result and commits patches together', () => {
        const r = runDesignTool(world, 'place_items', {
            items: [
                { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' },
                { kind: 'hovercraft', room: 'bedroom' },
                { kind: 'art', room: 'bedroom', id: 'picture', wall: 'north', t: 3.3 },
            ],
            message: 'Furnish bedroom',
        });
        expect(r.accepted).toBe(2);
        expect(r.refused).toBe(1);
        expect(r.text).toMatch(/unknown kind/);
        expect(r.message).toBe('Furnish bedroom');
        const after = commit(world, r);
        expect(readScene(after, 'home').items.map((i) => i.id).sort()).toEqual(['home-bed', 'home-picture']);
    });
    it('refuses a picture over the window and says where it fits', () => {
        const r = runDesignTool(world, 'place_items', { items: [{ kind: 'art', room: 'bedroom', id: 'p', wall: 'north', t: 2, y: 1.2 }] });
        expect(r.accepted).toBe(0);
        expect(r.text).toMatch(/window|opening/i);
    });
    it('edits pieces and keeps going after a refusal', () => {
        const placed = commit(world, runDesignTool(world, 'place_items', { items: [{ kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'start' }] }));
        const r = runDesignTool(placed, 'edit_items', { edits: [{ op: 'move', ref: 'nothing', wall: 'north' }, { op: 'snap_to_wall', ref: 'bed', wall: 'north', align: 'centre' }] });
        expect(r.accepted).toBe(1);
        expect(r.refused).toBe(1);
        const after = commit(placed, r);
        const bed = readScene(after, 'home').items.find((i) => i.id === 'home-bed');
        expect(bed.pos[0]).toBeCloseTo(2, 1);
        const gone = runDesignTool(after, 'edit_items', { edits: [{ op: 'remove', ref: 'bed' }] });
        expect(readScene(commit(after, gone), 'home').items).toHaveLength(0);
    });
    it('survives adversarial model output', () => {
        const hostile = [
            { items: [{ kind: 'bed', room: 'bedroom', at: ['NaN', 1] }] },
            { items: [{ kind: 'bed', room: 'bedroom', at: [1e300, 1] }] },
            { items: [{ kind: 'bed', room: '__proto__' }] },
            { items: [{ kind: 'bed', room: 'bedroom', params: { __proto__: { polluted: 1 } } }] },
            { items: [{ kind: 'bed', room: 'bedroom', id: '../../x', constructor: 1 }] },
            { items: Array.from({ length: 500 }, () => ({ kind: 'bed', room: 'bedroom' })) },
            { items: 'bed' },
            { building: 'x'.repeat(5000), items: [{ kind: 'bed', room: 'bedroom' }] },
            { items: [null, 7, [], 'x'] },
        ];
        for (const input of hostile) {
            const r = runDesignTool(world, 'place_items', input);
            expect(r.accepted, JSON.stringify(input).slice(0, 80)).toBe(0);
            expect(r.patches).toEqual([]);
        }
        const edits = [
            { edits: [{ op: 'move', ref: 'constructor', at: [1, 1] }] },
            { edits: [{ op: 'resize', ref: 'bed', params: { width: 1e99 } }] },
            { edits: [{ op: 'rotate', ref: '__proto__', yaw: 10 }] },
            { edits: [{ op: 'explode', ref: 'bed' }] },
        ];
        for (const input of edits)
            expect(runDesignTool(world, 'edit_items', input).accepted).toBe(0);
        expect({}['polluted']).toBeUndefined();
    });
});
describe('query_scene tool', () => {
    const world = shell();
    it('answers wall, measure, list, parts, shell and review in one call', () => {
        const r = runDesignTool(world, 'query_scene', {
            queries: [{ q: 'wall', room: 'bedroom', wall: 'north' }, { q: 'measure', a: 'home-l0-win0', b: 'home-l0-d0' }, { q: 'list', room: 'bedroom' }, { q: 'parts' }, { q: 'shell' }, { q: 'review' }, { q: 'bogus' }],
        });
        expect(r.ok).toBe(true);
        expect(r.text).toContain('window home-l0-win0');
        expect(r.text).toContain('parts library');
        expect(r.text).toMatch(/review of home/);
        expect(r.text).toMatch(/\[7\] refused/);
        expect(r.patches).toEqual([]);
    });
    it('reports planned pieces that were never placed', () => {
        const f = reviewFindings(world, 'home');
        expect(f.filter((x) => x.code === 'plan_missing')).toHaveLength(2);
    });
    it('says what is wrong when there is no building', () => {
        const r = runDesignTool(createWorld({}), 'query_scene', { queries: [{ q: 'list' }] });
        expect(r.text).toMatch(/no building/);
    });
    it('knows its own tool names', () => {
        expect(isDesignTool('place_items')).toBe(true);
        expect(isDesignTool('apply_patches')).toBe(false);
    });
});
