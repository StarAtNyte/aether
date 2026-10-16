import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { analyzeRoomPlacements, compileBuilding, navigableVerdict, summarizePlacementIssues } from '../src/index';
import { APARTMENT } from './fixtures';
function build(plan, seed = 1) {
    const c = compileBuilding(plan, { seed });
    const world = createWorld({ environment: { ground: { material: { preset: 'grass' }, size: 200 } } });
    const res = applyPatches(world, c.patches, { atomic: true });
    expect(res.errors).toEqual([]);
    return res.world;
}
function planFor(r) {
    return {
        id: 'rm',
        style: r.style,
        levels: [
            {
                height: 2.9,
                autoWindows: false,
                rooms: [
                    { id: 'main', type: r.type, rect: [0, 0, r.w, r.d], items: (r.items ?? []).map((i) => ({ ...i, params: i.params ?? {} })) },
                    { id: 'hall', type: 'hall', rect: [0, r.d, r.w, r.d + 1.6] },
                ],
                doors: [
                    { between: ['hall', 'main'], at: r.doorAt },
                    { between: ['hall', 'outside'], side: 'south', main: true },
                    ...(r.outside ? [{ between: ['main', 'outside'], side: r.outside.side, at: r.outside.at, width: 0.9 }] : []),
                ],
                windows: r.windows.map((w) => ({ room: 'main', side: w.side, count: w.count, width: w.width, sill: w.sill ?? 0.9, height: 1.3 })),
            },
        ],
    };
}
const TYPES = ['bedroom', 'living', 'kitchen', 'bathroom', 'office', 'kids', 'dining', 'studio'];
const STYLES = ['modern', 'scandinavian', 'industrial', 'japandi', 'classic'];
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
function randomRoom(rand, i) {
    const sides = ['north', 'east', 'west'];
    const w = 2.4 + rand() * 4.6;
    const d = 2.4 + rand() * 4.2;
    const windows = [];
    for (const side of sides)
        if (rand() < 0.7)
            windows.push({ side, width: 0.6 + rand() * 1.8, count: 2 + Math.floor(rand() * 2), sill: rand() < 0.2 ? 0.1 : 0.9 });
    const outside = rand() < 0.5 ? { side: sides[Math.floor(rand() * 3)], at: 0.2 + rand() * 0.6 } : undefined;
    const items = [];
    if (rand() < 0.7)
        items.push({ kind: 'curtain', ...(rand() < 0.5 ? { against: sides[Math.floor(rand() * 3)] } : {}) });
    if (rand() < 0.8)
        items.push({ kind: 'art', against: ['north', 'east', 'west', 'south'][Math.floor(rand() * 4)] });
    if (rand() < 0.4)
        items.push({ kind: 'mirror', against: ['north', 'east', 'west', 'south'][Math.floor(rand() * 4)] });
    return { type: TYPES[i % TYPES.length], w, d, style: STYLES[i % STYLES.length], windows, doorAt: 0.15 + rand() * 0.7, ...(outside ? { outside } : {}), items };
}
describe('wall pieces never sit over doors, windows or each other', () => {
    it('a bedroom with a door and a window on the same wall plus an explicit curtain and painting', () => {
        const world = build(planFor({ type: 'bedroom', w: 4, d: 3.6, style: 'modern', windows: [{ side: 'north', width: 1.2, count: 1 }], doorAt: 0.5, outside: { side: 'north', at: 0.8 }, items: [{ kind: 'curtain', against: 'north' }, { kind: 'art', against: 'north' }] }));
        const issues = analyzeRoomPlacements(world);
        expect(issues, summarizePlacementIssues(issues)).toEqual([]);
        const kinds = Object.values(world.entities).filter((e) => e.arch?.kind === 'curtain' || e.arch?.kind === 'art');
        expect(kinds.length).toBeGreaterThan(0);
    });
    it('the apartment fixture is clean on every style and seed', () => {
        for (const style of STYLES) {
            for (const seed of [1, 2, 3, 7, 11]) {
                const world = build({ ...APARTMENT, style }, seed);
                const issues = analyzeRoomPlacements(world);
                expect(issues, `${style}/${seed}: ${summarizePlacementIssues(issues)}`).toEqual([]);
            }
        }
    });
    it('property sweep: 120 random rooms (types, styles, narrow walls, doors next to windows)', () => {
        const rand = rng(20261015);
        const bad = [];
        let curtains = 0;
        let arts = 0;
        for (let i = 0; i < 120; i++) {
            const spec = randomRoom(rand, i);
            const world = build(planFor(spec), 1 + (i % 9));
            const issues = analyzeRoomPlacements(world);
            if (issues.length > 0)
                bad.push(`#${i} ${spec.type}/${spec.style} ${spec.w.toFixed(1)}x${spec.d.toFixed(1)}: ${summarizePlacementIssues(issues, 2)}`);
            for (const e of Object.values(world.entities)) {
                if (e.arch?.kind === 'curtain')
                    curtains++;
                if (e.arch?.kind === 'art')
                    arts++;
            }
        }
        expect(bad).toEqual([]);
        expect(curtains).toBeGreaterThan(20);
        expect(arts).toBeGreaterThan(20);
    });
    it('flags a curtain moved over a door and proposes a spot beside the window', () => {
        const world = build(planFor({ type: 'bedroom', w: 3.6, d: 5.6, style: 'modern', windows: [{ side: 'west', width: 1.0, count: 2 }], doorAt: 0.5, outside: { side: 'west', at: 0.9 }, items: [{ kind: 'curtain', against: 'west' }] }));
        expect(analyzeRoomPlacements(world)).toEqual([]);
        const curtain = Object.values(world.entities).find((e) => e.arch?.kind === 'curtain');
        const door = Object.values(world.entities).find((e) => e.arch?.role === 'door' && Math.abs(e.transform.position[0]) < 0.5);
        expect(curtain, 'a curtain was hung').toBeTruthy();
        expect(door, 'the west door exists').toBeTruthy();
        const moved = { ...world, entities: { ...world.entities, [curtain.id]: { ...curtain, transform: { ...curtain.transform, position: [curtain.transform.position[0], curtain.transform.position[1], door.transform.position[2]] } } } };
        const issues = analyzeRoomPlacements(moved);
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]?.code).toBe('wall_item_on_opening');
        expect(issues[0]?.entities).toContain(curtain.id);
        expect(issues[0]?.compass).toBe('west wall');
        const fix = issues[0].fix;
        expect(fix.position ?? fix.remove).toBeTruthy();
        if (fix.position) {
            // Applying the fix clears the problem.
            const fixed = { ...moved, entities: { ...moved.entities, [curtain.id]: { ...curtain, transform: { ...curtain.transform, position: fix.position } } } };
            expect(analyzeRoomPlacements(fixed)).toEqual([]);
        }
    });
    it('the navigable verification test flags a curtain over a door', () => {
        const world = build(planFor({ type: 'bedroom', w: 3.6, d: 5.6, style: 'modern', windows: [{ side: 'west', width: 1.0, count: 2 }], doorAt: 0.5, outside: { side: 'west', at: 0.9 }, items: [{ kind: 'curtain', against: 'west' }] }));
        expect(navigableVerdict(world, 'rm', 0.8).passed).toBe(true);
        const curtain = Object.values(world.entities).find((e) => e.arch?.kind === 'curtain');
        const door = Object.values(world.entities).find((e) => e.arch?.role === 'door' && Math.abs(e.transform.position[0]) < 0.5);
        const moved = { ...world, entities: { ...world.entities, [curtain.id]: { ...curtain, transform: { ...curtain.transform, position: [curtain.transform.position[0], curtain.transform.position[1], door.transform.position[2]] } } } };
        const v = navigableVerdict(moved, 'rm', 0.8);
        expect(v.passed).toBe(false);
        expect(v.message).toMatch(/Curtain .* sits over a door on the west wall/);
    });
});
