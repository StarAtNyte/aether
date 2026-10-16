import { describe, expect, it } from 'vitest';
import { createWorld, History } from '@aether/core';
import { addedVoxelEdits, findAvatar, focusTarget, framingSphere, isNewWorld, movingIds } from '../src/engine/worldQueries';
import { createStarterWorld } from '../src/lib/starterWorld';
describe('world queries', () => {
    it('finds the avatar by player.controls, playerController, then "player" id', () => {
        expect(findAvatar(createWorld())).toBeNull();
        expect(findAvatar(createWorld({ entities: { hero: { id: 'hero', behaviors: [{ type: 'playerController' }] } } }))).toBe('hero');
        expect(findAvatar(createWorld({ entities: { player: { id: 'player' } } }))).toBe('player');
        expect(findAvatar(createWorld({
            player: { controls: 'car' },
            entities: { car: { id: 'car' }, hero: { id: 'hero', behaviors: [{ type: 'playerController' }] } },
        }))).toBe('car');
        expect(findAvatar(createWorld({ entities: { hero: { id: 'hero', behaviors: [{ type: 'playerController', enabled: false }] } } }))).toBeNull();
        expect(findAvatar(createWorld({ entities: { player: { id: 'player', template: true } } }))).toBeNull();
    });
    it('lists only non-static, non-template bodies', () => {
        const w = createWorld({
            entities: {
                a: { id: 'a', physics: { body: 'dynamic' } },
                b: { id: 'b', physics: { body: 'kinematic' } },
                c: { id: 'c', physics: { body: 'static' } },
                d: { id: 'd', behaviors: [{ type: 'spin' }] },
                e: { id: 'e', physics: { body: 'dynamic' }, template: true },
            },
        });
        expect(movingIds(w)).toEqual(['a', 'b']);
    });
    it('frames the #focus entity of the starter world', () => {
        expect(focusTarget(createStarterWorld())).toBe('camp-clearing');
        expect(focusTarget(createWorld())).toBeNull();
    });
    it('detects rebuilt worlds (for camera re-framing) but not small edits', () => {
        const h = new History(createStarterWorld());
        const start = h.current;
        expect(isNewWorld(start, start)).toBe(false);
        const ids = Object.keys(start.entities);
        h.commit([{ op: 'update', id: ids[0], set: { name: 'Renamed' } }], 'rename', 'user');
        expect(isNewWorld(start, h.current)).toBe(false);
        // Same ids, rebuilt from scratch: new objects → a new world.
        const rebuilt = h.commit([{ op: 'clear', keepEnvironment: true }, ...ids.slice(0, 4).map((id) => ({ op: 'add', entity: { id, name: id } }))], 'rebuild', 'agent');
        expect(rebuilt.errors).toEqual([]);
        expect(Object.keys(h.current.entities).length).toBeGreaterThan(0);
        expect(isNewWorld(start, h.current)).toBe(true);
        expect(isNewWorld(start, createWorld())).toBe(false);
    });
    it('frames the action, ignoring distant backdrop props', () => {
        expect(framingSphere(createWorld())).toBeNull();
        const entities = {};
        for (let i = 0; i < 10; i++)
            entities[`d${i}`] = { id: `d${i}`, transform: { position: [i, 0.5, 0] }, physics: { body: 'dynamic' } };
        for (let i = 0; i < 4; i++)
            entities[`m${i}`] = { id: `m${i}`, transform: { position: [150, 0, i * 40] } };
        const s = framingSphere(createWorld({ entities }));
        expect(s).not.toBeNull();
        expect(s.center[0]).toBeGreaterThanOrEqual(4);
        expect(s.center[0]).toBeLessThanOrEqual(5);
        expect(s.radius).toBeLessThan(10);
        // Static-only scenes use all roots, still dropping the outer 20 %.
        const statics = {};
        for (let i = 0; i < 8; i++)
            statics[`h${i}`] = { id: `h${i}`, transform: { position: [i * 2, 0, 0] } };
        statics['far'] = { id: 'far', transform: { position: [500, 0, 500] } };
        const t = framingSphere(createWorld({ entities: statics }));
        expect(t.radius).toBeLessThanOrEqual(60);
        expect(t.center[0]).toBeLessThan(20);
    });
    it('treats new or regenerated block terrain as a new world, even without entities (regression: camera stayed underground)', () => {
        const start = createStarterWorld();
        const blocks = createWorld({ voxel: { preset: 'survival' } });
        expect(Object.keys(blocks.entities)).toHaveLength(0);
        expect(isNewWorld(start, blocks)).toBe(true);
        expect(isNewWorld(blocks, createWorld({ voxel: { preset: 'desert' } }))).toBe(true);
        expect(isNewWorld(blocks, createWorld({ voxel: { preset: 'survival', seed: 99 } }))).toBe(true);
        // Same terrain with an extra edit: not a new world (the edit is revealed instead).
        const built = createWorld({ voxel: { preset: 'survival', edits: [{ shape: 'box', from: [0, 0, 0], to: [3, 3, 3], block: 'stone', anchor: 'surface' }] } });
        expect(isNewWorld(blocks, built)).toBe(false);
    });
    it('finds the first block edit a turn added', () => {
        const box = { shape: 'box', from: [0, 0, 0], to: [3, 3, 3], block: 'stone' };
        const ball = { shape: 'sphere', center: [9, 70, 9], radius: 3, block: 'glass' };
        const none = createWorld({ voxel: { preset: 'survival' } });
        const one = createWorld({ voxel: { preset: 'survival', edits: [box] } });
        const two = createWorld({ voxel: { preset: 'survival', edits: [box, ball] } });
        expect(addedVoxelEdits(none, one)).toBe(0);
        expect(addedVoxelEdits(one, two)).toBe(1);
        expect(addedVoxelEdits(two, one)).toBeNull();
        expect(addedVoxelEdits(two, two)).toBeNull();
        expect(addedVoxelEdits(createWorld(), one)).toBeNull();
    });
});
