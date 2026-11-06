import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLazyStages, mergeSet, prewarmOrder, ProgramCache, sourceHash, type GlApi, type ProgramStore, type StoredSet } from '../src/gpu/program-cache';
import type { RenderTier } from '../src/gpu/finishing';

/** A fake WebGL2 context whose links finish when the test says so. */
function fakeGl() {
  let next = 0;
  const done = new Set<object>(), failed = new Set<object>();
  const programs: Array<{ id: number; shaders: object[] }> = [];
  const deletedPrograms: object[] = [], deletedShaders: object[] = [], linked: object[] = [];
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS: 3,
    isContextLost: () => false,
    createProgram: () => {
      const p = { id: ++next, shaders: [] as object[] };
      programs.push(p);
      return p;
    },
    createShader: (type: number) => ({ id: ++next, type }),
    shaderSource() {},
    compileShader() {},
    attachShader: (p: { shaders: object[] }, s: object) => void p.shaders.push(s),
    detachShader: (p: { shaders: object[] }, s: object) => void p.shaders.splice(p.shaders.indexOf(s), 1),
    linkProgram: (p: object) => void linked.push(p),
    getProgramParameter: (p: object, k: number) => (k === 42 ? done.has(p) : !failed.has(p)),
    deleteShader: (s: object) => void deletedShaders.push(s),
    deleteProgram: (p: object) => void deletedPrograms.push(p),
  };
  return { gl, done, failed, programs, linked, deletedPrograms, deletedShaders, finishAll: () => programs.forEach((p) => done.add(p)) };
}

function memoryStore(sets: Partial<Record<RenderTier, StoredSet>> = {}, sources = new Map<string, string>()): ProgramStore & { sets: typeof sets; sources: Map<string, string> } {
  return {
    sets,
    sources,
    getSet: async (t) => sets[t] ?? null,
    putSet: async (t, s) => void (sets[t] = s),
    getSources: async (hs) => new Map(hs.filter((h) => sources.has(h)).map((h) => [h, sources.get(h)!])),
    putSources: async (s) => s.forEach((v, k) => sources.set(k, v)),
    prune: async (keep) => [...sources.keys()].forEach((k) => keep.has(k) || sources.delete(k)),
  };
}

/** A stored set of `pairs` (vertex, fragment source), with their sources. */
function storeOf(tier: RenderTier, pairs: Array<[string, string]>) {
  const sources = new Map<string, string>();
  const entries = pairs.map(([v, f], i) => {
    sources.set(sourceHash(v), v);
    sources.set(sourceHash(f), f);
    return { v: sourceHash(v), f: sourceHash(f), uses: 1, last: 10 - i };
  });
  return memoryStore({ [tier]: { session: 10, entries } }, sources);
}

const settle = async (ms = 100) => {
  await vi.advanceTimersByTimeAsync(ms);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('program set bookkeeping', () => {
  it('hashes sources stably and tells lengths apart', () => {
    expect(sourceHash('void main(){}')).toBe(sourceHash('void main(){}'));
    expect(sourceHash('a')).not.toBe(sourceHash('b'));
    expect(sourceHash('ab')).not.toBe(sourceHash('ba'));
  });
  it('merges a session: one use per session, most recent first, stale and surplus entries dropped', () => {
    const prev: StoredSet = { session: 20, entries: [{ v: 'a', f: 'b', uses: 3, last: 20 }, { v: 'old', f: 'x', uses: 9, last: 2 }, { v: 'c', f: 'd', uses: 1, last: 19 }] };
    const next = mergeSet(prev, [{ v: 'c', f: 'd' }, { v: 'c', f: 'd' }, { v: 'e', f: 'f' }], 3);
    expect(next.session).toBe(21);
    expect(next.entries.map((e) => `${e.v}${e.f}:${e.uses}`)).toEqual(['cd:2', 'ef:1', 'ab:3']);
    expect(mergeSet(next, [{ v: 'g', f: 'h' }], 2).entries.map((e) => e.v)).toEqual(['g', 'c']);
    // A second save of the same page counts no second use.
    expect(mergeSet(next, [{ v: 'c', f: 'd' }], 3, 21).entries.find((e) => e.v === 'c')!.uses).toBe(2);
  });
  it('orders the pre-warm by recency, then use', () => {
    const order = prewarmOrder({ session: 5, entries: [{ v: 'a', f: '', uses: 9, last: 3 }, { v: 'b', f: '', uses: 1, last: 5 }, { v: 'c', f: '', uses: 4, last: 5 }] }, 2);
    expect(order.map((e) => e.v)).toEqual(['c', 'b']);
  });
});

describe('program cache', () => {
  it('links the stored set at boot and hands a pooled program to the pipeline that asks for it', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const store = storeOf('medium', [['V1', 'F1'], ['V1', 'F2']]);
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, f.gl as unknown as GlApi);
    await cache.prewarm('medium');
    await settle(20);
    expect(cache.stats.submitted).toBe(2);
    expect(cache.covers('V1') && cache.covers('F2')).toBe(true);
    f.finishAll();
    await settle(20);
    expect(cache.stats.linked).toBe(2);
    // Linked programs keep no shaders.
    expect(f.programs.every((p) => p.shaders.length === 0)).toBe(true);
    const taken = cache.take('V1', 'F2');
    expect(taken?.program).toBe(f.programs[1]);
    expect(taken?.ready()).toBe(true);
    expect(cache.covers('F2')).toBe(false);
    expect(cache.take('V1', 'F2')).toBeNull(); // taken once
    expect(cache.stats.adopted).toBe(1);
    expect(cache.stats.linkedOwn).toBe(1);
    cache.dispose();
  });
  it('drops a set entry three asked for first, and stops submitting once the world compiles', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const pairs: Array<[string, string]> = Array.from({ length: 10 }, (_, i) => [`V${i}`, `F${i}`]);
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, storeOf('low', pairs), f.gl as unknown as GlApi);
    cache.setTier('low');
    expect(cache.take('V9', 'F9')).toBeNull(); // before the set loaded: never linked by the pre-warm
    await cache.prewarm('low');
    await settle(20);
    expect(cache.stats.submitted).toBe(6); // in flight at most
    cache.worldCompiling();
    f.finishAll();
    await settle(100);
    expect(cache.stats.submitted).toBe(6);
    expect(f.linked.length).toBe(6);
    cache.dispose();
  });
  it('lets go of pooled programs nobody took after the first picture', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, storeOf('high', [['A', 'B'], ['C', 'D']]), f.gl as unknown as GlApi);
    await cache.prewarm('high');
    await settle(20);
    f.finishAll();
    await settle(20);
    cache.take('A', 'B');
    cache.markFirstPicture();
    await settle(25_000);
    expect(cache.stats.trimmed).toBe(1);
    expect(f.deletedPrograms).toEqual([f.programs[1]]);
    cache.dispose();
  });
  it('saves the pairs a session used under the tier in effect', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const store = memoryStore();
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, f.gl as unknown as GlApi);
    cache.setTier('ultra');
    cache.take('VS', 'FS');
    cache.note('VS', 'FS2');
    cache.setTier(null);
    cache.take('still', 'only');
    await cache.save();
    expect(store.sets.ultra?.entries.length).toBe(2);
    expect([...store.sources.values()].sort()).toEqual(['FS', 'FS2', 'VS']);
    cache.dispose();
  });
  it('primes neighbouring sets at rest: links each and deletes it', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const store = storeOf('high', [['H1', 'H2']]);
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, f.gl as unknown as GlApi);
    cache.setTier('medium');
    let rest = false;
    await cache.prime(['high'], () => rest);
    await settle(1500);
    expect(f.linked.length).toBe(0);
    rest = true;
    await settle(1100);
    expect(f.linked.length).toBe(1);
    f.finishAll();
    await settle(200);
    expect(cache.stats.primed).toBe(1);
    expect(f.deletedPrograms).toEqual([f.programs[0]]);
    cache.dispose();
  });
  it("links the tier's own unlinked set into the pool when idle, keeps it past the trim, and hands it to a later pipeline", async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const store = storeOf('low', [['A', 'B'], ['C', 'D']]);
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, f.gl as unknown as GlApi);
    // The world's compile began before the set loaded: the set stays queued.
    cache.worldCompiling();
    await cache.prewarm('low');
    cache.take('A', 'B');
    await settle(20);
    expect(f.linked.length).toBe(0);
    cache.markFirstPicture();
    let idle = false;
    await cache.prime([], () => false, () => idle);
    await settle(500);
    expect(f.linked.length).toBe(0);
    idle = true;
    await settle(300);
    expect(f.linked.length).toBe(1);
    f.finishAll();
    await settle(30_000);
    expect(cache.stats.pooledLater).toBe(1);
    expect(f.deletedPrograms.length).toBe(0);
    const p = cache.take('C', 'D');
    expect(p?.program).toBe(f.programs[0]);
    expect(f.linked.length).toBe(1);
    cache.dispose();
  });
  it('drops programs kept for the tier in effect when the tier changes', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const store = storeOf('low', [['A', 'B']]);
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, f.gl as unknown as GlApi);
    cache.worldCompiling();
    await cache.prewarm('low');
    cache.markFirstPicture();
    await cache.prime([], () => false, () => true);
    await settle(300);
    f.finishAll();
    await settle(200);
    expect(cache.stats.pooledLater).toBe(1);
    cache.setTier('medium');
    expect(f.deletedPrograms).toEqual([f.programs[0]]);
    expect(cache.take('A', 'B')).toBeNull();
    cache.dispose();
  });
});

describe('lazy stages', () => {
  it('compiles a covered stage only when its shader is read', async () => {
    vi.useFakeTimers();
    const f = fakeGl();
    const cache = new ProgramCache(f.gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, storeOf('low', [['VX', 'FX']]), f.gl as unknown as GlApi);
    await cache.prewarm('low');
    await settle(20);
    const data = new Map<object, Record<string, unknown>>();
    let compiled = 0;
    interface FakeBackend {
      get(k: object): Record<string, unknown>;
      set(k: object, v: Record<string, unknown>): void;
      createProgram(program: { stage: string; code: string }): void;
    }
    const backend: FakeBackend = {
      get: (k) => data.get(k) ?? {},
      set: (k, v) => void data.set(k, v),
      createProgram(program) {
        compiled++;
        this.set(program, { shaderGPU: { code: program.code } });
      },
    };
    const undo = installLazyStages(backend, cache);
    const covered = { stage: 'fragment', code: 'FX' }, other = { stage: 'fragment', code: 'FY' };
    backend.createProgram(covered);
    backend.createProgram(other);
    expect(compiled).toBe(1);
    expect((backend.get(covered)['shaderGPU'] as { code: string }).code).toBe('FX');
    expect(compiled).toBe(2);
    undo();
    cache.dispose();
  });
});
