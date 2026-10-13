import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { buildClusterDag } from '../src/virtual/cluster-dag';
import { VirtualGroup } from '../src/virtual/virtual-mesh';
import { createProcgenGeometrySource } from '../src/geometry/procgen-source';
import { makeSync, world } from './helpers';

/** A smooth sphere geometry (shared vertices) and its DAG. */
function sphere(): { geometry: BufferGeometry; positions: Float32Array; indices: Uint32Array } {
  const w = 96;
  const h = 64;
  const positions = new Float32Array((w + 1) * (h + 1) * 3);
  const idx: number[] = [];
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      const t = (j / h) * Math.PI;
      const p = (i / w) * Math.PI * 2;
      positions.set([Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)], (j * (w + 1) + i) * 3);
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i;
      idx.push(a, a + 1, a + w + 1, a + 1, a + w + 2, a + w + 1);
    }
  }
  const indices = Uint32Array.from(idx);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, positions, indices };
}

function camera(z: number): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 1.6, 0.1, 1000);
  c.position.set(0, 0, z);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

describe('VirtualGroup', () => {
  const s = sphere();
  const dag = buildClusterDag(s.positions, s.indices);

  function setup(capacity = 100_000): { group: VirtualGroup; meshes: Mesh[]; root: Group } {
    const group = new VirtualGroup(dag, s.geometry, capacity);
    const root = new Group();
    const meshes: Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const content = new Group();
      content.position.x = k * 3 - 3;
      root.add(content);
      const source = new Mesh(s.geometry, new MeshStandardMaterial());
      content.add(source);
      const m = group.add(source);
      content.add(m);
      meshes.push(m);
    }
    root.updateMatrixWorld(true);
    return { group, meshes, root };
  }

  it('packs every instance cut into one index buffer with disjoint ranges sharing vertex buffers', () => {
    const { group, meshes } = setup();
    expect(meshes.every((m) => !m.visible)).toBe(true);
    expect(group.update(camera(8), 800)).toBe(true);
    const ranges = meshes.map((m) => m.geometry.drawRange).sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.start).toBeGreaterThanOrEqual(ranges[i - 1]!.start + ranges[i - 1]!.count);
    expect(meshes.every((m) => m.visible && m.geometry.drawRange.count > 0)).toBe(true);
    expect(meshes[0]!.geometry.getAttribute('position')).toBe(meshes[1]!.geometry.getAttribute('position'));
    expect(meshes[0]!.geometry.index).toBe(meshes[2]!.geometry.index);
    expect(group.drawnTriangles).toBeGreaterThan(0);
    expect(group.update(camera(8), 800)).toBe(false);
  });

  it('draws fewer triangles far away and rises its threshold when over budget', () => {
    const near = setup();
    near.group.update(camera(4), 800);
    const far = setup();
    far.group.update(camera(200), 800);
    expect(far.group.drawnTriangles).toBeLessThan(near.group.drawnTriangles);
    const tight = setup(600);
    tight.group.update(camera(4), 800);
    expect(tight.group.thresholdScale).toBeGreaterThan(1);
    expect(tight.group.drawnTriangles).toBeLessThanOrEqual(600);
  });

  it('re-uploads only from the first instance whose cut changed', () => {
    const { group, meshes } = setup();
    group.update(camera(6), 800);
    const firstRange = { ...meshes[0]!.geometry.drawRange };
    // Moving the last instance only changes its own cut.
    meshes[2]!.parent!.position.z += 1.5;
    meshes[2]!.parent!.updateMatrixWorld(true);
    group.update(camera(6), 800);
    expect(meshes[0]!.geometry.drawRange).toEqual(firstRange);
    const idx = meshes[0]!.geometry.index!;
    expect(idx.updateRanges.length).toBe(1);
    expect(idx.updateRanges[0]!.start).toBeGreaterThan(0);
    group.dispose();
    expect(meshes.every((m) => m.parent === null)).toBe(true);
  });
});

describe('SceneSync virtual geometry', () => {
  it('swaps high-poly procedural parts to virtual geometry and keeps picking on the source', async () => {
    const { sync, geometries } = makeSync({ source: createProcgenGeometrySource(), virtual: { triangles: 500_000, dag: { createWorker: null } } });
    const big = { id: 'stone', shape: { kind: 'procedural' as const, generator: 'colossus', params: { detail: 1 } } };
    await sync.setWorld(world([big, { ...big, id: 'stone-2', transform: { position: [10, 0, 0] } }]));
    await sync.whenIdle();
    // The DAG builds a tick later (inline fallback here, a worker in browsers).
    for (let i = 0; i < 50 && sync.virtualStats().instances < 2; i++) await new Promise((r) => setTimeout(r, 20));
    const stats = sync.virtualStats();
    expect(stats.meshes).toBe(1);
    expect(stats.instances).toBe(2);
    expect(sync.viewNeedsUpdate).toBe(true);
    expect(sync.updateView(camera(40), 800)).toBe(true);
    expect(sync.virtualStats().drawnTriangles).toBeGreaterThan(0);
    expect(sync.virtualStats().drawnTriangles).toBeLessThan(stats.sourceTriangles);
    const node = sync.node('stone')!;
    expect(node.virtual).toHaveLength(1);
    expect(node.virtual[0]!.source.layers.mask).not.toBe(1);
    expect(sync.scaleGeometryActive).toBe(true);
    await sync.setWorld(world([]));
    expect(sync.virtualStats().meshes).toBe(0);
    expect(geometries.size).toBe(0);
  });

  it('leaves small parts and the ghost variant alone', async () => {
    const { sync } = makeSync({ source: createProcgenGeometrySource(), virtual: { triangles: 500_000, dag: { createWorker: null } } });
    await sync.setWorld(world([{ id: 'tree', shape: { kind: 'procedural', generator: 'tree-pine', params: {} } }]));
    await new Promise((r) => setTimeout(r, 30));
    expect(sync.virtualStats().instances).toBe(0);
    const ghost = makeSync({ source: createProcgenGeometrySource(), variant: 'ghost' }).sync;
    await ghost.setWorld(world([{ id: 'stone', shape: { kind: 'procedural', generator: 'colossus', params: { detail: 1 } } }]));
    await new Promise((r) => setTimeout(r, 30));
    expect(ghost.virtualStats().instances).toBe(0);
  });
});
