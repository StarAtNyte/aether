import { afterEach, describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Frustum, LOD, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Texture } from 'three';
import { color, float } from 'three/tsl';
import { AssetInstances, levelFor, materialSignature } from '../src/sync/asset-instances';
import { BATCHED_LAYER } from '../src/sync/static-batches';
import { createEntityNode, type EntityNode } from '../src/sync/entity-node';
import { world } from './helpers';

function triangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}

/** A library-model entity at `x` whose content is `content`. */
function model(id: string, x: number, content: Mesh | LOD, root: Scene, extra: Record<string, unknown> = {}): EntityNode {
  const w = world([{ id, shape: { kind: 'asset', id: 'street-lamp' }, physics: { body: 'static' }, ...extra } as never]);
  const node = createEntityNode(w.entities[id]!, false);
  node.object.position.x = x;
  node.object.updateMatrix();
  node.content.add(content);
  root.add(node.object);
  return node;
}

function camera(x: number, lookX: number): { camera: PerspectiveCamera; frustum: Frustum } {
  const c = new PerspectiveCamera(60, 1, 0.1, 1000);
  c.position.set(x, 0.5, 5);
  c.lookAt(lookX, 0.5, 0);
  c.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
  return { camera: c, frustum };
}

afterEach(() => {
  delete (globalThis as { __AETHER_MATERIAL_DEDUPE?: boolean }).__AETHER_MATERIAL_DEDUPE;
});

describe('materialSignature', () => {
  it('is equal for materials that draw the same and tells colours, scalars and textures apart', () => {
    const map = new Texture();
    const a = new MeshStandardMaterial({ color: '#336699', roughness: 0.4, map });
    const b = a.clone();
    expect(materialSignature(b).key).toBe(materialSignature(a).key);
    expect(materialSignature(new MeshStandardMaterial({ color: '#336699', roughness: 0.5, map })).key).not.toBe(materialSignature(a).key);
    expect(materialSignature(new MeshStandardMaterial({ color: '#336699', roughness: 0.4, map: new Texture() })).key).not.toBe(materialSignature(a).key);
    const red = new MeshStandardMaterial({ color: '#ff0000', roughness: 0.4, map });
    expect(materialSignature(red).key).not.toBe(materialSignature(a).key);
    expect(materialSignature(red).tintless).toBe(materialSignature(a).tintless);
    // A change after the first key gives a new one.
    b.roughness = 0.9;
    b.needsUpdate = true;
    expect(materialSignature(b).key).not.toBe(materialSignature(a).key);
  });

  it('keeps node materials apart and out of instancing', () => {
    const n = new MeshStandardMaterial() as MeshStandardMaterial & { colorNode?: unknown; roughnessNode?: unknown };
    n.colorNode = color(0.5, 0.5, 0.5);
    n.roughnessNode = float(0.5);
    const s = materialSignature(n);
    expect(s.plain).toBe(false);
    expect(s.key.startsWith('#')).toBe(true);
  });
});

describe('AssetInstances', () => {
  it('draws the copies of a static model as one instanced mesh per part; driven and node-material models stay as they are', () => {
    const root = new Scene();
    const g = triangle();
    const mat = new MeshStandardMaterial({ color: '#808080' });
    // Separate loads of one model: equal materials, not the same instance.
    const lamps = [0, 10, 20].map((x) => model(`lamp-${x}`, x, new Mesh(g, mat.clone()), root));
    const driven = model('driven', 30, new Mesh(g, mat.clone()), root, { behaviors: [{ type: 'spin', params: {} }] });
    const shaded = new MeshStandardMaterial() as MeshStandardMaterial & { colorNode?: unknown };
    shaded.colorNode = color(1, 0, 0);
    const graphs = [40, 50].map((x) => model(`shaded-${x}`, x, new Mesh(g, shaded), root));
    root.updateMatrixWorld(true);
    const ai = new AssetInstances(root);
    expect(ai.rebuild([...lamps, driven, ...graphs])).toBe(true);
    expect(ai.count).toBe(1);
    expect(ai.drawCallsSaved).toBe(2);
    for (const l of lamps) expect((l.content.children[0] as Mesh).layers.mask).toBe(1 << BATCHED_LAYER);
    for (const n of [driven, ...graphs]) expect((n.content.children[0] as Mesh).layers.isEnabled(0)).toBe(true);
    expect(ai.packAll()).toEqual([3]);
    const inst = ai.meshes()[0]!;
    // Each copy lands where its model is.
    const m = new Matrix4();
    inst.getMatrixAt(2, m);
    m.premultiply(inst.matrixWorld);
    expect(m.elements[12]).toBeCloseTo(20);
    // Unchanged content keeps the instanced mesh.
    expect(ai.rebuild([...lamps, driven, ...graphs])).toBe(false);
    // A lamp removed: the next pack leaves it out and asks for a regroup, which gives the mesh back.
    lamps[2]!.object.removeFromParent();
    expect(ai.packAll()).toEqual([2]);
    expect(ai.needsRebuild).toBe(true);
    ai.clear();
    for (const l of lamps) expect((l.content.children[0] as Mesh).layers.isEnabled(0)).toBe(true);
  });

  it('leaves meshes another layer takes (merged models) alone, and never gives them back to the default layer', () => {
    const root = new Scene();
    const g = triangle();
    const mat = new MeshStandardMaterial();
    const nodes = [0, 10, 20].map((x) => model(`m-${x}`, x, new Mesh(g, mat), root));
    root.updateMatrixWorld(true);
    const merged = new Set<Mesh>();
    const ai = new AssetInstances(root, (mesh) => merged.has(mesh));
    ai.rebuild(nodes);
    expect(ai.packAll()).toEqual([3]);
    // A merge takes the first copy (it sets the layer itself): the next pack notices, the regroup leaves it on its layer.
    const first = nodes[0]!.content.children[0] as Mesh;
    merged.add(first);
    expect(ai.packAll()).toEqual([2]);
    expect(ai.needsRebuild).toBe(true);
    ai.rebuild(nodes);
    expect(ai.owns(first)).toBe(false);
    expect(first.layers.mask).toBe(1 << BATCHED_LAYER);
    expect(ai.packAll()).toEqual([2]);
  });

  it('groups by material instance only with __AETHER_MATERIAL_DEDUPE = false', () => {
    (globalThis as { __AETHER_MATERIAL_DEDUPE?: boolean }).__AETHER_MATERIAL_DEDUPE = false;
    const root = new Scene();
    const g = triangle();
    const mat = new MeshStandardMaterial();
    const nodes = [0, 10, 20, 30].map((x, i) => model(`m-${x}`, x, new Mesh(g, i < 2 ? mat : mat.clone()), root));
    root.updateMatrixWorld(true);
    const ai = new AssetInstances(root);
    ai.rebuild(nodes);
    // The shared one instances; the two clones are distinct instances, each alone.
    expect(ai.count).toBe(1);
    expect(ai.packAll()).toEqual([2]);
  });

  it('packs each copy at the level of detail the camera picks, and culls copies outside its frustum', () => {
    const root = new Scene();
    const hi = triangle();
    const lo = triangle();
    const mat = new MeshStandardMaterial();
    const lods = [0, 100].map((x) => {
      const lod = new LOD();
      lod.addLevel(new Mesh(hi, mat), 0);
      lod.addLevel(new Mesh(lo, mat), 50);
      return model(`lamp-${x}`, x, lod, root);
    });
    root.updateMatrixWorld(true);
    const ai = new AssetInstances(root);
    ai.rebuild(lods);
    expect(ai.count).toBe(2);
    const near = camera(0, 0);
    // levelFor matches three's own choice.
    const lod0 = lods[0]!.content.children[0] as LOD;
    lod0.update(near.camera);
    expect(levelFor(lod0, near.camera.position, 1)).toBe(lod0.getCurrentLevel());
    // Looking along the row: the near lamp at full detail, the far one at its second level.
    expect(ai.packAll(near.camera, null)).toEqual([1, 1]);
    // From beside the far lamp, looking at it: the far lamp at full detail, the near one is out of view.
    const far = camera(100, 100);
    expect(ai.packAll(far.camera, far.frustum)).toEqual([1, 0]);
    const p = new Matrix4();
    ai.meshes()[0]!.getMatrixAt(0, p);
    p.premultiply(ai.meshes()[0]!.matrixWorld);
    expect(p.elements[12]).toBeCloseTo(100);
  });

  it('instances body paint tinted per entity with the colour per copy', () => {
    const root = new Scene();
    const g = triangle();
    const paint = new MeshStandardMaterial({ name: 'paint', color: '#ff0000', roughness: 0.3 });
    const blue = paint.clone();
    blue.color.set('#0000ff');
    const cars = [paint, blue].map((m, i) => model(`car-${i}`, i * 5, new Mesh(g, m), root));
    root.updateMatrixWorld(true);
    const ai = new AssetInstances(root);
    ai.rebuild(cars);
    expect(ai.count).toBe(1);
    ai.packAll();
    const inst = ai.meshes()[0]!;
    const own = inst.material as MeshStandardMaterial;
    expect(own).not.toBe(paint);
    expect(own.color.getHex()).toBe(0xffffff);
    expect(own.roughness).toBe(0.3);
    const c = inst.instanceColor!.array;
    expect(Array.from(c.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(c.slice(3, 6))).toEqual([0, 0, 1]);
  });
});
