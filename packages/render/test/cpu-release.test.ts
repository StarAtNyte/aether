import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { compileBuilding } from '@aether/arch';
import { cpuGeometry, cpuPieces, releaseAfterUpload, released, sweepUploads } from '../src/gpu/cpu-release';
import { buildShadowGeometry } from '../src/sync/cell-shadow-batches';
import { buildExportScene } from '../src/view/gltf-export';
import { makeSync, tick } from './helpers';

/** A stand-in for three's backend: an attribute is uploaded once marked. */
function backend(): { has(o: object): boolean; get(o: object): { bufferGPU?: unknown }; upload(g: BufferGeometry): void } {
  const up = new Set<object>();
  return {
    has: (o) => up.has(o),
    get: (o) => (up.has(o) ? { bufferGPU: {} } : {}),
    upload(g) {
      if (g.index) up.add(g.index);
      for (const name in g.attributes) up.add(g.attributes[name]!);
    },
  };
}

afterEach(() => {
  delete (globalThis as { __AETHER_RELEASE_CPU_GEOMETRY?: boolean }).__AETHER_RELEASE_CPU_GEOMETRY;
});

describe('CPU copies after upload', () => {
  it('releases a geometry only once every attribute and its index are uploaded, keeping counts, types and bounds', () => {
    const g = new BoxGeometry(2, 2, 2);
    const b = backend();
    releaseAfterUpload(g);
    expect(sweepUploads(b)).toBe(0);
    expect(released(g)).toBe(false);
    b.upload(g);
    const positions = g.getAttribute('position').count;
    const indices = g.index!.count;
    expect(sweepUploads(b)).toBeGreaterThan(0);
    expect(released(g)).toBe(true);
    expect(g.getAttribute('position').array).toBeInstanceOf(Float32Array);
    expect(g.getAttribute('position').array.length).toBe(0);
    expect(g.getAttribute('position').count).toBe(positions);
    expect(g.index!.array.constructor).toBe(Uint16Array);
    expect(g.index!.count).toBe(indices);
    // Bounds were computed while the data was there, and a later recompute keeps them.
    expect(g.boundingSphere!.radius).toBeCloseTo(Math.sqrt(3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    expect(g.boundingSphere!.radius).toBeCloseTo(Math.sqrt(3));
    expect(g.boundingBox!.max.x).toBeCloseTo(1);
  });

  it('releases each attribute once a pass has uploaded it (a depth pass uploads positions only)', () => {
    const g = new BoxGeometry();
    const up = new Set<object>([g.getAttribute('position'), g.index!]);
    const b = { has: (o: object) => up.has(o), get: (o: object) => (up.has(o) ? { buffer: {} } : {}) };
    releaseAfterUpload(g);
    sweepUploads(b);
    expect(released(g)).toBe(true);
    expect(g.getAttribute('position').array.length).toBe(0);
    expect(g.getAttribute('normal').array.length).toBeGreaterThan(0);
    up.add(g.getAttribute('normal'));
    up.add(g.getAttribute('uv'));
    sweepUploads(b);
    expect(g.getAttribute('normal').array.length).toBe(0);
    expect(g.getAttribute('uv').array.length).toBe(0);
    expect(g.boundingSphere!.radius).toBeCloseTo(Math.sqrt(0.75));
  });

  it('releases only the attributes named', () => {
    const g = new BoxGeometry();
    const b = backend();
    releaseAfterUpload(g, {}, ['position']);
    b.upload(g);
    sweepUploads(b);
    expect(g.getAttribute('position').array.length).toBe(0);
    expect(g.getAttribute('normal').array.length).toBeGreaterThan(0);
    expect(g.index!.array.length).toBeGreaterThan(0);
  });

  it('keeps every copy with the switch off, and forgets disposed geometry', () => {
    (globalThis as { __AETHER_RELEASE_CPU_GEOMETRY?: boolean }).__AETHER_RELEASE_CPU_GEOMETRY = false;
    const off = new BoxGeometry();
    const b = backend();
    releaseAfterUpload(off);
    b.upload(off);
    sweepUploads(b);
    expect(released(off)).toBe(false);
    delete (globalThis as { __AETHER_RELEASE_CPU_GEOMETRY?: boolean }).__AETHER_RELEASE_CPU_GEOMETRY;
    const gone = new BoxGeometry();
    releaseAfterUpload(gone);
    gone.dispose();
    b.upload(gone);
    sweepUploads(b);
    expect(released(gone)).toBe(false);
  });

  it('gives a released geometry back through its owner', () => {
    const g = new BoxGeometry();
    const b = backend();
    releaseAfterUpload(g, { restore: () => new BoxGeometry(), pieces: () => [{ geometry: new BoxGeometry(), matrix: new Matrix4() }] });
    expect(cpuGeometry(g)).toEqual({ geometry: g, temporary: false });
    expect(cpuPieces(g)).toBeNull();
    b.upload(g);
    sweepUploads(b);
    const copy = cpuGeometry(g)!;
    expect(copy.temporary).toBe(true);
    expect(copy.geometry.getAttribute('position').array.length).toBe(24 * 3);
    expect(cpuPieces(g)).toHaveLength(1);
  });
});

function house(): WorldDoc {
  const b = compileBuilding({
    id: 'house',
    levels: [{ height: 3, rooms: [{ id: 'living', type: 'living', rect: [0, 0, 7, 5] }, { id: 'kitchen', type: 'kitchen', rect: [7, 0, 11, 5] }], doors: [{ between: ['living', 'outside'], main: true }, { between: ['living', 'kitchen'] }] }],
  });
  const r = applyPatches(createWorld(), b.patches);
  expect(r.errors).toEqual([]);
  return r.world;
}

describe('released building merges', () => {
  it('cast the same shadow triangles from their members and export the same geometry', async () => {
    const { sync } = makeSync();
    await sync.setWorld(house());
    await tick(10);
    sync.root.updateMatrixWorld(true);
    sync.updateBatches();
    const meshes: Mesh[] = [];
    sync.root.traverse((o) => {
      if (o instanceof Mesh && o.name === 'aether:merged') meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThan(0);
    const before = meshes.map((mesh) => buildShadowGeometry([{ mesh, world: mesh.matrixWorld }], new Matrix4()));
    const positions = meshes.map((m) => Float32Array.from(m.geometry.getAttribute('position').array as Float32Array));
    const b = backend();
    for (const m of meshes) b.upload(m.geometry);
    sweepUploads(b);
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i]!;
      expect(released(m.geometry)).toBe(true);
      expect(m.geometry.getAttribute('position').array.length).toBe(0);
      const after = buildShadowGeometry([{ mesh: m, world: m.matrixWorld }], new Matrix4());
      expect(Array.from(after.starts)).toEqual(Array.from(before[i]!.starts));
      expect(after.index.length).toBe(before[i]!.index.length);
      for (let k = 0; k < after.positions.length; k++) expect(after.positions[k]).toBeCloseTo(before[i]!.positions[k]!, 4);
      const copy = cpuGeometry(m.geometry)!;
      expect(copy.temporary).toBe(true);
      expect(Array.from(copy.geometry.getAttribute('position').array)).toEqual(Array.from(positions[i]!));
      copy.geometry.dispose();
    }
    // The export draws them from a copy made again.
    const exported = buildExportScene(sync.root, null);
    let merged = 0;
    exported.root.traverse((o) => {
      if (o instanceof Mesh && o.geometry.getAttribute('position')?.array.length === o.geometry.getAttribute('position')?.count * 3) merged++;
    });
    expect(merged).toBe(exported.meshes);
    exported.dispose();
  });

  it('a released virtual or shadow batch never reads its empty arrays', () => {
    const root = new Group();
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(new BoxGeometry(), material);
    root.add(mesh);
    root.updateMatrixWorld(true);
    const b = backend();
    releaseAfterUpload(mesh.geometry);
    b.upload(mesh.geometry);
    sweepUploads(b);
    // Without an owner to restore it, the export leaves it out instead of writing an empty mesh.
    const exported = buildExportScene(root, new PerspectiveCamera());
    expect(exported.meshes).toBe(0);
    expect(exported.skipped).toBe(1);
    exported.dispose();
  });
});
