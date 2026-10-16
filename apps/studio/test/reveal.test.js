import { describe, expect, it } from 'vitest';
import { applyPatches, validateWorld } from '@aether/core';
import { applyArchOps, floorPlan2d } from '@aether/arch';
import { MAX_INK_STROKES, cameraArc, cameraAt, inkPlan, revealPhase, sectionHeightFor, strokeProgress } from '../src/lib/reveal';
const PLAN = {
    id: 'flat',
    name: 'Flat',
    style: 'modern',
    levels: [
        {
            rooms: [
                { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 6, 5] },
                { id: 'bed', type: 'bedroom', rect: [6, 0, 10, 5] },
            ],
            doors: [{ between: ['living', 'bed'] }, { between: ['living', 'outside'], main: true }],
            windows: [{ room: 'living', side: 'north', count: 1 }],
        },
    ],
};
function plan() {
    const r0 = validateWorld({});
    if (!r0.ok)
        throw new Error('invalid');
    const r = applyArchOps(r0.world, [{ op: 'create_building', plan: PLAN }]);
    const world = applyPatches(r0.world, r.patches).world;
    const fp = floorPlan2d(world, 'flat', 0);
    if (!fp)
        throw new Error('no floor plan');
    return fp;
}
describe('reveal timeline', () => {
    it('draws first, then the paper dissolves, the walls rise and the camera settles last', () => {
        const start = revealPhase(0);
        expect(start).toEqual({ ink: 0, paper: 1, rise: 0, cam: 0 });
        const mid = revealPhase(0.2);
        expect(mid.ink).toBeGreaterThan(0.5);
        expect(mid.paper).toBe(1);
        expect(mid.rise).toBe(0);
        const end = revealPhase(1);
        expect(end).toEqual({ ink: 1, paper: 0, rise: 1, cam: 1 });
        // Monotone.
        let prev = revealPhase(0);
        for (let i = 1; i <= 100; i++) {
            const p = revealPhase(i / 100);
            expect(p.ink).toBeGreaterThanOrEqual(prev.ink);
            expect(p.rise).toBeGreaterThanOrEqual(prev.rise);
            expect(p.cam).toBeGreaterThanOrEqual(prev.cam);
            expect(p.paper).toBeLessThanOrEqual(prev.paper);
            prev = p;
        }
        expect(revealPhase(Number.NaN)).toEqual(end);
        expect(revealPhase(-5).ink).toBe(0);
        expect(revealPhase(9).rise).toBe(1);
    });
    it('section height grows in steps and is null once the walls stand', () => {
        expect(sectionHeightFor(1, 3.2)).toBeNull();
        expect(sectionHeightFor(0, 3.2)).toBeGreaterThan(0);
        const heights = Array.from({ length: 101 }, (_, i) => sectionHeightFor(i / 100, 3.2)).filter((h) => h !== null);
        for (let i = 1; i < heights.length; i++)
            expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
        expect(new Set(heights).size).toBeLessThanOrEqual(26);
        expect(sectionHeightFor(0.5, 0)).toBeNull();
        expect(sectionHeightFor(Number.NaN, 3)).toBeNull();
    });
});
describe('ink plan', () => {
    it('turns a floor plan into walls, openings and furniture strokes with lengths and labels', () => {
        const ink = inkPlan(plan());
        expect(ink.strokes.length).toBeGreaterThan(10);
        const weights = new Set(ink.strokes.map((s) => s.weight));
        expect(weights.has('wall')).toBe(true);
        expect(weights.has('opening')).toBe(true);
        expect(weights.has('fine')).toBe(true);
        for (const s of ink.strokes) {
            expect(s.length).toBeGreaterThan(0);
            expect(s.from).toBeGreaterThanOrEqual(0);
            expect(s.to).toBeLessThanOrEqual(1);
            expect(s.to).toBeGreaterThan(s.from);
        }
        // Walls are drawn before furniture.
        const wallEnd = Math.max(...ink.strokes.filter((s) => s.weight === 'wall').map((s) => s.from));
        const furnitureStart = Math.min(...ink.strokes.filter((s) => s.weight === 'fine' && s.closed).map((s) => s.from));
        expect(wallEnd).toBeLessThan(furnitureStart + 0.3);
        expect(ink.labels.map((l) => l.text)).toContain('Living room');
        expect(ink.labels[0]?.detail).toMatch(/m²$/);
        expect(ink.bounds[2]).toBeGreaterThan(ink.bounds[0]);
    });
    it('caps the stroke count and cleans labels', () => {
        const base = plan();
        const many = { ...base, items: Array.from({ length: 4000 }, (_, i) => ({ id: `i${i}`, kind: 'x', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] })) };
        expect(inkPlan(many).strokes.length).toBeLessThanOrEqual(MAX_INK_STROKES);
        const named = { ...base, rooms: [{ ...base.rooms[0], name: 'Bed\u0007room\n<script>'.padEnd(200, 'x') }] };
        const label = inkPlan(named).labels[0]?.text ?? '';
        expect(label.length).toBeLessThanOrEqual(40);
        expect(label).not.toMatch(/[\u0000-\u001f]/);
    });
    it('stroke progress runs 0 to 1 across its window', () => {
        expect(strokeProgress({ from: 0.2, to: 0.4 }, 0)).toBe(0);
        expect(strokeProgress({ from: 0.2, to: 0.4 }, 0.3)).toBeCloseTo(0.5, 5);
        expect(strokeProgress({ from: 0.2, to: 0.4 }, 1)).toBe(1);
        expect(strokeProgress({ from: 0.5, to: 0.5 }, 0.6)).toBe(1);
    });
});
describe('camera arc', () => {
    it('starts overhead and ends exactly at the editor camera', () => {
        const arc = cameraArc([0, 1, 0], [10, 6, 12]);
        const end = cameraAt(arc, 1);
        expect(end.position[0]).toBeCloseTo(10, 4);
        expect(end.position[1]).toBeCloseTo(6, 4);
        expect(end.position[2]).toBeCloseTo(12, 4);
        const start = cameraAt(arc, 0);
        expect(start.pitch).toBeLessThan(-1.2);
        expect(start.position[1]).toBeGreaterThan(end.position[1]);
        // Always looking at the centre.
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
            const c = cameraAt(arc, f);
            const dir = [-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch)];
            const toCentre = [-c.position[0], 1 - c.position[1], -c.position[2]];
            const l = Math.hypot(...toCentre);
            const dot = dir[0] * toCentre[0] / l + dir[1] * toCentre[1] / l + dir[2] * toCentre[2] / l;
            expect(dot).toBeGreaterThan(0.999);
        }
    });
    it('survives degenerate cameras', () => {
        const arc = cameraArc([0, 0, 0], [0, 0, 0]);
        const c = cameraAt(arc, 0.5);
        expect(c.position.every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(c.yaw + c.pitch)).toBe(true);
    });
});
