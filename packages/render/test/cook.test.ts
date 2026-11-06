import { afterEach, describe, expect, it, vi } from 'vitest';
import { cookedProgramStore, openCookedPackage } from '../src/cook/cooked';
import { COOK_FORMAT, encodeProgramSetFile, parseCookedProgramSet, parseCookManifest, programSetLines, PROGRAM_SET_FORMAT, readProgramSetFile, worldIrHash, type CookedProgramSet, type CookManifest } from '../src/cook/format';
import { LaneCookSource } from '../src/cook/lane-source';
import { decodeOutput, encodeOutput } from '../src/geometry/ddc';
import { ProgramCache, sourceHash, type GlApi, type ProgramStore, type StoredSet } from '../src/gpu/program-cache';
import type { RenderTier } from '../src/gpu/finishing';
import type { GeneratorOutput } from '../src/types';

afterEach(() => {
  vi.useRealTimers();
});

function output(n: number): GeneratorOutput {
  const positions = new Float32Array(Array.from({ length: 9 }, (_, i) => i + n));
  return { parts: [{ positions, normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), material: 'stone' }], colliders: [], stats: { ms: 1, triangles: 1 } } as unknown as GeneratorOutput;
}

async function encoded(out: GeneratorOutput): Promise<Uint8Array> {
  return new Uint8Array(await encodeOutput(out).blob.arrayBuffer());
}

/** A pack of entries (each 8-aligned) and the manifest index of each. */
async function packOf(outs: GeneratorOutput[]): Promise<{ buf: ArrayBuffer; at: Array<[number, number]> }> {
  const bodies = await Promise.all(outs.map(encoded));
  const at: Array<[number, number]> = [];
  let size = 0;
  for (const b of bodies) {
    at.push([size, b.byteLength]);
    size += Math.ceil(b.byteLength / 8) * 8;
  }
  const buf = new Uint8Array(size);
  bodies.forEach((b, i) => buf.set(b, at[i]![0]));
  return { buf: buf.buffer, at };
}

const HEX = (c: string): string => c.repeat(64);

function manifest(over: Partial<CookManifest> = {}): CookManifest {
  return {
    format: COOK_FORMAT,
    irHash: HEX('a'),
    genVersion: 'gen1.p3',
    dir: '0123456789abcdef/',
    cookedAt: '2026-11-06T00:00:00.000Z',
    world: { id: 'w', name: 'W', entities: 2 },
    opening: { position: [1, 2, 3], target: [4, 5, 6] },
    startMode: 'play',
    profile: 'game',
    partition: { cellSize: 32, origin: [-64, -64] },
    cells: [{ key: '0:1,2', bounds: [0, 0, 1, 1], entries: 1, bytes: 100, packs: [0] }],
    packs: [{ file: 'packs/0000.bin', bytes: 1024 }],
    entries: { [HEX('b')]: [0, 0, 100, 0] },
    programs: { medium: { file: 'programs/medium.json', bytes: 10, programs: 1 } },
    lightmap: null,
    ...over,
  };
}

describe('cooked package format', () => {
  it('accepts a well-formed manifest and refuses out-of-range or unsafe ones', () => {
    expect(parseCookManifest(manifest()).ok).toBe(true);
    expect(parseCookManifest({ ...manifest(), format: COOK_FORMAT + 1 }).ok).toBe(false);
    expect(parseCookManifest(manifest({ dir: '../x/' })).ok).toBe(false);
    expect(parseCookManifest(manifest({ packs: [{ file: '/etc/passwd', bytes: 1 }] })).ok).toBe(false);
    expect(parseCookManifest(manifest({ entries: { [HEX('b')]: [0, 1000, 100, 0] } })).ok).toBe(false); // past the pack
    expect(parseCookManifest(manifest({ entries: { [HEX('b')]: [0, 4, 100, 0] } })).ok).toBe(false); // unaligned
    expect(parseCookManifest(manifest({ entries: { [HEX('b')]: [1, 0, 100, 0] } })).ok).toBe(false); // no such pack
    expect(parseCookManifest(manifest({ startMode: 'fly' as never })).ok).toBe(false);
    expect(parseCookManifest(manifest({ programs: { epic: { file: 'p.json', bytes: 1, programs: 1 } } as never })).ok).toBe(false);
  });

  it('checks a program set file: its tier, and pairs that name sources it holds', () => {
    const set = { format: COOK_FORMAT, tier: 'high', boot: 1, pairs: [['0123456789abcdef1', 'fedcba98765432101']], sources: { '0123456789abcdef1': 'v', fedcba98765432101: 'f' } };
    expect(parseCookedProgramSet(set, 'high')?.boot).toBe(1);
    expect(parseCookedProgramSet(set, 'low')).toBeNull();
    expect(parseCookedProgramSet({ ...set, pairs: [['0123456789abcdef1', '00000000000000002']] }, 'high')).toBeNull();
    expect(parseCookedProgramSet({ ...set, boot: 9 }, 'high')?.boot).toBe(0);
  });

  it('stores each line of GLSL once and rebuilds the exact sources from a gzipped file (format 3), and still reads format 2', async () => {
    const common = Array.from({ length: 50 }, (_, i) => `float f${i}(float x) { return x * ${i}.0; }`).join('\n');
    const codes = ['#version 300 es\nvoid main() {}', `#version 300 es\n${common}\nout vec4 c;\nvoid main() { c = vec4(1.0); }`, `#version 300 es\n${common}\nout vec4 c;\nvoid main() { c = vec4(0.0); }\n`, ''];
    const sources = Object.fromEntries(codes.map((c) => [sourceHash(c), c]));
    const pairs: Array<[string, string]> = [[sourceHash(codes[0]!), sourceHash(codes[1]!)], [sourceHash(codes[0]!), sourceHash(codes[2]!)], [sourceHash(codes[3]!), sourceHash(codes[1]!)]];
    const plain = { tier: 'medium' as const, boot: 2, pairs, sources };
    const lines = programSetLines(plain);
    // The 50 shared lines are stored once, and each source is a few runs.
    expect(lines.lines.length).toBeLessThan(60);
    expect(lines.sources[sourceHash(codes[2]!)]!.length).toBeLessThanOrEqual(8);
    const bytes = await encodeProgramSetFile(plain);
    expect(bytes[0]).toBe(0x1f);
    const back = parseCookedProgramSet(await readProgramSetFile(bytes), 'medium');
    expect(back?.format).toBe(PROGRAM_SET_FORMAT);
    expect(back?.sources).toEqual(sources);
    expect(back?.pairs).toEqual(pairs);
    expect(back?.boot).toBe(2);
    // A host that took the gzip off already: the JSON is read as it is.
    expect(parseCookedProgramSet(await readProgramSetFile(new TextEncoder().encode(JSON.stringify(lines))), 'medium')?.sources).toEqual(sources);
    // Format 2 (plain JSON, cooks before this one).
    const v2 = parseCookedProgramSet(await readProgramSetFile(new TextEncoder().encode(JSON.stringify({ format: COOK_FORMAT, ...plain }))), 'medium');
    expect(v2?.sources).toEqual(sources);
    // Runs past the lines, or a source that does not rebuild to its hash's length, are refused.
    expect(parseCookedProgramSet({ ...lines, sources: { ...lines.sources, [sourceHash(codes[1]!)]: [0, lines.lines.length + 1] } }, 'medium')).toBeNull();
    expect(parseCookedProgramSet({ ...lines, sources: { ...lines.sources, [sourceHash(codes[1]!)]: [0, 1] } }, 'medium')).toBeNull();
    await expect(readProgramSetFile(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).rejects.toThrow();
  });

  it('hashes the IR canonically, without the opening and the start mode', async () => {
    const a = await worldIrHash({ name: 'x', seed: 1, entities: { a: 1 } });
    expect(await worldIrHash({ entities: { a: 1 }, seed: 1, name: 'x' })).toBe(a);
    expect(await worldIrHash({ entities: { a: 1 }, seed: 1, name: 'x', opening: { position: [0, 0, 0] }, startMode: 'orbit' })).toBe(a);
    expect(await worldIrHash({ entities: { a: 2 }, seed: 1, name: 'x' })).not.toBe(a);
  });

  it('decodes an entry inside a pack, in the geometry cache encoding', async () => {
    const { buf, at } = await packOf([output(0), output(100)]);
    const second = decodeOutput(buf, at[1]![0], at[1]![1]);
    expect(Array.from(second.parts[0]!.positions).slice(0, 2)).toEqual([100, 101]);
    expect(() => decodeOutput(buf, 4, 16)).toThrow();
    expect(() => decodeOutput(buf, at[1]![0], buf.byteLength)).toThrow();
  });
});

describe('a lane reading a cooked package', () => {
  it('serves entries from a pack fetched once, and reads a failed fetch as a miss', async () => {
    const { buf, at } = await packOf([output(0), output(7)]);
    const fetches: string[] = [];
    const src = new LaneCookSource({ packs: ['p0', 'p1'], entries: { [HEX('1')]: [0, at[0]![0], at[0]![1], 0], [HEX('2')]: [0, at[1]![0], at[1]![1], 0], [HEX('3')]: [1, 0, 16, 0] } }, async (u) => {
      fetches.push(u);
      return u === 'p0' ? buf : null;
    });
    expect(src.has(HEX('9'))).toBe(false);
    expect((await src.get(HEX('2')))?.output.parts[0]!.positions[0]).toBe(7);
    expect((await src.get(HEX('1')))?.encoded.byteLength).toBe(at[0]![1]);
    expect(await src.get(HEX('3'))).toBeNull();
    expect(fetches).toEqual(['p0', 'p1']);
  });
});

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

function cookedSet(tier: RenderTier, pairs: Array<[string, string]>, boot: number): CookedProgramSet {
  const sources: Record<string, string> = {};
  for (const [v, f] of pairs) {
    sources[sourceHash(v)] = v;
    sources[sourceHash(f)] = f;
  }
  return { format: COOK_FORMAT, tier, boot, pairs: pairs.map(([v, f]) => [sourceHash(v), sourceHash(f)]), sources };
}

describe('the cooked program store', () => {
  it("serves the browser's own set, the cooked boot pairs and the rest apart, and writes nothing cooked into it", async () => {
    const inner = memoryStore({ medium: { session: 4, entries: [{ v: sourceHash('OLDV'), f: sourceHash('OLDF'), uses: 2, last: 4 }] } }, new Map([[sourceHash('OLDV'), 'OLDV'], [sourceHash('OLDF'), 'OLDF']]));
    const store = cookedProgramStore(inner, async (t) => (t === 'medium' ? cookedSet('medium', [['V1', 'F1'], ['V2', 'F2']], 1) : null));
    // The browser's own set is not displaced by the cooked pairs.
    const set = await store.getSet('medium');
    expect(set?.entries.map((e) => e.v)).toEqual([sourceHash('OLDV')]);
    expect([...((await store.boot!('medium')) ?? [])]).toEqual([`${sourceHash('V1')}:${sourceHash('F1')}`]);
    expect([...((await store.later!('medium')) ?? [])]).toEqual([`${sourceHash('V2')}:${sourceHash('F2')}`]);
    const src = await store.getSources([sourceHash('V2'), sourceHash('OLDF')]);
    expect(src.get(sourceHash('V2'))).toBe('V2');
    expect(src.get(sourceHash('OLDF'))).toBe('OLDF');
    await store.putSet('medium', set!);
    expect(inner.sources.has(sourceHash('F2'))).toBe(false);
    expect(inner.sets.medium?.entries).toHaveLength(1);
    expect(await store.boot!('low')).toBeNull();
  });

  it('links the boot pairs of the tier the world settles on, and the rest of the cooked set only after the first picture', async () => {
    vi.useFakeTimers();
    const linked: string[] = [];
    const gl = {
      VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3,
      isContextLost: () => false,
      createProgram: () => ({ shaders: [] as string[] }),
      createShader: (t: number) => ({ t, src: '' }),
      shaderSource: (sh: { src: string }, src: string) => void (sh.src = src),
      compileShader() {},
      attachShader: (p: { shaders: string[] }, s: { src: string }) => void p.shaders.push(s.src),
      detachShader() {},
      linkProgram: (p: { shaders: string[] }) => void linked.push(p.shaders.join('+')),
      getProgramParameter: () => true,
      deleteShader() {}, deleteProgram() {},
    };
    const sets: Partial<Record<RenderTier, CookedProgramSet>> = {
      medium: cookedSet('medium', [['MV1', 'MF1'], ['MV2', 'MF2']], 2),
      low: cookedSet('low', [['LV1', 'LF1'], ['LV2', 'LF2'], ['LV3', 'LF3']], 2),
    };
    const store = cookedProgramStore(memoryStore(), async (t) => sets[t] ?? null);
    const cache = new ProgramCache(gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, gl as unknown as GlApi);
    const boot = cache.prewarm('medium');
    // The world turns out heavy before the medium set loaded: the low tier's boot pairs link instead.
    cache.setTier('low');
    await boot;
    await vi.advanceTimersByTimeAsync(100);
    expect(linked.sort()).toEqual(['LF1+LV1', 'LF2+LV2']);
    cache.markFirstPicture();
    await cache.prime([], () => true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(linked).toContain('LF3+LV3');
    expect(linked.some((l) => l.startsWith('M'))).toBe(false);
    cache.dispose();
  });

  it("keeps linking a cooked world's boot set after the world's compile begins", async () => {
    vi.useFakeTimers();
    const done = new Set<object>();
    const programs: object[] = [];
    let id = 0;
    const gl = {
      VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3,
      isContextLost: () => false,
      createProgram: () => {
        const p = { id: ++id, shaders: [] as object[] };
        programs.push(p);
        return p;
      },
      createShader: () => ({ id: ++id }),
      shaderSource() {}, compileShader() {},
      attachShader: (p: { shaders: object[] }, s: object) => void p.shaders.push(s),
      detachShader: (p: { shaders: object[] }, s: object) => void p.shaders.splice(p.shaders.indexOf(s), 1),
      linkProgram() {},
      getProgramParameter: (p: object, k: number) => (k === 42 ? done.has(p) : true),
      deleteShader() {}, deleteProgram() {},
    };
    const pairs: Array<[string, string]> = Array.from({ length: 10 }, (_, i) => [`V${i}`, `F${i}`]);
    const store = cookedProgramStore(memoryStore(), async () => cookedSet('low', pairs, 8));
    const cache = new ProgramCache(gl as unknown as WebGL2RenderingContext, { COMPLETION_STATUS_KHR: 42 }, store, gl as unknown as GlApi);
    await cache.prewarm('low');
    await vi.advanceTimersByTimeAsync(20);
    expect(cache.stats.eager).toBe(8);
    expect(cache.stats.submitted).toBe(6);
    cache.worldCompiling();
    programs.forEach((p) => done.add(p));
    await vi.advanceTimersByTimeAsync(40);
    // The two left of the boot set go on; the two outside it wait for idle priming.
    expect(cache.stats.submitted).toBe(8);
    cache.dispose();
  });
});

describe('opening a cooked package', () => {
  const world = { name: 'W', entities: {} };
  const respond = (body: unknown, type = 'application/json'): Response => new Response(JSON.stringify(body), { headers: { 'content-type': type } });

  it('opens a package cooked from this IR by this build, and resolves its files against the manifest', async () => {
    const m = manifest({ irHash: await worldIrHash(world) });
    const r = await openCookedPackage('https://h.test/cooked/w/manifest.json', world, { genVersion: 'gen1.p3', fetch: async () => respond(m) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg.laneIndex.packs).toEqual(['https://h.test/cooked/w/0123456789abcdef/packs/0000.bin']);
    expect(r.pkg.lightmapBase).toBeNull();
    // Hugging Face serves a dataset's .json files as text/plain, from a redirect: files resolve against the final URL's request.
    const hf = 'https://huggingface.co/datasets/o/d/resolve/main/w/manifest.json';
    const remote = await openCookedPackage(hf, world, { genVersion: 'gen1.p3', fetch: async () => respond(m, 'text/plain; charset=utf-8') });
    expect(remote.ok && remote.pkg.laneIndex.packs).toEqual(['https://huggingface.co/datasets/o/d/resolve/main/w/0123456789abcdef/packs/0000.bin']);
  });

  it('falls back on a stale cook, a missing one or an HTML answer', async () => {
    const m = manifest({ irHash: await worldIrHash(world) });
    const url = 'https://h.test/cooked/w/manifest.json';
    expect((await openCookedPackage(url, world, { genVersion: 'gen2.p3', fetch: async () => respond(m) })).ok).toBe(false);
    expect((await openCookedPackage(url, { ...world, name: 'X' }, { genVersion: 'gen1.p3', fetch: async () => respond(m) })).ok).toBe(false);
    expect((await openCookedPackage(url, world, { genVersion: 'gen1.p3', fetch: async () => new Response('nope', { status: 404 }) })).ok).toBe(false);
    expect((await openCookedPackage(url, world, { genVersion: 'gen1.p3', fetch: async () => respond(m, 'text/html') })).ok).toBe(false);
    expect((await openCookedPackage(url, world, { genVersion: 'gen1.p3', fetch: async () => Promise.reject(new TypeError('Failed to fetch')) })).ok).toBe(false);
    expect((await openCookedPackage(url, world, { genVersion: 'gen1.p3', fetch: async () => new Response('{', { headers: { 'content-type': 'text/plain' } }) })).ok).toBe(false);
  });
});
