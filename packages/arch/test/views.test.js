import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { legendText, markIndex, projectMarks, reviewPoses, runDesignTool } from '../src/index';
const PLAN = {
    id: 'home',
    name: 'Test home',
    style: 'modern',
    levels: [
        {
            height: 2.9,
            rooms: [
                { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
                { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
            ],
            openings: [
                { kind: 'window', room: 'bedroom', wall: 'north', along: 2, width: 1.4, height: 1.3, sill: 0.9 },
                { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9 },
                { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true },
            ],
        },
    ],
};
function world() {
    let w = createWorld({});
    const r = runDesignTool(w, 'design_plan', { plan: PLAN });
    w = applyPatches(w, r.patches).world;
    const p = runDesignTool(w, 'place_items', { items: [{ kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'start' }, { kind: 'art', room: 'bedroom', id: 'pic', wall: 'north', t: 3.3 }] });
    return applyPatches(w, p.patches).world;
}
describe('review poses', () => {
    const w = world();
    it('gives a level plan, corner views and wall views, capped', () => {
        const poses = reviewPoses(w, 'home', { rooms: ['bedroom'] });
        const names = poses.map((p) => p.name);
        expect(names[0]).toBe('level-0-plan');
        expect(names.some((n) => n.startsWith('bedroom-corner'))).toBe(true);
        expect(names).toContain('bedroom-wall-north');
        expect(poses.length).toBeLessThanOrEqual(8);
        expect(reviewPoses(w, 'home', { maxViews: 2 })).toHaveLength(2);
        for (const p of poses) {
            expect(p.position.every(Number.isFinite)).toBe(true);
            expect(p.fov).toBeGreaterThanOrEqual(50);
            expect(p.fov).toBeLessThanOrEqual(100);
        }
        expect(poses[0].hideTops).toBe(true);
        expect(poses[0].position[1]).toBeGreaterThan(3);
    });
    it('puts wall cameras inside the room, facing the wall', () => {
        const north = reviewPoses(w, 'home', { rooms: ['bedroom'] }).find((p) => p.name === 'bedroom-wall-north');
        expect(north.position[2]).toBeGreaterThan(north.target[2]);
        expect(north.position[2]).toBeLessThan(3.6);
        expect(north.target[0]).toBeCloseTo(2, 1);
    });
    it('applies the building transform', () => {
        const moved = { ...w, entities: { ...w.entities, home: { ...w.entities['home'], transform: { ...w.entities['home'].transform, position: [100, 0, 50] } } } };
        const a = reviewPoses(w, 'home', { rooms: ['bedroom'] }).find((p) => p.name === 'bedroom-wall-north');
        const b = reviewPoses(moved, 'home', { rooms: ['bedroom'] }).find((p) => p.name === 'bedroom-wall-north');
        expect(b.position[0] - a.position[0]).toBeCloseTo(100, 1);
        expect(b.position[2] - a.position[2]).toBeCloseTo(50, 1);
    });
    it('returns nothing for an unknown building', () => {
        expect(reviewPoses(w, 'nope')).toEqual([]);
        expect(markIndex(w, 'nope')).toEqual([]);
    });
});
describe('numbered marks', () => {
    const w = world();
    it('numbers pieces first (by id) then openings, stably', () => {
        const idx = markIndex(w, 'home');
        expect(idx.slice(0, 2).map((m) => m.id)).toEqual(['home-bed', 'home-pic']);
        expect(idx.map((m) => m.n)).toEqual(idx.map((_, i) => i + 1));
        expect(idx.some((m) => m.kind === 'window')).toBe(true);
        expect(markIndex(w, 'home')).toEqual(idx);
    });
    it('projects the marks that the camera sees, inside the image', () => {
        const idx = markIndex(w, 'home');
        const pose = reviewPoses(w, 'home', { rooms: ['bedroom'] }).find((p) => p.name === 'bedroom-wall-north');
        const marks = projectMarks(w, 'home', pose, 1.5);
        const ids = new Set(marks.map((m) => idx.find((i) => i.n === m.n).id));
        expect(ids.has('home-bed')).toBe(true);
        expect(ids.has('home-pic')).toBe(true);
        for (const m of marks) {
            expect(m.x - m.w).toBeGreaterThanOrEqual(-1e-9);
            expect(m.x + m.w).toBeLessThanOrEqual(1 + 1e-9);
            expect(m.y - m.h).toBeGreaterThanOrEqual(-1e-9);
            expect(m.y + m.h).toBeLessThanOrEqual(1 + 1e-9);
        }
        const bed = marks.find((m) => m.n === 1);
        const pic = marks.find((m) => m.n === 2);
        // The picture hangs to the right of the bed on the north wall, and above the bed's top.
        expect(pic.x).toBeGreaterThan(bed.x);
        const legend = legendText(idx, new Set(marks.map((m) => m.n)));
        expect(legend).toContain('1 = bed home-bed');
    });
    it('marks pieces on the plan view and drops what is behind the camera', () => {
        const plan = reviewPoses(w, 'home')[0];
        expect(projectMarks(w, 'home', plan).length).toBeGreaterThanOrEqual(2);
        const back = { ...plan, position: [2, -5, 2], target: [2, -10, 2], up: [0, 0, -1] };
        expect(projectMarks(w, 'home', back)).toEqual([]);
    });
});
