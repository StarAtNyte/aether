import { applyArchOps } from '@aether/arch';
import { loadCatalog } from '@aether/assets';
import { applyPatches } from '@aether/core';
import { catalog } from '@aether/procgen';
import { beforeAll, describe, expect, it } from 'vitest';
import { worldChanges } from '../src/refine/changes';
import { classifyScope, auditPatches } from '../src/refine/guard';
import { EMPTY_MEMORY, planFineEdit } from '../src/refine/plan';
import { resolveRef } from '../src/refine/resolve';
import { parseRef } from '../src/refine/parse-ref';
import { sceneOf } from '../src/refine/scene';
import { roomWalls, wallsBySide } from '../src/refine/walls';
import { loadFixture } from './fine/fixtures';
const generators = catalog();
const A = 'apartment-l0-';
function edit(world, text, extra = {}) {
    return planFineEdit({ world, text, catalogs: { generators }, ...extra });
}
function apply(world, r) {
    expect(r.kind, `${r.reason ?? ''} ${r.detail ?? ''}`).toBe('edit');
    const res = applyPatches(world, r.patches);
    expect(res.errors).toEqual([]);
    return res.world;
}
beforeAll(async () => {
    await loadCatalog();
});
describe('minimal patches', () => {
    it('a colour edit is one property-level update on the named object', () => {
        const w = loadFixture('apartment');
        const r = edit(w, 'make the sofa dark green velvet');
        expect(r.kind).toBe('edit');
        const updates = r.patches.filter((p) => p.op === 'update');
        expect(updates).toHaveLength(1);
        expect(r.patches).toHaveLength(1);
        const set = updates[0].set;
        expect(Object.keys(set.shape.params).sort()).toEqual(['color', 'upholstery']);
        expect(r.cosmetic).toBe(true);
        expect(r.summary).toMatch(/sofa/i);
        // nothing else in the world changed
        const after = apply(w, r);
        const changed = new Set(worldChanges(w, after).filter((c) => c.scope === 'entity').map((c) => c.id));
        expect([...changed]).toEqual([`${A}living-f0`]);
    });
    it('keeps the edit when the building is re-compiled (overrides)', () => {
        const w = loadFixture('apartment');
        const after = apply(w, edit(w, 'make the sofa dark green velvet'));
        const sofa = after.entities[`${A}living-f0`];
        expect(sofa.arch?.overrides?.['shape.params.upholstery']).toBe('velvet');
        // An unrelated architecture edit re-compiles the whole building: the sofa keeps its colour.
        const res = applyArchOps(after, [{ op: 'set_material', building: 'apartment', target: 'floor', room: 'living', material: { finish: 'oak' } }]);
        const sofa2 = res.target.entities[`${A}living-f0`];
        expect(sofa2.shape.kind === 'procedural' && sofa2.shape.params['upholstery']).toBe('velvet');
    });
    it('removed pieces stay removed after a re-compile', () => {
        const w = loadFixture('apartment');
        const after = apply(w, edit(w, 'remove the sofa'));
        expect(after.entities[`${A}living-f0`]).toBeUndefined();
        const res = applyArchOps(after, [{ op: 'set_material', building: 'apartment', target: 'floor', room: 'living', material: { finish: 'oak' } }]);
        expect(res.target.entities[`${A}living-f0`]).toBeUndefined();
    });
    it('wallpaper changes only the face that looks into the room', () => {
        const w = loadFixture('apartment');
        const r = edit(w, "wallpaper on the main bedroom's back wall");
        const after = apply(w, r);
        const index = sceneOf(w);
        const room = index.get(`${A}master`);
        const want = new Set(wallsBySide(roomWalls(index, room), 'back', 0).flatMap((x) => x.faces.map((f) => `${f.wallId}:${f.side}`)));
        const got = new Set();
        for (const c of worldChanges(w, after)) {
            const m = /^shape\.params\.finish([AB])/.exec(c.path);
            if (c.scope === 'entity' && m)
                got.add(`${c.id}:${m[1].toLowerCase()}`);
        }
        expect(got.size).toBeGreaterThan(0);
        for (const g of got)
            expect(want.has(g), g).toBe(true);
    });
    it('left and right are the viewer\'s', () => {
        const w = loadFixture('apartment');
        const sofa = sceneOf(w).get(`${A}living-f0`);
        const facingNorth = apply(w, edit(w, 'move the sofa 1 meter to the left', { heading: 0 }));
        const facingSouth = apply(w, edit(w, 'move the sofa 1 meter to the left', { heading: 180 }));
        const dx = (d) => d.entities[`${A}living-f0`].transform.position[0] - w.entities[`${A}living-f0`].transform.position[0];
        expect(dx(facingNorth)).toBeCloseTo(-1, 1);
        expect(dx(facingSouth)).toBeCloseTo(1, 1);
        expect(sofa.id).toBe(`${A}living-f0`);
    });
    it('a fast edit takes milliseconds', () => {
        const w = loadFixture('penthouse');
        const t0 = performance.now();
        for (let i = 0; i < 20; i++)
            edit(w, 'make the sofa burgundy velvet');
        expect((performance.now() - t0) / 20).toBeLessThan(50);
    });
});
describe('target resolution', () => {
    const w = loadFixture('penthouse');
    const index = sceneOf(w);
    const ctx = { selection: [], focus: [], heading: 0 };
    it('by noun and room', () => {
        const r = resolveRef(index, parseRef('the sofa'), ctx);
        expect(r.items.map((i) => i.id)).toEqual(['penthouse-l0-living-f0']);
    });
    it('by ordinal within a room', () => {
        const r = resolveRef(index, parseRef('the second chair in the dining room'), ctx);
        expect(r.items.map((i) => i.id)).toEqual(['penthouse-l0-dining-f2']);
    });
    it('ambiguous references come back as candidates, not a guess', () => {
        const r = resolveRef(index, parseRef('the lamp'), ctx);
        expect(r.items).toHaveLength(0);
        expect(r.ambiguous.length).toBeGreaterThan(1);
    });
    it('uses the selection for "it" and as a tie-break', () => {
        const sel = ['penthouse-l0-living-f7'];
        expect(resolveRef(index, parseRef('it'), { ...ctx, selection: sel }).items.map((i) => i.id)).toEqual(sel);
        expect(resolveRef(index, parseRef('the lamp'), { ...ctx, selection: sel }).items.map((i) => i.id)).toEqual(sel);
    });
    it('by relative position', () => {
        const r = resolveRef(index, parseRef('the lamp left of the sofa'), ctx);
        expect(r.items.length + (r.ambiguous?.length ?? 0)).toBeGreaterThan(0);
    });
    it('never resolves to a locked object', () => {
        const locked = structuredClone(w);
        locked.entities['penthouse-l0-living-f0'].locked = true;
        const r = resolveRef(sceneOf(locked), parseRef('the sofa'), ctx);
        expect(r.items).toHaveLength(0);
    });
    it('a group tag names the whole group ("the train")', () => {
        const meadow = loadFixture('meadow');
        const r = resolveRef(sceneOf(meadow), parseRef('the train'), ctx);
        expect(r.items.length).toBeGreaterThanOrEqual(4);
    });
});
describe('conversation', () => {
    it('"do the same for the other tent" repeats on the sibling', () => {
        const w = loadFixture('camp');
        const first = edit(w, 'make the first tent yellow');
        const w1 = apply(w, first);
        const second = edit(w1, 'do the same for the other tent', { memory: first.memory });
        expect(second.kind).toBe('edit');
        expect(second.targets).toEqual(['tent-2']);
    });
    it('"it" and "make that bigger" follow the last edit', () => {
        const w = loadFixture('camp');
        const first = edit(w, 'make the second tent red');
        const w1 = apply(w, first);
        const next = edit(w1, 'now make it a bit bigger', { memory: first.memory });
        expect(next.targets).toEqual(['tent-2']);
    });
    it('undo and redo are handed to the host', () => {
        const w = loadFixture('camp');
        expect(edit(w, 'undo that').kind).toBe('undo');
        expect(edit(w, 'redo').kind).toBe('redo');
    });
    it('asks instead of guessing', () => {
        const w = loadFixture('apartment');
        const r = edit(w, 'make the rug red');
        expect(r.kind).toBe('question');
        expect(r.question.candidates.length).toBeGreaterThanOrEqual(3);
    });
    it('declines what it does not understand (the model handles it)', () => {
        const w = loadFixture('camp');
        expect(edit(w, 'make the scene feel cozier').kind).toBe('none');
        expect(edit(w, 'what is in this scene?').reason).toBe('question');
        expect(edit(w, 'start over with a desert').reason).toBe('new-world');
    });
    it('refuses honestly when an object cannot take the look', () => {
        const w = loadFixture('apartment');
        const r = edit(w, 'make the sofa legs white');
        expect(r.kind).toBe('none');
        expect(r.reason).toBe('refused');
        expect(r.detail).toMatch(/oak|walnut/);
    });
});
describe('never swallows what it does not understand', () => {
    const prompts = [
        'a cozy village by a lake at sunset',
        'build a medieval village with a windmill and a market',
        'create a haunted forest with fog and ghosts',
        'make a game where you collect coins',
        'a snowy mountain village',
        'make the world a desert at night',
        'make the scene feel more cozy',
        'make it look like the 1980s',
        'add a lot of detail',
        'make everything prettier',
        'give it a fantasy theme',
        'I want to play as a dragon',
        'make the tents look more rustic',
        'surprise me',
        'can you improve this?',
        'build me a castle with a moat and a drawbridge',
        'turn this into a space station',
        'add a boss fight at the end',
        'a jungle with rivers and waterfalls',
        'tell me a story about the campfire',
        'make the sky purple',
    ];
    for (const text of prompts) {
        it(`declines "${text}"`, () => {
            for (const name of ['camp', 'apartment']) {
                const r = edit(loadFixture(name), text);
                expect(r.kind === 'edit' || r.kind === 'question', `${name}: ${r.kind} ${r.summary}`).toBe(false);
                expect(r.patches).toHaveLength(0);
            }
        });
    }
});
describe('game and world edits', () => {
    it('the goal number moves with its rule, HUD label and pickups', () => {
        const w = loadFixture('coins');
        const r = edit(w, 'collect 15 coins to win');
        const after = apply(w, r);
        const rule = after.rules.find((x) => x.id === 'all-coins');
        expect(rule.when.on === 'state' && rule.when.value).toBe(15);
        expect(after.hud.some((h) => h.label.includes('15'))).toBe(true);
        const coins = Object.values(after.entities).filter((e) => e.behaviors.some((b) => b.type === 'collectible'));
        expect(coins.length).toBeGreaterThanOrEqual(15);
    });
    it('a new time limit updates state, messages and the timer test', () => {
        const w = loadFixture('coins');
        const after = apply(w, edit(w, 'give me 90 seconds'));
        expect(after.state['timeLeft']).toBe(90);
        const rule = after.rules.find((x) => x.id === 'intro');
        expect(JSON.stringify(rule)).toContain('90 seconds');
        const t = after.tests.find((x) => x.id === 'timer-runs');
        expect(t && t.kind === 'eventually' && t.condition.value).toBe(88);
    });
    it('"harder" speeds up the opponents', () => {
        const w = loadFixture('kart');
        const r = edit(w, 'make the game harder');
        expect(r.targets.sort()).toEqual(['rival-1', 'rival-2']);
    });
    it('weather, fog and sky are environment-only edits', () => {
        const w = loadFixture('camp');
        for (const text of ['make it rain', 'remove the fog', 'make it night']) {
            const r = edit(w, text);
            expect(r.kind, text).toBe('edit');
            const kinds = new Set(r.changes.map((c) => c.scope));
            expect([...kinds]).toEqual(['environment']);
        }
    });
});
describe('the over-edit guard', () => {
    const w = loadFixture('camp');
    it('classifies a named small edit', () => {
        const s = classifyScope(w, 'make the second tent red', { selection: [], focus: [], heading: 0 });
        expect(s.kind).toBe('small');
        expect(s.allowed.has('tent-2')).toBe(true);
    });
    it('scene-wide requests are broad', () => {
        expect(classifyScope(w, 'make it a winter scene', { selection: [], focus: [], heading: 0 }).kind).toBe('broad');
        expect(classifyScope(w, 'redecorate everything', { selection: [], focus: [], heading: 0 }).kind).toBe('broad');
    });
    it('refuses a patch that also touches unrelated entities', () => {
        const scope = classifyScope(w, 'make the second tent red', { selection: [], focus: [], heading: 0 });
        const good = [{ op: 'update', id: 'tent-2', set: { shape: { params: { color: '#c0392b' } } } }];
        const sloppy = [...good, { op: 'update', id: 'tent-1', set: { shape: { params: { color: '#c0392b' } } } }, { op: 'update', id: 'rock-1', set: { transform: { position: [1, 0, 1] } } }, { op: 'remove', id: 'jetty-1' }];
        expect(auditPatches(w, good, scope).ok).toBe(true);
        const bad = auditPatches(w, sloppy, scope);
        expect(bad.ok).toBe(false);
        expect(bad.offending.sort()).toEqual(['jetty-1', 'rock-1', 'tent-1']);
        expect(bad.message).toMatch(/small edit/);
    });
    it('a regeneration (clear) is refused for a small edit but allowed for a broad one', () => {
        const scope = classifyScope(w, 'make the second tent red', { selection: [], focus: [], heading: 0 });
        expect(auditPatches(w, [{ op: 'clear', keepEnvironment: true }], scope).ok).toBe(false);
        const broad = classifyScope(w, 'start over with a desert', { selection: [], focus: [], heading: 0 });
        expect(auditPatches(w, [{ op: 'clear', keepEnvironment: true }], broad).ok).toBe(true);
    });
});
describe('memory is plain data', () => {
    it('round-trips through JSON', () => {
        const w = loadFixture('camp');
        const r = edit(w, 'make the first tent yellow');
        const copy = JSON.parse(JSON.stringify(r.memory));
        expect(copy).toEqual(r.memory);
        expect(EMPTY_MEMORY.targets).toEqual([]);
    });
});
