import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three';
import { WATER_KEY } from '../src/materials/material-cache';
import { WATER_SHADER_KEY } from '../src/materials/water';
import { BATCHED_LAYER } from '../src/sync/static-batches';
import { box, makeSync, patch, world } from './helpers';

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(55, 1, 0.1, 100);
  c.position.set(0, 3, 10);
  c.lookAt(0, 0, 0);
  return c;
}

describe('water pass visibility', () => {
  it('rejects offscreen water and follows runtime transforms, ancestor visibility and layers', async () => {
    const { sync } = makeSync();
    const w = world([{ id: 'parent' }, box('pool', [1000, 0, 0], { parent: 'parent', material: { preset: 'water' } })]);
    await sync.setWorld(w);
    const c = camera();
    expect(sync.hasVisibleWater(c)).toBe(false);
    const pool = sync.object('pool')!;
    pool.position.x = 0;
    pool.updateMatrix();
    expect(sync.hasVisibleWater(c)).toBe(true);
    const parent = sync.object('parent')!;
    parent.visible = false;
    expect(sync.hasVisibleWater(c)).toBe(false);
    parent.visible = true;
    const binding = sync.node('pool')!.bindings[0]!;
    binding.mesh.layers.set(3);
    expect(sync.hasVisibleWater(c)).toBe(false);
    c.layers.enable(3);
    expect(sync.hasVisibleWater(c)).toBe(true);
    binding.mesh.layers.set(BATCHED_LAYER);
    expect(sync.hasVisibleWater(c)).toBe(true);
    binding.mesh.layers.set(0);
    // Shader-backed water carries a different marker from the classic fallback.
    const m = binding.mesh.material as import('three').Material;
    delete m.userData[WATER_KEY];
    m.userData[WATER_SHADER_KEY] = {};
    expect(sync.hasVisibleWater(c)).toBe(true);
    m.visible = false;
    expect(sync.hasVisibleWater(c)).toBe(false);
    m.visible = true;
    await sync.setWorld(patch(w, [{ op: 'remove', id: 'pool' }]));
    expect(sync.hasVisibleWater(c)).toBe(false);
    sync.clear();
  });

  it('keeps candidate indices correct when removing and replacing water out of order', async () => {
    const { sync } = makeSync();
    const w = world([box('a', [0, 0, 0], { material: { preset: 'water' } }), box('b', [1000, 0, 0], { material: { preset: 'water' } }), box('c', [2000, 0, 0], { material: { preset: 'water' } })]);
    await sync.setWorld(w);
    const c = camera();
    expect(sync.hasVisibleWater(c)).toBe(true);
    const less = patch(w, [{ op: 'remove', id: 'a' }]);
    await sync.setWorld(less);
    expect(sync.hasVisibleWater(c)).toBe(false);
    const moved = sync.object('c')!;
    moved.position.x = 0;
    moved.updateMatrix();
    expect(sync.hasVisibleWater(c)).toBe(true);
    await sync.setWorld(patch(less, [{ op: 'update', id: 'c', set: { material: { preset: 'stone', color: '#ff0000' } } }]));
    expect(sync.hasVisibleWater(c)).toBe(false);
    sync.clear();
    expect(sync.hasVisibleWater(c)).toBe(false);
  });

  it('uses the current camera projection on both backend coordinate systems', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([box('pool', [0, 0, 0], { material: { preset: 'water' } })]));
    const c = camera();
    for (const coordinateSystem of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) {
      c.coordinateSystem = coordinateSystem;
      c.updateProjectionMatrix();
      expect(sync.hasVisibleWater(c)).toBe(true);
      c.position.x = 1000;
      c.updateMatrix();
      expect(sync.hasVisibleWater(c)).toBe(false);
      c.position.x = 0;
      c.updateMatrix();
    }
    sync.clear();
  });

  it('updates its candidate list when materials change, and honors uncullable water', async () => {
    const { sync } = makeSync();
    const w = world([box('solid')]);
    await sync.setWorld(w);
    const c = camera();
    expect(sync.hasVisibleWater(c)).toBe(false);
    const wet = patch(w, [{ op: 'update', id: 'solid', set: { material: { preset: 'water' } } }]);
    await sync.setWorld(wet);
    expect(sync.hasVisibleWater(c)).toBe(true);
    const node = sync.node('solid')!;
    node.object.position.x = 1000;
    node.object.updateMatrix();
    expect(sync.hasVisibleWater(c)).toBe(false);
    node.bindings[0]!.mesh.frustumCulled = false;
    expect(sync.hasVisibleWater(c)).toBe(true);
    await sync.setWorld(w);
    expect(sync.hasVisibleWater(c)).toBe(false);
    node.object.position.x = 0;
    node.object.updateMatrix();
    expect(sync.setProperty('solid', 'material.preset', 'water')).toBe(true);
    expect(sync.hasVisibleWater(c)).toBe(true);
    sync.clearOverrides();
    expect(sync.hasVisibleWater(c)).toBe(false);
    sync.clear();
  });
});
