import { describe, expect, it } from 'vitest';
import { checkPlayability, deriveStaticColliders, makePlayable, playedOnFoot } from '../src/index';
import type { EntityInput, Vec3 } from '@aether/core';
import { box, world } from './helpers';

/** A box with no physics at all (an imported mesh). */
const bare = (id: string, position: Vec3, size: Vec3, extra: Partial<EntityInput> = {}): EntityInput => ({ id, shape: { kind: 'primitive', primitive: 'box', size }, transform: { position }, ...extra });

const NO_GROUND = { environment: { ground: null } } as const;
const onFoot = { player: { mode: 'thirdPerson' as const, spawn: [0, 1, 0] as [number, number, number] } };

describe('playability', () => {
  it('passes a spawn on solid ground with room to walk', async () => {
    const r = await checkPlayability(world([box('floor', [0, -0.25, 0], [40, 0.5, 40], { body: 'static' })], { ...NO_GROUND, ...onFoot }));
    expect(r.ok).toBe(true);
    expect(r.ground![1]).toBeCloseTo(0, 1);
    expect(r.walkableArea).toBeGreaterThan(400);
    expect(r.issues).toEqual([]);
    expect(r.settled![1]).toBeGreaterThan(-0.2);
  });

  it('fails a spawn with nothing under it, and warns of a spawn closed in', async () => {
    const none = await checkPlayability(world([], { ...NO_GROUND, ...onFoot }));
    expect(none.ok).toBe(false);
    expect(none.issues[0]!.code).toBe('no-ground');
    expect(none.issues[0]!.message).toMatch(/fall forever/);
    // A one-metre ledge: playable, but the floor around the spawn is tiny.
    const ledge = await checkPlayability(world([box('ledge', [0, -0.25, 0], [1.2, 0.5, 1.2], { body: 'static' })], { ...NO_GROUND, ...onFoot }));
    expect(ledge.ok).toBe(true);
    expect(ledge.issues.map((i) => i.code)).toContain('small-area');
  });

  it('makes an imported world without colliders solid, leaving bodies and people alone', async () => {
    const w = world(
      [
        bare('floor', [0, -0.25, 0], [40, 0.5, 40]),
        box('crate', [3, 0.5, 0], [1, 1, 1], { body: 'dynamic' }),
        bare('hidden', [0, 5, 0], [1, 1, 1], { visible: false }),
        { id: 'kid', name: 'Child', character: { body: 'kaho', gender: 'female', age: 'young', scale: 1 }, shape: { kind: 'none' }, transform: { position: [1, 0, 1] } },
      ],
      { ...NO_GROUND, ...onFoot },
    );
    const d = deriveStaticColliders(w);
    expect(d.ids).toEqual(['floor']);
    expect(d.world.entities['floor']!.physics).toMatchObject({ body: 'static', collider: 'auto' });
    expect(w.entities['floor']!.physics).toBeUndefined();
    const r = await makePlayable(w);
    expect(r.derived).toEqual(['floor']);
    expect(r.report.ok).toBe(true);
    expect(r.report.issues[0]!.code).toBe('derived');
    expect(r.world.entities['floor']!.physics?.body).toBe('static');
  });

  it('leaves a world that is already playable, and one that no collider would save, unchanged', async () => {
    const good = world([box('floor', [0, -0.25, 0], [40, 0.5, 40], { body: 'static' })], { ...NO_GROUND, ...onFoot });
    const a = await makePlayable(good);
    expect(a.world).toBe(good);
    expect(a.derived).toEqual([]);
    const far = world([bare('floor', [100, -0.25, 0], [4, 0.5, 4])], { ...NO_GROUND, ...onFoot });
    const b = await makePlayable(far);
    expect(b.report.ok).toBe(false);
    expect(b.world).toBe(far);
    expect(b.derived).toEqual([]);
  });

  it('a sky dome over the spawn is not made solid', async () => {
    // A hollow "dome": a wide slab 60 m over the spawn, and the floor.
    const w = world([bare('floor', [0, -0.25, 0], [40, 0.5, 40]), bare('sky', [0, 60, 0], [400, 1, 400])], { ...NO_GROUND, ...onFoot });
    const r = await makePlayable(w);
    expect(r.report.ok).toBe(true);
    expect(r.derived).toEqual(['floor']);
    expect(r.world.entities['sky']!.physics).toBeUndefined();
  });

  it('knows which worlds are played on foot', () => {
    expect(playedOnFoot(world([], onFoot))).toBe(true);
    expect(playedOnFoot(world([], { player: { mode: 'orbit' } }))).toBe(false);
  });
});
