import { afterEach, describe, expect, it } from 'vitest';
import type { Entity, EntityInput } from '@aether/core';
import type { ColliderDesc } from '@aether/procgen';
import { generateBuiltinSync } from '@aether/procgen';
import { PhysicsWorld } from '../src/index';
import { resolveShapeColliders, MAX_COLLIDERS_PER_SHAPE } from '../src/source';
import { world } from './helpers';

const live: PhysicsWorld[] = [];
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});
async function make(entities: EntityInput[], provider?: (e: Entity) => ColliderDesc[] | undefined): Promise<PhysicsWorld> {
  const pw = await PhysicsWorld.create(world(entities, { environment: { ground: null } }), provider ? { colliders: provider } : {});
  live.push(pw);
  return pw;
}
function kinds(pw: PhysicsWorld, id: string): number[] {
  return pw._records().get(id)?.colliders.map((c) => c.shapeType()) ?? [];
}

const crate = generateBuiltinSync('crate', {}, 1);

describe('explicit collider kinds', () => {
  const proc = (id: string, collider: string, x: number): EntityInput => ({
    id,
    shape: { kind: 'procedural', generator: 'crate' },
    transform: { position: [x, 0, 0] },
    physics: { body: 'static', collider: collider as 'box' },
  });

  it('derives box/sphere/capsule/cylinder/hull/trimesh from the shape', async () => {
    const pw = await make([
      proc('as-box', 'box', 0),
      proc('as-sphere', 'sphere', 10),
      { id: 'as-capsule', shape: { kind: 'primitive', primitive: 'box', size: [0.5, 2, 0.5] }, physics: { body: 'static', collider: 'capsule' }, transform: { position: [20, 0, 0] } },
      proc('squat-capsule', 'capsule', 25),
      proc('as-cylinder', 'cylinder', 30),
      proc('as-hull', 'hull', 40),
      proc('as-trimesh', 'trimesh', 50),
      proc('as-auto', 'auto', 60),
      { id: 'no-collider', shape: { kind: 'primitive', primitive: 'box' }, physics: { body: 'dynamic', collider: 'none', mass: 3 }, transform: { position: [70, 0, 0] } },
      { id: 'prim-hull', shape: { kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] }, physics: { body: 'static', collider: 'hull' }, transform: { position: [80, 0, 0] } },
    ]);
    const R = (await import('@dimforge/rapier3d-compat')).default;
    expect(kinds(pw, 'as-box')).toEqual([R.ShapeType.Cuboid]);
    expect(kinds(pw, 'as-sphere')).toEqual([R.ShapeType.Ball]);
    expect(kinds(pw, 'as-capsule')).toEqual([R.ShapeType.Capsule]);
    expect(kinds(pw, 'squat-capsule')).toEqual([R.ShapeType.Ball]); // no height left after the caps
    expect(kinds(pw, 'as-cylinder')).toEqual([R.ShapeType.Cylinder]);
    expect(kinds(pw, 'as-hull')).toEqual([R.ShapeType.ConvexPolyhedron]);
    expect(kinds(pw, 'as-trimesh')).toEqual([R.ShapeType.TriMesh]);
    expect(kinds(pw, 'as-auto').length).toBe(crate.colliders.length);
    expect(kinds(pw, 'no-collider')).toEqual([]);
    expect(kinds(pw, 'prim-hull')).toEqual([R.ShapeType.ConvexPolyhedron]);
    pw.stepFixed();
    expect(pw._records().get('no-collider')?.body.mass()).toBeCloseTo(3, 4);
    // The bounds box spans the generated crate: its top matches the generator bounds.
    const top = pw.raycast([0, 50, 0], [0, -1, 0], 100);
    expect(top?.id).toBe('as-box');
    expect(top?.point[1]).toBeCloseTo(crate.bounds.max[1], 3);
  });

  it('uses heightfields only when the shape has one', async () => {
    const pw = await make([
      { id: 'hills', shape: { kind: 'procedural', generator: 'terrain' }, physics: { body: 'static', collider: 'heightfield' } },
      { id: 'boxy', shape: { kind: 'primitive', primitive: 'box' }, physics: { body: 'static', collider: 'heightfield' }, transform: { position: [500, 0, 0] } },
    ]);
    const R = (await import('@dimforge/rapier3d-compat')).default;
    expect(kinds(pw, 'hills')).toEqual([R.ShapeType.HeightField]);
    expect(kinds(pw, 'boxy')).toEqual([R.ShapeType.Cuboid]);
    expect(pw.notes().some((n) => n.startsWith('boxy: shape has no heightfield'))).toBe(true);
  });
});

// Regression: a kart racing over a canyon floor (a flat heightfield) caught the seams between
// its triangles and was kicked metres into the air, then rolled over in the next hairpin.
describe('heightfield internal edges', () => {
  it('lets a fast box slide across a flat heightfield without being kicked upward', async () => {
    const pw = await make([
      { id: 'canyon', shape: { kind: 'procedural', generator: 'terrain', params: { variant: 3, size: 400, height: 40, resolution: 128 } }, physics: { body: 'static', friction: 0.9 } },
      { id: 'sled', shape: { kind: 'primitive', primitive: 'box', size: [1.6, 1, 2.4] }, transform: { position: [0, 0.5, 150] }, physics: { body: 'dynamic', mass: 160, friction: 0.05, initialVelocity: [0, 0, -26] } },
    ]);
    let maxY = 0;
    for (let i = 0; i < 360; i++) {
      pw.stepFixed();
      maxY = Math.max(maxY, pw.getState('sled')?.position[1] ?? 0);
    }
    // Rests at its half height (0.5 m); no hops.
    expect(maxY).toBeLessThan(0.62);
    expect(pw.getState('sled')?.position[2]).toBeLessThan(120);
  });
});

describe('collider providers and fallbacks', () => {
  it('prefers provider colliders and survives malformed / throwing / huge providers', async () => {
    const provider = (e: Entity): ColliderDesc[] | undefined => {
      if (e.id === 'custom') return [{ kind: 'sphere', radius: 0.5, offset: [0, 0.5, 0] }, { kind: 'box', halfExtents: [Number.NaN, 1, 1], offset: [0, 0, 0] }];
      if (e.id === 'thrower') throw new Error('kaput');
      if (e.id === 'flood') return Array.from({ length: MAX_COLLIDERS_PER_SHAPE + 10 }, (_, i) => ({ kind: 'sphere', radius: 0.1, offset: [i * 0.01, 0, 0] }) as ColliderDesc);
      return undefined;
    };
    const pw = await make([
      { id: 'custom', shape: { kind: 'procedural', generator: 'crate' }, physics: { body: 'static' } },
      { id: 'thrower', shape: { kind: 'procedural', generator: 'crate' }, physics: { body: 'static' }, transform: { position: [10, 0, 0] } },
      { id: 'flood', shape: { kind: 'procedural', generator: 'crate' }, physics: { body: 'static' }, transform: { position: [20, 0, 0] } },
      { id: 'statue', shape: { kind: 'model', url: '/models/a.glb', fitSize: 2 }, physics: { body: 'static' }, transform: { position: [30, 0, 0] } },
    ], provider);
    expect(kinds(pw, 'custom')).toHaveLength(1);
    expect(kinds(pw, 'thrower').length).toBe(crate.colliders.length);
    expect(kinds(pw, 'flood')).toHaveLength(MAX_COLLIDERS_PER_SHAPE);
    const notes = pw.notes();
    expect(notes.some((n) => n.includes('custom: ignored 1 malformed'))).toBe(true);
    expect(notes.some((n) => n.includes('thrower: collider provider failed (kaput)'))).toBe(true);
    expect(notes.some((n) => n.includes('statue: model colliders unknown'))).toBe(true);
    expect(pw.raycast([30, 10, 0], [0, -1, 0], 20)?.point[1]).toBeCloseTo(2, 4);
  });

  it('uses a placeholder for custom generators without a provider', () => {
    const doc = world([{ id: 'thing', shape: { kind: 'procedural', generator: 'my-gen' }, physics: { body: 'static' } }], {
      generators: { 'my-gen': { id: 'my-gen', description: 'x', source: 'return api.build();' } },
    });
    const r = resolveShapeColliders(doc.entities.thing as Entity, 'auto', doc);
    expect(r.colliders).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/no colliders for generator "my-gen"/);
  });
});

describe('collider output cache budget', () => {
  it('stays within its entry and byte caps across many distinct generator calls', async () => {
    const { builtinOutput, clearColliderCache, colliderCacheStats, MAX_COLLIDER_CACHE_BYTES } = await import('../src/source');
    clearColliderCache();
    for (let seed = 1; seed <= 90; seed++) builtinOutput({ kind: 'procedural', generator: 'terrain', params: {}, seed });
    const stats = colliderCacheStats();
    expect(stats.entries).toBeLessThanOrEqual(64);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.bytes).toBeLessThanOrEqual(MAX_COLLIDER_CACHE_BYTES);
    clearColliderCache();
    expect(colliderCacheStats()).toEqual({ entries: 0, bytes: 0 });
  });
});

describe('collider views of huge outputs', () => {
  it('caches a light point sample for meshes above the trimesh limit and keeps small meshes intact', async () => {
    const { colliderView } = await import('../src/source');
    const big = generateBuiltinSync('colossus', { detail: 3 }, 1);
    const view = colliderView(big);
    expect(view.colliders).toEqual(big.colliders);
    expect(view.bounds).toEqual(big.bounds);
    expect(view.parts).toHaveLength(1);
    expect(view.parts[0]!.indices.length).toBe(0);
    expect(view.parts[0]!.positions.length / 3).toBeLessThanOrEqual(16_384 + 1);
    const small = generateBuiltinSync('rock', {}, 1);
    expect(colliderView(small)).toBe(small);
    // Hull colliders still work from the sample.
    const e = { id: 'c', shape: { kind: 'procedural', generator: 'colossus', params: { detail: 3 } }, physics: { body: 'static', collider: 'hull' } } as unknown as Entity;
    const r = resolveShapeColliders(e, 'hull', null);
    expect(r.colliders.length).toBeGreaterThan(0);
  });
});
