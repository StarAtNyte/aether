import { describe, expect, it } from 'vitest';
import { cachePixelStoreState } from '../src/gpu/pixel-store-cache';
const path = 'three/src/renderers/webgl-fallback/utils/WebGLState.js';
const { default: WebGLState } = await import(path) as { default: { prototype: {
  getParameter(name: number): unknown; pixelStorei(name: number, value: unknown): void;
} } };
function fixture() {
  const gl = { UNPACK_ROW_LENGTH: 1, UNPACK_IMAGE_HEIGHT: 2, UNPACK_SKIP_PIXELS: 3,
    UNPACK_SKIP_ROWS: 4, UNPACK_SKIP_IMAGES: 5, PACK_ALIGNMENT: 6, UNPACK_ALIGNMENT: 7,
    UNPACK_FLIP_Y_WEBGL: 8, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 9, UNPACK_COLORSPACE_CONVERSION_WEBGL: 10,
    BROWSER_DEFAULT_WEBGL: 42, PACK_ROW_LENGTH: 11, PACK_SKIP_PIXELS: 12, PACK_SKIP_ROWS: 13,
    getParameter(name: number): unknown { reads++; return driver[name]; },
    pixelStorei(name: number, value: unknown) { driver[name] = value; },
  };
  const defaults: Record<number, unknown> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 4, 7: 4, 8: false, 9: false, 10: 42, 11: 0, 12: 0, 13: 0 };
  let driver = { ...defaults }, reads = 0;
  const state = { gl, parameters: {} as Record<number, unknown>,
    getParameter: WebGLState.prototype.getParameter, pixelStorei: WebGLState.prototype.pixelStorei,
    reset() { driver = { ...defaults }; this.parameters = {}; },
  };
  return { backend: { gl, state }, reads: () => reads };
}

describe('pixel-store state cache', () => {
  it('preserves non-default initial state and avoids driver queries on subsequent reads', () => {
    const f = fixture(), { state, gl } = f.backend;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 32);
    cachePixelStoreState(f.backend);
    expect(state.getParameter(gl.UNPACK_ROW_LENGTH)).toBe(32);
    const reads = f.reads();
    for (let i = 0; i < 100; i++) expect(state.getParameter(gl.UNPACK_SKIP_ROWS)).toBe(0);
    expect(f.reads()).toBe(reads);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 3);
    expect(state.getParameter(gl.UNPACK_SKIP_ROWS)).toBe(3);
    expect(f.reads()).toBe(reads);
  });
  it('repopulates exact reset defaults without querying the driver', () => {
    const f = fixture(), { state, gl } = f.backend;
    cachePixelStoreState(f.backend);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 7);
    state.pixelStorei(gl.PACK_ALIGNMENT, 1);
    const reads = f.reads();
    state.reset();
    expect(state.getParameter(gl.UNPACK_SKIP_ROWS)).toBe(0);
    expect(state.getParameter(gl.PACK_ALIGNMENT)).toBe(4);
    expect(state.getParameter(gl.UNPACK_FLIP_Y_WEBGL)).toBe(false);
    expect(state.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL)).toBe(42);
    expect(f.reads()).toBe(reads);
  });
  it('installs once, leaves known cache entries intact and ignores unsupported backends', () => {
    cachePixelStoreState({});
    const f = fixture(), { state, gl } = f.backend;
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
    cachePixelStoreState(f.backend);
    const reset = state.reset, reads = f.reads();
    cachePixelStoreState(f.backend);
    expect(state.reset).toBe(reset);
    expect(f.reads()).toBe(reads);
    expect(state.getParameter(gl.UNPACK_ALIGNMENT)).toBe(8);
  });
});
