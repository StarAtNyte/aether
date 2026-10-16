import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { analyzeRoomPlacements, applyArchOps, checkBuildings, wallMountIndex } from '@aether/arch';
import { planArch } from '../src/providers/mock/arch';
import { planMock } from '../src/providers/mock/planner';
import { summarizeWorldForModel } from '../src/world-text';
function build(prompt) {
    const base = createWorld();
    const plan = planArch(prompt, summarizeWorldForModel(base));
    expect(plan, prompt).not.toBeNull();
    const env = applyPatches(base, plan.patches);
    const res = applyArchOps(env.world, plan.arch.ops);
    expect(res.errors, prompt).toEqual([]);
    const after = applyPatches(env.world, res.patches);
    expect(after.errors).toEqual([]);
    return after.world;
}
const PROMPTS = [
    'a bedroom with a curtain and a painting',
    'a modern apartment',
    'a house with two bedrooms',
    'a scandinavian living room with a fireplace',
    'a small café interior',
    'a japandi bedroom with a mirror and a painting',
];
describe('offline planner: wall pieces and the placement question', () => {
    for (const prompt of PROMPTS) {
        it(`"${prompt}" hangs nothing over a door or window`, () => {
            const world = build(prompt);
            const issues = analyzeRoomPlacements(world);
            expect(issues, issues.map((i) => i.message).join('; ')).toEqual([]);
            expect(checkBuildings(world)[0]?.issues).toEqual([]);
        });
    }
    it('"a bedroom with a curtain and a painting" actually hangs both, on the right spots', () => {
        const world = build('a bedroom with a curtain and a painting');
        const kinds = Object.values(world.entities).map((e) => e.arch?.kind);
        expect(kinds).toContain('curtain');
        expect(kinds).toContain('art');
        const curtains = wallMountIndex(world);
        expect([...curtains.values()].filter((m) => m.kind === 'curtain').length).toBeGreaterThan(0);
    });
    it('the summary a model reads lists each wall with its openings and wall pieces', () => {
        const world = build('a bedroom with a curtain and a painting');
        const text = summarizeWorldForModel(world);
        expect(text).toMatch(/walls \(t = metres/);
        expect(text).toMatch(/window t=[\d.]+ w=[\d.]+ sill=/);
        expect(text).toMatch(/door t=[\d.]+ w=/);
        expect(text).toMatch(/curtain#[a-z0-9-]+ t=/);
        expect(text).toMatch(/art#[a-z0-9-]+ t=/);
        expect(text).toMatch(/(north|south|east|west) wall/);
        expect(text).toMatch(/placement-check: ok/);
    });
    it('answers "why is the curtain over the door and the painting over the window" by finding and fixing both', () => {
        const world = build('a modern apartment');
        const mounts = Object.values(world.entities).filter((e) => e.arch?.kind === 'curtain' || e.arch?.kind === 'art');
        expect(mounts.length).toBeGreaterThan(2);
        // Break the layout the way the user's render showed it: a door cut where a curtain hangs, a window where a picture hangs.
        const index = wallMountIndex(world);
        const curtain = mounts.find((e) => e.arch?.kind === 'curtain');
        const art = mounts.find((e) => e.arch?.kind === 'art');
        const cut = (w, mountId, opening) => {
            const m = index.get(mountId);
            const wall = w.entities[m.wall];
            const shape = wall.shape;
            const params = { ...shape.params, openings: [...shape.params['openings'], { ...opening, offset: m.t }] };
            return { ...w, entities: { ...w.entities, [wall.id]: { ...wall, shape: { ...shape, params } } } };
        };
        let broken = cut(world, curtain.id, { kind: 'door', width: 0.9, height: 2.1, sill: 0 });
        broken = cut(broken, art.id, { kind: 'window', width: 1.2, height: 1.3, sill: 0.9 });
        const before = analyzeRoomPlacements(broken);
        expect(before.length).toBeGreaterThan(0);
        const summary = summarizeWorldForModel(broken);
        expect(summary).toMatch(/placement-issue/);
        const plan = planMock('why is the curtain over the door and the painting over the window', summary);
        expect(plan.patches.length).toBeGreaterThan(0);
        expect(plan.message).toMatch(/placement problem/);
        expect(plan.message).not.toMatch(/couldn't map/);
        const fixed = applyPatches(broken, plan.patches);
        expect(fixed.errors).toEqual([]);
        const after = analyzeRoomPlacements(fixed.world);
        expect(after, after.map((i) => i.message).join('; ')).toEqual([]);
    });
    it('says honestly that nothing overlaps when the walls are clean', () => {
        const world = build('a modern apartment');
        const plan = planMock('why is the painting over the window?', summarizeWorldForModel(world));
        expect(plan.patches).toEqual([]);
        expect(plan.message).toMatch(/no curtain, picture, mirror/);
    });
});
