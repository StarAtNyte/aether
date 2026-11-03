import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, LOD, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { compileBuilding } from '@aether/arch';
import { BATCHED_LAYER } from '../src/sync/static-batches';
import { MAX_MERGE_INSTANCES, MAX_MERGE_VERTICES, MIN_MERGE, StaticMerges, mergeGeometries } from '../src/sync/static-merges';
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

describe('small scatter layers', () => {
  function triangle(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  }
  /** A scatter entity of `copies` instances along x (5 m apart, from `offset`). */
  function layer(id: string, copies: number, offset: number, geometry: BufferGeometry, material: MeshBasicMaterial, parent: Group) {
    const w = world([{ id, shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'test-part' }, count: copies, area: [1, 1] } }]);
    const node = createEntityNode(w.entities[id]!, false);
    const matrices = new Float32Array(copies * 16);
    for (let i = 0; i < copies; i++) matrices.set(new Matrix4().makeTranslation(offset + i * 5, 0, 0).elements, i * 16);
    const attr = new InstancedBufferAttribute(matrices, 16);
    const mesh = new InstancedMesh(geometry, material, copies);
    mesh.instanceMatrix = attr;
    node.content.add(mesh);
    node.instanceMatrix = attr;
    node.instances = copies;
    node.bindings.push({ mesh, partMaterial: {}, hasColors: false, doubleSided: false, materialKey: 'shared', seeThrough: false, ownedMaterial: null });
    node.geometryKeys.push('shared');
    parent.add(node.object);
    return node;
  }

  it('merges each copy of a few-copy scatter (a house, a stretch of fence) into the merge, leaving big layers instanced', () => {
    const geometry = triangle();
    const material = new MeshBasicMaterial();
    const parent = new Group();
    const nodes = [layer('house-1', 1, 0, geometry, material, parent), layer('house-2', 1, 20, geometry, material, parent), layer('fence', 2, 10, geometry, material, parent), layer('forest', MAX_MERGE_INSTANCES + 1, 0, geometry, material, parent),
      // In another cell of copies: culled on its own.
      layer('far-house', 1, 300, geometry, material, parent)];
    parent.updateMatrixWorld(true);
    const merges = new StaticMerges();
    expect(merges.rebuild(nodes)).toBe(true);
    expect(merges.count).toBe(1);
    // Three instanced draws became one; the big layer still draws itself.
    expect(merges.drawCallsSaved).toBe(2);
    for (const n of nodes.slice(0, 3)) expect(n.bindings[0]!.mesh.layers.isEnabled(BATCHED_LAYER)).toBe(true);
    expect(nodes[3]!.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    expect(nodes[4]!.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    const m = parent.children.find((o): o is Mesh => o.name === 'aether:merged')!;
    const p = m.geometry.getAttribute('position');
    expect(p.count).toBe(12);
    const xs = new Set<number>();
    for (let i = 0; i < p.count; i += 3) xs.add(Math.round(p.getX(i)));
    // Every copy where its instance matrix puts it.
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 10, 15, 20]);
    expect(merges.update()).toBe(false);
    expect(merges.rebuild(nodes)).toBe(false);
    // Rewritten instance matrices evict the layer: it draws itself again.
    nodes[2]!.instanceMatrix!.needsUpdate = true;
    expect(merges.update()).toBe(true);
    expect(nodes[2]!.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    merges.clear();
    geometry.dispose();
    material.dispose();
  });
});

describe('parts that move only when used', () => {
  it('merge while idle when interactive merging is on, and draw themselves once they move', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geometry.setIndex([0, 1, 2]);
    const material = new MeshBasicMaterial();
    const parent = new Group();
    const part = (id: string, x: number, behavior: string) => {
      const w = world([{ id, shape: { kind: 'procedural', generator: 'furn-part' }, physics: { body: 'kinematic' }, behaviors: [{ type: behavior, params: {} }] } as never]);
      const node = createEntityNode(w.entities[id]!, false);
      node.object.position.x = x;
      node.object.updateMatrix();
      const mesh = new Mesh(geometry, material);
      node.content.add(mesh);
      node.bindings.push({ mesh, partMaterial: {}, hasColors: false, doubleSided: false, materialKey: 'shared', seeThrough: false, ownedMaterial: null });
      node.geometryKeys.push('shared');
      parent.add(node.object);
      return node;
    };
    const drawers = [0, 1, 2, 3].map((x) => part(`drawer-${x}`, x, 'operable'));
    const spinner = part('spinner', 5, 'spin');
    parent.updateMatrixWorld(true);
    const merges = new StaticMerges();
    expect(merges.rebuild([...drawers, spinner])).toBe(false);
    merges.interactive = true;
    expect(merges.rebuild([...drawers, spinner])).toBe(true);
    expect(merges.drawCallsSaved).toBe(3);
    expect(spinner.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    // Opened: the drawer draws itself, the others stay merged.
    drawers[0]!.object.position.z = 0.4;
    drawers[0]!.object.updateMatrix();
    parent.updateMatrixWorld(true);
    expect(merges.update()).toBe(true);
    expect(drawers[0]!.bindings[0]!.mesh.layers.isEnabled(0)).toBe(true);
    expect(drawers[1]!.bindings[0]!.mesh.layers.isEnabled(BATCHED_LAYER)).toBe(true);
    merges.interactive = false;
    expect(merges.rebuild([...drawers, spinner])).toBe(true);
    expect(merges.count).toBe(0);
    merges.clear();
  });
});

describe('static library models', () => {
  it('merges the meshes of static models placed many times; animated, LOD and driven models stay as they are', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geometry.setIndex([0, 1, 2]);
    const tangents = geometry.clone();
    tangents.setAttribute('tangent', new BufferAttribute(new Float32Array(12), 4));
    const material = new MeshBasicMaterial();
    const parent = new Group();
    const lamp = (id: string, x: number, extra: Record<string, unknown> = {}, wrap?: 'lod' | 'tangent') => {
      const w = world([{ id, shape: { kind: 'asset', id: 'street-lamp' }, physics: { body: 'static' }, ...extra } as never]);
      const node = createEntityNode(w.entities[id]!, false);
      node.object.position.x = x;
      const mesh = new Mesh(wrap === 'tangent' ? tangents : geometry, material);
      if (wrap === 'lod') {
        const lod = new LOD();
        lod.addLevel(mesh, 0);
        node.content.add(lod);
      } else node.content.add(mesh);
      parent.add(node.object);
      return { node, mesh };
    };
    const lamps = [0, 10, 20, 30].map((x) => lamp(`lamp-${x}`, x));
    const lod = lamp('lod', 40, {}, 'lod');
    const odd = lamp('tangent', 50, {}, 'tangent');
    const driven = lamp('patrol', 60, { behaviors: [{ type: 'spin', params: {} }] });
    parent.updateMatrixWorld(true);
    const merges = new StaticMerges();
    expect(merges.rebuild([...lamps, lod, odd, driven].map((l) => l.node))).toBe(true);
    expect(merges.count).toBe(1);
    expect(merges.drawCallsSaved).toBe(3);
    for (const l of lamps) expect(l.mesh.layers.isEnabled(BATCHED_LAYER)).toBe(true);
    for (const l of [lod, odd, driven]) expect(l.mesh.layers.isEnabled(0)).toBe(true);
    // A lamp knocked over draws itself again.
    lamps[0]!.node.object.position.y = 1;
    lamps[0]!.node.object.updateMatrix();
    parent.updateMatrixWorld(true);
    expect(merges.update()).toBe(true);
    expect(lamps[0]!.mesh.layers.isEnabled(0)).toBe(true);
    merges.clear();
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
