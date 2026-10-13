import { describe, expect, it } from 'vitest';
import { encodeMesh, decodeMesh, type MeshData } from '@aether/core';
import {
  bakeOutput,
  ComputeClient,
  deleteFaces,
  extrudeFaces,
  faceEdges,
  faceVertices,
  flipFaces,
  generateBuiltinSync,
  insetFaces,
  mergeByDistance,
  meshColliders,
  meshHealth,
  orientOutward,
  runMeshOp,
  SculptSession,
  signedVolume,
  smoothMesh,
  softWeights,
  subdivide,
  transformVertices,
  unwrapUVs,
  falloffWeight,
  type WorkerLike,
} from '../src/index';

/** Unit cube with split vertices per face (24 vertices, like generator output). */
function splitCube(): MeshData {
  const faces: Array<[number[], number[], number[], number[]]> = [
    [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], // +z
    [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]], // -z
    [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]], // +x
    [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]], // -x
    [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]], // +y
    [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], // -y
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  faces.forEach((quad, f) => {
    for (const v of quad) positions.push(...v);
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), colors: null, uvs: null, faceMaterials: null };
}

/** Triangles of the +y face (indices 8, 9 in splitCube order). */
const TOP = [8, 9];

describe('mesh topology', () => {
  it('reports a split cube as a closed manifold with volume 1', () => {
    const cube = splitCube();
    const h = meshHealth(cube);
    expect(h.closed).toBe(true);
    expect(h.vertices).toBe(24);
    expect(signedVolume(cube)).toBeCloseTo(1, 5);
  });
});

describe('extrude', () => {
  it('raises the top face and keeps the cube closed', () => {
    const out = extrudeFaces(splitCube(), TOP, 0.5);
    const h = meshHealth(out);
    expect(h.closed).toBe(true);
    expect(h.degenerate).toBe(0);
    expect(h.triangles).toBe(12 + 4 * 2);
    expect(signedVolume(out)).toBeCloseTo(1.5, 5);
    let maxY = -Infinity;
    for (let i = 1; i < out.positions.length; i += 3) maxY = Math.max(maxY, out.positions[i] as number);
    expect(maxY).toBeCloseTo(1, 5);
  });

  it('pushes the face in (negative distance) and stays outward-facing', () => {
    const out = extrudeFaces(splitCube(), TOP, -0.25);
    expect(meshHealth(out).closed).toBe(true);
    expect(signedVolume(out)).toBeCloseTo(0.75, 5);
  });

  it('never mutates the input', () => {
    const cube = splitCube();
    const copy = cube.positions.slice();
    extrudeFaces(cube, TOP, 1);
    expect([...cube.positions]).toEqual([...copy]);
  });
});

describe('inset', () => {
  it('insets faces watertight', () => {
    const out = insetFaces(splitCube(), TOP, 0.3);
    const h = meshHealth(out);
    expect(h.closed).toBe(true);
    expect(h.triangles).toBe(12 + 2 * 6);
    expect(signedVolume(out)).toBeCloseTo(1, 5);
  });
});

describe('subdivide', () => {
  it('splits every face into four (simple) and keeps the volume', () => {
    const out = subdivide(splitCube());
    expect(meshHealth(out).closed).toBe(true);
    expect(out.indices.length / 3).toBe(48);
    expect(signedVolume(out)).toBeCloseTo(1, 5);
  });

  it('subdivides a selection without cracks (neighbours are split too)', () => {
    const out = subdivide(splitCube(), TOP);
    const h = meshHealth(out);
    expect(h.closed).toBe(true);
    expect(h.degenerate).toBe(0);
    expect(signedVolume(out)).toBeCloseTo(1, 5);
  });

  it('Loop subdivision shrinks a cube toward a sphere and stays closed', () => {
    const out = subdivide(splitCube(), null, { smooth: true });
    expect(meshHealth(out).closed).toBe(true);
    const v = signedVolume(out);
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(1);
  });
});

describe('smooth', () => {
  it('relaxes a spike (Laplacian) and keeps split copies together', () => {
    const cube = splitCube();
    const spiked = extrudeFaces(cube, TOP, 2);
    const out = smoothMesh(spiked, { iterations: 4, factor: 0.5 });
    let maxBefore = -Infinity;
    let maxAfter = -Infinity;
    for (let i = 1; i < spiked.positions.length; i += 3) maxBefore = Math.max(maxBefore, spiked.positions[i] as number);
    for (let i = 1; i < out.positions.length; i += 3) maxAfter = Math.max(maxAfter, out.positions[i] as number);
    expect(maxAfter).toBeLessThan(maxBefore);
    expect(meshHealth(out).closed).toBe(true);
  });

  it('respects soft-selection weights', () => {
    const cube = splitCube();
    const out = smoothMesh(cube, { iterations: 3, weights: new Float32Array(24) });
    expect([...out.positions]).toEqual([...cube.positions]);
  });
});

describe('merge, delete, flip, orient, unwrap', () => {
  it('merges split vertices by distance', () => {
    const r = mergeByDistance(splitCube(), 1e-4);
    expect(r.removed).toBe(16);
    expect(r.mesh.positions.length / 3).toBe(8);
    expect(meshHealth(r.mesh).closed).toBe(true);
  });

  it('deletes faces and opens a boundary', () => {
    const out = deleteFaces(splitCube(), TOP);
    const h = meshHealth(out);
    expect(h.triangles).toBe(10);
    expect(h.boundaryEdges).toBe(4);
    expect(h.vertices).toBe(20);
  });

  it('flips normals and recomputes them outward', () => {
    const flipped = flipFaces(splitCube());
    expect(signedVolume(flipped)).toBeCloseTo(-1, 5);
    const r = orientOutward(flipped);
    expect(signedVolume(r.mesh)).toBeCloseTo(1, 5);
    expect(r.flipped).toBe(12);
    const partly = flipFaces(splitCube(), [0, 5, 9]);
    const fixed = orientOutward(partly);
    expect(signedVolume(fixed.mesh)).toBeCloseTo(1, 5);
    expect(fixed.flipped).toBe(3);
  });

  it('box-unwraps UVs per face axis', () => {
    const out = unwrapUVs(splitCube(), 'box', 2);
    expect(out.uvs).not.toBeNull();
    expect(out.uvs!.length).toBe((out.positions.length / 3) * 2);
    for (const u of out.uvs!) expect(Math.abs(u)).toBeLessThanOrEqual(1.0001);
    expect(meshHealth(out).closed).toBe(true);
  });
});

describe('selection helpers', () => {
  it('expands face vertices to split copies and lists unique edges', () => {
    const cube = splitCube();
    const verts = faceVertices(cube, TOP);
    // 4 corners of the top face, each with 3 split copies.
    expect(verts.size).toBe(12);
    expect(faceEdges(cube, TOP).length / 2).toBe(5);
  });

  it('soft weights fall off with distance', () => {
    const cube = splitCube();
    const w = softWeights(cube, [8], 0.9);
    expect(w[8]).toBe(1);
    expect(Math.max(...w.filter((_, i) => i !== 8 && w[i]! < 1))).toBeLessThan(1);
    expect(falloffWeight('linear', 0.25)).toBeCloseTo(0.75);
    expect(falloffWeight('smooth', 1)).toBe(0);
  });

  it('transforms weighted vertices', () => {
    const cube = splitCube();
    const w = new Float32Array(24);
    w[0] = 1;
    w[1] = 0.5;
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1];
    const out = transformVertices(cube.positions, w, translate);
    expect(out[1]).toBeCloseTo((cube.positions[1] as number) + 2);
    expect(out[4]).toBeCloseTo((cube.positions[4] as number) + 1);
    expect(out[7]).toBe(cube.positions[7]);
  });
});

describe('sculpt and paint', () => {
  function grid(n = 20): MeshData {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) positions.push(x - n / 2, 0, z - n / 2);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const a = z * (n + 1) + x;
        indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), colors: null, uvs: null, faceMaterials: null };
  }

  it('raises, smooths and flattens terrain and reports dirty ranges', () => {
    const s = new SculptSession(grid());
    const dab = { center: [0, 0, 0] as const, normal: [0, 1, 0] as const, radius: 3, strength: 1 };
    expect(s.sculpt('raise', dab)).toBeGreaterThan(0);
    const centre = 10 * 21 + 10;
    const raised = s.data.positions[centre * 3 + 1] as number;
    expect(raised).toBeCloseTo(0.45, 5);
    const dirty = s.takeDirty();
    expect(dirty).not.toBeNull();
    expect(s.takeDirty()).toBeNull();
    s.sculpt('smooth', dab);
    expect(s.data.positions[centre * 3 + 1] as number).toBeLessThan(raised);
    const flat = new SculptSession(s.data);
    flat.sculpt('flatten', { ...dab, center: [5, 0, 5] });
    for (let i = 0; i < 6; i++) flat.sculpt('flatten', { ...dab, center: [0, 0, 0], strength: 1 });
    expect(Math.abs(flat.data.positions[centre * 3 + 1] as number)).toBeLessThan(raised);
  });

  it('noise is deterministic per seed and paint blends colours', () => {
    const a = new SculptSession(grid(), { seed: 7 });
    const b = new SculptSession(grid(), { seed: 7 });
    const dab = { center: [1, 0, 1] as const, normal: [0, 1, 0] as const, radius: 4, strength: 0.8 };
    a.sculpt('noise', dab);
    b.sculpt('noise', dab);
    expect([...a.data.positions]).toEqual([...b.data.positions]);
    const p = new SculptSession(grid());
    expect(p.paint([1, 0, 0], { ...dab, falloff: 'constant', strength: 1 })).toBeGreaterThan(0);
    const c = p.data.colors!;
    const centre = 11 * 21 + 11;
    expect([c[centre * 3], c[centre * 3 + 1], c[centre * 3 + 2]]).toEqual([1, 0, 0]);
    expect(c[0]).toBe(1);
    p.paint([0, 0, 1], { ...dab, falloff: 'constant', strength: 1 }, true);
    expect(c[centre * 3 + 1]).toBe(1);
  });
});

describe('bake and colliders', () => {
  it('bakes a generator output into one mesh with material slots that round-trips the codec', () => {
    const out = generateBuiltinSync('house', {}, 3);
    const baked = bakeOutput(out);
    const verts = out.parts.reduce((n, p) => n + p.positions.length / 3, 0);
    expect(baked.data.positions.length / 3).toBe(verts);
    expect(baked.materials.length).toBeGreaterThan(1);
    const asset = encodeMesh('house-mesh', baked.data, { materials: baked.materials, source: { shape: { kind: 'procedural', generator: 'house', params: {}, seed: 3 } } });
    const back = decodeMesh(asset);
    expect(back.indices.length).toBe(baked.data.indices.length);
    expect(back.faceMaterials).not.toBeNull();
  });

  it('builds trimesh colliders for static and hulls for dynamic bodies', () => {
    const cube = splitCube();
    const [stat] = meshColliders(cube, 'static');
    expect(stat!.kind).toBe('trimesh');
    const [dyn] = meshColliders(cube, 'dynamic');
    expect(dyn!.kind).toBe('hull');
  });
});

describe('runMeshOp', () => {
  it('validates operations and results', () => {
    expect(() => runMeshOp({ kind: 'extrude', faces: [], distance: 1 }, splitCube())).toThrow(/invalid mesh operation/);
    expect(() => runMeshOp({ kind: 'extrude', faces: [0], distance: Number.NaN }, splitCube())).toThrow(/invalid mesh operation/);
    const r = runMeshOp({ kind: 'merge', distance: 0.001 }, splitCube());
    expect(r.note).toMatch(/Merged 16 vertices/);
  });

  it('refuses results above the vertex limit', () => {
    let m = splitCube();
    expect(() => {
      for (let i = 0; i < 12; i++) m = subdivide(m);
    }).toThrow(/vertices|triangles/);
  });
});

describe('ComputeClient', () => {
  it('runs inline without workers', async () => {
    const c = new ComputeClient({ createWorker: null });
    expect(c.usesWorker).toBe(false);
    const r = await c.meshOp({ kind: 'extrude', faces: TOP, distance: 1 }, splitCube());
    expect(meshHealth(r.mesh).closed).toBe(true);
    const out = await c.generate('rock', {}, 2);
    expect(out.parts.length).toBeGreaterThan(0);
    c.dispose();
  });

  it('times out a stuck worker, rejects and terminates it', async () => {
    let terminated = 0;
    const fake: WorkerLike = { postMessage: () => undefined, terminate: () => void terminated++, onmessage: null, onerror: null };
    const c = new ComputeClient({ createWorker: () => fake, timeoutMs: 100 });
    await expect(c.meshOp({ kind: 'orient' }, splitCube())).rejects.toThrow(/longer than/);
    expect(terminated).toBe(1);
    c.dispose();
  });

  it('rejects malformed worker replies', async () => {
    let worker: WorkerLike | null = null;
    const fake: WorkerLike = {
      postMessage: (msg: unknown) => {
        const id = (msg as { id: number }).id;
        queueMicrotask(() => worker?.onmessage?.({ data: { type: 'mesh', id, ok: true, mesh: { positions: 'x' } } } as MessageEvent));
      },
      terminate: () => undefined,
      onmessage: null,
      onerror: null,
    };
    worker = fake;
    const c = new ComputeClient({ createWorker: () => fake });
    await expect(c.meshOp({ kind: 'orient' }, splitCube())).rejects.toThrow(/invalid mesh data/);
    c.dispose();
  });

  it('does not transfer (detach) the caller mesh', async () => {
    const posted: unknown[] = [];
    const fake: WorkerLike = { postMessage: (m: unknown) => void posted.push(m), terminate: () => undefined, onmessage: null, onerror: null };
    const c = new ComputeClient({ createWorker: () => fake, timeoutMs: 100 });
    const cube = splitCube();
    const p = c.meshOp({ kind: 'orient' }, cube);
    expect(cube.positions.length).toBe(72);
    await expect(p).rejects.toThrow();
    c.dispose();
  });
});
