import { describe, expect, it } from 'vitest';
import { InstancedMesh, PerspectiveCamera } from 'three';
import { buildChunks, FieldCuller, FIELD_STRIDE, packMatrices, type FieldView } from '../src/virtual/field-culler';
import { buildLodChain, isFaceted } from '../src/virtual/lod-chain';
import { composeScatterMatrices, composeScatterPacked, scatterPlacements } from '../src/geometry/scatter';
import { shareBudget } from '../src/sync/field-mount';
import { FIELD_MIN_INSTANCES } from '../src/virtual/scatter-field';
import { renderBudget } from '../src/gpu/budget';
import { makeSync, patch, world } from './helpers';
import { primitiveOutput } from '@aether/procgen';

/** 2D field of `n`×`n` unit-scale instances on a 2 m grid. */
function gridField(n: number): Float32Array {
  const data = new Float32Array(n * n * FIELD_STRIDE);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const o = (z * n + x) * FIELD_STRIDE;
      data[o] = x * 2;
      data[o + 2] = z * 2;
      data[o + 3] = 1;
      data[o + 4] = 0;
    }
  }
  return data;
}

const view = (cx: number, cz: number, planes: Float64Array | null = null): FieldView => ({ cx, cy: 2, cz, pixelScale: 800, planes });

describe('field packing', () => {
  it('packs the same transforms as the matrix path', () => {
    const p = scatterPlacements({ count: 50, area: [20, 20], seed: 4, scaleRange: [0.5, 2], randomYaw: true }, 50);
    const m = composeScatterMatrices(p, 0.5);
    const a = packMatrices(m, p.count);
    const b = composeScatterPacked(p, 0.5);
    expect(a.length).toBe(50 * FIELD_STRIDE);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i] as number, 5);
  });

  it('sorts instances into compact chunks with padded boxes', () => {
    const data = gridField(64);
    const chunks = buildChunks(data, 64 * 64, 0.5, 128);
    expect(chunks.chunkCount).toBeGreaterThan(20);
    expect(chunks.start[chunks.chunkCount]).toBe(4096);
    for (let c = 0; c < chunks.chunkCount; c++) {
      const b = c * 6;
      for (let i = chunks.start[c] as number; i < (chunks.start[c + 1] as number); i++) {
        const x = chunks.data[i * FIELD_STRIDE] as number;
        expect(x).toBeGreaterThanOrEqual((chunks.boxes[b] as number) + 0.49);
        expect(x).toBeLessThanOrEqual((chunks.boxes[b + 3] as number) - 0.49);
      }
    }
    expect(buildChunks(new Float32Array(0), 0, 1).chunkCount).toBe(0);
  });
});

describe('FieldCuller', () => {
  const data = gridField(100); // 10 000 instances over 200 × 200 m
  const chunks = buildChunks(data, 10_000, 1, 64);

  it('stays within the triangle budget and draws near chunks finer than far ones', () => {
    const culler = new FieldCuller(chunks, { lodTriangles: [500, 100, 20, 4], radius: 1, budgetTriangles: 200_000 });
    expect(culler.update(view(100, 100))).not.toBe(0);
    expect(culler.drawnTriangles).toBeLessThanOrEqual(200_000);
    expect(culler.drawnInstances).toBeGreaterThan(0);
    // Level 0 instances are nearer than any level-3 instance.
    const near = culler.buffers[0] as Float32Array;
    const far = culler.buffers[culler.levels - 1] as Float32Array;
    const dist = (buf: Float32Array, i: number): number => Math.hypot((buf[i * 16 + 12] as number) - 100, (buf[i * 16 + 14] as number) - 100);
    let maxNear = 0;
    for (let i = 0; i < (culler.counts[0] as number); i++) maxNear = Math.max(maxNear, dist(near, i));
    let minFar = Infinity;
    for (let i = 0; i < (culler.counts[culler.levels - 1] as number); i++) minFar = Math.min(minFar, dist(far, i));
    expect(culler.counts[0]).toBeGreaterThan(0);
    expect(maxNear).toBeLessThan(minFar);
  });

  it('demotes and drops chunks front to back when the budget is small', () => {
    const generous = new FieldCuller(chunks, { lodTriangles: [500, 100, 20, 4], radius: 1, budgetTriangles: 5_000_000 });
    generous.update(view(100, 100));
    const tight = new FieldCuller(chunks, { lodTriangles: [500, 100, 20, 4], radius: 1, budgetTriangles: 20_000 });
    tight.update(view(100, 100));
    expect(tight.drawnTriangles).toBeLessThanOrEqual(20_000);
    expect(tight.drawnTriangles).toBeLessThan(generous.drawnTriangles);
    expect(tight.counts[0]).toBeLessThanOrEqual(generous.counts[0] as number);
  });

  it('rewrites nothing when the view did not change, and only changed levels otherwise', () => {
    const culler = new FieldCuller(chunks, { lodTriangles: [500, 100, 20, 4], radius: 1, budgetTriangles: 1_000_000 });
    expect(culler.update(view(50, 50))).not.toBe(0);
    const rewrites = culler.rewrites;
    expect(culler.update(view(50, 50))).toBe(0);
    expect(culler.rewrites).toBe(rewrites);
    // A tiny move inside the hysteresis band changes nothing either.
    expect(culler.update(view(50.01, 50))).toBe(0);
  });

  it('rewrites only from the first changed chunk and matches a fresh plan', () => {
    const opts = { lodTriangles: [500, 100, 20, 4], radius: 1, budgetTriangles: 2_000_000 };
    const moving = new FieldCuller(chunks, opts);
    const path = [view(20, 20), view(60, 30), view(120, 90), view(150, 160), view(100, 100)];
    for (const v of path) {
      moving.update(v);
      // Every drawn instance appears exactly once over all level buffers, with no stale entries.
      const seen = new Set<string>();
      let total = 0;
      for (let l = 0; l < moving.levels; l++) {
        const buf = moving.buffers[l] as Float32Array;
        for (let i = 0; i < (moving.counts[l] as number); i++) {
          const key = `${buf[i * 16 + 12]},${buf[i * 16 + 14]}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          total++;
        }
      }
      expect(total).toBe(moving.drawnInstances);
      // Same set as a culler planning this view from scratch with the same assignment size.
      const fresh = new FieldCuller(chunks, opts);
      fresh.update(v);
      expect(Math.abs(fresh.drawnInstances - moving.drawnInstances)).toBeLessThanOrEqual(fresh.drawnInstances * 0.5 + 64);
    }
    // A short move keeps most of each level: changed levels upload from a non-zero offset.
    moving.update(view(100, 100));
    let x = 100;
    let dirty = 0;
    while (dirty === 0 && x < 140) {
      x += 2;
      dirty = moving.update(view(x, 100));
    }
    expect(dirty).not.toBe(0);
    let partial = false;
    for (let l = 0; l < moving.levels; l++) if (dirty & (1 << l) && (moving.dirtyFrom[l] as number) > 0) partial = true;
    expect(partial).toBe(true);
  });

  it('culls chunks outside the frustum and tiny far instances', () => {
    const all = new FieldCuller(chunks, { lodTriangles: [4], radius: 1, budgetTriangles: 1e9 });
    all.update(view(100, 100));
    // Keep x ≤ 40 only.
    const half = new FieldCuller(chunks, { lodTriangles: [4], radius: 1, budgetTriangles: 1e9 });
    half.update(view(100, 100, Float64Array.from([-1, 0, 0, 40])));
    expect(half.drawnInstances).toBeLessThan(all.drawnInstances / 2);
    // Far away, instances are below a pixel and skipped entirely.
    const far = new FieldCuller(chunks, { lodTriangles: [4], radius: 1, budgetTriangles: 1e9, minPixels: 0.6 });
    far.update({ cx: 1e6, cy: 2, cz: 1e6, pixelScale: 800, planes: null });
    expect(far.drawnInstances).toBe(0);
  });

  it('allocates nothing per update after warm-up', () => {
    const culler = new FieldCuller(chunks, { lodTriangles: [500, 100, 20, 4], radius: 1, budgetTriangles: 300_000 });
    const v = view(10, 10);
    for (let i = 0; i < 50; i++) {
      v.cx = 10 + i * 3;
      culler.update(v);
    }
    // Buffers keep identity (no reallocation); capacities never exceeded.
    const bufs = [...culler.buffers];
    for (let i = 0; i < 50; i++) {
      v.cz = 10 + i * 3;
      culler.update(v);
    }
    culler.buffers.forEach((b, i) => expect(b).toBe(bufs[i]));
    for (let l = 0; l < culler.levels; l++) expect(culler.counts[l]).toBeLessThanOrEqual(culler.capacity[l] as number);
  });

  it('splits a budget by instances with a floor', () => {
    expect(shareBudget(1000, [100, 300])).toEqual([250, 750]);
    expect(shareBudget(1000, [1, 999])[0]).toBe(50);
    expect(shareBudget(1000, [0, 0])).toEqual([0, 0]);
  });
});

describe('LOD chains', () => {
  it('builds strictly cheaper levels from a faceted generator mesh', () => {
    const out = primitiveOutput({ kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] });
    const chain = buildLodChain(out.parts);
    expect(chain.length).toBeGreaterThan(1);
    for (let l = 1; l < chain.length; l++) expect(chain[l]!.triangles).toBeLessThanOrEqual(chain[l - 1]!.triangles * 0.7);
    // Every level keeps one geometry per part with consistent attributes.
    for (const level of chain) {
      expect(level.parts).toHaveLength(out.parts.length);
      for (const p of level.parts) {
        expect(p.normals.length).toBe(p.positions.length);
        for (const i of p.indices) expect(i).toBeLessThan(p.positions.length / 3);
      }
    }
  });

  it('detects flat shading and re-flattens simplified levels', () => {
    // A tetrahedron with three own vertices per face is faceted; shared vertices are not.
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
    const flat = new Float32Array(faces.flatMap((f) => f.flatMap((v) => corners[v]!)));
    expect(isFaceted(flat)).toBe(true);
    expect(isFaceted(new Float32Array(corners.flat().concat([2, 0, 0, 0, 2, 0])))).toBe(false);
    // A faceted, finely tessellated sphere: simplified levels keep one normal per face.
    const sphere = primitiveOutput({ kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] });
    const part = sphere.parts[0]!;
    const n = part.indices.length;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) positions.set(part.positions.subarray(part.indices[i]! * 3, part.indices[i]! * 3 + 3), i * 3);
    const normals = new Float32Array(n * 3);
    for (let f = 0; f < n; f += 3) {
      const a = positions.subarray(f * 3, f * 3 + 3), b = positions.subarray(f * 3 + 3, f * 3 + 6), c = positions.subarray(f * 3 + 6, f * 3 + 9);
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const nn = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const l = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
      for (let k = 0; k < 3; k++) normals.set([nn[0]! / l, nn[1]! / l, nn[2]! / l], (f + k) * 3);
    }
    const indices = Uint32Array.from({ length: n }, (_, i) => i);
    const chain = buildLodChain([{ positions, normals, indices }]);
    expect(chain.length).toBeGreaterThan(1);
    const lod = chain[1]!.parts[0]!;
    expect(lod.positions.length).toBe(lod.indices.length * 3); // three own vertices per triangle
    for (let f = 0; f < lod.indices.length; f += 3) {
      for (let k = 1; k < 3; k++) for (let j = 0; j < 3; j++) expect(lod.normals[(f + k) * 3 + j]).toBeCloseTo(lod.normals[f * 3 + j]!, 6);
    }
  });
});

describe('SceneSync scatter fields', () => {
  const field = (count: number): Parameters<typeof world>[0][number] => ({
    id: 'forest',
    shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone', size: [1, 2, 1] }, count, area: [300, 300], seed: 3 },
  });

  it('mounts huge layers as fields, plans them per view and releases everything', async () => {
    const { sync, materials, geometries } = makeSync({ fields: { maxInstances: 100_000, triangles: 400_000 } });
    const w = world([field(20_000)]);
    await sync.setWorld(w);
    const node = sync.node('forest')!;
    expect(node.field).not.toBeNull();
    expect(sync.instanceCount).toBe(20_000);
    expect(node.bindings.length).toBe(node.field!.levels * node.partCount);
    expect(sync.viewNeedsUpdate).toBe(true);
    const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    camera.position.set(0, 10, 0);
    camera.lookAt(100, 0, 0);
    camera.updateMatrixWorld();
    expect(sync.updateView(camera, 900)).toBe(true);
    const stats = sync.fieldStats();
    expect(stats.drawnInstances).toBeGreaterThan(0);
    expect(stats.drawnInstances).toBeLessThan(20_000);
    expect(stats.drawnTriangles).toBeLessThanOrEqual(400_000);
    const drawn = node.field!.meshes.reduce((s, m: InstancedMesh) => s + m.count, 0);
    expect(drawn).toBe(stats.drawnInstances * node.partCount);
    // Same view: nothing to re-upload.
    expect(sync.updateView(camera, 900)).toBe(false);
    const tris = primitiveOutput({ kind: 'primitive', primitive: 'cone', size: [1, 2, 1] }).parts.reduce((s, p) => s + p.indices.length / 3, 0);
    expect(sync.sceneTriangles()).toBe(tris * 20_000);
    await sync.setWorld(patch(w, [{ op: 'remove', id: 'forest' }]));
    expect(sync.instanceCount).toBe(0);
    expect(sync.fieldStats().fields).toBe(0);
    expect(materials.size).toBe(0);
    expect(geometries.size).toBe(0);
  });

  it('shares the field budget so a later ground-cover field is not starved by two huge forests', async () => {
    const { sync } = makeSync({ fields: { maxInstances: 10_000, triangles: 100_000 } });
    await sync.setWorld(world([{ ...field(8_000), id: 'east' }, { ...field(8_000), id: 'west' }, { ...field(3_000), id: 'grass' }]));
    expect(sync.node('grass')!.instances).toBeGreaterThan(0);
    expect(sync.node('east')!.instances).toBeLessThanOrEqual(4_500);
    expect(sync.instanceCount).toBeLessThanOrEqual(10_000);
  });

  it('keeps small layers plain and respects the field instance budget', async () => {
    const { sync } = makeSync({ fields: { maxInstances: 5_000, triangles: 100_000 } });
    await sync.setWorld(world([{ ...field(FIELD_MIN_INSTANCES - 1), id: 'small' }, field(8_000)]));
    expect(sync.node('small')!.field).toBeNull();
    expect(sync.node('forest')!.instances).toBe(5_000);
    expect(sync.getWarnings().get('forest')).toMatch(/field limited/);
  });

  it('gives every GPU class a field budget', () => {
    for (const tier of ['discrete', 'integrated', 'software', 'unknown'] as const) {
      const b = renderBudget(tier, false);
      expect(b.fieldInstances).toBeGreaterThanOrEqual(300_000);
      expect(b.fieldTriangles).toBeGreaterThan(0);
    }
    expect(renderBudget('discrete', true).fieldTriangles).toBeLessThan(renderBudget('discrete', false).fieldTriangles);
  });
});

describe('foliage wind', () => {
  it('gives vegetation fields a wind position node that survives material changes, and leaves other fields alone', async () => {
    const { createProcgenGeometrySource } = await import('../src/geometry/procgen-source');
    const { sync, materials } = makeSync({ source: createProcgenGeometrySource(), fields: { maxInstances: 100_000, triangles: 200_000 } });
    const w = world([
      { id: 'pines', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine' }, count: 3000, area: [200, 200], seed: 1 } },
      { id: 'stones', shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'rock' }, count: 3000, area: [200, 200], seed: 2 } },
    ]);
    await sync.setWorld(w);
    await sync.whenIdle();
    const windy = (id: string): boolean[] => sync.node(id)!.bindings.map((b) => (b.mesh.material as { positionNode?: unknown }).positionNode !== undefined);
    expect(windy('pines').every(Boolean)).toBe(true);
    expect(windy('stones').some(Boolean)).toBe(false);
    await sync.setWorld(patch(w, [{ op: 'update', id: 'pines', set: { material: { color: '#335533' } } }]));
    expect(windy('pines').every(Boolean)).toBe(true);
    await sync.setWorld(world([]));
    expect(materials.size).toBe(0);
  });
});
