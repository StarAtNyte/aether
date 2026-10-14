/**
 * Physics of library / imported assets: colliders come from the catalog
 * (box, capsule, hull), fall back through the shape's fallback chain, and
 * asset bodies behave physically (a dynamic crate falls and rests).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Entity, EntityInput, Vec3 } from '@aether/core';
import { registerUserAsset, setCatalog, unregisterUserAsset, type CatalogInput } from '@aether/assets';
import { PhysicsWorld } from '../src/index';
import { assetColliderDescs, assetGeneratorShape, usesAssets } from '../src/asset-colliders';
import { resolveShapeColliders } from '../src/source';
import { world } from './helpers';

const CATALOG: CatalogInput = {
  version: 1,
  base: '/assets/lib/',
  packs: [{ id: 'p', title: 'P', author: 'A', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://example.org', version: '1' }],
  entries: [
    { id: 'crate', name: 'Crate', kind: 'model', category: 'props', tags: [], style: 'low-poly', pack: 'p', size: [1, 0.8, 0.6], tris: 12, bytes: 1, file: 'm/crate.00000000.glb', lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'man', name: 'Man', kind: 'model', category: 'characters', tags: [], style: 'stylised', pack: 'p', size: [2, 1.8, 0.5], tris: 12, bytes: 1, file: 'm/man.00000000.glb', lods: [], collider: { type: 'capsule' }, placement: 'floor', facing: '-z', source: 'x' },
    { id: 'rock', name: 'Rock', kind: 'model', category: 'rocks', tags: [], style: 'low-poly', pack: 'p', size: [2, 1, 2], tris: 12, bytes: 1, file: 'm/rock.00000000.glb', lods: [], collider: { type: 'hull', points: [-100, 0, -100, 100, 0, -100, 100, 0, 100, -100, 0, 100, 0, 100, 0] }, placement: 'floor', facing: '+z', source: 'x' },
    { id: 'hero', name: 'Hero', kind: 'generator', category: 'props', tags: [], style: 'stylised', pack: 'p', size: [1, 1, 1], tris: 0, bytes: 0, lods: [], collider: { type: 'box' }, placement: 'floor', facing: '+z', generator: { id: 'crate', params: { size: 2 } }, source: 'x' },
  ],
};

const live: PhysicsWorld[] = [];
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});
beforeAll(() => {
  setCatalog(CATALOG);
});

const asset = (id: string, extra: Partial<EntityInput> = {}): EntityInput => ({ id: `e-${id}`, shape: { kind: 'asset', id }, physics: { body: 'static' }, ...extra });

describe('asset colliders', () => {
  it('derives a box standing on y = 0 from the catalog size (fitSize scales it)', () => {
    const [box] = assetColliderDescs({ id: 'crate' })!;
    expect(box).toEqual({ kind: 'box', halfExtents: [0.5, 0.4, 0.3], offset: [0, 0.4, 0] });
    const [scaled] = assetColliderDescs({ id: 'crate', fitSize: 2 })!;
    expect(scaled).toMatchObject({ kind: 'box', halfExtents: [1, 0.8, 0.6] });
  });

  it('gives characters an upright capsule narrower than their bind-pose box', () => {
    const [cap] = assetColliderDescs({ id: 'man' })!;
    expect(cap?.kind).toBe('capsule');
    if (cap?.kind !== 'capsule') return;
    expect(cap.radius).toBeLessThanOrEqual(0.25);
    expect(cap.halfHeight + cap.radius).toBeCloseTo(0.9, 5);
    expect(cap.offset).toEqual([0, 0.9, 0]);
  });

  it('turns hull support points (cm) into metres', () => {
    const [hull] = assetColliderDescs({ id: 'rock' })!;
    expect(hull?.kind).toBe('hull');
    if (hull?.kind === 'hull') expect([...hull.points.slice(0, 3)]).toEqual([-1, 0, -1]);
  });

  it('unknown / generator / sky assets have no catalog colliders', () => {
    expect(assetColliderDescs({ id: 'missing' })).toBeNull();
    expect(assetColliderDescs({ id: 'hero' })).toBeNull();
    expect(assetGeneratorShape({ id: 'hero' })).toEqual({ kind: 'procedural', generator: 'crate', params: { size: 2 } });
    expect(assetGeneratorShape({ id: 'crate' })).toBeNull();
  });

  it('fallback chain: generator asset → shape fallback → sized placeholder', () => {
    const resolve = (e: EntityInput) => resolveShapeColliders(world([e]).entities[e.id] as Entity, 'auto', null);
    const hero = resolve(asset('hero'));
    expect(hero.colliders.length).toBeGreaterThan(0);
    expect(hero.warnings).toEqual([]);
    const fb = resolve({ id: 'x', shape: { kind: 'asset', id: 'missing', fallback: { kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] } } });
    expect(fb.colliders[0]?.shape.kind).toBe('ball');
    const none = resolve({ id: 'y', shape: { kind: 'asset', id: 'missing', fitSize: 3 } });
    expect(none.colliders[0]?.shape.kind).toBe('box');
    expect(none.warnings.join(' ')).toContain('unknown');
  });

  it('a renderer-provided collider (user imports) wins', () => {
    registerUserAsset({ meta: { id: 'user-0123456789ab', kind: 'model', name: 'U', mime: 'model/gltf-binary', bytes: 1, size: [4, 1, 4], createdAt: 1 }, url: 'blob:x' });
    expect(assetColliderDescs({ id: 'user-0123456789ab' })![0]).toMatchObject({ kind: 'box', halfExtents: [2, 0.5, 2] });
    unregisterUserAsset('user-0123456789ab');
    expect(assetColliderDescs({ id: 'user-0123456789ab' })).toBeNull();
  });

  it('detects worlds that use assets', () => {
    expect(usesAssets(world([asset('crate')]))).toBe(true);
    expect(usesAssets(world([{ id: 'b', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } }]))).toBe(false);
  });

  it('a dynamic asset falls onto the ground and rests on its base', async () => {
    const pw = await PhysicsWorld.create(world([asset('crate', { transform: { position: [0, 3, 0] }, physics: { body: 'dynamic' } })]));
    live.push(pw);
    for (let i = 0; i < 240; i++) pw.step(1 / 60);
    const pos: Vec3 = [0, 0, 0];
    expect(pw.readPose('e-crate', pos, [0, 0, 0, 1])).toBe(true);
    // The entity origin is the base of the model: resting on the ground means y ≈ 0.
    expect(Math.abs(pos[1])).toBeLessThan(0.05);
  });
});
