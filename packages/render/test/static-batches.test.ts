import { describe, expect, it, vi } from 'vitest';
import { Frustum, Matrix4, PerspectiveCamera, InstancedMesh, Mesh, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
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
    expect(sync.batchStats()).toEqual({ batches: 1, drawCallsSaved: 9, merges: 0 });
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

  it('does not upload stationary fractional transforms again, including after moves and visibility changes', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(Array.from({ length: 8 }, (_, i) => post(`post-${i}`, i + 0.1, {
      transform: { position: [i + 0.1, 0.7, -0.3], rotation: [0, 0.37, 0], scale: [1.1, 1, 0.9] },
    }))));
    expect(frame(sync)).toBe(true);
    const batch = batchesOf(sync)[0]!;
    let version = batch.instanceMatrix.version;
    for (let i = 0; i < 5; i++) expect(frame(sync)).toBe(false);
    expect(batch.instanceMatrix.version).toBe(version);

    const member = sync.object('post-2')!;
    member.position.x = 4.123456789;
    member.updateMatrix();
    expect(frame(sync)).toBe(true);
    expect(batch.instanceMatrix.array[2 * 16 + 12]).toBe(Math.fround(4.123456789));
    version = batch.instanceMatrix.version;
    expect(frame(sync)).toBe(false);
    expect(batch.instanceMatrix.version).toBe(version);

    member.visible = false;
    expect(frame(sync)).toBe(true);
    expect(frame(sync)).toBe(false);
    member.visible = true;
    expect(frame(sync)).toBe(true);
    version = batch.instanceMatrix.version;
    expect(frame(sync)).toBe(false);
    expect(batch.instanceMatrix.version).toBe(version);
    sync.clear();
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

  it('stops submitting a fully hidden batch and restores moved members without invalid bounds', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(fence(8)));
    frame(sync);
    const batch = batchesOf(sync)[0]!;
    for (let i = 0; i < 8; i++) sync.object(`post-${i}`)!.visible = false;
    expect(frame(sync)).toBe(true);
    expect(batch.visible).toBe(false);
    expect(frame(sync)).toBe(false);
    const object = sync.object('post-3')!;
    object.position.set(400, 2, 0); object.updateMatrix(); object.visible = true;
    expect(frame(sync)).toBe(true);
    expect(batch.visible).toBe(true);
    expect(batch.boundingSphere!.center.toArray().every(Number.isFinite)).toBe(true);
    expect(batch.boundingSphere!.containsPoint(new Vector3(400, 2, 0))).toBe(true);
    expect(frame(sync)).toBe(false);
    sync.clear();
  });

  it('builds finite bounds when some or all members start hidden', async () => {
    for (const allHidden of [false, true]) {
      const { sync } = makeSync();
      await sync.setWorld(world(fence(8)));
      for (let i = 0; i < (allHidden ? 8 : 1); i++) sync.object(`post-${i}`)!.visible = false;
      frame(sync);
      const batch = batchesOf(sync)[0]!;
      expect(batch.visible).toBe(!allHidden);
      expect(batch.boundingSphere!.center.toArray().every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(batch.boundingSphere!.radius)).toBe(true);
      if (allHidden) expect(batch.boundingSphere!.isEmpty()).toBe(true);
      sync.object('post-0')!.visible = true;
      frame(sync);
      expect(batch.visible).toBe(true);
      expect(batch.boundingSphere!.center.toArray().every(Number.isFinite)).toBe(true);
      expect(batch.boundingSphere!.containsPoint(new Vector3(0, .5, 0))).toBe(true);
      sync.clear();
    }
  });

  it('uploads only changed instance spans and preserves pending edits until the renderer consumes them', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(fence(200)));
    frame(sync);
    const attribute = batchesOf(sync)[0]!.instanceMatrix;
    // Initial data covers the whole batch, even if it changes before its first draw.
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 200 * 16 }]);
    const move = (i: number): void => {
      const object = sync.object(`post-${i}`)!;
      object.position.y += 0.25;
      object.updateMatrix();
      expect(frame(sync)).toBe(true);
    };
    move(7);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 200 * 16 }]);
    // Both renderer backends clear the ranges after uploading them.
    attribute.clearUpdateRanges();
    move(7);
    expect(attribute.updateRanges).toEqual([{ start: 7 * 16, count: 16 }]);
    const reused = attribute.updateRanges[0];
    move(9);
    move(3);
    expect(attribute.updateRanges).toEqual([{ start: 3 * 16, count: 7 * 16 }]);
    expect(frame(sync)).toBe(false);
    expect(attribute.updateRanges[0]).toBe(reused);
    attribute.clearUpdateRanges();
    sync.object('post-100')!.visible = false;
    expect(frame(sync)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 100 * 16, count: 16 }]);
    expect(attribute.updateRanges[0]).toBe(reused);
    attribute.clearUpdateRanges();
    sync.object('post-100')!.visible = true;
    expect(frame(sync)).toBe(true);
    expect(attribute.updateRanges).toEqual([{ start: 100 * 16, count: 16 }]);
    sync.clear();
  });

  it('skips bounds unions for contained edits and expands for an escaping scaled member', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(fence(200)));
    frame(sync);
    const batch = batchesOf(sync)[0]!;
    const union = vi.spyOn(batch.boundingSphere!, 'union');
    const object = sync.object('post-7')!;
    object.position.y = 0.6;
    object.updateMatrix();
    frame(sync);
    expect(union).not.toHaveBeenCalled();
    object.position.set(-1000, 2, 0);
    object.scale.set(10, 3, 2);
    object.updateMatrix();
    frame(sync);
    expect(union).toHaveBeenCalledOnce();
    const source = batch.geometry.boundingSphere!;
    const member = memberMesh(sync, 'post-7');
    const sphere = source.clone().applyMatrix4(member.matrixWorld);
    expect(batch.boundingSphere!.center.distanceTo(sphere.center) + sphere.radius).toBeLessThanOrEqual(batch.boundingSphere!.radius + 1e-6);
    union.mockRestore();
    sync.clear();
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

  it('recreates a batch when all members change shadow flags and restores members when groups shrink', async () => {
    const { sync } = makeSync();
    const w = world(fence(8));
    await sync.setWorld(w);
    frame(sync);
    const first = batchesOf(sync)[0]!;
    const changed = patch(w, fence(8).map((e) => ({ op: 'update' as const, id: e.id, set: { castShadow: false, receiveShadow: false } })));
    await sync.setWorld(changed);
    frame(sync);
    const second = batchesOf(sync)[0]!;
    expect(second).not.toBe(first);
    expect(second.castShadow).toBe(false);
    expect(second.receiveShadow).toBe(false);
    await sync.setWorld(patch(changed, [{ op: 'update', id: 'post-0', set: { castShadow: true } }, { op: 'update', id: 'post-1', set: { castShadow: true } }, { op: 'update', id: 'post-2', set: { castShadow: true } }]));
    frame(sync);
    expect(batchesOf(sync)).toHaveLength(0);
    for (let i = 0; i < 8; i++) expect(memberMesh(sync, `post-${i}`).layers.isEnabled(0)).toBe(true);
    sync.clear();
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

  it('spatially partitions a new world regardless of entity order, culling distant regions', async () => {
    const { sync } = makeSync();
    // Interleaved authoring order: each consecutive entity belongs to another district.
    const props = Array.from({ length: 1024 }, (_, i) => post(`post-${i}`, (i % 4) * 1000 + Math.floor(i / 4) * 0.05));
    const w = world(props);
    await sync.setWorld(w);
    frame(sync);
    const batches = batchesOf(sync);
    expect(batches).toHaveLength(4);
    expect(batches.reduce((n, b) => n + b.count, 0)).toBe(1024);
    const camera = new PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(6, 3, 30);
    camera.lookAt(6, 0.5, 0);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(batches.filter((b) => frustum.intersectsObject(b)).reduce((n, b) => n + b.count, 0)).toBe(256);
    // Edits elsewhere retain the spatial leaves and their GPU buffers.
    await sync.setWorld(patch(w, [{ op: 'add', entity: post('unrelated', 9000, { material: { color: '#ff0000' } }) }]));
    frame(sync);
    expect(batchesOf(sync)).toEqual(batches);
    // A member moved outside its old region expands its leaf's bounds immediately.
    const moved = sync.object('post-1')!;
    moved.position.x = 6;
    moved.updateMatrix();
    frame(sync);
    expect(batches.filter((b) => frustum.intersectsObject(b)).reduce((n, b) => n + b.count, 0)).toBe(512);
    sync.clear();
  });

  it('keeps a dense collection together to avoid unnecessary draws', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world(Array.from({ length: 1024 }, (_, i) => post(`post-${i}`, (i % 32) * 0.5))));
    frame(sync);
    expect(batchesOf(sync)).toHaveLength(1);
    sync.clear();
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
