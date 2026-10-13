import { describe, expect, it } from 'vitest';
import { InstancedMesh, Mesh, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import type { EntityInput } from '@aether/core';
import { BATCHED_LAYER, MIN_BATCH } from '../src/sync/static-batches';
import type { SceneSync } from '../src/sync/scene-sync';
import { makeSync, patch, world } from './helpers';

function post(id: string, x: number, extra: Partial<EntityInput> = {}): EntityInput {
  return { id, transform: { position: [x, 0.5, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [0.3, 1, 0.3] }, material: { color: '#8a6a4a' }, physics: { body: 'static' }, ...extra };
}

function batchesOf(sync: SceneSync): InstancedMesh[] {
  return sync.root.children.filter((c): c is InstancedMesh => (c as InstancedMesh).isInstancedMesh === true && c.name === 'aether:batch');
}

function memberMesh(sync: SceneSync, id: string): Mesh {
  let found: Mesh | null = null;
  sync.object(id)?.traverse((o: Object3D) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh;
  });
  if (!found) throw new Error(`no mesh for ${id}`);
  return found;
}

function frame(sync: SceneSync): boolean {
  sync.root.updateMatrixWorld(true);
  return sync.updateBatches();
}

const fence = (n: number): EntityInput[] => Array.from({ length: n }, (_, i) => post(`post-${i}`, i));

describe('static-prop batches', () => {
  it('instances identical static props into one draw and keeps picking on the members', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([...fence(10), post('odd', 20, { material: { color: '#ff0000' } }), post('crate', 30, { physics: { body: 'dynamic' } })]));
    expect(frame(sync)).toBe(true);
    const batches = batchesOf(sync);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.count).toBe(10);
    expect(sync.batchStats()).toEqual({ batches: 1, drawCallsSaved: 9 });
    expect(memberMesh(sync, 'post-3').layers.isEnabled(BATCHED_LAYER)).toBe(true);
    expect(memberMesh(sync, 'post-3').layers.isEnabled(0)).toBe(false);
    expect(memberMesh(sync, 'odd').layers.isEnabled(0)).toBe(true);
    expect(memberMesh(sync, 'crate').layers.isEnabled(0)).toBe(true);
    // Instance 3 sits where post-3 is.
    const m = batches[0]!.instanceMatrix.array as Float32Array;
    expect([m[3 * 16 + 12], m[3 * 16 + 13], m[3 * 16 + 14]]).toEqual([3, 0.5, 0]);
    // A raycaster with the batched layer enabled still hits the member (picking works).
    const ray = new Raycaster(new Vector3(3, 0.5, 10), new Vector3(0, 0, -1));
    ray.layers.enable(BATCHED_LAYER);
    const hits: Intersection[] = [];
    ray.intersectObject(sync.root, true, hits);
    expect(sync.idOf(hits[0]?.object ?? null)).toBe('post-3');
    // Nothing changed: no instance update.
    expect(frame(sync)).toBe(false);
  });

  it('follows moves (gizmo drags, grow-in) and hides invisible members without regrouping', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(fence(8)));
    frame(sync);
    const batch = batchesOf(sync)[0]!;
    sync.object('post-2')!.position.set(2, 5, 1);
    sync.object('post-2')!.updateMatrix();
    expect(frame(sync)).toBe(true);
    const m = batch.instanceMatrix.array as Float32Array;
    expect([m[2 * 16 + 12], m[2 * 16 + 13], m[2 * 16 + 14]]).toEqual([2, 5, 1]);
    sync.object('post-4')!.visible = false;
    expect(frame(sync)).toBe(true);
    expect(Array.from(m.subarray(4 * 16, 5 * 16)).every((v) => v === 0)).toBe(true);
    expect(batchesOf(sync)[0]).toBe(batch);
  });

  it('a runtime material override takes the member out of its batch', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(fence(8)));
    frame(sync);
    expect(sync.setProperty('post-1', 'material.color', '#00ff00')).toBe(true);
    frame(sync);
    expect(batchesOf(sync)[0]?.count).toBe(7);
    expect(memberMesh(sync, 'post-1').layers.isEnabled(0)).toBe(true);
    sync.clearOverrides();
    frame(sync);
    expect(batchesOf(sync)[0]?.count).toBe(8);
  });

  it('regroups on removal (a removed prop is never drawn) and drops groups below the minimum', async () => {
    const { sync } = makeSync();
    const w1 = world(fence(MIN_BATCH + 1));
    await sync.setWorld(w1);
    frame(sync);
    const w2 = patch(w1, [{ op: 'remove', id: 'post-0' }]);
    await sync.setWorld(w2);
    frame(sync);
    expect(batchesOf(sync)[0]?.count).toBe(MIN_BATCH);
    await sync.setWorld(patch(w2, [{ op: 'remove', id: 'post-1' }]));
    frame(sync);
    expect(batchesOf(sync)).toHaveLength(0);
    expect(memberMesh(sync, 'post-2').layers.isEnabled(0)).toBe(true);
  });

  it('keeps an unchanged batch across unrelated edits (no new instance buffer)', async () => {
    const { sync } = makeSync();
    const w1 = world([...fence(8), post('sign', 50, { material: { color: '#123456' } })]);
    await sync.setWorld(w1);
    frame(sync);
    const before = batchesOf(sync)[0];
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'sign', set: { material: { color: '#654321' } } }]));
    frame(sync);
    expect(batchesOf(sync)[0]).toBe(before);
  });

  it('never batches transparent materials or runtime spawns, and is off for the ghost variant', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(Array.from({ length: 8 }, (_, i) => post(`glass-${i}`, i, { material: { color: '#88ccff', opacity: 0.4 } }))));
    frame(sync);
    expect(batchesOf(sync)).toHaveLength(0);
    const ghost = makeSync({ variant: 'ghost' }).sync;
    await ghost.setWorld(world(fence(8)));
    expect(ghost.updateBatches()).toBe(false);
    expect(batchesOf(ghost)).toHaveLength(0);
    const off = makeSync({ staticBatching: false }).sync;
    await off.setWorld(world(fence(8)));
    off.updateBatches();
    expect(batchesOf(off)).toHaveLength(0);
  });

  it('dispose/clear removes every batch', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(fence(8)));
    frame(sync);
    sync.clear();
    expect(batchesOf(sync)).toHaveLength(0);
    expect(sync.batchStats().batches).toBe(0);
  });
});
