import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, createWorld, decodeMesh, encodeMesh, encodeMeshUpdate, type MeshData, type WorldDoc } from '@aether/core';
import { extrudeFaces } from '@aether/procgen';
import { initPhysics, PhysicsWorld, scatterInstances } from '../src/index';

/** Box mesh 2 × 1 × 2 with its base on y = 0 (8 shared vertices, outward winding). */
function slab(): MeshData {
  const positions = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
  return { positions, indices, colors: null, uvs: null, faceMaterials: null };
}

function withMesh(body: 'static' | 'dynamic', y = 0): WorldDoc {
  const r = applyPatches(createWorld(), [
    { op: 'setMesh', mesh: encodeMesh('slab-mesh', slab()) },
    { op: 'add', entity: { id: 'slab', shape: { kind: 'mesh', mesh: 'slab-mesh' }, transform: { position: [0, y, 0] }, physics: { body } } },
  ]);
  expect(r.errors).toEqual([]);
  return r.world;
}

const live: PhysicsWorld[] = [];
beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  for (const pw of live.splice(0)) pw.dispose();
});

async function make(doc: WorldDoc): Promise<PhysicsWorld> {
  const pw = await PhysicsWorld.create(doc);
  live.push(pw);
  return pw;
}

describe('mesh colliders', () => {
  it('a static mesh is solid (exact trimesh): a ball rests on top of it', async () => {
    const base = withMesh('static');
    const doc = applyPatches(base, [{ op: 'add', entity: { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [0.4, 0.4, 0.4] }, transform: { position: [0, 3, 0] }, physics: { body: 'dynamic' } } }]).world;
    const pw = await make(doc);
    for (let i = 0; i < 180; i++) pw.stepFixed();
    expect(pw.getState('ball')!.position[1]).toBeCloseTo(1.2, 1);
  });

  it('a dynamic mesh uses a convex hull and comes to rest on the ground', async () => {
    const pw = await make(withMesh('dynamic', 2));
    for (let i = 0; i < 240; i++) pw.stepFixed();
    expect(pw.getState('slab')!.position[1]).toBeCloseTo(0, 1);
  });

  it('sync rebuilds colliders when the mesh data changes (extrude raises the top)', async () => {
    const base = withMesh('static');
    const ballDoc = applyPatches(base, [{ op: 'add', entity: { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [0.4, 0.4, 0.4] }, transform: { position: [0, 4, 0] }, physics: { body: 'static' } } }]).world;
    const pw = await make(ballDoc);
    const before = pw.raycast([0, 10, 0], [0, -1, 0], 20, 'ball');
    expect(before?.id).toBe('slab');
    expect(10 - before!.distance).toBeCloseTo(1, 3);
    const asset = ballDoc.meshes['slab-mesh']!;
    const raised = extrudeFaces(decodeMesh(asset), [2, 3], 1);
    const edited = applyPatches(ballDoc, [{ op: 'setMesh', mesh: encodeMeshUpdate(asset, decodeMesh(asset), raised) }]).world;
    pw.sync(edited);
    pw.refreshQueries();
    const after = pw.raycast([0, 10, 0], [0, -1, 0], 20, 'ball');
    expect(10 - after!.distance).toBeCloseTo(2, 3);
  });
});

describe('painted scatter points', () => {
  it('places instances at the painted points with seeded scale and yaw', () => {
    const shape = { count: 3, area: [1, 1] as [number, number], seed: 4, scaleRange: [0.5, 1.5] as [number, number], randomYaw: true, points: [[1, 0, 2], [-3, 0.5, 4], [0, 0, -1]] as Array<[number, number, number]> };
    const a = scatterInstances(shape);
    const b = scatterInstances(shape);
    expect(a.map((i) => i.position)).toEqual(shape.points);
    expect(a).toEqual(b);
    for (const i of a) expect(i.scale).toBeGreaterThanOrEqual(0.5);
  });
});
