import { describe, expect, it, vi } from 'vitest';
import { Bone, BoxGeometry, Float32BufferAttribute, Group, LOD, Matrix4, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { makeSync, world } from './helpers';
import { loadRig } from './support/rig-fixture';
import { cloneModel, disposeModelInstance, ModelCache, shareSkeletons } from '../src/geometry/model-loader';

function model() {
  const root = new Group();
  const bone = new Bone();
  root.add(bone);
  root.updateMatrixWorld(true);
  const geometry = new BoxGeometry();
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const material = new MeshBasicMaterial();
  const a = new SkinnedMesh(geometry, material);
  const b = new SkinnedMesh(geometry, material);
  a.bind(new Skeleton([bone]), new Matrix4());
  b.bind(new Skeleton([bone]), new Matrix4().makeTranslation(0.2, 0.3, 0.4));
  root.add(a, b);
  return { root, bone, a, b, dispose: () => { geometry.dispose(); material.dispose(); } };
}

describe('instance-local skeleton palettes', () => {
  it('shares equivalent palettes while preserving each mesh bind transform and posed vertices', () => {
    const m = model();
    m.bone.position.set(1, 2, 3);
    m.root.updateMatrixWorld(true);
    m.a.skeleton.update();
    m.b.skeleton.update();
    const before = [m.a, m.b].map((mesh) => mesh.getVertexPosition(0, new Vector3()).clone());
    const bind = m.b.bindMatrix.clone();
    expect(shareSkeletons(m.root)).toBe(1);
    expect(m.a.skeleton).toBe(m.b.skeleton);
    expect(m.b.bindMatrix.equals(bind)).toBe(true);
    for (let i = 0; i < 2; i++) expect([m.a, m.b][i]!.getVertexPosition(0, new Vector3()).toArray()).toEqual(before[i]!.toArray());
    expect(shareSkeletons(m.root)).toBe(0);
    m.dispose();
  });

  it('does not merge different inverse binds or different joint identities', () => {
    const m = model();
    m.b.skeleton.boneInverses[0]!.makeTranslation(1, 0, 0);
    expect(shareSkeletons(m.root)).toBe(0);
    const other = new Bone();
    m.root.add(other);
    m.b.bind(new Skeleton([other]), new Matrix4());
    expect(shareSkeletons(m.root)).toBe(0);
    m.dispose();
  });

  it('rejects matching root joints when later joints differ', () => {
    const m = model();
    const left = new Bone(), right = new Bone();
    m.bone.add(left, right);
    m.root.updateMatrixWorld(true);
    m.a.bind(new Skeleton([m.bone, left]), new Matrix4());
    m.b.bind(new Skeleton([m.bone, right]), new Matrix4());
    expect(shareSkeletons(m.root)).toBe(0);
    expect(m.a.skeleton).not.toBe(m.b.skeleton);
    m.dispose();
  });

  it('shares only within each cloned actor, never with its source or another actor', () => {
    const m = model();
    const first = clone(m.root);
    const second = clone(m.root);
    expect(shareSkeletons(first)).toBe(1);
    expect(shareSkeletons(second)).toBe(1);
    const skins = (root: Group) => root.children.filter((o): o is SkinnedMesh => (o as SkinnedMesh).isSkinnedMesh === true);
    const a = skins(first as Group), b = skins(second as Group);
    expect(a[0]!.skeleton).not.toBe(b[0]!.skeleton);
    expect(a[0]!.skeleton).not.toBe(m.a.skeleton);
    a[0]!.skeleton.bones[0]!.position.x = 7;
    expect(b[0]!.skeleton.bones[0]!.position.x).toBe(0);
    expect(m.bone.position.x).toBe(0);
    m.dispose();
  });

  it('clones custom-loader skeletons independently without glTF-loader initialization', () => {
    const m = model();
    const first = cloneModel(m.root);
    const second = cloneModel(m.root);
    const skin = first.children.find((o) => (o as SkinnedMesh).isSkinnedMesh) as SkinnedMesh;
    const other = second.children.find((o) => (o as SkinnedMesh).isSkinnedMesh) as SkinnedMesh;
    expect(skin.skeleton).not.toBe(m.a.skeleton);
    expect(skin.skeleton).not.toBe(other.skeleton);
    skin.skeleton.bones[0]!.position.x = 8;
    expect(m.bone.position.x).toBe(0);
    expect(other.skeleton.bones[0]!.position.x).toBe(0);
    disposeModelInstance(first);
    disposeModelInstance(second);
    m.dispose();
  });

  it('releases each owned palette once through LOD wrappers without disposing shared source resources', () => {
    const m = model();
    m.a.skeleton.computeBoneTexture();
    const sourceDispose = vi.spyOn(m.a.skeleton, 'dispose');
    const sourceTextureDispose = vi.spyOn(m.a.skeleton.boneTexture!, 'dispose');
    const geometryDispose = vi.spyOn(m.a.geometry, 'dispose');
    const materialDispose = vi.spyOn(m.a.material as MeshBasicMaterial, 'dispose');
    const first = cloneModel(m.root), second = cloneModel(m.root);
    const lod = new LOD();
    lod.addLevel(first, 0);
    lod.addLevel(second, 20);
    const wrapper = new Group();
    wrapper.add(lod);
    const skeletons = new Set<Skeleton>();
    wrapper.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skeletons.add((o as SkinnedMesh).skeleton); });
    expect(skeletons.size).toBe(2);
    const owned = [...skeletons].map((skeleton) => {
      skeleton.computeBoneTexture();
      return { skeleton, dispose: vi.spyOn(skeleton, 'dispose'), texture: vi.spyOn(skeleton.boneTexture!, 'dispose') };
    });
    disposeModelInstance(m.root);
    disposeModelInstance(wrapper);
    disposeModelInstance(wrapper);
    disposeModelInstance(first);
    for (const item of owned) {
      expect(item.dispose).toHaveBeenCalledOnce();
      expect(item.texture).toHaveBeenCalledOnce();
      expect(item.skeleton.boneTexture).toBeNull();
    }
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(sourceTextureDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    m.a.skeleton.dispose();
    m.dispose();
  });

  it('signals draw-state disposal on static instances without disposing borrowed geometry or materials', () => {
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const source = new Group();
    source.add(new Mesh(geometry, material));
    const instance = cloneModel(source);
    const object = instance.children[0]!;
    const events = vi.spyOn(object, 'dispatchEvent');
    const sourceEvents = vi.spyOn(source.children[0]!, 'dispatchEvent');
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    disposeModelInstance(instance);
    disposeModelInstance(instance);
    expect(events).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'dispose' }));
    expect(sourceEvents).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    geometry.dispose(); material.dispose();
  });

  it('releases mounted model palettes on entity removal while a source is still cached', async () => {
    const m = model();
    const url = '/models/owned.glb';
    const models = new ModelCache({ load: async () => m.root });
    await models.acquire(url);
    const { sync } = makeSync({ models });
    await sync.setWorld(world([{ id: 'actor', shape: { kind: 'model', url } }]));
    await sync.whenIdle();
    const skeletons = new Set<Skeleton>();
    sync.object('actor')!.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skeletons.add((o as SkinnedMesh).skeleton); });
    expect(skeletons.size).toBe(1);
    const skeleton = [...skeletons][0]!;
    skeleton.computeBoneTexture();
    const dispose = vi.spyOn(skeleton.boneTexture!, 'dispose');
    const sourceDispose = vi.spyOn(m.a.geometry, 'dispose');
    await sync.setWorld(world([]));
    expect(dispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(models.size).toBe(1);
    sync.clear();
    expect(dispose).toHaveBeenCalledOnce();
    models.release(url);
  });

  it('character teardown releases its clone-owned palettes', async () => {
    const { rig } = await loadRig('palette-owner', { ownedClone: true });
    const skeletons = new Set<Skeleton>();
    rig.root.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skeletons.add((o as SkinnedMesh).skeleton); });
    expect(skeletons.size).toBeGreaterThan(0);
    const textures = [...skeletons].map((skeleton) => {
      skeleton.computeBoneTexture();
      return vi.spyOn(skeleton.boneTexture!, 'dispose');
    });
    rig.dispose();
    rig.dispose();
    for (const dispose of textures) expect(dispose).toHaveBeenCalledOnce();
  });

  it('leaves uploaded GPU palettes intact', () => {
    const m = model();
    m.b.skeleton.computeBoneTexture();
    const texture = m.b.skeleton.boneTexture;
    expect(shareSkeletons(m.root)).toBe(0);
    expect(m.b.skeleton.boneTexture).toBe(texture);
    m.b.skeleton.dispose();
    m.dispose();
  });
});
