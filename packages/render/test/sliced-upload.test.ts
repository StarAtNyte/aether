import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';
import { SLICED_MIN_BYTES, slicedUploads, UPLOAD_CHUNK_BYTES } from '../src/streaming/sliced-upload';

/** A fake WebGL2 context that keeps buffer contents, and three's backend data map. */
function fakeBackend() {
  const buffers = new Map<object, { bytes: Uint8Array; target: number }>();
  const bound = new Map<number, object | null>();
  const calls: Array<{ fn: string; bytes: number }> = [];
  let resets = 0;
  const gl = {
    createBuffer: () => ({}) as WebGLBuffer,
    bindBuffer: (target: number, b: WebGLBuffer | null) => void bound.set(target, b),
    bufferData: (target: number, size: number) => {
      const b = bound.get(target)!;
      buffers.set(b, { bytes: new Uint8Array(size), target });
      calls.push({ fn: 'bufferData', bytes: 0 });
    },
    bufferSubData: (target: number, offset: number, src: ArrayBufferView & { BYTES_PER_ELEMENT: number }, srcOffset: number, length: number) => {
      const b = buffers.get(bound.get(target)!)!;
      const per = src.BYTES_PER_ELEMENT;
      b.bytes.set(new Uint8Array(src.buffer, src.byteOffset + srcOffset * per, length * per), offset);
      calls.push({ fn: 'bufferSubData', bytes: length * per });
    },
    deleteBuffer: (b: WebGLBuffer) => void buffers.delete(b),
  };
  const data = new WeakMap<object, Record<string, unknown>>();
  const backend = {
    isWebGLBackend: true,
    gl,
    get: (o: object) => {
      let d = data.get(o);
      if (!d) data.set(o, (d = {}));
      return d;
    },
    state: { resetVertexState: () => void resets++ },
  };
  return { backend, buffers, calls, resets: () => resets };
}

const bigFloats = (bytes: number): Float32Array => Float32Array.from({ length: bytes / 4 }, (_, i) => i * 0.5);

describe('slicedUploads', () => {
  it('uploads large attributes in chunks and hands complete buffers to the backend', () => {
    const f = fakeBackend();
    const up = slicedUploads(f.backend)!;
    const g = new BufferGeometry();
    const pos = new BufferAttribute(bigFloats(UPLOAD_CHUNK_BYTES * 2 + 4096), 3);
    const small = new BufferAttribute(new Float32Array(30), 3);
    const index = new BufferAttribute(Uint32Array.from({ length: (SLICED_MIN_BYTES * 1.5) / 4 }, (_, i) => i % 1000), 1);
    g.setAttribute('position', pos);
    g.setAttribute('normal', small);
    g.setIndex(index);
    let steps = 0;
    while (!up.step(g)) steps++;
    // Index: allocate + 2 chunks; position: allocate + 3 chunks.
    expect(steps).toBe(3 + 4);
    expect(f.calls.every((c) => c.bytes <= UPLOAD_CHUNK_BYTES)).toBe(true);
    const posData = f.backend.get(pos) as { bufferGPU: object; bufferType: number; version: number };
    expect(posData.bufferType).toBe(34962);
    expect(posData.version).toBe(pos.version);
    expect(new Float32Array(f.buffers.get(posData.bufferGPU)!.bytes.buffer)).toEqual(pos.array);
    const idxData = f.backend.get(index) as { bufferGPU: object; bufferType: number };
    expect(idxData.bufferType).toBe(34963);
    expect(new Uint32Array(f.buffers.get(idxData.bufferGPU)!.bytes.buffer)).toEqual(index.array);
    // The element buffer was bound with no vertex array bound.
    expect(f.resets()).toBeGreaterThan(0);
    // Small attributes are left to three.
    expect((f.backend.get(small) as { bufferGPU?: object }).bufferGPU).toBeUndefined();
    expect(up.stats.attributes).toBe(2);
  });

  it('leaves dynamic attributes alone and gives way when three uploaded first', () => {
    const f = fakeBackend();
    const up = slicedUploads(f.backend)!;
    const g = new BufferGeometry();
    const dyn = new BufferAttribute(bigFloats(SLICED_MIN_BYTES * 2), 3).setUsage(DynamicDrawUsage);
    const pos = new BufferAttribute(bigFloats(UPLOAD_CHUNK_BYTES * 3), 3);
    g.setAttribute('color', dyn);
    g.setAttribute('position', pos);
    expect(up.step(g)).toBe(false); // allocation of position
    expect(f.buffers.size).toBe(1);
    // three drew the object first and made its own buffer: the partial one is deleted.
    (f.backend.get(pos) as { bufferGPU?: object }).bufferGPU = {};
    expect(up.step(g)).toBe(true);
    expect(f.buffers.size).toBe(0);
    expect((f.backend.get(dyn) as { bufferGPU?: object }).bufferGPU).toBeUndefined();
  });

  it('frees a partial buffer when its geometry is disposed, and is off on other backends', () => {
    const f = fakeBackend();
    const up = slicedUploads(f.backend)!;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(bigFloats(UPLOAD_CHUNK_BYTES * 3), 3));
    up.step(g);
    expect(f.buffers.size).toBe(1);
    g.dispose();
    expect(f.buffers.size).toBe(0);
    expect(slicedUploads({ isWebGPUBackend: true })).toBeNull();
  });
});
