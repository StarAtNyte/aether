import { describe, expect, it } from 'vitest';
import { Color, type BufferAttribute, type Mesh, type Object3D } from 'three';
import { VoxelLayer, type VoxelMeshPass } from '../src/voxel/voxel-layer';

const ATLAS = 16;

function layerWithAtlas(): VoxelLayer {
  const layer = new VoxelLayer();
  layer.setAtlas(new Uint8Array(ATLAS * ATLAS * 4).fill(200), ATLAS, new Uint16Array(3));
  return layer;
}

describe('VoxelLayer terrain fog', () => {
  it('sets the fog uniforms and bumps the version only on change', () => {
    const layer = layerWithAtlas();
    const fog = new Color(0.5, 0.6, 0.7);
    const v0 = layer.version;
    layer.setFog(fog, 64, 128, 0);
    const v1 = layer.version;
    expect(v1).toBeGreaterThan(v0);
    layer.setFog(fog, 64, 128, 0);
    expect(layer.version).toBe(v1);
    layer.setFogOrigin(10, -4);
    const v2 = layer.version;
    expect(v2).toBeGreaterThan(v1);
    layer.setFogOrigin(10, -4);
    expect(layer.version).toBe(v2);
    layer.dispose();
  });

  it('rejects non-finite values (the fade stays well-formed)', () => {
    const layer = layerWithAtlas();
    const v = layer.version;
    layer.setFogOrigin(Number.NaN, 0);
    expect(layer.version).toBe(v);
    // far ≤ near or NaN: clamped to a valid fade instead of a division by zero in the shader.
    expect(() => layer.setFog(new Color(), 50, Number.NaN, Number.POSITIVE_INFINITY)).not.toThrow();
    layer.dispose();
  });

  it('ignores fog before the atlas (no materials yet)', () => {
    const layer = new VoxelLayer();
    const v = layer.version;
    layer.setFog(new Color(), 1, 2, 0);
    layer.setFogOrigin(1, 2);
    expect(layer.version).toBe(v);
    layer.dispose();
  });
});

function quadPass(): VoxelMeshPass {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
    uvs: new Float32Array(8),
    data: new Uint8Array(16),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
    quads: 1,
  };
}

describe('VoxelLayer chunk pre-build', () => {
  it('builds new chunk meshes in one compiler call per frame, even outside the view (regression: 120 ms first-draw stalls)', () => {
    const layer = layerWithAtlas();
    const calls: Array<{ names: string[]; culled: boolean[] }> = [];
    layer.setCompiler((o: Object3D) => {
      calls.push({ names: o.children.map((c) => c.name), culled: o.children.map((c) => c.frustumCulled) });
      return Promise.resolve();
    });
    calls.length = 0; // the atlas warm-up is not part of this test
    layer.setChunk(1, 2, 3, { opaque: quadPass(), cutout: quadPass(), liquid: null, minY: 0, maxY: 1 });
    layer.setChunk(2, 4, 3, { opaque: quadPass(), cutout: null, liquid: null, minY: 0, maxY: 1 });
    expect(calls).toHaveLength(0);
    layer.flushPrebuild();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.names).toEqual(['voxel:2,3:0', 'voxel:2,3:1', 'voxel:4,3:0']);
    // Culling is off during the (synchronous) projection only; the meshes stay in the chunk group.
    expect(calls[0]?.culled.every((c) => !c)).toBe(true);
    const group = layer.group.children.find((c) => c.name === 'aether:voxel-chunks');
    expect(group?.children).toHaveLength(3);
    expect(group?.children.every((c) => c.frustumCulled && c.parent === group)).toBe(true);
    // Nothing new: no call.
    layer.flushPrebuild();
    expect(calls).toHaveLength(1);
    layer.dispose();
  });

  it('skips chunks removed before the flush and frees removed chunks only after their pending pre-build', async () => {
    const layer = layerWithAtlas();
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    let compiled = 0;
    layer.setCompiler((o: Object3D) => {
      compiled += o.children.length;
      return pending;
    });
    compiled = 0;
    const group = layer.group.children.find((c) => c.name === 'aether:voxel-chunks');
    // Removed before its flush: freed at once and never compiled.
    layer.setChunk(6, 9, 9, { opaque: quadPass(), cutout: null, liquid: null, minY: 0, maxY: 1 });
    const early = group?.children[0] as Mesh;
    let earlyDisposed = 0;
    early.geometry.addEventListener('dispose', () => earlyDisposed++);
    layer.removeChunk(6);
    expect(earlyDisposed).toBe(1);
    layer.setChunk(7, 0, 0, { opaque: quadPass(), cutout: null, liquid: null, minY: 0, maxY: 1 });
    layer.flushPrebuild();
    expect(compiled).toBe(1);
    const mesh = group?.children[0] as Mesh;
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => disposed++);
    layer.removeChunk(7);
    expect(group?.children).toHaveLength(0);
    expect(disposed).toBe(0);
    finish();
    await pending;
    await Promise.resolve();
    expect(disposed).toBe(1);
    layer.dispose();
  });
});

describe('VoxelLayer chunk memory', () => {
  it('releases the CPU vertex copies once the pre-build uploaded them, keeping counts and bounds', async () => {
    const layer = layerWithAtlas();
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    layer.setCompiler(() => pending);
    layer.setChunk(1, 0, 0, { opaque: quadPass(), cutout: null, liquid: null, minY: 0, maxY: 1 });
    layer.flushPrebuild();
    const group = layer.group.children.find((c) => c.name === 'aether:voxel-chunks');
    const mesh = group?.children[0] as Mesh;
    const g = mesh.geometry;
    const version = (g.getAttribute('position') as BufferAttribute).version;
    // Not built yet: the arrays stay (the build reads them; regression: empty GPU buffers).
    mesh.onAfterRender(null as never, null as never, null as never, g, null as never, null as never);
    expect(g.getAttribute('position').array.length).toBe(12);
    finish();
    await pending;
    await Promise.resolve();
    expect(g.getAttribute('position').array.length).toBe(0);
    expect(g.getAttribute('uv').array.length).toBe(0);
    expect(g.getAttribute('data').array.length).toBe(0);
    expect(g.getIndex()?.array.length).toBe(0);
    expect(g.getAttribute('position').count).toBe(4);
    expect(g.getIndex()?.count).toBe(6);
    expect((g.getAttribute('position') as BufferAttribute).version).toBe(version);
    expect(g.boundingSphere).not.toBeNull();
    layer.dispose();
  });

  it('keeps the arrays when the build fails or without a compiler', async () => {
    const layer = layerWithAtlas();
    const failed = Promise.reject(new Error('device lost'));
    failed.catch(() => undefined);
    layer.setCompiler(() => failed);
    layer.setChunk(1, 0, 0, { opaque: quadPass(), cutout: null, liquid: null, minY: 0, maxY: 1 });
    layer.flushPrebuild();
    await failed.catch(() => undefined);
    await Promise.resolve();
    const group = layer.group.children.find((c) => c.name === 'aether:voxel-chunks');
    expect((group?.children[0] as Mesh).geometry.getAttribute('position').array.length).toBe(12);
    layer.setCompiler(null);
    layer.setChunk(2, 1, 0, { opaque: quadPass(), cutout: null, liquid: null, minY: 0, maxY: 1 });
    layer.flushPrebuild();
    expect((group?.children[1] as Mesh).geometry.getAttribute('position').array.length).toBe(12);
    layer.dispose();
  });
});

describe('VoxelLayer resource lifecycle', () => {
  it('frees every chunk geometry over 20 create/destroy cycles, with and without pending pre-builds', async () => {
    for (const withCompiler of [false, true]) {
      const layer = layerWithAtlas();
      if (withCompiler) layer.setCompiler(() => new Promise<void>((r) => setTimeout(r, 0)));
      let created = 0;
      let disposed = 0;
      const group = layer.group.children.find((c) => c.name === 'aether:voxel-chunks');
      for (let cycle = 0; cycle < 20; cycle++) {
        for (let k = 0; k < 4; k++) {
          layer.setChunk(k, k, cycle, { opaque: quadPass(), cutout: quadPass(), liquid: quadPass(), minY: 0, maxY: 1 });
        }
        for (const c of group?.children ?? []) {
          created++;
          (c as Mesh).geometry.addEventListener('dispose', () => disposed++);
        }
        layer.flushPrebuild();
        if (cycle % 2 === 0) await new Promise((r) => setTimeout(r, 1));
        for (let k = 0; k < 4; k++) layer.removeChunk(k);
        expect(group?.children).toHaveLength(0);
      }
      await new Promise((r) => setTimeout(r, 5));
      expect(created).toBe(20 * 4 * 3);
      expect(disposed).toBe(created);
      expect(layer.stats()).toMatchObject({ chunks: 0, triangles: 0 });
      layer.dispose();
    }
  });
});
