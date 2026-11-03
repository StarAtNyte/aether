import { afterEach, describe, expect, it, vi } from 'vitest';
import { parallelPrograms } from '../src/gpu/parallel-programs';
function fixture() {
  let next = 0;
  const ready = new Set<object>(), deleted: object[] = [], completed: unknown[] = [];
  const gl = { createProgram: () => ({ id: ++next }), attachShader() {}, linkProgram() {},
    isContextLost: () => false, deleteProgram: (p: object) => deleted.push(p),
    getProgramParameter: (p: object) => ready.has(p),
  };
  const data = new Map<object, { programGPU?: object; shaderGPU?: object }>();
  const backend = { gl, parallel: { COMPLETION_STATUS_KHR: 42 },
    get: (p: object) => data.get(p) ?? { shaderGPU: {} }, set: (p: object, v: object) => data.set(p, v),
    createRenderPipeline: vi.fn(),
    _completeCompile: (o: { getBindings(): unknown }) => completed.push(o.getBindings()),
  };
  const changed = vi.fn(), failed = vi.fn();
  const controller = parallelPrograms(backend as unknown as Parameters<typeof parallelPrograms>[0], changed, failed);
  const add = (promises: Promise<void>[] | null = null) => {
    const pipeline = { fragmentProgram: {}, vertexProgram: {} };
    let bindings = { value: next };
    const object = { pipeline, getBindings: () => bindings };
    (backend.createRenderPipeline as unknown as (o: typeof object, p: typeof promises) => void)(object, promises);
    return { program: data.get(pipeline)!.programGPU!, bindings, mutate: () => { bindings = { value: -1 }; } };
  };
  return { add, ready, deleted, completed, changed, failed, controller, backend };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('parallel WebGL linking', () => {
  it('yields between completed programs and rechecks newly submitted links before reflection', async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const f = fixture();
    const a = f.add(), b = f.add();
    f.ready.add(a.program); f.ready.add(b.program);
    const complete = f.backend._completeCompile;
    f.backend._completeCompile = object => { const count = complete(object); clock += 5; return count; };
    await vi.advanceTimersToNextTimerAsync();
    expect(f.completed).toEqual([a.bindings]);
    expect(f.controller.pending).toBe(1);
    const c = f.add();
    await vi.advanceTimersToNextTimerAsync();
    expect(f.completed).toEqual([a.bindings]);
    f.ready.add(c.program);
    await vi.advanceTimersToNextTimerAsync();
    expect(f.completed).toEqual([a.bindings, b.bindings]);
    expect(f.changed).not.toHaveBeenCalled();
    await vi.advanceTimersToNextTimerAsync();
    await f.controller.idle();
    expect(f.completed).toEqual([a.bindings, b.bindings, c.bindings]);
    expect(f.changed).toHaveBeenCalledOnce();
    f.controller.dispose();
  });
  it('defers setup until every submitted program is complete and retains original bindings', async () => {
    vi.useFakeTimers();
    const f = fixture(), promises: Promise<void>[] = [];
    const a = f.add(promises), b = f.add();
    a.mutate();
    f.ready.add(a.program);
    await vi.advanceTimersByTimeAsync(16);
    expect(f.completed).toEqual([]);
    expect(f.controller.pending).toBe(2);
    f.ready.add(b.program);
    await vi.advanceTimersByTimeAsync(8);
    await Promise.all(promises);
    expect(f.completed).toEqual([a.bindings, b.bindings]);
    expect(f.controller.pending).toBe(0);
    expect(f.changed).toHaveBeenCalledTimes(1);
    expect(f.failed).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it('cancels polling and releases unfinished programs on disposal', async () => {
    vi.useFakeTimers();
    const f = fixture(), p = f.add();
    const idle = f.controller.idle();
    f.controller.dispose();
    await idle;
    await vi.runAllTimersAsync();
    expect(f.deleted).toEqual([p.program]);
    expect(f.completed).toEqual([]);
    expect(f.changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the native path for atomic capture draws and restores deferred linking afterward', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.synchronous(() => (f.backend.createRenderPipeline as unknown as (o: object, p: null) => void)({}, null));
    expect(f.controller.pending).toBe(0);
    f.add();
    expect(f.controller.pending).toBe(1);
    f.controller.dispose();
  });
  it('selects WebGPU asynchronous creation on normal draws and releases waiters on disposal', async () => {
    let finish!: () => void;
    const backend = {
      isWebGPUBackend: true,
      createRenderPipeline: (_o: unknown, promises: Promise<void>[] | null) => { promises?.push(new Promise<void>(r => { finish = r; })); },
    };
    const original = backend.createRenderPipeline;
    const changed = vi.fn(), failed = vi.fn();
    const c = parallelPrograms(backend as unknown as Parameters<typeof parallelPrograms>[0], changed, failed);
    backend.createRenderPipeline({}, null);
    expect(c.pending).toBe(1);
    finish();
    await c.idle();
    expect(changed).toHaveBeenCalledTimes(1);
    backend.createRenderPipeline({}, null);
    const idle = c.idle();
    c.dispose();
    await idle;
    finish();
    await Promise.resolve();
    expect(backend.createRenderPipeline).toBe(original);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });
  it('keeps one-shot environment conversion draws synchronous', () => {
    vi.useFakeTimers();const f = fixture();
    const object = { pipeline: { fragmentProgram: {}, vertexProgram: {} }, getBindings: () => [], context: { textures: [{ isPMREMTexture: true }] } };
    (f.backend.createRenderPipeline as unknown as (item: typeof object, promises: null) => void)(object, null);
    expect(f.controller.pending).toBe(0);expect(vi.getTimerCount()).toBe(0);f.controller.dispose();
  });
  it('keeps the native path when parallel compilation is unavailable', () => {
    const backend = { createRenderPipeline: vi.fn() };
    const original = backend.createRenderPipeline;
    const c = parallelPrograms(backend as unknown as Parameters<typeof parallelPrograms>[0], vi.fn(), vi.fn());
    expect(backend.createRenderPipeline).toBe(original);
    expect(c.pending).toBe(0);
    c.dispose();
  });
});
describe('drawing while a program links', () => {
  it('skips draws of an object whose program is still linking and draws it once complete', async () => {
    vi.useFakeTimers();
    let next = 0;
    const ready = new Set<object>();
    const data = new Map<object, { programGPU?: object; shaderGPU?: object }>();
    const draw = vi.fn();
    const backend = {
      gl: { createProgram: () => ({ id: ++next }), attachShader() {}, linkProgram() {}, isContextLost: () => false, deleteProgram() {}, getProgramParameter: (p: object) => ready.has(p) },
      parallel: { COMPLETION_STATUS_KHR: 42 },
      get: (p: object) => data.get(p) ?? { shaderGPU: {} }, set: (p: object, v: object) => data.set(p, v),
      createRenderPipeline: vi.fn(), _completeCompile: vi.fn(), draw,
    };
    const controller = parallelPrograms(backend as unknown as Parameters<typeof parallelPrograms>[0], vi.fn(), vi.fn());
    const pipeline = { fragmentProgram: {}, vertexProgram: {} };
    const object = { pipeline, getBindings: () => ({}) };
    (backend.createRenderPipeline as unknown as (o: typeof object, p: null) => void)(object, null);
    backend.draw(object, {});
    expect(draw).not.toHaveBeenCalled();
    // The renderer measures how much of a frame still waits for links from these counts.
    expect(controller.draws).toEqual({ issued: 1, linking: 1 });
    ready.add(data.get(pipeline)!.programGPU!);
    await vi.advanceTimersToNextTimerAsync();
    expect(controller.pending).toBe(0);
    backend.draw(object, {});
    expect(draw).toHaveBeenCalledTimes(1);
    expect(controller.draws).toEqual({ issued: 2, linking: 1 });
    controller.dispose();
    expect(backend.draw).toBe(draw);
  });
});
