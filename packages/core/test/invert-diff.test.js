import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, deepEqual, diffWorlds, invertPatches, isEmptyDiff, patchesBetween, rng, } from '../src/index';
import { sampleWorld } from './helpers';
function normalize(patches, world) {
    const r = applyPatches(world, patches);
    expect(r.errors).toEqual([]);
    return r.applied;
}
/** Apply → invert → apply inverse must restore the original exactly, with no errors. */
function roundTrip(world, input) {
    const patches = normalize(input, world);
    const after = applyPatches(world, patches).world;
    const inverse = invertPatches(world, patches);
    const back = applyPatches(after, inverse);
    expect(back.errors).toEqual([]);
    expect(deepEqual(back.world, world)).toBe(true);
    // inverse of the inverse re-applies the change
    const redo = applyPatches(back.world, invertPatches(after, inverse));
    expect(redo.errors).toEqual([]);
    expect(deepEqual(redo.world, after)).toBe(true);
}
describe('invertPatches', () => {
    const scenarios = [
        ['add', [{ op: 'add', entity: { id: 'n', parent: 'car', joint: { type: 'fixed', target: 'car' } } }]],
        ['update merge', [{ op: 'update', id: 'car', set: { transform: { position: [9, 9, 9] }, physics: { mass: 5 }, tags: ['x'] } }]],
        ['update shape kind', [{ op: 'update', id: 'car', set: { shape: { kind: 'procedural', generator: 'car', params: { a: 1 } } } }]],
        ['update delete optional', [{ op: 'update', id: 'car', set: { physics: null, description: 'd' } }]],
        ['update state', [{ op: 'update', id: 'coin', set: { state: { value: null, other: { deep: [1, 2] } } } }]],
        ['remove recursive with refs', [{ op: 'remove', id: 'car' }]],
        ['remove non-recursive', [{ op: 'remove', id: 'wheel', recursive: false }]],
        ['remove scatter surface', [{ op: 'remove', id: 'floor' }]],
        ['rename with refs', [{ op: 'rename', id: 'car', newId: 'truck' }]],
        ['rename leaf', [{ op: 'rename', id: 'hub', newId: 'axle' }]],
        ['rules', [{ op: 'addRule', rule: { id: 'r3', when: { on: 'start' }, then: [{ do: 'reset' }] } }, { op: 'updateRule', id: 'pickup', set: { when: { on: 'timer', at: 3 }, once: true } }]],
        ['remove middle rule', [{ op: 'removeRule', id: 'pickup' }]],
        ['environment', [{ op: 'setEnvironment', set: { sky: 'night', fog: { color: '#101010', density: 0.2 }, ground: null } }]],
        ['player', [{ op: 'setPlayer', set: { controls: null, mode: 'orbit', spawn: [1, 2, 3] } }]],
        ['state', [{ op: 'setState', key: 'lives', value: 3 }, { op: 'setState', key: 'score', value: null }]],
        ['hud', [{ op: 'setHud', hud: [] }]],
        ['generators/scripts', [
                { op: 'defineGenerator', generator: { id: 'gen', description: 'a', source: 'return api.build()' } },
                { op: 'defineScript', script: { id: 'scr', description: 'a', source: 'return []' } },
                { op: 'add', entity: { id: 'tower', shape: { kind: 'procedural', generator: 'gen' } } },
            ]],
        ['tests', [{ op: 'addTest', test: { id: 'z', kind: 'noOverlap' } }, { op: 'removeTest', id: 'car-stays' }]],
        ['meta', [{ op: 'setMeta', name: 'Other', seed: 77, description: 'x' }]],
        ['intro', [{ op: 'setMeta', intro: { title: 'Lantern Isles', tagline: 'Light the way home', controls: ['WASD — move'] } }]],
        ['clear', [{ op: 'clear' }]],
        ['clear all', [{ op: 'clear', keepEnvironment: false }]],
        ['reparent swap', [{ op: 'update', id: 'wheel', set: { parent: null, joint: null } }, { op: 'update', id: 'car', set: { parent: 'hub' } }]],
        ['mutual joints between new entities', [
                { op: 'add', entity: { id: 'a1' } },
                { op: 'add', entity: { id: 'b1', joint: { type: 'fixed', target: 'a1' } } },
                { op: 'update', id: 'a1', set: { joint: { type: 'fixed', target: 'b1' } } },
            ]],
    ];
    it.each(scenarios)('%s round-trips', (_name, patches) => {
        roundTrip(sampleWorld(), patches);
    });
    it('round-trips changing and removing an existing title card, and clear removes it', () => {
        const base = applyPatches(sampleWorld(), [{ op: 'setMeta', intro: { title: 'Old', tagline: 't' } }]).world;
        expect(base.intro?.title).toBe('Old');
        expect(base.intro?.controls).toEqual([]);
        roundTrip(base, [{ op: 'setMeta', intro: { title: 'New', objective: 'Win' } }]);
        roundTrip(base, [{ op: 'setMeta', intro: null }]);
        roundTrip(base, [{ op: 'clear' }]);
        expect(applyPatches(base, [{ op: 'clear' }]).world.intro).toBeUndefined();
        expect(applyPatches(base, [{ op: 'setMeta', intro: null }]).world.intro).toBeUndefined();
        expect(diffWorlds(sampleWorld(), base).metaChanged).toBe(true);
    });
    it('rejects an invalid title card', () => {
        const r = applyPatches(sampleWorld(), [{ op: 'setMeta', intro: { title: '', controls: Array(9).fill('x') } }]);
        expect(r.errors.length).toBe(1);
        expect(r.world.intro).toBeUndefined();
    });
    it('returns [] for no-ops and ignores failing patches', () => {
        const w = sampleWorld();
        expect(invertPatches(w, [])).toEqual([]);
        expect(invertPatches(w, [{ op: 'remove', id: 'ghost', recursive: true }])).toEqual([]);
    });
    it('keeps rule order when restoring a removed rule', () => {
        const w = sampleWorld({
            rules: ['a', 'b', 'c', 'd'].map((id) => ({ id, when: { on: 'start' }, then: [{ do: 'reset' }] })),
        });
        roundTrip(w, [{ op: 'removeRule', id: 'b' }]);
        const after = applyPatches(w, [{ op: 'removeRule', id: 'b' }]).world;
        const back = applyPatches(after, invertPatches(w, [{ op: 'removeRule', id: 'b', }])).world;
        expect(back.rules.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    });
    it('fuzz: random patch sequences always invert exactly', () => {
        const r = rng(1234);
        const pick = (xs) => xs[Math.floor(r() * xs.length)];
        let world = sampleWorld();
        let totalApplied = 0;
        const opsSeen = new Set();
        for (let iter = 0; iter < 150; iter++) {
            const ids = Object.keys(world.entities);
            const ruleIds = world.rules.map((x) => x.id);
            const n = 1 + Math.floor(r() * 5);
            const patches = [];
            for (let k = 0; k < n; k++) {
                const id = ids.length > 0 ? pick(ids) : 'none';
                const fresh = `e${iter}-${k}`;
                switch (Math.floor(r() * 12)) {
                    case 0:
                        patches.push({ op: 'add', entity: { id: fresh, parent: r() < 0.5 && ids.length ? pick(ids) : null, tags: [pick(['a', 'b'])] } });
                        break;
                    case 1:
                        patches.push({ op: 'update', id, set: { transform: { position: [r(), r(), r()] } } });
                        break;
                    case 2:
                        patches.push({ op: 'update', id, set: { parent: ids.length ? pick(ids) : null } });
                        break;
                    case 3:
                        patches.push({ op: 'remove', id, recursive: r() < 0.5 });
                        break;
                    case 4:
                        patches.push({ op: 'rename', id, newId: fresh });
                        break;
                    case 5:
                        patches.push({ op: 'update', id, set: { joint: r() < 0.5 ? null : { type: 'fixed', target: ids.length ? pick(ids) : 'world' } } });
                        break;
                    case 6:
                        patches.push({ op: 'addRule', rule: { id: fresh, when: { on: 'click', target: id }, then: [{ do: 'destroy', target: id }] } });
                        break;
                    case 7:
                        if (ruleIds.length)
                            patches.push({ op: 'removeRule', id: pick(ruleIds) });
                        break;
                    case 8:
                        patches.push({ op: 'setState', key: pick(['a', 'b', 'score']), value: r() < 0.3 ? null : Math.floor(r() * 10) });
                        break;
                    case 9:
                        patches.push({ op: 'setPlayer', set: { controls: r() < 0.5 ? null : id } });
                        break;
                    case 10:
                        patches.push({ op: 'update', id, set: { shape: r() < 0.5 ? { kind: 'primitive', primitive: 'sphere' } : { kind: 'none' } } });
                        break;
                    default: patches.push({ op: 'setEnvironment', set: { sky: pick(['day', 'night', 'dawn']) } });
                }
            }
            const before = world;
            const res = applyPatches(before, patches);
            totalApplied += res.applied.length;
            for (const p of res.applied)
                opsSeen.add(p.op);
            const inverse = invertPatches(before, res.applied);
            const back = applyPatches(res.world, inverse);
            expect(back.errors).toEqual([]);
            expect(deepEqual(back.world, before)).toBe(true);
            world = res.world;
        }
        expect(totalApplied).toBeGreaterThan(200);
        expect(opsSeen.size).toBe(9); // every op the generator emits was exercised
    });
});
describe('patchesBetween', () => {
    it('transforms between unrelated worlds', () => {
        const a = sampleWorld();
        const b = createWorld({
            name: 'Other',
            environment: { sky: 'space', ground: null },
            entities: {
                hub: { id: 'hub' }, // survives, re-rooted
                x: { id: 'x', parent: 'hub', joint: { type: 'fixed', target: 'y' } },
                y: { id: 'y', joint: { type: 'fixed', target: 'x' } },
            },
            player: { controls: 'y' },
            rules: [{ id: 'crash', when: { on: 'start' }, then: [{ do: 'reset' }] }],
        });
        const r = applyPatches(a, patchesBetween(a, b));
        expect(r.errors).toEqual([]);
        expect(deepEqual(r.world, b)).toBe(true);
        const back = applyPatches(b, patchesBetween(b, a));
        expect(back.errors).toEqual([]);
        expect(deepEqual(back.world, a)).toBe(true);
        expect(patchesBetween(a, a)).toEqual([]);
    });
});
describe('diffWorlds', () => {
    it('identity fast path', () => {
        const w = sampleWorld();
        expect(isEmptyDiff(diffWorlds(w, w))).toBe(true);
        expect(isEmptyDiff(diffWorlds(w, JSON.parse(JSON.stringify(w))))).toBe(true);
    });
    it('reports entity and section changes', () => {
        const w = sampleWorld();
        const r = applyPatches(w, [
            { op: 'add', entity: { id: 'n' } },
            { op: 'remove', id: 'coin' },
            { op: 'update', id: 'floor', set: { name: 'Ground' } },
            { op: 'setEnvironment', set: { sky: 'night' } },
            { op: 'setPlayer', set: { moveSpeed: 2 } },
            { op: 'removeRule', id: 'crash' },
            { op: 'defineGenerator', generator: { id: 'gen', description: '', source: 'x' } },
            { op: 'setState', key: 'score', value: 1 },
            { op: 'setMeta', name: 'x' },
        ]);
        const d = diffWorlds(w, r.world);
        expect(d.added).toEqual(['n']);
        expect(d.removed).toEqual(['coin']);
        expect(d.changed).toEqual(['floor']);
        expect(d).toMatchObject({ environmentChanged: true, playerChanged: true, rulesChanged: true, generatorsChanged: ['gen'], stateChanged: true, metaChanged: true, hudChanged: false, testsChanged: false });
        expect(d.scriptsChanged).toEqual([]);
    });
    it('treats deep-equal but distinct entities as unchanged', () => {
        const w = sampleWorld();
        const clone = { ...w, entities: { ...w.entities, car: JSON.parse(JSON.stringify(w.entities['car'])) } };
        expect(diffWorlds(w, clone).changed).toEqual([]);
    });
    it('is fast on 5000 shared entities', () => {
        const big = applyPatches(createWorld(), Array.from({ length: 5000 }, (_, i) => ({ op: 'add', entity: { id: `e${i}` } }))).world;
        const next = applyPatches(big, [{ op: 'update', id: 'e10', set: { name: 'x' } }]).world;
        const t0 = performance.now();
        for (let i = 0; i < 20; i++)
            diffWorlds(big, next);
        expect((performance.now() - t0) / 20).toBeLessThan(10);
        expect(diffWorlds(big, next).changed).toEqual(['e10']);
    });
});
