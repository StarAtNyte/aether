import { describe, expect, it } from 'vitest';
import { cacheUniformBindingKeys } from '../src/gpu/uniform-binding-keys';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';

// Exercise the installed Three version's real method without creating a WebGL context.
const path = 'three/src/renderers/webgl-fallback/utils/WebGLState.js';
const { default: WebGLState } = await import(path) as {
  default: { prototype: { bindBufferBase(target: number, index: number, buffer: object | null): boolean } };
};
function fixture() {
  let calls = 0, fail = false;
  const gl = {
    UNIFORM_BUFFER: 35345,
    bindBufferBase(_target: number, _index: number, _buffer: object | null) {
      if (fail) throw new Error('context');
      calls++;
    },
  };
  const state = { gl, currentBoundBufferBases: {} as Record<string, object | null | undefined>, bindBufferBase: WebGLState.prototype.bindBufferBase };
  return { backend: { gl, state }, calls: () => calls, fail: (value: boolean) => { fail = value; } };
}

describe('uniform binding key reuse', () => {
  it('preserves existing bindings, return values and resets of the original state cache', () => {
    const f = fixture(), { gl, state } = f.backend;
    const buffer = {};
    expect(state.bindBufferBase(gl.UNIFORM_BUFFER, 2, buffer)).toBe(true);
    cacheUniformBindingKeys(f.backend);
    const patched = state.bindBufferBase;
    cacheUniformBindingKeys(f.backend);
    expect(state.bindBufferBase).toBe(patched);
    expect(state.bindBufferBase(gl.UNIFORM_BUFFER, 2, buffer)).toBe(false);
    expect(f.calls()).toBe(1);
    state.currentBoundBufferBases = {};
    expect(state.bindBufferBase(gl.UNIFORM_BUFFER, 2, buffer)).toBe(true);
    expect(state.bindBufferBase(gl.UNIFORM_BUFFER, 2, null)).toBe(true);
    expect(state.bindBufferBase(gl.UNIFORM_BUFFER, 2, null)).toBe(false);
    expect(f.calls()).toBe(3);
  });

  it('matches stock behavior for other targets and indices outside the prepared range', () => {
    const stock = fixture(), cached = fixture();
    cacheUniformBindingKeys(cached.backend);
    const buffer = {};
    for (const [target, index] of [[35345, 0], [35345, 63], [35345, 64], [35345, -1], [35345, 1.5], [35982, 0]]) {
      for (const value of [buffer, buffer, null]) {
        expect(cached.backend.state.bindBufferBase(target!, index!, value)).toBe(stock.backend.state.bindBufferBase(target!, index!, value));
      }
    }
    expect(cached.calls()).toBe(stock.calls());
    expect(cached.backend.state.currentBoundBufferBases).toEqual(stock.backend.state.currentBoundBufferBases);
  });

  it('does not cache failed binds or touch unsupported backends', () => {
    cacheUniformBindingKeys({});
    const f = fixture();
    cacheUniformBindingKeys(f.backend);
    const buffer = {};
    f.fail(true);
    expect(() => f.backend.state.bindBufferBase(35345, 0, buffer)).toThrow('context');
    f.fail(false);
    expect(f.backend.state.bindBufferBase(35345, 0, buffer)).toBe(true);
    expect(f.calls()).toBe(1);
  });

  it('binds changing buffers without creating per-draw keys', async () => {
    const f = fixture();
    cacheUniformBindingKeys(f.backend);
    const a = {}, b = {};
    const report = await probeAllocations(() => {
      for (let i = 0; i < 8; i++) {
        f.backend.state.bindBufferBase(35345, i, a);
        f.backend.state.bindBufferBase(35345, i, b);
      }
    }, { iterations: 400, warmup: 3000, match: /packages\/render\/src\/gpu\/uniform-binding-keys/ });
    expect(report.bytesPerIteration, describeSites(report)).toBeLessThan(16);
    expect(f.calls()).toBeGreaterThan(1000);
  });
});
