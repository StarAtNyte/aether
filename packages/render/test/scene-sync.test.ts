import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Mesh, MeshStandardMaterial, PointLight, Quaternion, Raycaster, SpotLight, Vector3 } from 'three';
import { DEFAULT_MAX_INSTANCES } from '../src/sync/scene-sync';
import { eulerDegToQuat, type EntityInput } from '@aether/core';
import { box, makeSync, patch, tick, world } from './helpers';
import { ENTITY_ID_KEY } from '../src/sync/entity-node';

function meshes(sync: ReturnType<typeof makeSync>['sync'], id: string): Mesh[] {
  const out: Mesh[] = [];
  sync.node(id)?.content.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

describe('SceneSync structure', () => {
  it('creates nodes with transforms, hierarchy and shadow flags; skips templates', async () => {
    const { sync } = makeSync();
    const w = world([
      box('base', [0, 0.5, 0]),
      { ...box('child', [0, 2, 0]), parent: 'base', transform: { position: [0, 2, 0], rotation: [0, 90, 0], scale: [2, 2, 2] }, castShadow: false },
      { ...box('tpl'), template: true },
      { ...box('under-tpl'), parent: 'tpl' },
      { id: 'empty' },
    ]);
    await sync.setWorld(w);
    expect(sync.entityCount).toBe(3);
    expect(sync.object('tpl')).toBeUndefined();
    expect(sync.object('under-tpl')).toBeUndefined();
    const child = sync.object('child')!;
    expect(child.parent).toBe(sync.object('base'));
    expect(child.position.y).toBe(2);
    expect(child.scale.x).toBe(2);
    expect(child.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(child.matrix.elements[13]).toBe(2); // matrix updated although matrixAutoUpdate is off
    expect(meshes(sync, 'base')[0]!.castShadow).toBe(true);
    expect(meshes(sync, 'child')[0]!.castShadow).toBe(false);
    expect(meshes(sync, 'empty')).toHaveLength(0);
    expect(sync.getOutput('base')?.parts.length).toBe(1);
  });

  it('keeps Object3D identity for unchanged entities and applies minimal updates', async () => {
    const { sync, materials } = makeSync();
    const w1 = world([box('a'), box('b', [3, 0.5, 0])]);
    await sync.setWorld(w1);
    const a = sync.object('a');
    const bMesh = meshes(sync, 'b')[0]!;
    const w2 = patch(w1, [{ op: 'update', id: 'b', set: { transform: { position: [5, 0.5, 0] } } }]);
    await sync.setWorld(w2);
    expect(sync.object('a')).toBe(a);
    expect(meshes(sync, 'b')[0]).toBe(bMesh);
    expect(sync.object('b')!.position.x).toBe(5);

    const w3 = patch(w2, [{ op: 'update', id: 'b', set: { material: { color: '#ff0000' } } }]);
    await sync.setWorld(w3);
    const mat = meshes(sync, 'b')[0]!.material as MeshStandardMaterial;
    expect(meshes(sync, 'b')[0]).toBe(bMesh); // geometry kept, material swapped
    expect(mat.color.getHexString()).toBe('ff0000');
    expect(materials.size).toBe(2);

    const w4 = patch(w3, [{ op: 'update', id: 'b', set: { shape: { kind: 'primitive', primitive: 'sphere', size: [2, 2, 2] } } }]);
    await sync.setWorld(w4);
    expect(meshes(sync, 'b')[0]).not.toBe(bMesh);
    expect(sync.object('b')).toBeDefined();
  });

  it('removes entities and releases every cached resource', async () => {
    const { sync, materials, geometries } = makeSync();
    const w1 = world([box('a', [0, 0.5, 0], { material: { preset: 'gold' } }), box('b'), { id: 'p', shape: { kind: 'procedural', generator: 'tree', params: {} } }]);
    await sync.setWorld(w1);
    expect(geometries.size).toBeGreaterThan(0);
    const w2 = patch(w1, [{ op: 'remove', id: 'a' }, { op: 'remove', id: 'b' }, { op: 'remove', id: 'p' }]);
    await sync.setWorld(w2);
    expect(sync.entityCount).toBe(0);
    expect(materials.size).toBe(0);
    expect(geometries.size).toBe(0);
    expect(sync.root.children).toHaveLength(0);
  });

  it('reparents on parent change and survives parent removal', async () => {
    const { sync } = makeSync();
    const w1 = world([box('p1'), box('p2', [4, 0, 0]), { ...box('c'), parent: 'p1' }]);
    await sync.setWorld(w1);
    const w2 = patch(w1, [{ op: 'update', id: 'c', set: { parent: 'p2' } }]);
    await sync.setWorld(w2);
    expect(sync.object('c')!.parent).toBe(sync.object('p2'));
    const w3 = patch(w2, [{ op: 'remove', id: 'p2', recursive: false }]);
    await sync.setWorld(w3);
    expect(sync.object('c')).toBeDefined();
    expect(sync.object('c')!.parent).toBe(sync.root);
  });

  it('turning a parent into a template hides its subtree', async () => {
    const { sync } = makeSync();
    const w1 = world([box('p'), { ...box('c'), parent: 'p' }]);
    await sync.setWorld(w1);
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'p', set: { template: true } }]));
    expect(sync.entityCount).toBe(0);
  });

  it('resolves entity ids from any descendant object (picking)', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([box('a'), { ...box('b'), parent: 'a' }]));
    expect(sync.idOf(meshes(sync, 'b')[0]!)).toBe('b');
    expect(sync.idOf(meshes(sync, 'a')[0]!)).toBe('a');
    expect(sync.idOf(sync.root)).toBeNull();
    expect(sync.object('a')!.userData[ENTITY_ID_KEY]).toBe('a');
  });
});

describe('SceneSync procedural content', () => {
  it('shows a placeholder while generating, then the multi-part output with part materials', async () => {
    const { sync, source } = makeSync();
    source.defer = true;
    const w = world([{ id: 't', shape: { kind: 'procedural', generator: 'tree', params: { h: 3 } }, material: { color: '#ff0000' } }]);
    const done = sync.setWorld(w);
    expect(sync.node('t')!.placeholder).toBe(true);
    expect(sync.node('t')!.pending).toBe(true);
    source.flush();
    await done;
    const n = sync.node('t')!;
    expect(n.placeholder).toBe(false);
    expect(n.pending).toBe(false);
    expect(n.bindings).toHaveLength(2);
    // Multi-part: the part presets win over the entity color.
    const colors = n.bindings.map((b) => (b.mesh.material as MeshStandardMaterial).color.getHexString());
    expect(colors).not.toContain('ff0000');
    expect(sync.getOutput('t')?.parts).toHaveLength(2);
  });

  it('falls back with a warning when generation fails', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([{ id: 'x', shape: { kind: 'procedural', generator: 'fail-gen', params: {} } }]));
    const n = sync.node('x')!;
    expect(n.failed).toBe(true);
    expect(n.bindings.length).toBeGreaterThan(0);
    expect(sync.getWarnings().get('x')).toMatch(/boom/);
  });

  it('drops stale async results when the shape changes mid-generation', async () => {
    const { sync, source, geometries } = makeSync();
    source.defer = true;
    const w1 = world([{ id: 't', shape: { kind: 'procedural', generator: 'tree', params: {} } }]);
    const first = sync.setWorld(w1);
    const w2 = patch(w1, [{ op: 'update', id: 't', set: { shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } } }]);
    await sync.setWorld(w2);
    source.flush();
    await first;
    const n = sync.node('t')!;
    expect(n.bindings).toHaveLength(1);
    expect(n.keyed?.key.startsWith('prim|')).toBe(true);
    expect(geometries.size).toBe(1);
  });

  it('rebuilds entities whose custom generator was redefined', async () => {
    const { sync, source } = makeSync();
    const gen = { id: 'gizmo', description: 'x', source: 'return api.build();' };
    const w1 = world([{ id: 'g', shape: { kind: 'procedural', generator: 'gizmo', params: {} } }, box('b')], { generators: { gizmo: gen } });
    await sync.setWorld(w1);
    const calls = source.proceduralCalls;
    await sync.setWorld(patch(w1, [{ op: 'defineGenerator', generator: { ...gen, source: 'api.box(1,1,1); return api.build();' } }]));
    expect(source.proceduralCalls).toBe(calls + 1);
  });

  it('shows the fallback for models without a loader and loads models with one', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([{ id: 'm', shape: { kind: 'model', url: '/a.glb' } }]));
    await sync.whenIdle();
    expect(sync.node('m')!.failed).toBe(true);

    const { ModelCache } = await import('../src/geometry/model-loader');
    const { Group: G, BoxGeometry, MeshBasicMaterial } = await import('three');
    const loaded = new G();
    loaded.add(new Mesh(new BoxGeometry(2, 4, 2), new MeshBasicMaterial()));
    const models = new ModelCache({ load: async () => loaded });
    const s2 = makeSync({ models }).sync;
    await s2.setWorld(world([{ id: 'm', shape: { kind: 'model', url: '/a.glb', fitSize: 1 } }]));
    await s2.whenIdle();
    const n = s2.node('m')!;
    expect(n.failed).toBe(false);
    expect(n.placeholder).toBe(false);
    const b = new Box3().setFromObject(n.content);
    expect(b.max.y - b.min.y).toBeCloseTo(1);
    expect(models.size).toBe(1);
    s2.clear();
    expect(models.size).toBe(0);
  });
});

describe('SceneSync scatter', () => {
  const forest = (extra: Partial<EntityInput> = {}): EntityInput => ({
    id: 'forest',
    shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, count: 1000, area: [50, 50], seed: 3 },
    ...extra,
  });

  it('draws instanced meshes sharing one matrix buffer', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([forest()]));
    const n = sync.node('forest')!;
    expect(n.instances).toBe(1000);
    expect(sync.instanceCount).toBe(1000);
    const im = n.bindings[0]!.mesh as InstancedMesh;
    expect(im).toBeInstanceOf(InstancedMesh);
    expect(im.count).toBe(1000);
    expect(im.instanceMatrix.array.length).toBe(16000);
    expect(im.boundingSphere).not.toBeNull();
    // Primitive boxes rest on y = 0: lift = half height × scale.
    const m = im.instanceMatrix.array;
    const scale = Math.hypot(m[4] as number, m[5] as number, m[6] as number);
    expect(m[13]).toBeCloseTo(1 * scale, 4);
    expect(sync.getOutput('forest')).toBeUndefined();
    expect(sync.idOf(im)).toBe('forest');
  });

  it('places instances on a surface entity (and relayouts when it moves)', async () => {
    const { sync } = makeSync();
    const terrain: EntityInput = { id: 'hill', transform: { position: [0, 1, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [100, 2, 100] } };
    const w1 = world([forest({ shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, count: 200, area: [50, 50], seed: 3, onSurface: 'hill' } }), terrain]);
    await sync.setWorld(w1);
    await sync.whenIdle();
    const im = () => sync.node('forest')!.bindings[0]!.mesh as InstancedMesh;
    const yOf = (i: number): number => {
      const m = im().instanceMatrix.array;
      const s = Math.hypot(m[i * 16 + 4] as number, m[i * 16 + 5] as number, m[i * 16 + 6] as number);
      return (m[i * 16 + 13] as number) - s;
    };
    for (let i = 0; i < 20; i++) expect(yOf(i)).toBeCloseTo(2, 3); // top of the hill
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'hill', set: { transform: { position: [0, 4, 0] } } }]));
    await sync.whenIdle();
    for (let i = 0; i < 20; i++) expect(yOf(i)).toBeCloseTo(5, 3);
  });

  it('enforces the total instance budget', async () => {
    const { sync } = makeSync({ maxInstances: 1500 });
    await sync.setWorld(world([forest(), { ...forest(), id: 'forest-2' }]));
    expect(sync.instanceCount).toBe(1500);
    expect([...sync.getWarnings().values()].join(' ')).toMatch(/limited/);
  });

  it('handles a 200k-instance scatter (clamped to the default laptop budget unless raised)', async () => {
    const big = forest({ shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone', size: [1, 2, 1] }, count: 200_000, area: [400, 400], seed: 1 } });
    const { sync } = makeSync();
    await sync.setWorld(world([big]));
    expect(sync.instanceCount).toBe(DEFAULT_MAX_INSTANCES);
    expect(sync.getWarnings().get('forest')).toMatch(/limited/);
    const { sync: roomy } = makeSync({ maxInstances: 500_000 });
    const t0 = performance.now();
    await roomy.setWorld(world([big]));
    expect(roomy.instanceCount).toBe(200_000);
    expect(performance.now() - t0).toBeLessThan(2500);
  });

  it('clamps scatter layers to the triangle budget (instances × triangles per instance)', async () => {
    const { sync } = makeSync({ maxScatterTriangles: 1200 });
    await sync.setWorld(world([forest()]));
    const tris = (meshes(sync, 'forest')[0]!.geometry.index?.count ?? 0) / 3;
    expect(tris).toBeGreaterThan(0);
    expect(sync.instanceCount).toBe(Math.floor(1200 / tris));
    expect(sync.getWarnings().get('forest')).toMatch(/triangles/);
    await sync.setWorld(world([]));
    expect(sync.instanceCount).toBe(0);
  });

  it('does not cast shadows from dense scatter layers and skips them in mesh raycasts', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([forest({ id: 'sparse', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, count: 50, area: [10, 10], seed: 1 } }), forest({ shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 2, 1] }, count: 5000, area: [50, 50], seed: 3 } })]));
    const sparse = meshes(sync, 'sparse')[0] as InstancedMesh;
    const dense = meshes(sync, 'forest')[0] as InstancedMesh;
    expect(sparse.castShadow).toBe(true);
    expect(dense.castShadow).toBe(false);
    expect(dense.receiveShadow).toBe(true);
    const ray = new Raycaster(new Vector3(0, 50, 0), new Vector3(0, -1, 0));
    expect(ray.intersectObject(sync.root, true)).toHaveLength(0);
    expect(sync.pickScatter(ray.ray)?.id).toMatch(/forest|sparse/);
  });

  it('relayouts only the scatters bound to a changed surface', async () => {
    const { sync, source } = makeSync();
    const w1 = world([
      box('ground', [0, 0, 0]),
      forest({ id: 'on-ground', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, count: 10, area: [5, 5], seed: 1, onSurface: 'ground' } }),
      forest({ id: 'free', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, count: 10, area: [5, 5], seed: 2 } }),
    ]);
    await sync.setWorld(w1);
    await sync.whenIdle();
    const freeMesh = meshes(sync, 'free')[0];
    const boundMesh = meshes(sync, 'on-ground')[0];
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'ground', set: { transform: { position: [0, 3, 0] } } }]));
    await sync.whenIdle();
    expect(meshes(sync, 'free')[0]).toBe(freeMesh);
    expect(meshes(sync, 'on-ground')[0]).not.toBe(boundMesh);
    expect(source).toBeDefined();
  });
});

describe('SceneSync runtime', () => {
  it('animates material overrides in place without creating or disposing materials per tick', async () => {
    const { sync, materials } = makeSync();
    const w = world([{ ...box('glow'), material: { color: '#ff0000', emissive: '#ffaa00', emissiveIntensity: 1 } }]);
    await sync.setWorld(w);
    const mesh = meshes(sync, 'glow')[0]!;
    const cachedSize = materials.size;
    let created = 0;
    let disposed = 0;
    const seen = new Set<unknown>();
    for (let i = 0; i < 600; i++) {
      expect(sync.setProperty('glow', 'material.emissiveIntensity', 1 + Math.sin(i / 10))).toBe(true);
      expect(sync.setProperty('glow', 'material.opacity', 0.5 + 0.5 * Math.sin(i / 7))).toBe(true);
      const m = mesh.material as MeshStandardMaterial;
      if (!seen.has(m)) {
        seen.add(m);
        created++;
        m.addEventListener('dispose', () => disposed++);
      }
    }
    expect(created).toBe(1);
    expect(disposed).toBe(0);
    expect(materials.size).toBe(cachedSize);
    const live = mesh.material as MeshStandardMaterial;
    expect(live.transparent).toBe(true);
    expect(live.emissiveIntensity).toBeCloseTo(1 + Math.sin(599 / 10));
    expect(live.opacity).toBeCloseTo(0.5 + 0.5 * Math.sin(599 / 7));
    // Invalid values are rejected without touching the material.
    expect(sync.setProperty('glow', 'material.opacity', 2)).toBe(false);
    expect(sync.setProperty('glow', 'material.color', 'red')).toBe(false);
    // Reset drops the private clone and rebinds the shared cached material.
    sync.clearOverrides();
    expect(disposed).toBe(1);
    expect(mesh.material).not.toBe(live);
    expect((mesh.material as MeshStandardMaterial).emissiveIntensity).toBe(1);
    expect(materials.size).toBe(cachedSize);
  });

  it('reuses shared GPU resources across a rebuild instead of disposing and recreating them', async () => {
    const { sync, materials } = makeSync();
    const w1 = world([box('solo')]);
    await sync.setWorld(w1);
    const before = meshes(sync, 'solo')[0]!;
    let disposed = 0;
    (before.material as MeshStandardMaterial).addEventListener('dispose', () => disposed++);
    before.geometry.addEventListener('dispose', () => disposed++);
    // A shape change on the only user of the material rebuilds the node.
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'solo', set: { shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1.0001] } } }]));
    const after = meshes(sync, 'solo')[0]!;
    expect(after.material).toBe(before.material);
    expect(disposed).toBe(1); // only the old (now unused) geometry
    expect(materials.size).toBe(1);
  });

  it('restores the document pose of overridden entities on reset', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([box('crate', [1, 0.5, 0])]));
    const packed = new Float32Array([9, -5, 9, 0, 0, 0, 1]);
    sync.applyTransforms(packed, ['crate']);
    sync.setProperty('crate', 'visible', false);
    sync.clearOverrides();
    const o = sync.object('crate')!;
    expect(o.visible).toBe(true);
    expect(o.position.toArray()).toEqual([1, 0.5, 0]);
  });

  it('applies packed physics poses, converting parented bodies to local space', async () => {
    const { sync } = makeSync();
    const w = world([
      box('root-body'),
      { id: 'holder', transform: { position: [10, 0, 0], rotation: [0, 90, 0], scale: [2, 2, 2] } },
      { ...box('child-body'), parent: 'holder' },
    ]);
    await sync.setWorld(w);
    const q = eulerDegToQuat([0, 45, 0]);
    const packed = new Float32Array([1, 2, 3, ...q, 12, 1, 0, ...q, Number.NaN, 0, 0, 0, 0, 0, 1]);
    sync.applyTransforms(packed, ['root-body', 'child-body', 'missing']);
    expect(sync.object('root-body')!.position.toArray()).toEqual([1, 2, 3]);
    const child = sync.object('child-body')!;
    child.updateWorldMatrix(true, false);
    const wp = new Vector3().setFromMatrixPosition(child.matrixWorld);
    expect(wp.x).toBeCloseTo(12, 4);
    expect(wp.y).toBeCloseTo(1, 4);
    const wq = new Quaternion();
    child.matrixWorld.decompose(new Vector3(), wq, new Vector3());
    expect(Math.abs(wq.dot(new Quaternion(...q)))).toBeCloseTo(1, 4);
    // Short arrays/orders are tolerated.
    sync.applyTransforms(new Float32Array(3), ['root-body']);
  });

  it('applyTransforms on 5000 bodies is fast', async () => {
    const { sync } = makeSync();
    const ents: EntityInput[] = [];
    for (let i = 0; i < 5000; i++) ents.push(box(`b-${i}`, [i, 0.5, 0]));
    await sync.setWorld(world(ents));
    const order = ents.map((e) => e.id);
    const packed = new Float32Array(order.length * 7);
    for (let i = 0; i < order.length; i++) packed[i * 7 + 6] = 1;
    const t0 = performance.now();
    for (let f = 0; f < 30; f++) sync.applyTransforms(packed, order);
    expect((performance.now() - t0) / 30).toBeLessThan(8);
  });

  it('runtime property overrides: fast paths, generic paths, rejection and reset', async () => {
    const { sync } = makeSync();
    const w = world([box('a', [0, 0.5, 0], { light: { type: 'point', intensity: 1 } })]);
    await sync.setWorld(w);
    expect(sync.setProperty('a', 'visible', false)).toBe(true);
    expect(sync.object('a')!.visible).toBe(false);
    expect(sync.setProperty('a', 'light.intensity', 3)).toBe(true);
    expect(sync.node('a')!.light!.light.intensity).toBe(60);
    expect(sync.setProperty('a', 'material.color', '#00ff00')).toBe(true);
    expect((meshes(sync, 'a')[0]!.material as MeshStandardMaterial).color.getHexString()).toBe('00ff00');
    expect(sync.setProperty('a', 'position', [1, 2, 3])).toBe(true);
    expect(sync.object('a')!.position.z).toBe(3);
    expect(sync.setProperty('a', 'material.color', 'green')).toBe(false);
    expect(sync.setProperty('a', '__proto__.polluted', 1)).toBe(false);
    expect(sync.setProperty('a', 'material.constructor', 1)).toBe(false);
    expect(sync.setProperty('a', 'id', 'b')).toBe(false);
    expect(sync.setProperty('missing', 'visible', true)).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    sync.clearOverrides();
    expect(sync.object('a')!.visible).toBe(true);
    expect(sync.object('a')!.position.z).toBe(0);
    expect((meshes(sync, 'a')[0]!.material as MeshStandardMaterial).color.getHexString()).not.toBe('00ff00');
  });

  it('transient entities survive setWorld and never shadow document ids', async () => {
    const { sync } = makeSync();
    const w1 = world([box('a')]);
    await sync.setWorld(w1);
    const { Entity } = await import('@aether/core');
    expect(sync.addTransient(Entity.parse(box('spawned-1')))).not.toBe(false);
    expect(sync.addTransient(Entity.parse(box('a')))).toBe(false);
    await sync.setWorld(patch(w1, [{ op: 'add', entity: Entity.parse(box('b')) }]));
    expect(sync.object('spawned-1')).toBeDefined();
    expect(sync.removeTransient('a')).toBe(false);
    expect(sync.removeTransient('spawned-1')).toBe(true);
    expect(sync.object('spawned-1')).toBeUndefined();
  });

  it('attaches existing orphans when their parent appears later', async () => {
    const { sync } = makeSync();
    const w1 = world([box('a')]);
    await sync.setWorld(w1);
    const { Entity } = await import('@aether/core');
    sync.addTransient(Entity.parse({ ...box('rider'), parent: 'cart' }));
    expect(sync.object('rider')!.parent).toBe(sync.root);
    await sync.setWorld(patch(w1, [{ op: 'add', entity: Entity.parse(box('cart', [5, 0, 0])) }]));
    expect(sync.object('rider')!.parent).toBe(sync.object('cart'));
  });

  it('caps shadow-casting lights at two, deterministically', async () => {
    const { sync } = makeSync();
    const lamp = (id: string): EntityInput => ({ id, light: { type: 'point', castShadow: true } });
    await sync.setWorld(world([lamp('l-c'), lamp('l-a'), lamp('l-b'), { id: 'spot', light: { type: 'spot', angle: 40 } }]));
    const casting = ['l-a', 'l-b', 'l-c'].filter((id) => sync.node(id)!.light!.light.castShadow);
    expect(casting).toEqual(['l-a', 'l-b']);
    const spot = sync.node('spot')!.light!.light as SpotLight;
    expect(spot).toBeInstanceOf(SpotLight);
    expect(spot.target.parent).toBe(sync.object('spot'));
    expect(sync.node('l-a')!.light!.light).toBeInstanceOf(PointLight);
  });

  it('ghost variant uses translucent materials and no lights', async () => {
    const { sync } = makeSync({ variant: 'ghost' });
    await sync.setWorld(world([box('a', [0, 0.5, 0], { light: { type: 'point' } })]));
    const mat = meshes(sync, 'a')[0]!.material as MeshStandardMaterial;
    expect(mat.transparent).toBe(true);
    expect(sync.node('a')!.light).toBeNull();
    expect(meshes(sync, 'a')[0]!.castShadow).toBe(false);
  });

  it('syncs 5000 entities, then patches one incrementally', async () => {
    const { sync, materials } = makeSync();
    const ents: EntityInput[] = [];
    for (let i = 0; i < 5000; i++) ents.push(box(`e-${i}`, [i % 100, 0.5, Math.floor(i / 100)], { material: { preset: i % 2 ? 'wood' : 'stone' } }));
    const t0 = performance.now();
    const w1 = world(ents);
    await sync.setWorld(w1);
    expect(sync.entityCount).toBe(5000);
    expect(materials.size).toBe(2);
    expect(performance.now() - t0).toBeLessThan(4000);
    const before = sync.object('e-10');
    const t1 = performance.now();
    await sync.setWorld(patch(w1, [{ op: 'update', id: 'e-42', set: { transform: { position: [0, 9, 0] } } }]));
    expect(performance.now() - t1).toBeLessThan(250);
    expect(sync.object('e-10')).toBe(before);
    expect(sync.object('e-42')!.position.y).toBe(9);
    const bounds = sync.computeBounds(new Box3());
    expect(bounds.max.y).toBeCloseTo(9.5);
  });

  it('dispose releases everything and ignores later calls', async () => {
    const { sync, materials, geometries } = makeSync();
    await sync.setWorld(world([box('a'), box('b')]));
    sync.dispose();
    expect(materials.size).toBe(0);
    expect(geometries.size).toBe(0);
    await sync.setWorld(world([box('c')]));
    expect(sync.entityCount).toBe(0);
    await tick();
  });
});
