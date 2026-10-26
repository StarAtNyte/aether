import { describe, expect, it } from 'vitest';
import { cacheUniformUploads } from '../src/gpu/buffer-uploads';

function fixture() {
  let calls = 0, fail = false;
  const handles = new WeakMap<object, { buffer: object }>();
  const backend = {
    get(binding: object) {
      let data = handles.get(binding);
      if (!data) { data = { buffer: {} }; handles.set(binding, data); }
      return data;
    },
    updateBinding(_binding: object) { if (fail) throw new Error('upload'); calls++; },
    updateBindings(_group: { bindings: object[] }) {},
  };
  cacheUniformUploads(backend);
  return { backend, calls: () => calls, fail: (value: boolean) => { fail = value; } };
}

describe('raw uniform upload cache', () => {
  it('uploads independent GPU buffers and every changed bit, including signed zero and NaN payloads', () => {
    const f = fixture();
    const buffer = new Float32Array(16);
    const a = { isNodeUniformBuffer: true, buffer }, b = { ...a };
    for (const binding of [a, b, a, b]) f.backend.updateBinding(binding);
    expect(f.calls()).toBe(2);
    buffer[0] = -0;
    f.backend.updateBinding(a); f.backend.updateBinding(b);
    expect(f.calls()).toBe(4);
    const words = new Uint32Array(buffer.buffer);
    for (const bits of [0x7fc00001, 0x7fc00002]) {
      words[0] = bits; f.backend.updateBinding(a);
    }
    expect(f.calls()).toBe(6);
    f.backend.updateBinding(a);
    expect(f.calls()).toBe(6);
  });

  it('invalidates on partial writes, bind-group refresh, array replacement and GPU recreation', () => {
    const f = fixture();
    const a = { isNodeUniformBuffer: true, buffer: new Float32Array(16), updateRanges: [] as object[] };
    f.backend.updateBinding(a);
    a.updateRanges.push({ start: 0, count: 1 }); f.backend.updateBinding(a);
    a.updateRanges.length = 0; f.backend.updateBinding(a);
    f.backend.updateBindings({ bindings: [a] }); f.backend.updateBinding(a);
    a.buffer = a.buffer.slice(); f.backend.updateBinding(a);
    f.backend.get(a).buffer = {}; f.backend.updateBinding(a);
    expect(f.calls()).toBe(6);
  });

  it('retries failed uploads and installs once', () => {
    const f = fixture();
    cacheUniformUploads(f.backend);
    const a = { isNodeUniformBuffer: true, buffer: new Float32Array(16) };
    f.fail(true); expect(() => f.backend.updateBinding(a)).toThrow('upload');
    f.fail(false); f.backend.updateBinding(a); f.backend.updateBinding(a);
    expect(f.calls()).toBe(1);
  });

  it('forwards ordinary groups and concurrently writable shared memory', () => {
    const f = fixture();
    const ordinary = { buffer: new Float32Array(16) };
    const shared = { isNodeUniformBuffer: true, buffer: new Float32Array(new SharedArrayBuffer(64)) };
    for (const a of [ordinary, shared]) { f.backend.updateBinding(a); f.backend.updateBinding(a); }
    expect(f.calls()).toBe(4);
  });
});
