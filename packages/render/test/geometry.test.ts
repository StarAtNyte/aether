import { describe, expect, it } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, type Object3D } from 'three';
import { createWorld } from '@aether/core';
import { GeneratorCache, primitiveOutput } from '@aether/procgen';
import { GeometryCache, InvalidMeshError, partKey, partToBufferGeometry } from '../src/geometry/buffer-geometry';
import { createProcgenGeometrySource, primitiveKey } from '../src/geometry/procgen-source';
import { ModelCache, instantiateModel, isSafeModelUrl, type ModelLoader } from '../src/geometry/model-loader';
import { buildHeightGrid, transformPositions } from '../src/geometry/height-grid';
import type { MeshPart } from '../src/types';

function boxPart(): MeshPart {
  const out = primitiveOutput({ kind: 'primitive', primitive: 'box', size: [2, 1, 1] });
  return out.parts[0] as MeshPart;
}

describe('partToBufferGeometry', () => {
  it('converts attributes and indices without copying vertex arrays', () => {
    const part = boxPart();
    const g = partToBufferGeometry(part);
    expect(g.getAttribute('position').count).toBe(part.positions.length / 3);
    expect(g.getAttribute('position').array).toBe(part.positions);
    expect(g.getAttribute('normal').array).toBe(part.normals);
    expect(g.getIndex()?.count).toBe(part.indices.length);
    expect(g.getIndex()?.array).toBeInstanceOf(Uint16Array);
    expect(g.boundingBox?.max.x).toBeCloseTo(1);
    expect(g.boundingSphere).not.toBeNull();
  });

  it('keeps 32-bit indices for large meshes', () => {
    const n = 70_000;
    const g = partToBufferGeometry({ positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), indices: new Uint32Array([0, 1, 69_999]), material: {} });
    expect(g.getIndex()?.array).toBeInstanceOf(Uint32Array);
  });

  it('adds uv and color attributes only when lengths match', () => {
    const part = boxPart();
    const vc = part.positions.length / 3;
    const g = partToBufferGeometry({ ...part, uvs: new Float32Array(vc * 2), colors: new Float32Array(vc * 3 - 3) });
    expect(g.getAttribute('uv')).toBeDefined();
    expect(g.getAttribute('color')).toBeUndefined();
  });

  it('computes normals when missing and rejects malformed arrays', () => {
    const part = boxPart();
    const g = partToBufferGeometry({ ...part, normals: new Float32Array(3) });
    expect(g.getAttribute('normal').count).toBe(part.positions.length / 3);
    expect(() => partToBufferGeometry({ ...part, positions: new Float32Array(4) })).toThrow(InvalidMeshError);
    expect(() => partToBufferGeometry({ ...part, indices: new Uint32Array(4) })).toThrow(InvalidMeshError);
  });
});

describe('GeometryCache', () => {
  it('refcounts per output key + part index', () => {
    const cache = new GeometryCache();
    const part = boxPart();
    const a = cache.acquire('k', 0, part);
    const b = cache.acquire('k', 0, part);
    expect(a.geometry).toBe(b.geometry);
    expect(a.key).toBe(partKey('k', 0));
    expect(cache.acquire('k', 1, part).geometry).not.toBe(a.geometry);
    cache.release(a.key);
    expect(cache.refs(a.key)).toBe(1);
    cache.release(a.key);
    expect(cache.refs(a.key)).toBe(0);
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe('createProcgenGeometrySource', () => {
  it('memoizes primitives by stable key (same sizes as physics)', () => {
    const src = createProcgenGeometrySource();
    const shape = { kind: 'primitive' as const, primitive: 'cylinder' as const, size: [1, 2, 1] as [number, number, number] };
    const a = src.primitive(shape);
    expect(a.key).toBe(primitiveKey(shape));
    expect(src.primitive({ ...shape, size: [1, 2, 1] })).toBe(a);
    expect(a.output.bounds.max[1]).toBeCloseTo(1);
  });

  it('generates built-in procedural shapes with cache keys', async () => {
    const src = createProcgenGeometrySource({ cache: new GeneratorCache(8) });
    const w = createWorld({});
    const shape = { kind: 'procedural' as const, generator: 'rock', params: {}, seed: 3 };
    const a = await src.procedural(shape, w);
    expect(a.key.startsWith('proc|rock|3|')).toBe(true);
    expect(a.output.parts.length).toBeGreaterThan(0);
    const b = await src.procedural(shape, w);
    expect(b.output).toBe(a.output);
  });

  it('rejects unknown generators and custom ones without a sandbox', async () => {
    const src = createProcgenGeometrySource();
    await expect(src.procedural({ kind: 'procedural', generator: 'no-such-thing', params: {} }, createWorld({}))).rejects.toThrow();
    const w = createWorld({ generators: { thing: { id: 'thing', description: 'x', source: 'return api.build();' } } });
    await expect(src.procedural({ kind: 'procedural', generator: 'thing', params: {} }, w)).rejects.toThrow(/sandbox/);
    expect(src.fallback('x').output.parts.length).toBeGreaterThan(0);
  });
});

describe('model loading', () => {
  it('allowlists model URLs', () => {
    for (const ok of ['/models/a.glb', './a.glb', 'blob:https://x/1', 'models/tree.glb', 'data:model/gltf-binary;base64,AAAA']) {
      expect(isSafeModelUrl(ok), ok).toBe(true);
    }
    // Arbitrary hosts (tracking / IP leaks) and plain http are rejected unless allowlisted.
    for (const bad of ['https://cdn.example.com/a.glb', 'http://localhost:5173/m.gltf', 'https://user:pw@x/a.glb', 'javascript:alert(1)', 'file:///etc/passwd', '//evil.com/a.glb', 'data:text/html;base64,AAAA', 'ftp://x/a.glb', '', ' https://x/a.glb', 'a b.glb', 'x'.repeat(3000), 'https://x/a\\b.glb']) {
      expect(isSafeModelUrl(bad), bad).toBe(false);
    }
  });

  it('normalizes models: fit size, centered, resting on y=0, sharing geometry', () => {
    const src = new Group();
    const mesh = new Mesh(new BoxGeometry(4, 2, 2), new MeshBasicMaterial());
    mesh.position.set(10, 5, -3);
    src.add(mesh);
    const inst = instantiateModel(src, 2);
    inst.updateMatrixWorld(true);
    const clone = inst.children[0] as Object3D;
    const m = clone.children[0] as Mesh;
    expect(m.geometry).toBe(mesh.geometry);
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    expect(b.max.x - b.min.x).toBeCloseTo(2);
    expect(b.min.y).toBeCloseTo(0);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0);
  });

  it('caches loads per URL and disposes the source when released', async () => {
    let loads = 0;
    const geometry = new BoxGeometry(1, 1, 1);
    let disposed = 0;
    geometry.addEventListener('dispose', () => disposed++);
    const loader: ModelLoader = {
      load: async () => {
        loads++;
        const g = new Group();
        g.add(new Mesh(geometry, new MeshBasicMaterial()));
        return g;
      },
    };
    const cache = new ModelCache(loader);
    const a = cache.acquire('/a.glb');
    const b = cache.acquire('/a.glb');
    expect(await a).toBe(await b);
    expect(loads).toBe(1);
    cache.release('/a.glb');
    cache.release('/a.glb');
    await Promise.resolve();
    await Promise.resolve();
    expect(disposed).toBe(1);
    await expect(cache.acquire('javascript:alert(1)')).rejects.toThrow(/rejected/);
    expect(loads).toBe(1);
  });
});

describe('height grid', () => {
  it('rasterizes the top surface and samples bilinearly', () => {
    // A 10x10 slope: y = x / 10 over x in [0, 10].
    const positions = new Float32Array([0, 0, 0, 10, 1, 0, 10, 1, 10, 0, 0, 10]);
    const indices = new Uint32Array([0, 2, 1, 0, 3, 2]);
    const grid = buildHeightGrid([{ positions, indices }], 64)!;
    expect(grid.sample(5, 5)).toBeCloseTo(0.5, 1);
    expect(grid.sample(2.5, 7)).toBeCloseTo(0.25, 1);
    expect(Number.isNaN(grid.sample(50, 5))).toBe(true);
  });

  it('keeps the highest of overlapping surfaces', () => {
    const quad = (y: number): { positions: Float32Array; indices: Uint32Array } => ({
      positions: new Float32Array([-1, y, -1, 1, y, -1, 1, y, 1, -1, y, 1]),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    });
    const grid = buildHeightGrid([quad(1), quad(3)], 32)!;
    expect(grid.sample(0, 0)).toBeCloseTo(3);
  });

  it('transforms positions by a matrix and returns null for empty input', () => {
    const m = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 5, 1, 0, 1];
    expect(Array.from(transformPositions(new Float32Array([1, 1, 1]), m))).toEqual([6, 3, 1]);
    expect(buildHeightGrid([])).toBeNull();
  });

  it('rasterizes a 200k-triangle terrain quickly', () => {
    const n = 316;
    const positions = new Float32Array((n + 1) * (n + 1) * 3);
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
      const i = (z * (n + 1) + x) * 3;
      positions[i] = x;
      positions[i + 1] = Math.sin(x * 0.1) + Math.cos(z * 0.1);
      positions[i + 2] = z;
    }
    const indices = new Uint32Array(n * n * 6);
    let k = 0;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x;
      indices.set([a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2], k);
      k += 6;
    }
    const t0 = performance.now();
    const grid = buildHeightGrid([{ positions, indices }])!;
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(grid.sample(100.3, 50.7)).toBeCloseTo(Math.sin(10.03) + Math.cos(5.07), 1);
  });
});
