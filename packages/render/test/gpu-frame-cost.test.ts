import { afterEach, describe, expect, it, vi } from 'vitest';
import { gpuFrameCost } from '../src/gpu/frame-cost';
import { AdaptiveResolution } from '../src/view/adaptive-resolution';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  let clock = 0, available = true, lost = false, disjoint = false, duration = 1e6, external = false;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2, CURRENT_QUERY: 3,
    getExtension: () => ({ TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 }),
    isContextLost: () => lost, getParameter: () => disjoint,
    getQuery: () => external ? {} : null,
    createQuery: vi.fn(() => ({})), deleteQuery: vi.fn(), beginQuery: vi.fn(), endQuery: vi.fn(),
    getQueryParameter: vi.fn((_q: object, kind: number) => {
      if (kind === 1) return available;
      if (!available) throw new Error('blocking result requested');
      return duration;
    }),
  };
  const backend = { gl: gl as unknown as WebGL2RenderingContext, trackTimestamp: false };
  const cost = gpuFrameCost(backend), pipeline = {};
  const frame = (valid = true) => { cost.begin(800, 600, pipeline); cost.end(valid); clock += 16; };
  return { gl, backend, cost, frame, pipeline,
    advance: (ms: number) => { clock += ms; },
    ready: (v: boolean) => { available = v; }, lost: () => { lost = true; },
    disjoint: () => { disjoint = true; }, external: () => { external = true; },
    duration: (ns: number) => { duration = ns; },
  };
}
describe('GPU frame cost', () => {
  it('uses sparse queries and requires three available samples before protecting resolution', () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) f.frame();
    expect(f.cost.seconds).toBeUndefined();
    f.frame();
    expect(f.cost.seconds).toBe(.001);
    expect(f.gl.beginQuery).toHaveBeenCalledTimes(3);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(1);
    f.advance(501); expect(f.cost.seconds).toBeUndefined();
    f.cost.dispose();
  });
  it('never requests unavailable results, bounds pending queries, and releases them on disposal', () => {
    const f = fixture(); f.ready(false);
    for (let i = 0; i < 30; i++) f.frame();
    expect(f.gl.createQuery).toHaveBeenCalledTimes(3);
    expect(f.cost.seconds).toBeUndefined();
    expect(f.gl.getQueryParameter.mock.calls.every(([, kind]) => kind === 1)).toBe(true);
    f.cost.dispose(); expect(f.gl.deleteQuery).toHaveBeenCalledTimes(3);
  });
  it('discards incomplete discovery frames, disjoint results and changed drawing dimensions', () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.frame(false);
    expect(f.cost.seconds).toBeUndefined();
    for (let i = 0; i < 30; i++) f.frame();
    expect(f.cost.seconds).toBe(.001);
    f.cost.begin(400, 300, f.pipeline); f.cost.end(true);
    expect(f.cost.seconds).toBeUndefined();
    for (let i = 0; i < 30; i++) f.frame();
    expect(f.cost.seconds).toBe(.001);
    f.disjoint(); for (let i = 0; i < 4; i++) f.frame();
    expect(f.cost.seconds).toBeUndefined(); f.cost.dispose();
  });
  it('does not conflict with another timer user or Three timestamp tracking', () => {
    const f = fixture(); f.external(); f.frame();
    expect(f.gl.beginQuery).not.toHaveBeenCalled();
    f.backend.trackTimestamp = true;
    for (let i = 0; i < 30; i++) f.frame();
    expect(f.cost.seconds).toBeUndefined(); f.cost.dispose();
  });
  it('invalidates measurements when only the scene-pass scale or pipeline changes', () => {
    const f = fixture(); for (let i = 0; i < 30; i++) f.frame();
    expect(f.cost.seconds).toBe(.001);
    f.cost.begin(800, 600, f.pipeline, .5); f.cost.end(true);
    expect(f.cost.seconds).toBeUndefined();
    for (let i = 0; i < 30; i++) f.frame();
    expect(f.cost.seconds).toBe(.001);
    f.cost.begin(800, 600, {}); f.cost.end(true);
    expect(f.cost.seconds).toBeUndefined(); f.cost.dispose();
  });
  it('avoids GL cleanup calls after context loss and works without WebGL timers', () => {
    const f = fixture(); f.ready(false); f.frame(); f.lost(); f.cost.dispose();
    expect(f.gl.deleteQuery).not.toHaveBeenCalled();
    const unsupported = gpuFrameCost({}); unsupported.begin(1, 1, null); unsupported.end(true);
    expect(unsupported.seconds).toBeUndefined(); unsupported.dispose();
  });
  it('retains full resolution for CPU delays but still responds to genuine GPU overload and missing evidence', () => {
    for (const gpu of [.001, .04, undefined, NaN, -1]) {
      const a = new AdaptiveResolution();
      for (let i = 0; i < 300; i++) a.record(.04, true, gpu);
      if (gpu === .001) expect(a.scale).toBe(1);
      else expect(a.scale).toBeLessThan(1);
    }
    const a = new AdaptiveResolution(); a.scale = .5;
    for (let i = 0; i < 600; i++) a.record(.04, true, .001);
    expect(a.scale).toBe(1);
  });
});
