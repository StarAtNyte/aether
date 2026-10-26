import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { compileBuilding } from '@aether/arch';
import { BATCHED_LAYER } from '../src/sync/static-batches';
import { MAX_MERGE_VERTICES, MIN_MERGE, StaticMerges, mergeGeometries } from '../src/sync/static-merges';
import { createEntityNode } from '../src/sync/entity-node';
import { box, makeSync, tick, world } from './helpers';

function house(): WorldDoc {
  const b = compileBuilding({
    id: 'house',
    levels: [
      { height: 3, rooms: [{ id: 'living', type: 'living', rect: [0, 0, 7, 5] }, { id: 'kitchen', type: 'kitchen', rect: [7, 0, 11, 5] }], doors: [{ between: ['living', 'outside'], main: true }, { between: ['living', 'kitchen'], kind: 'opening', width: 1.6 }], stairs: [{ at: [0.6, 1.2], heading: 'east' }] },
      { height: 2.8, rooms: [{ id: 'landing', type: 'hall', rect: [0, 0, 7, 5] }, { id: 'bed', type: 'bedroom', rect: [7, 0, 11, 5] }], doors: [{ between: ['landing', 'bed'] }] },
    ],
  });
  const r = applyPatches(createWorld(), b.patches);
  expect(r.errors).toEqual([]);
  return r.world;
}

async function setup(): Promise<{ sync: ReturnType<typeof makeSync>['sync']; w: WorldDoc }> {
  const { sync } = makeSync();
  const w = house();
  await sync.setWorld(w);
  await tick(10);
  sync.root.updateMatrixWorld(true);
  sync.updateBatches();
  return { sync, w };
}

function merged(sync: ReturnType<typeof makeSync>['sync']): Mesh[] {
  const out: Mesh[] = [];
  sync.root.traverse((o) => {
    if (o instanceof Mesh && o.name === 'aether:merged') out.push(o);
  });
  return out;
}

describe('StaticMerges (building geometry)', () => {
  it('merges the static parts of a building per storey and material, keeping members pickable', async () => {
    const { sync, w } = await setup();
    const meshes = merged(sync);
    expect(meshes.length).toBeGreaterThan(0);
    expect(sync.batchStats().merges).toBe(meshes.length);
    expect(sync.batchStats().drawCallsSaved).toBeGreaterThan(20);
    // Merged meshes live under the storeys (exploded / solo views move and hide them).
    const levels = new Set(Object.values(w.entities).filter((e) => e.arch?.role === 'level').map((e) => sync.object(e.id)));
    for (const m of meshes) expect(levels.has(m.parent ?? undefined)).toBe(true);
    // Members draw through the merge: moved to the raycast-only layer.
    const wall = Object.values(w.entities).find((e) => e.arch?.role === 'wall')!;
    expect(sync.node(wall.id)!.bindings.some((b) => b.mesh.layers.isEnabled(BATCHED_LAYER))).toBe(true);
    // Doors (behaviours) never merge.
    const leaf = Object.values(w.entities).find((e) => e.arch?.role === 'door')!;
    expect(sync.node(leaf.id)!.bindings.every((b) => !b.mesh.layers.isEnabled(BATCHED_LAYER))).toBe(true);
    // Nothing changed: the next frame is free.
    expect(sync.updateBatches()).toBe(false);
  });

  it('skips matrix arithmetic for unchanged merges and retains merges when their parent moves', async () => {
    const { sync } = await setup();
    const before = merged(sync);
    const invert = vi.spyOn(Matrix4.prototype, 'invert');
    const multiply = vi.spyOn(Matrix4.prototype, 'multiplyMatrices');
    try {
      expect(sync.updateBatches()).toBe(false);
      expect(invert).not.toHaveBeenCalled();
      expect(multiply).not.toHaveBeenCalled();
      // Exploded-storey views move both the parent and its members together.
      const parent = before[0]!.parent!;
      parent.position.y += 7;
      parent.updateMatrix();
      sync.root.updateMatrixWorld(true);
      invert.mockClear();
      multiply.mockClear();
      expect(sync.updateBatches()).toBe(false);
      expect(invert).toHaveBeenCalled();
      expect(merged(sync)).toEqual(before);
      // The newly checked transforms are cached too.
      invert.mockClear();
      multiply.mockClear();
      expect(sync.updateBatches()).toBe(false);
      expect(invert).not.toHaveBeenCalled();
      expect(multiply).not.toHaveBeenCalled();
    } finally {
      invert.mockRestore();
      multiply.mockRestore();
      sync.clear();
    }
  });

  it('evicts a member that moves, is hidden or re-materialised, and re-merges the rest', async () => {
    const { sync, w } = await setup();
    const before = sync.batchStats().drawCallsSaved;
    const furniture = Object.values(w.entities).filter((e) => e.arch?.role === 'furniture');
    const moved = sync.node(furniture[0]!.id)!;
    moved.object.position.x += 1;
    moved.object.updateMatrix();
    const hidden = sync.node(furniture[1]!.id)!;
    hidden.content.visible = false;
    sync.root.updateMatrixWorld(true);
    expect(sync.updateBatches()).toBe(true);
    for (const b of moved.bindings) expect(b.mesh.layers.isEnabled(BATCHED_LAYER)).toBe(false);
    for (const b of hidden.bindings) expect(b.mesh.layers.isEnabled(BATCHED_LAYER)).toBe(false);
    expect(sync.batchStats().drawCallsSaved).toBeLessThan(before);
    expect(sync.batchStats().drawCallsSaved).toBeGreaterThan(0);
  });

  it('pauses while content grows in and disposes merged geometry it releases', async () => {
    const { sync } = await setup();
    const geos = merged(sync).map((m) => m.geometry);
    const spies = geos.map((g) => vi.spyOn(g, 'dispose'));
    sync.setMergesSuspended(true);
    expect(merged(sync)).toHaveLength(0);
    for (const s of spies) expect(s).toHaveBeenCalled();
    sync.root.traverse((o) => {
      if (o instanceof Mesh) expect(o.layers.isEnabled(BATCHED_LAYER)).toBe(false);
    });
    sync.setMergesSuspended(false);
    sync.updateBatches();
    expect(merged(sync).length).toBe(geos.length);
    sync.clear();
    expect(merged(sync)).toHaveLength(0);
  });

  it('leaves non-building content alone', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([box('a', [0, 0.5, 0]), box('b', [2, 0.5, 0]), box('c', [4, 0.5, 0])]));
    sync.updateBatches();
    expect(sync.batchStats().merges).toBe(0);
    expect(MIN_MERGE).toBeGreaterThan(1);
  });
});

describe('large static merge partitions', () => {
  it('retains unchanged buffers and restores a leftover group that becomes too small to merge', () => {
    const vertices = Math.floor(MAX_MERGE_VERTICES / 4) + 1;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
    const normals = new Float32Array(vertices * 3);
    for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setIndex([0, 1, 2]);
    const material = new MeshBasicMaterial();
    const parent = new Group();
    const w = world(Array.from({ length: 9 }, (_, i) => ({ id: `part-${i}`, shape: { kind: 'procedural', generator: 'test-part' } })));
    const nodes = Object.values(w.entities).map((entity, i) => {
      const node = createEntityNode(entity, false);
      node.object.position.x = i;
      node.object.updateMatrix();
      const mesh = new Mesh(geometry, material);
      node.content.add(mesh);
      node.bindings.push({ mesh, partMaterial: {}, hasColors: false, doubleSided: false, materialKey: 'shared', seeThrough: false, ownedMaterial: null });
      node.geometryKeys.push('shared');
      parent.add(node.object);
      return node;
    });
    parent.updateMatrixWorld(true);
    const merges = new StaticMerges();
    expect(merges.rebuild(nodes)).toBe(true);
    expect(merges.count).toBe(3);
    const buffers = parent.children.filter((o): o is Mesh => o.name === 'aether:merged').map((m) => m.geometry);
    const disposals = buffers.map((g) => vi.spyOn(g, 'dispose'));
    expect(merges.rebuild(nodes)).toBe(false);
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();
    expect(merges.rebuild(nodes.slice(0, 8))).toBe(true);
    expect(merges.count).toBe(2);
    expect(disposals[0]).not.toHaveBeenCalled();
    expect(disposals[1]).not.toHaveBeenCalled();
    expect(disposals[2]).toHaveBeenCalledOnce();
    for (let i = 0; i < 6; i++) expect(nodes[i]!.bindings[0]!.mesh.layers.isEnabled(BATCHED_LAYER)).toBe(true);
    for (let i = 6; i < 9; i++) expect(nodes[i]!.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    expect(merges.update()).toBe(false);
    merges.clear();
    geometry.dispose();
    material.dispose();
  });
});

describe('mergeGeometries', () => {
  it('transforms positions and normals into the parent frame and offsets indices', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    const a = new Matrix4().makeTranslation(5, 0, 0);
    const b = new Matrix4().makeRotationY(Math.PI / 2);
    const out = mergeGeometries([
      { geometry: g, rel: Float64Array.from(a.elements) },
      { geometry: g, rel: Float64Array.from(b.elements) },
    ]);
    const p = out.getAttribute('position');
    const n = out.getAttribute('normal');
    expect(p.count).toBe(6);
    expect(p.getX(1)).toBeCloseTo(6);
    // Rotated 90° about Y: +X → −Z, normal +Z → +X.
    expect(p.getZ(4)).toBeCloseTo(-1);
    expect(n.getX(3)).toBeCloseTo(1);
    expect(Array.from(out.index!.array)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
