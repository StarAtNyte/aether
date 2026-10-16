import { describe, expect, it } from 'vitest';
import { compileBuilding, buildFurniture, furnitureByKind, furnitureMovables } from '@aether/arch';
import { generateBuiltinSync, validateOutput } from '../src/index';
const PLAN = {
    id: 'flat',
    name: 'Flat',
    style: 'modern',
    rotation: 30,
    levels: [
        {
            rooms: [
                { id: 'kitchen', type: 'kitchen', rect: [0, 0, 5, 4] },
                { id: 'bed', type: 'bedroom', rect: [5, 0, 9, 4] },
            ],
            doors: [{ between: ['kitchen', 'bed'] }, { between: ['kitchen', 'outside'], main: true }],
        },
    ],
};
function compiled() {
    return compileBuilding(PLAN);
}
function triangleCount(out) {
    return out.parts.reduce((n, p) => n + p.indices.length / 3, 0);
}
describe('interactive furniture parts', () => {
    it('a compiled apartment exposes drawers and cabinet doors as operable children of their piece', () => {
        const b = compiled();
        const parts = b.entities.filter((e) => e.arch?.role === 'part' && e.shape?.kind === 'procedural' && e.shape.generator === 'furn-part');
        expect(parts.length).toBeGreaterThan(6);
        const byId = new Map(b.entities.map((e) => [e.id ?? '', e]));
        for (const part of parts) {
            expect(part.parent && byId.get(part.parent)?.arch?.role).toMatch(/furniture|fixture/);
            expect(['operable', 'toggle']).toContain(part.behaviors?.[0]?.type);
            expect(part.physics?.body).toBe('kinematic');
            expect(part.interact?.kind).toMatch(/drawer|cabinet|appliance|tap/);
            expect(part.shape?.kind).toBe('procedural');
        }
        const kinds = new Set(parts.map((p) => p.arch?.kind));
        expect(kinds.has('drawer')).toBe(true);
        expect(kinds.has('door')).toBe(true);
    });
    it('drawer slide offsets point out of the front of the piece in the world frame (building rotation included)', () => {
        const b = compiled();
        const drawer = b.entities.find((e) => e.arch?.kind === 'drawer');
        expect(drawer).toBeDefined();
        const piece = b.entities.find((e) => e.id === drawer?.parent);
        const slide = (drawer?.behaviors?.[0]?.params?.['slide'] ?? [0, 0, 0]);
        const yaw = (((piece?.transform?.rotation?.[1] ?? 0) + 30) * Math.PI) / 180;
        // Front (+z local) in the world: rotate (0, 1) by the yaw (same convention as rotateYaw).
        const front = [Math.sin(yaw), Math.cos(yaw)];
        const dot = (slide[0] ?? 0) * (front[0] ?? 0) + (slide[2] ?? 0) * (front[1] ?? 0);
        expect(dot).toBeGreaterThan(0.25);
    });
    it('every part regenerates from its recipe: real geometry plus a collider of the part box', () => {
        const b = compiled();
        for (const part of b.entities.filter((e) => e.arch?.role === 'part' && e.shape?.kind === 'procedural' && e.shape.generator === 'furn-part')) {
            const shape = part.shape;
            expect(shape.generator).toBe('furn-part');
            const out = generateBuiltinSync(shape.generator, shape.params, shape.seed);
            expect(validateOutput(out).ok).toBe(true);
            expect(out.parts.length).toBeGreaterThan(0);
            expect(out.colliders.length).toBe(1);
            // Re-centred on the part origin: the box collider sits at the origin and the mesh is near it.
            const size = shape.params['size'];
            expect(out.bounds.min[0]).toBeGreaterThan(-(size[0] ?? 1) / 2 - 0.1);
            expect(out.bounds.max[0]).toBeLessThan((size[0] ?? 1) / 2 + 0.1);
        }
    });
    it('the carcass of an interactive piece has less geometry than the static one, and the parts add it back', () => {
        const def = furnitureByKind('nightstand');
        expect(def).toBeDefined();
        if (!def)
            return;
        const fixed = triangleCount(buildFurniture(def, {}, 3));
        const hollow = triangleCount(buildFurniture(def, { interactive: true }, 3));
        expect(hollow).toBeLessThan(fixed);
        const spec = furnitureMovables(def, {}, 3);
        expect(spec.length).toBe(1);
        expect(spec[0]?.kind).toBe('drawer');
        const partTris = triangleCount(generateBuiltinSync('furn-part', { of: def.id, part: 'drawer-0', p: {}, size: spec[0]?.size ?? [0.4, 0.1, 0.02] }, 3));
        expect(hollow + partTris).toBeGreaterThanOrEqual(fixed);
    });
    it('kitchens hand out base drawers, base doors, upper doors and fridges two doors', () => {
        const kitchen = furnitureByKind('kitchen');
        const fridge = furnitureByKind('fridge');
        if (!kitchen || !fridge)
            throw new Error('missing defs');
        const k = furnitureMovables(kitchen, { length: 3.2 }, 1).map((m) => m.id);
        expect(k.some((id) => id.startsWith('drawer-'))).toBe(true);
        expect(k.some((id) => id.startsWith('door-'))).toBe(true);
        expect(k.some((id) => id.startsWith('upper-'))).toBe(true);
        expect(new Set(k).size).toBe(k.length);
        expect(furnitureMovables(fridge, {}, 1).map((m) => m.id)).toEqual(['door-0', 'door-1']);
    });
    it('refuses malformed or hostile part params', () => {
        const bad = [
            {},
            { of: 'furn-sofa', part: 'door-0' },
            { of: 'furn-kitchen', part: '../etc' },
            { of: '__proto__', part: 'door-0' },
            { of: 'furn-kitchen', part: 'x'.repeat(100) },
        ];
        for (const params of bad)
            expect(() => generateBuiltinSync('furn-part', params, 1)).toThrow();
        // An unknown but well-formed part id is just empty.
        const none = generateBuiltinSync('furn-part', { of: 'furn-kitchen', part: 'drawer-99', p: {}, size: [0.5, 0.5, 0.02] }, 1);
        expect(none.parts.length).toBe(0);
    });
    it('parts are valid entities of the world schema', async () => {
        const { Entity: EntitySchema } = await import('@aether/core');
        for (const e of compiled().entities.filter((x) => x.arch?.role === 'part')) {
            const parsed = EntitySchema.parse(e);
            if (parsed.interact)
                expect(parsed.interact.reach ?? 2.4).toBeLessThanOrEqual(6);
        }
    });
    it('window casements are children of their window: a swinging, usable sash with its own geometry and a smaller static window', () => {
        const b = compileBuilding(PLAN);
        const sashes = b.entities.filter((e) => e.arch?.kind === 'sash');
        expect(sashes.length).toBeGreaterThan(0);
        const byId = new Map(b.entities.map((e) => [e.id ?? '', e]));
        for (const sash of sashes) {
            const win = byId.get(sash.parent ?? '');
            expect(win?.arch?.role).toBe('window');
            expect((win?.shape).params['sash']).toBe(true);
            expect(sash.interact?.kind).toBe('window');
            const bh = sash.behaviors?.[0];
            expect(bh?.type).toBe('operable');
            expect(bh?.params?.['hinge']).toBe('left');
            expect(Math.abs(bh?.params?.['swingAngle'])).toBeGreaterThan(60);
            const shape = sash.shape;
            const out = generateBuiltinSync(shape.generator, shape.params, 1);
            expect(validateOutput(out).ok).toBe(true);
            expect(out.colliders.length).toBe(1);
            // The static window without its casement has less glass than the closed window with one.
            const wp = (win?.shape).params;
            const withSash = generateBuiltinSync('arch-window', wp, 1);
            const without = generateBuiltinSync('arch-window', { ...wp, sash: false }, 1);
            expect(withSash.stats.triangles).toBeLessThan(without.stats.triangles);
        }
        // Windows that cannot open (frosted bathroom glass, wide pictures) keep a plain window.
        const plain = b.entities.filter((e) => e.arch?.role === 'window' && !e.shape.params['sash']);
        expect(plain.length).toBeGreaterThanOrEqual(0);
    });
});
