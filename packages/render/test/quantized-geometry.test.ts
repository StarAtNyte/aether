import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { installGpuQuantize, MAX_STEP, quantizeOnGpu, readsObjectSpace } from '../src/gpu/quantized-geometry';

/** A stand-in for three's WebGL2 backend and renderer: records what each attribute went up as and what each draw saw. */
function fakeRenderer() {
  const data = new Map<object, { bufferGPU: object; array: ArrayBufferView }>();
  const vaos: Array<Array<{ normalized: boolean; type: string }>> = [];
  const draws: Matrix4[] = [];
  const deleted: object[] = [];
  const backend = {
    isWebGLBackend: true,
    gl: { INT_2_10_10_10_REV: 0x8d9f },
    has: (o: object) => data.has(o),
    get: (o: object) => data.get(o) ?? ({} as { bufferGPU?: object }),
    attributeUtils: {
      createAttribute(a: BufferAttribute) {
        data.set(a, { bufferGPU: {}, array: a.array.slice() });
      },
      updateAttribute(a: BufferAttribute) {
        data.set(a, { bufferGPU: {}, array: a.array.slice() });
      },
    },
    _createVao(attributes: BufferAttribute[]) {
      vaos.push(attributes.map((a) => ({ normalized: a.normalized, type: data.get(a)!.array.constructor.name })));
      return {};
    },
  };
  const renderer = {
    backend,
    _currentSourceMaterial: null,
    _attributes: { delete: (a: object) => { deleted.push(a); data.delete(a); } },
    _geometries: { attributeCall: new WeakMap() },
    _renderObjectDirect(object: Mesh, _material?: unknown) {
      // three's draw: upload what is missing, make the vertex layout, read the world matrix.
      const g = object.geometry;
      const attrs = Object.values(g.attributes) as BufferAttribute[];
      for (const a of attrs) if (!data.has(a)) backend.attributeUtils.createAttribute(a);
      backend._createVao(attrs);
      draws.push(object.matrixWorld.clone());
    },
  };
  return { renderer, data, vaos, draws, deleted };
}

/** What the GPU computes for vertex `i`: the uploaded position through the matrix the draw saw. */
function gpuPosition(f: ReturnType<typeof fakeRenderer>, g: BufferGeometry, i: number, draw = -1): Vector3 {
  const a = f.data.get(g.getAttribute('position'))!.array as unknown as ArrayLike<number>;
  const m = f.draws.at(draw)!;
  // Read normalized, as the vertex layout says.
  return new Vector3(a[i * 3]! / 32767, a[i * 3 + 1]! / 32767, a[i * 3 + 2]! / 32767).applyMatrix4(m);
}

afterEach(() => {
  delete (globalThis as { __AETHER_GPU_QUANTIZE?: boolean }).__AETHER_GPU_QUANTIZE;
});

describe('quantized geometry on the GPU', () => {
  it('uploads int16 positions and packed normals, keeps float on the CPU, and draws the same world positions', () => {
    const f = fakeRenderer();
    installGpuQuantize(f.renderer);
    const g = new BoxGeometry(3, 2, 5);
    const mesh = new Mesh(g, new MeshStandardMaterial());
    mesh.position.set(1200.5, 30, -4000.25);
    mesh.rotation.set(0.3, 1.1, 0);
    mesh.updateMatrixWorld(true);
    const world = mesh.matrixWorld.clone();
    quantizeOnGpu(g, mesh);
    f.renderer._renderObjectDirect(mesh, mesh.material);
    expect(f.data.get(g.getAttribute('position'))!.array).toBeInstanceOf(Int16Array);
    expect(f.data.get(g.getAttribute('normal'))!.array).toBeInstanceOf(Int32Array);
    // UVs within 0..1: normalized uint16; metre UVs beyond -1..1 stay float.
    expect(f.data.get(g.getAttribute('uv'))!.array).toBeInstanceOf(Uint16Array);
    expect(g.getAttribute('position').array).toBeInstanceOf(Float32Array);
    // Read normalized; the CPU attributes keep their flags.
    expect(f.vaos[0]!.find((v) => v.type === 'Int32Array' && v.normalized)).toBeTruthy();
    expect(f.vaos[0]!.find((v) => v.type === 'Int16Array' && v.normalized)).toBeTruthy();
    expect(g.getAttribute('position').normalized).toBe(false);
    expect(g.getAttribute('normal').normalized).toBe(false);
    // The world matrix is the object's again after the draw.
    expect(mesh.matrixWorld.equals(world)).toBe(true);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const want = new Vector3().fromBufferAttribute(p, i).applyMatrix4(world);
      expect(gpuPosition(f, g, i).distanceTo(want)).toBeLessThan(1e-3);
    }
  });

  it('goes up as integers again after its GPU copy went (a geometry disposed while undrawn), normals packed 10:10:10', () => {
    const f = fakeRenderer();
    installGpuQuantize(f.renderer);
    const g = new BoxGeometry(2, 2, 2);
    const mesh = new Mesh(g, new MeshStandardMaterial());
    quantizeOnGpu(g, mesh);
    f.renderer._renderObjectDirect(mesh, mesh.material);
    f.data.clear();
    f.renderer._renderObjectDirect(mesh, mesh.material);
    expect(f.data.get(g.getAttribute('position'))!.array).toBeInstanceOf(Int16Array);
    const n = f.data.get(g.getAttribute('normal'))!.array as Int32Array;
    expect(n).toBeInstanceOf(Int32Array);
    expect(n.length).toBe(g.getAttribute('normal').count);
    // The first corner of a box's +x face: (1, 0, 0) is 511 in the low 10 bits.
    expect(n[0]! & 1023).toBe(511);
    expect(f.vaos.at(-1)!.length).toBe(3);
  });

  it('keeps positions on the cooked 2^-11 m grid (to rounding) and moves the grid for geometry far from its origin', () => {
    const f = fakeRenderer();
    installGpuQuantize(f.renderer);
    const n = 64;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = 500 + Math.round(Math.sin(i * 1.7) * 15 * 2048) / 2048;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const mesh = new Mesh(g, new MeshStandardMaterial());
    quantizeOnGpu(g, mesh);
    f.renderer._renderObjectDirect(mesh, mesh.material);
    expect(f.data.get(g.getAttribute('position'))!.array).toBeInstanceOf(Int16Array);
    for (let i = 0; i < n; i++) {
      const v = gpuPosition(f, g, i);
      expect(Math.abs(v.x - pos[i * 3]!)).toBeLessThan(1e-9);
      expect(Math.abs(v.y - pos[i * 3 + 1]!)).toBeLessThan(1e-9);
      expect(Math.abs(v.z - pos[i * 3 + 2]!)).toBeLessThan(1e-9);
    }
  });

  it('leaves positions float for geometry too large for the grid, for instancing and object-space materials', () => {
    const f = fakeRenderer();
    installGpuQuantize(f.renderer);
    const big = new BoxGeometry(MAX_STEP * 2 * 32767 * 1.5, 1, 1);
    const uv = big.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.array.length; i++) uv.array[i] = (uv.array[i] as number) * 40 - 20;
    const m1 = new Mesh(big, new MeshStandardMaterial());
    quantizeOnGpu(big, m1);
    f.renderer._renderObjectDirect(m1, m1.material);
    expect(f.data.get(big.getAttribute('position'))!.array).toBeInstanceOf(Float32Array);
    expect(f.data.get(big.getAttribute('normal'))!.array).toBeInstanceOf(Int32Array);
    expect(f.data.get(big.getAttribute('uv'))!.array).toBeInstanceOf(Float32Array);

    const g2 = new BoxGeometry(1, 1, 1);
    const im = new InstancedMesh(g2, new MeshStandardMaterial(), 2);
    quantizeOnGpu(g2, im);
    f.renderer._renderObjectDirect(im as unknown as Mesh, im.material);
    expect(f.data.get(g2.getAttribute('position'))!.array).toBeInstanceOf(Float32Array);

    const shaded = new MeshStandardMaterial();
    shaded.userData['aetherShaded'] = 'high';
    expect(readsObjectSpace(shaded)).toBe(true);
    const g3 = new BoxGeometry(1, 1, 1);
    const m3 = new Mesh(g3, shaded);
    quantizeOnGpu(g3, m3);
    f.renderer._renderObjectDirect(m3, m3.material);
    expect(f.data.get(g3.getAttribute('position'))!.array).toBeInstanceOf(Float32Array);
  });

  it('goes back to float positions when an object-space material draws a quantized geometry', () => {
    const f = fakeRenderer();
    installGpuQuantize(f.renderer);
    const g = new BoxGeometry(1, 1, 1);
    const mesh = new Mesh(g, new MeshStandardMaterial());
    quantizeOnGpu(g, mesh);
    f.renderer._renderObjectDirect(mesh, mesh.material);
    expect(f.data.get(g.getAttribute('position'))!.array).toBeInstanceOf(Int16Array);
    const shaded = new MeshStandardMaterial();
    shaded.userData['aetherShaded'] = 'high';
    mesh.material = shaded;
    f.renderer._renderObjectDirect(mesh, mesh.material);
    expect(f.deleted).toContain(g.getAttribute('position'));
    expect(f.data.get(g.getAttribute('position'))!.array).toBeInstanceOf(Float32Array);
    expect(f.draws.at(-1)!.equals(mesh.matrixWorld)).toBe(true);
  });

  it('stores colours within 0..1 as normalized uint16, others as half floats, and does nothing when switched off', () => {
    const f = fakeRenderer();
    installGpuQuantize(f.renderer);
    const g = new BoxGeometry(1, 1, 1);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
    const h = new BoxGeometry(1, 1, 1);
    h.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1.5), 3));
    for (const x of [g, h]) {
      const mesh = new Mesh(x, new MeshStandardMaterial());
      quantizeOnGpu(x, mesh);
      f.renderer._renderObjectDirect(mesh, mesh.material);
    }
    expect(f.data.get(g.getAttribute('color'))!.array).toBeInstanceOf(Uint16Array);
    // Outside 0..1: half floats (1.5 is 0x3e00).
    expect(Array.from(f.data.get(h.getAttribute('color'))!.array as Uint16Array).slice(0, 3)).toEqual([0x3e00, 0x3e00, 0x3e00]);
    expect(f.vaos.at(-1)!.find((v) => v.type === 'Uint16Array' && !v.normalized)).toBeTruthy();

    (globalThis as { __AETHER_GPU_QUANTIZE?: boolean }).__AETHER_GPU_QUANTIZE = false;
    const off = new BoxGeometry(1, 1, 1);
    const mesh = new Mesh(off, new MeshStandardMaterial());
    quantizeOnGpu(off, mesh);
    f.renderer._renderObjectDirect(mesh, mesh.material);
    expect(f.data.get(off.getAttribute('position'))!.array).toBeInstanceOf(Float32Array);
  });
});
