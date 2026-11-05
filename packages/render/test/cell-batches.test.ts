import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, DoubleSide, PlaneGeometry } from 'three';
import { ancestorCell, assignCell, cellAt, cellBounds, CellIndex, cellKey, cellSizeFor, levelFor, partitionFor, PERSISTENT_CELL } from '../src/streaming/cell-grid';
import { buildShadowGeometry, CellShadowBatches, installShadowSkip, memberAt, plainCasterMaterial, REBUILD_QUIET_MS, SHADOW_BATCH_LAYER, shadowSkipTest, type ShadowCandidate } from '../src/sync/cell-shadow-batches';
import { buildClusterDag } from '../src/virtual/cluster-dag';
import { VirtualGroup } from '../src/virtual/virtual-mesh';
import { batchableViewMaterial, VirtualCellBatches, VIRTUAL_REBUILD_QUIET_MS } from '../src/virtual/virtual-cell-batch';
import { BATCHED_LAYER } from '../src/sync/static-batches';

describe('cell grid', () => {
  it('sizes base cells by world scale', () => {
    expect(cellSizeFor(40)).toBe(16);
    expect(cellSizeFor(124)).toBe(32);
    expect(cellSizeFor(780)).toBe(64);
    expect(cellSizeFor(2000)).toBe(128);
    expect(cellSizeFor(Number.NaN)).toBe(16);
  });

  it('snaps the origin so every level nests, and assigns by centre and size', () => {
    const p = partitionFor([-390, -260], [390, 260]);
    expect(p.cellSize).toBe(64);
    expect(Math.abs(p.origin[0] % 256)).toBe(0);
    // A house (12 m) at level 0, a 300 m terrain part at level 2, a 2 km backdrop in the persistent layer.
    expect(levelFor(p, 12)).toBe(0);
    expect(levelFor(p, 300)).toBe(2);
    expect(assignCell(p, 0, 0, 3000)).toBe(PERSISTENT_CELL);
    const { ix, iz } = cellAt(p, 10, 70);
    expect(assignCell(p, 10, 70, 12)).toBe(cellKey(0, ix, iz));
    const [x0, z0, x1, z1] = cellBounds(p, cellKey(0, ix, iz));
    expect(10).toBeGreaterThanOrEqual(x0); expect(10).toBeLessThan(x1);
    expect(70).toBeGreaterThanOrEqual(z0); expect(70).toBeLessThan(z1);
    // A level-0 cell lies inside its level-1 ancestor.
    const parent = ancestorCell(cellKey(0, ix, iz), 1);
    const [px0, pz0, px1, pz1] = cellBounds(p, parent);
    expect(x0).toBeGreaterThanOrEqual(px0); expect(x1).toBeLessThanOrEqual(px1);
    expect(z0).toBeGreaterThanOrEqual(pz0); expect(z1).toBeLessThanOrEqual(pz1);
    expect(assignCell(p, Number.NaN, 0, 1)).toBe(PERSISTENT_CELL);
  });

  it('re-buckets only the entities that moved', () => {
    const idx = new CellIndex(partitionFor([0, 0], [500, 500]));
    expect(idx.assign('a', 10, 10, 5)).toHaveLength(1);
    expect(idx.assign('b', 12, 12, 5)).toHaveLength(1);
    const cell = idx.cell('a')!;
    expect([...idx.entities(cell)].sort()).toEqual(['a', 'b']);
    // Same cell: nothing to do.
    expect(idx.assign('a', 11, 11, 5)).toEqual([]);
    // Moved across: the cell it left and the one it joined.
    const changed = idx.assign('a', 300, 300, 5);
    expect(changed).toHaveLength(2);
    expect(changed[0]).toBe(cell);
    expect([...idx.entities(cell)]).toEqual(['b']);
    expect(idx.remove('b')).toBe(cell);
    expect([...idx.cells()]).toEqual([idx.cell('a')]);
  });
});

/** A static scene of `n` boxes in a row, each owned by entity `e<i>`. */
function boxes(n: number, spacing = 3): { root: Group; meshes: Mesh[]; material: MeshStandardMaterial } {
  const root = new Group();
  const material = new MeshStandardMaterial();
  const meshes: Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const m = new Mesh(new BoxGeometry(1, 1, 1), material);
    m.position.set(i * spacing, 0.5, 0);
    m.castShadow = true;
    root.add(m);
    meshes.push(m);
  }
  root.updateMatrixWorld(true);
  return { root, meshes, material };
}

function clock(): { now: () => number; advance(ms: number): void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('cell shadow batches', () => {
  it('merges positions in world space and maps triangles back to entities', () => {
    const { meshes } = boxes(3);
    const built = buildShadowGeometry(meshes.map((mesh) => ({ mesh, world: mesh.matrixWorld })), new Matrix4());
    // A box: 24 vertices, 12 triangles.
    expect(built.positions.length).toBe(3 * 24 * 3);
    expect(Array.from(built.starts)).toEqual([0, 12, 24, 36]);
    // The second box's vertices are moved by its world matrix (x = 3 ± 0.5).
    const xs = Array.from(built.positions.subarray(24 * 3, 48 * 3)).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(2.5);
    expect(Math.max(...xs)).toBeCloseTo(3.5);
    expect(memberAt(built.starts, 0)).toBe(0);
    expect(memberAt(built.starts, 13)).toBe(1);
    expect(memberAt(built.starts, 35)).toBe(2);
    expect(memberAt(built.starts, 36)).toBe(-1);
  });

  it('accepts plain casters only', () => {
    expect(plainCasterMaterial(new MeshStandardMaterial())).toBe(true);
    expect(plainCasterMaterial(new MeshStandardMaterial({ transparent: true, opacity: 0.5 }))).toBe(true);
    expect(plainCasterMaterial(new MeshStandardMaterial({ alphaTest: 0.5 }))).toBe(false);
    expect(plainCasterMaterial([new MeshStandardMaterial()])).toBe(false);
  });

  it('batches a cell, skips its members in the shadow pass once drawn, and resolves picks to the entity', () => {
    const { root, meshes } = boxes(4);
    const c = clock();
    const batches = new CellShadowBatches(root, { now: c.now });
    const candidates: ShadowCandidate[] = meshes.map((mesh, i) => ({ mesh, id: `e${i}` }));
    batches.rebuild(candidates);
    expect(batches.flush()).toBe(true);
    expect(batches.count).toBe(1);
    const [batch] = [...batches.meshes()];
    expect(batch!.layers.mask).toBe(1 << SHADOW_BATCH_LAYER);
    // Not ready until it drew once: the members still cast by themselves.
    expect(batches.skips(meshes[0]!)).toBe(false);
    batches.takeOver(batch!);
    for (const m of meshes) expect(batches.skips(m)).toBe(true);
    expect(batches.entityAt(batch!, 0)).toBe('e0');
    expect(batches.entityAt(batch!, 12 * 2 + 3)).toBe('e2');
    expect(batches.entityAt(batch!, 12 * 4)).toBe(null);
  });

  it('evicts an edited member at once (degenerate range) and rebuilds its cell after the edit settles', () => {
    const { root, meshes } = boxes(4);
    const c = clock();
    const batches = new CellShadowBatches(root, { now: c.now });
    const candidates: ShadowCandidate[] = meshes.map((mesh, i) => ({ mesh, id: `e${i}` }));
    batches.rebuild(candidates);
    batches.flush();
    const [batch] = [...batches.meshes()];
    batches.takeOver(batch!);
    // Edit: move entity e1.
    meshes[1]!.position.x += 10;
    root.updateMatrixWorld(true);
    expect(batches.update(true)).toBe(true);
    expect(batches.skips(meshes[1]!)).toBe(false);
    expect(batches.skips(meshes[0]!)).toBe(true);
    const index = batch!.geometry.index!;
    const tri = Array.from(index.array.slice(12 * 3, 24 * 3));
    expect(tri.every((v) => v === 0)).toBe(true);
    expect(index.updateRanges).toEqual([{ start: 36, count: 36 }]);
    expect(batches.entityAt(batch!, 13)).toBe(null);
    // Waits for quiet, then rebuilds the cell with e1 at its new place.
    expect(batches.pending).toBe(1);
    expect(batches.pump(8)).toBe(false);
    c.advance(REBUILD_QUIET_MS + 1);
    batches.rebuild(candidates);
    expect(batches.pump(8)).toBe(true);
    const [next] = [...batches.meshes()];
    expect(next).not.toBe(batch);
    expect(batch!.parent).toBe(null);
    batches.takeOver(next!);
    expect(batches.skips(meshes[1]!)).toBe(true);
    const box = next!.geometry.boundingBox!;
    expect(box.max.x).toBeCloseTo(13.5);
  });

  it('keeps a selected entity out while selected and takes it back after', () => {
    const { root, meshes } = boxes(3);
    const c = clock();
    const batches = new CellShadowBatches(root, { now: c.now });
    const candidates: ShadowCandidate[] = meshes.map((mesh, i) => ({ mesh, id: `e${i}` }));
    batches.rebuild(candidates);
    batches.flush();
    batches.takeOver([...batches.meshes()][0]!);
    batches.pin(['e2']);
    expect(batches.skips(meshes[2]!)).toBe(false);
    c.advance(REBUILD_QUIET_MS + 1);
    batches.rebuild(candidates);
    batches.flush();
    let [b] = [...batches.meshes()];
    batches.takeOver(b!);
    expect(batches.skips(meshes[2]!)).toBe(false);
    expect(batches.skips(meshes[0]!)).toBe(true);
    batches.pin([]);
    expect(batches.rescanNeeded).toBe(true);
    batches.rebuild(candidates);
    c.advance(REBUILD_QUIET_MS + 1);
    batches.flush();
    [b] = [...batches.meshes()];
    batches.takeOver(b!);
    expect(batches.skips(meshes[2]!)).toBe(true);
  });

  it('evicts a member that is hidden or removed', () => {
    const { root, meshes } = boxes(3);
    const batches = new CellShadowBatches(root);
    batches.rebuild(meshes.map((mesh, i) => ({ mesh, id: `e${i}` })));
    batches.flush();
    batches.takeOver([...batches.meshes()][0]!);
    meshes[0]!.visible = false;
    meshes[1]!.removeFromParent();
    expect(batches.update(true)).toBe(true);
    expect(batches.skips(meshes[0]!)).toBe(false);
    expect(batches.skips(meshes[1]!)).toBe(false);
    expect(batches.skips(meshes[2]!)).toBe(true);
  });

  it('groups by shadow side and cell', () => {
    const { root, meshes } = boxes(4);
    const twoSided = new MeshStandardMaterial({ side: DoubleSide });
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(new PlaneGeometry(1, 1), twoSided);
      m.castShadow = true;
      m.position.set(i, 0, 2);
      root.add(m);
      meshes.push(m);
    }
    // Far away: another cell.
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), meshes[0]!.material as MeshStandardMaterial);
      m.castShadow = true;
      m.position.set(900 + i, 0, 900);
      root.add(m);
      meshes.push(m);
    }
    root.updateMatrixWorld(true);
    const batches = new CellShadowBatches(root);
    batches.rebuild(meshes.map((mesh, i) => ({ mesh, id: `e${i}` })));
    batches.flush();
    expect(batches.count).toBe(3);
    expect(batches.saved).toBe(8 - 3);
  });

  it('skips members only in passes whose camera sees the batch layer', () => {
    const { root, meshes } = boxes(2);
    const batches = new CellShadowBatches(root);
    batches.rebuild(meshes.map((mesh, i) => ({ mesh, id: `e${i}` })));
    batches.flush();
    batches.takeOver([...batches.meshes()][0]!);
    const drawn: unknown[] = [];
    const renderer = { fn: null as null | ((...a: unknown[]) => void), setRenderObjectFunction(f: null | ((...a: unknown[]) => void)) { this.fn = f; } };
    installShadowSkip(renderer, shadowSkipTest(() => batches));
    const pass = (o: unknown): void => { drawn.push(o); };
    renderer.setRenderObjectFunction(pass);
    const sun = new PerspectiveCamera();
    sun.layers.enable(SHADOW_BATCH_LAYER);
    const other = new PerspectiveCamera();
    renderer.fn!(meshes[0], null, sun);
    renderer.fn!(meshes[0], null, other);
    expect(drawn).toEqual([meshes[0]]);
    // Restoring the wrapped function (three's ShadowNode does) does not wrap it again.
    const wrapped = renderer.fn;
    renderer.setRenderObjectFunction(wrapped);
    expect(renderer.fn).toBe(wrapped);
  });
});

/** A smooth grid patch (shared vertices) and its DAG. */
function patch(n = 120): { geometry: BufferGeometry; positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  const idx: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.set([i / n - 0.5, Math.sin(i * 0.3) * 0.02, j / n - 0.5], (j * (n + 1) + i) * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
  const indices = Uint32Array.from(idx);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, positions, indices };
}

describe('virtual cell batches', () => {
  function scene(n: number) {
    const root = new Group();
    const material = new MeshStandardMaterial();
    const p = patch();
    const dag = buildClusterDag(p.positions, p.indices);
    const group = new VirtualGroup(dag, p.geometry, 200_000);
    const members = [];
    for (let i = 0; i < n; i++) {
      const content = new Group();
      content.position.set(i * 2, 0, 0);
      root.add(content);
      const source = new Mesh(p.geometry, material);
      source.layers.set(BATCHED_LAYER);
      source.castShadow = true;
      content.add(source);
      const mesh = group.add(source);
      content.add(mesh);
      members.push({ mesh, source, dag, id: `v${i}` });
    }
    root.updateMatrixWorld(true);
    const c = clock();
    const batches = new VirtualCellBatches(root, { setBatched: (m, on) => group.setBatched(m, on), hiddenLayer: BATCHED_LAYER, now: c.now });
    const camera = new PerspectiveCamera(50, 1.6, 0.1, 1000);
    camera.position.set(2, 3, 6);
    camera.lookAt(2, 0, 0);
    camera.updateMatrixWorld();
    return { root, members, group, batches, camera, clock: c, material };
  }

  it('accepts materials without node slots only', () => {
    const m = new MeshStandardMaterial();
    expect(batchableViewMaterial(m)).toBe(true);
    (m as unknown as { colorNode: unknown }).colorNode = {};
    expect(batchableViewMaterial(m)).toBe(false);
  });

  it('draws the members as one mesh, hands them back when one is edited, and maps triangles to entities', () => {
    const { root, members, group, batches, camera, clock: c } = scene(3);
    batches.rebuild(members, () => 'cell');
    expect(batches.flush()).toBe(true);
    expect(batches.count).toBe(1);
    const [mesh] = [...batches.meshes()];
    expect(mesh!.parent).toBe(root);
    for (const m of members) {
      expect(m.mesh.layers.mask).toBe(1 << BATCHED_LAYER);
      expect(group.isBatched(m.mesh)).toBe(true);
    }
    expect(batches.update(camera, 900, () => false)).toBe(true);
    const range = mesh!.geometry.drawRange;
    expect(range.count).toBeGreaterThan(0);
    // The members' own cuts are empty while batched.
    group.update(camera, 900);
    for (const m of members) expect(m.mesh.geometry.drawRange.count).toBe(0);
    // Every index points into the merged vertices.
    const index = mesh!.geometry.index!.array as Uint32Array;
    const vertices = mesh!.geometry.getAttribute('position').count;
    for (let i = 0; i < range.count; i++) expect(index[i]!).toBeLessThan(vertices);
    expect(batches.entityAt(mesh!, 0)).toBe('v0');
    expect(batches.entityAt(mesh!, range.count / 3 - 1)).toBe('v2');
    // Edit: move v1. It is evicted and draws its own cut again; the batch packs nothing for it.
    members[1]!.mesh.parent!.position.x += 5;
    root.updateMatrixWorld(true);
    expect(batches.verify()).toBe(true);
    expect(members[1]!.mesh.layers.mask).toBe(1);
    expect(group.isBatched(members[1]!.mesh)).toBe(false);
    batches.update(camera, 900, () => false);
    group.update(camera, 900);
    expect(members[1]!.mesh.geometry.drawRange.count).toBeGreaterThan(0);
    for (let t = 0; t < mesh!.geometry.drawRange.count / 3; t += 97) expect(batches.entityAt(mesh!, t)).not.toBe('v1');
    // The cell is merged again once the edit settled.
    expect(batches.pending).toBe(1);
    c.advance(VIRTUAL_REBUILD_QUIET_MS + 1);
    batches.rebuild(members, () => 'cell');
    expect(batches.pump(8)).toBe(true);
    expect(mesh!.parent).toBe(null);
    expect(group.isBatched(members[1]!.mesh)).toBe(true);
  });

  it('casts only while a caster member is not covered by a shadow batch', () => {
    const { members, batches, camera } = scene(2);
    batches.rebuild(members, () => 'cell');
    batches.flush();
    const [mesh] = [...batches.meshes()];
    batches.update(camera, 900, () => false);
    expect(mesh!.castShadow).toBe(true);
    camera.position.x += 1;
    camera.updateMatrixWorld();
    batches.update(camera, 900, () => true);
    expect(mesh!.castShadow).toBe(false);
  });

  it('keeps a selected entity out of the batch', () => {
    const { members, batches, group } = scene(3);
    batches.rebuild(members, () => 'cell');
    batches.flush();
    batches.pin(['v0']);
    expect(batches.verify()).toBe(true);
    expect(group.isBatched(members[0]!.mesh)).toBe(false);
    expect(members[0]!.mesh.layers.mask).toBe(1);
  });
});
