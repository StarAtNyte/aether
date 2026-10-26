import { describe, expect, it, vi } from 'vitest';
import { BatchedMesh, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { DrawBatches, MAX_DRAW_BATCH_MEMBERS, drawBatchKey } from '../src/sync/draw-batches';
import { drawBatchRevision, hasBatchDrawPreparation, prepareBatchDraws } from '../src/gpu/batch-draws';
import { BATCHED_LAYER } from '../src/sync/static-batches';

function fixture(count = 8) {
  const root = new Group(), parent = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  root.add(parent);
  const meshes = Array.from({ length: count }, (_, i) => { const mesh = new Mesh(geometry, material); mesh.position.x = i % 64; parent.add(mesh); return mesh; });
  root.updateMatrixWorld(true);
  const renderer = { _nodes: { updateForRender(_object: unknown) {}, updateAfter(_object: unknown) {} } };
  expect(prepareBatchDraws(renderer)).toBe(true);
  const batches = new DrawBatches(root);
  const ready = (): void => {
    for (const b of batches.batches) renderer._nodes.updateAfter({ object: b.mesh, material, scene: new Scene(), camera: new PerspectiveCamera(), geometry: b.mesh.geometry, group: null });
    batches.update();
  };
  return { root, parent, geometry, material, meshes, renderer, batches, ready };
}

describe('transform-updatable draw batches', () => {
  it('keeps native originals visible until the new batch finishes a primary draw update', () => {
    const f = fixture(); f.batches.rebuild(f.meshes);
    expect(f.meshes.every(m => m.layers.mask === 1)).toBe(true);
    expect(f.batches.drawCallsSaved).toBe(0);
    const batch = f.batches.batches[0]!;
    f.renderer._nodes.updateAfter({ object: batch.mesh, material: { isShadowPassMaterial: true } });
    f.batches.update(); expect(f.meshes.every(m => m.layers.mask === 1)).toBe(true);
    f.ready(); expect(f.meshes.every(m => m.layers.mask === (1 << BATCHED_LAYER))).toBe(true);
    expect(f.batches.drawCallsSaved).toBe(7); expect(f.batches.update()).toBe(false);
    f.batches.clear(); expect(f.meshes.every(m => m.layers.mask === 1)).toBe(true);
  });

  it('retains unchanged geometry, matrices textures and native histories across a regroup', () => {
    const f = fixture(); f.batches.rebuild(f.meshes); f.ready();
    const batch = f.batches.batches[0]!.mesh, geometry = batch.geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    f.batches.prepareRegroup(); expect(f.meshes.every(m => m.layers.mask === 1)).toBe(true);
    expect(f.batches.rebuild(f.meshes)).toBe(false);
    expect(f.batches.batches[0]!.mesh).toBe(batch); expect(dispose).not.toHaveBeenCalled();
    expect(f.meshes.every(m => m.layers.mask === (1 << BATCHED_LAYER))).toBe(true);
    f.batches.clear(); expect(dispose).toHaveBeenCalledOnce();
  });

  it('lets static batching claim sources during regroup without restoring or double-drawing them', () => {
    const f = fixture(); f.batches.rebuild(f.meshes); f.ready(); f.batches.prepareRegroup();
    for (let i = 0; i < 4; i++) f.meshes[i]!.layers.set(BATCHED_LAYER);
    f.batches.rebuild(f.meshes);
    expect(f.batches.batches[0]!.members.map(m => m.source)).toEqual(f.meshes.slice(4));
    expect(f.meshes.slice(0, 4).every(m => m.layers.mask === (1 << BATCHED_LAYER))).toBe(true);
    expect(f.meshes.slice(4).every(m => m.layers.mask === 1)).toBe(true);
    f.batches.clear(); expect(f.meshes.slice(0, 4).every(m => m.layers.mask === (1 << BATCHED_LAYER))).toBe(true);
  });

  it('updates moving members, expands coarse bounds, and hides/restores full groups', () => {
    const f = fixture(); f.batches.rebuild(f.meshes); f.ready();
    const batch = f.batches.batches[0]!.mesh, matrix = new Matrix4();
    const version = drawBatchRevision(batch);
    f.meshes[2]!.position.set(200, 3, 4); f.root.updateMatrixWorld(true);
    expect(f.batches.update()).toBe(true); batch.getMatrixAt(2, matrix);
    expect(matrix.elements.slice(12, 15)).toEqual([200, 3, 4]); expect(batch.boundingSphere!.containsPoint(f.meshes[2]!.position)).toBe(true);
    expect(drawBatchRevision(batch)).toBeGreaterThan(version!);
    f.parent.visible = false; f.batches.update(); expect(batch.visible).toBe(false);
    f.parent.visible = true; f.batches.update(); expect(batch.visible).toBe(true);
    f.batches.clear();
  });

  it('returns changed geometry to native meshes and releases stale copied buffers', () => {
    const f = fixture(); f.batches.rebuild(f.meshes); f.ready();
    const sourceDispose = vi.spyOn(f.geometry, 'dispose'), materialDispose = vi.spyOn(f.material, 'dispose');
    const batchDispose = vi.spyOn(f.batches.batches[0]!.mesh.geometry, 'dispose');
    f.geometry.attributes.position!.needsUpdate = true;
    expect(f.batches.update()).toBe(true); expect(f.batches.count).toBe(0); expect(f.batches.bytes).toBe(0);
    expect(f.meshes.every(m => m.layers.mask === 1)).toBe(true); expect(batchDispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
    f.batches.clear();
  });

  it('does not flatten instancing, custom hooks, deformation, transparency or custom depth behavior', () => {
    const f = fixture(); const source = f.meshes[0]!;
    expect(drawBatchKey(new InstancedMesh(f.geometry, f.material, 16))).toBeNull();
    const batch = new BatchedMesh(4, 24, 36, f.material); expect(drawBatchKey(batch)).toBeNull(); batch.dispose();
    source.onBeforeRender = () => {}; expect(drawBatchKey(source)).toBeNull(); source.onBeforeRender = Mesh.prototype.onBeforeRender;
    source.customDepthMaterial = f.material; expect(drawBatchKey(source)).toBeNull(); source.customDepthMaterial = undefined;
    f.material.depthWrite = false; expect(drawBatchKey(source)).toBeNull(); f.material.depthWrite = true;
    source.visible = false; expect(drawBatchKey(source)).toBeNull();
  });

  it('keeps undersized partition tails native and respects its memory bound', () => {
    const f = fixture(MAX_DRAW_BATCH_MEMBERS + 2); f.batches.rebuild(f.meshes); f.ready();
    expect(f.batches.count).toBe(1); expect(f.batches.drawCallsSaved).toBe(MAX_DRAW_BATCH_MEMBERS - 1);
    expect(f.meshes.slice(-2).every(m => m.layers.mask === 1)).toBe(true); f.batches.clear();
    const limited = new DrawBatches(f.root, 1); limited.rebuild(f.meshes);
    expect(limited.count).toBe(0); expect(limited.bytes).toBe(0); expect(f.meshes.every(m => m.layers.mask === 1)).toBe(true);
    limited.clear();
  });

  it('guards and idempotently installs camera preparation without affecting unrelated meshes', () => {
    expect(prepareBatchDraws({})).toBe(false);
    const f = fixture(), update = f.renderer._nodes.updateForRender;
    expect(prepareBatchDraws(f.renderer)).toBe(true); expect(f.renderer._nodes.updateForRender).toBe(update);
    expect(hasBatchDrawPreparation(f.renderer)).toBe(true);
    expect(drawBatchRevision(f.meshes[0]!)).toBeUndefined();
    f.batches.rebuild(f.meshes); const mesh = f.batches.batches[0]!.mesh;
    const revision = drawBatchRevision(mesh); expect(revision).toBeTypeOf('number'); f.batches.update(); expect(drawBatchRevision(mesh)).toBe(revision); mesh.onBeforeRender = () => {}; expect(drawBatchRevision(mesh)).toBeUndefined(); f.batches.clear();
  });
});
