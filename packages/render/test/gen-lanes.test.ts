import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { GeneratorCache, getBuiltinGenerator, generateBuiltinSync, resolveBuiltin, validateOutput, type GeneratorOutput, type MeshPart, type WorkerLike } from '@aether/procgen';
import { createProcgenGeometrySource } from '../src/geometry/procgen-source';
import { makeSync, patch, world } from './helpers';
import { boxProjectedUvs, partToBufferGeometry, preparePart, prepareOutputParts, SPLIT_SOURCE_KEY, terrainUvs } from '../src/geometry/buffer-geometry';
import { metreUvMesh } from '../src/geometry/metre-uvs';
import { setPositionBounds } from '../src/geometry/position-bounds';
import { decodeOutput, encodeOutput } from '../src/geometry/ddc';
import { checkOutputShape, outputTransfer, parseGenRequest } from '../src/geometry/gen-protocol';
import { GenPool, LaneFailure } from '../src/geometry/gen-pool';
import { prepareSoft, softenPart } from '../src/geometry/soften';

/** The main-thread conversion before the generation lanes existed (kept verbatim as the reference). */
function referenceGeometry(part: MeshPart): BufferGeometry {
  const { positions, normals, indices, colors } = part;
  const vertexCount = positions.length / 3;
  const narrow = (ix: Uint32Array, n: number): Uint16Array | Uint32Array => (n > 65_536 ? ix : Uint16Array.from(ix));
  const g = new BufferGeometry();
  const hasNormals = normals instanceof Float32Array && normals.length === positions.length;
  const hasColors = colors instanceof Float32Array && colors.length === vertexCount * 3;
  const splat = part.material?.splat === true;
  const keep = (part.material?.foliage !== undefined || part.material?.waterKind === 'fall') && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  const authored = part.material?.finish !== undefined && part.uvs instanceof Float32Array && part.uvs.length === vertexCount * 2;
  if (!keep && !splat && indices.length > 0) {
    const r = metreUvMesh({ positions, normals, indices, colors: hasColors ? colors : null, uvs: authored ? (part.uvs as Float32Array) : null });
    const n = r.positions.length / 3;
    g.setAttribute('position', new BufferAttribute(r.positions, 3));
    g.setAttribute('normal', new BufferAttribute(r.normals, 3));
    if (r.colors) g.setAttribute('color', new BufferAttribute(r.colors, 3));
    g.setIndex(new BufferAttribute(narrow(r.indices, n), 1));
    g.setAttribute('uv', new BufferAttribute(r.uvs, 2));
    if (r.positions !== positions) g.userData[SPLIT_SOURCE_KEY] = { positions: r.positions, indices: r.indices };
    setPositionBounds(g, r.positions);
    return g;
  }
  g.setAttribute('position', new BufferAttribute(positions, 3));
  if (hasNormals) g.setAttribute('normal', new BufferAttribute(normals, 3));
  if (hasColors) g.setAttribute('color', new BufferAttribute(colors, 3));
  if (splat) {
    if (part.splat instanceof Float32Array && part.splat.length === vertexCount * 4) g.setAttribute('splat', new BufferAttribute(part.splat, 4));
    else {
      const w = new Float32Array(vertexCount * 4);
      for (let i = 0; i < vertexCount; i++) w[i * 4] = 1;
      g.setAttribute('splat', new BufferAttribute(w, 4));
    }
  }
  if (indices.length > 0) g.setIndex(new BufferAttribute(narrow(indices, vertexCount), 1));
  const uvs = keep ? (part.uvs as Float32Array) : splat ? terrainUvs(positions) : boxProjectedUvs(positions, g.getAttribute('normal').array as Float32Array);
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  setPositionBounds(g, positions);
  return g;
}

function sameGeometry(a: BufferGeometry, b: BufferGeometry): void {
  expect(Object.keys(a.attributes).sort()).toEqual(Object.keys(b.attributes).sort());
  for (const k of Object.keys(a.attributes)) {
    const x = a.getAttribute(k).array, y = b.getAttribute(k).array;
    expect(x.constructor).toBe(y.constructor);
    expect(Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength)), k).toBe(true);
  }
  const ia = a.getIndex()?.array, ib = b.getIndex()?.array;
  expect(ia?.constructor).toBe(ib?.constructor);
  expect(Array.from(ia ?? [])).toEqual(Array.from(ib ?? []));
  expect(a.boundingBox?.min.toArray()).toEqual(b.boundingBox?.min.toArray());
  expect(a.boundingBox?.max.toArray()).toEqual(b.boundingBox?.max.toArray());
  expect(a.boundingSphere?.center.toArray()).toEqual(b.boundingSphere?.center.toArray());
  expect(a.boundingSphere?.radius).toBe(b.boundingSphere?.radius);
  expect(!!a.userData[SPLIT_SOURCE_KEY]).toBe(!!b.userData[SPLIT_SOURCE_KEY]);
}

function builtin(id: string, params: Record<string, unknown> = {}): GeneratorOutput {
  const gen = getBuiltinGenerator(id);
  if (!gen) throw new Error(`no generator ${id}`);
  const v = validateOutput(generateBuiltinSync(id, resolveBuiltin(gen, params as never), 3));
  if (!v.ok) throw new Error(v.error);
  return v.output;
}

/** A flat-shaded bumpy grid (every triangle its own three vertices and face normal) in an organic preset. */
function facetedHill(preset: 'grass' | 'stone'): MeshPart {
  const n = 12;
  const h = (x: number, z: number): number => Math.sin(x * 0.7) * Math.cos(z * 0.5) * 0.8;
  const pos: number[] = [];
  const nrm: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      pos.push(p[0]!, p[1]!, p[2]!);
      nrm.push(nx, ny, nz);
    }
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = (x: number, z: number): number[] => [x, h(x, z), z];
    tri(p(i, j), p(i, j + 1), p(i + 1, j));
    tri(p(i + 1, j), p(i, j + 1), p(i + 1, j + 1));
  }
  const indices = new Uint32Array(pos.length / 3).map((_, i) => i);
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices, material: { preset } };
}

// A spread of outputs: metre UVs with split corners, authored finishes, foliage cards, layered terrain, vertex colours.
const SAMPLE = ['boulder', 'classical-temple', 'tree-spruce', 'terrain', 'shipping-container', 'sandbag-wall', 'hedge', 'cliff-face'].filter((id) => !!getBuiltinGenerator(id));

describe('prepared geometry (generation lanes)', () => {
  it('builds exactly the geometry the main thread built before, for every part', () => {
    expect(SAMPLE.length).toBeGreaterThanOrEqual(6);
    let parts = 0;
    for (const id of SAMPLE) {
      const out = builtin(id);
      for (const part of out.parts) {
        const ref = referenceGeometry(part);
        sameGeometry(partToBufferGeometry(part), ref);
        const prepared = preparePart(part);
        expect(prepared).not.toBeNull();
        sameGeometry(partToBufferGeometry({ ...part, prepared: prepared ?? undefined }), ref);
        parts++;
      }
    }
    expect(parts).toBeGreaterThan(10);
  });

  it('softens in the lane exactly as on the main thread', () => {
    let softened = 0;
    for (const parts of [...SAMPLE.map((id) => builtin(id).parts), [facetedHill('grass'), facetedHill('stone')]]) {
      for (const part of parts) {
        const main = softenPart(part);
        const lane: MeshPart = { ...part };
        lane.prepared = preparePart(lane) ?? undefined;
        prepareSoft(lane, preparePart);
        const fromLane = softenPart(lane);
        expect(Array.from(fromLane.normals)).toEqual(Array.from(main.normals));
        if (main !== part) {
          softened++;
          expect(fromLane.prepared).toBeDefined();
          sameGeometry(partToBufferGeometry(fromLane), referenceGeometry(main));
        }
      }
    }
    expect(softened).toBeGreaterThan(0);
  });

  it('round-trips an output through the cache format, shared arrays shared, each in a buffer of its own', async () => {
    const out = builtin('classical-temple');
    prepareOutputParts(out.parts);
    const enc = encodeOutput(out);
    const back = decodeOutput(await enc.blob.arrayBuffer());
    expect(checkOutputShape(back)).toBe(true);
    expect(back.parts.length).toBe(out.parts.length);
    out.parts.forEach((p, i) => {
      const q = back.parts[i] as MeshPart;
      expect(Array.from(q.positions)).toEqual(Array.from(p.positions));
      expect(q.material).toEqual(p.material);
      sameGeometry(partToBufferGeometry(q), partToBufferGeometry(p));
      if (p.prepared?.positions === p.positions) expect(q.prepared?.positions).toBe(q.positions);
      expect(q.positions.byteOffset).toBe(0);
      expect(q.positions.buffer.byteLength).toBe(q.positions.byteLength);
    });
    expect(back.colliders).toEqual(out.colliders);
    expect(back.bounds).toEqual(out.bounds);
    const bufs = outputTransfer(back);
    expect(new Set(bufs).size).toBe(bufs.length);
  });

  it('rejects malformed entries and requests', () => {
    expect(() => decodeOutput(new ArrayBuffer(4))).toThrow();
    const out = builtin('boulder');
    const bad = { ...out, parts: [{ ...(out.parts[0] as MeshPart), normals: new Float32Array(3) }] };
    expect(checkOutputShape(bad)).toBe(false);
    expect(parseGenRequest({ type: 'gen', id: 1, key: 'k', generator: 'x'.repeat(65), params: {}, seed: 1 })).toBeNull();
    expect(parseGenRequest({ type: 'lookup', id: 1 })).toBeNull();
    expect(parseGenRequest({ type: 'post', id: 2, key: null, raw: {} })).toMatchObject({ type: 'post' });
  });
});

/** In-process lane: answers like gen.worker.ts (no cache), in order. */
class FakeLane implements WorkerLike {
  static log: string[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(private readonly opts: { crash?: boolean; hits?: Set<string> } = {}) {
    setTimeout(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent), 0);
  }
  postMessage(message: unknown): void {
    const req = parseGenRequest(message);
    if (!req) return;
    FakeLane.log.push(`${req.type}:${req.key}`);
    if (this.opts.crash) {
      setTimeout(() => this.onerror?.({} as Event), 0);
      return;
    }
    setTimeout(() => {
      if (req.type === 'lookup') {
        const hit = this.opts.hits?.has(req.key) ? builtin('boulder') : null;
        this.onmessage?.({ data: { type: 'result', id: req.id, ok: true, output: hit, hit: !!hit } } as MessageEvent);
      } else if (req.type === 'gen') {
        const out = builtin(req.generator);
        prepareOutputParts(out.parts);
        this.onmessage?.({ data: { type: 'result', id: req.id, ok: true, output: out, hit: false } } as MessageEvent);
      } else {
        const v = validateOutput(req.raw);
        this.onmessage?.({ data: v.ok ? { type: 'result', id: req.id, ok: true, output: v.output, hit: false } : { type: 'result', id: req.id, ok: false, error: v.error } } as MessageEvent);
      }
    }, 1);
  }
  terminate(): void {
    this.onmessage = null;
  }
}

describe('GenPool', () => {
  it('runs a burst nearest first and returns prepared output', async () => {
    FakeLane.log = [];
    const pool = new GenPool({ lanes: 1, createWorker: () => new FakeLane() });
    const order: number[] = [];
    await Promise.all([30, 10, 20].map((p) => pool.builtin('boulder', {}, 1, { key: `k${p}`, priority: p }).then((out) => {
      order.push(p);
      expect(out.parts[0]?.prepared).toBeDefined();
    })));
    expect(FakeLane.log).toEqual(['gen:k10', 'gen:k20', 'gen:k30']);
    expect(order).toEqual([10, 20, 30]);
    expect(pool.stats.generated).toBe(3);
    pool.dispose();
  });

  it('serves custom generators from the cache, else validates sandbox output in a lane', async () => {
    FakeLane.log = [];
    const pool = new GenPool({ lanes: 2, createWorker: () => new FakeLane({ hits: new Set(['hit']) }) });
    let sandboxRuns = 0;
    const sandbox = {
      run: async () => { sandboxRuns++; return builtin('boulder'); },
      runRaw: async () => { sandboxRuns++; return builtin('boulder'); },
      dispose: () => undefined,
    };
    const def = { id: 'x', description: '', params: {}, source: 'return api.build();' };
    await pool.custom(sandbox, def, {}, 1, { key: 'hit', priority: 0 });
    expect(sandboxRuns).toBe(0);
    const out = await pool.custom(sandbox, def, {}, 1, { key: 'miss', priority: 0 });
    expect(sandboxRuns).toBe(1);
    expect(checkOutputShape(out)).toBe(true);
    expect(FakeLane.log).toEqual(['lookup:hit', 'lookup:miss', 'post:miss']);
    expect(pool.stats).toMatchObject({ hits: 1, posted: 1, fallbacks: 0 });
    pool.dispose();
  });

  it('falls back when a lane crashes, and rejects with LaneFailure for built-ins', async () => {
    const pool = new GenPool({ lanes: 1, createWorker: () => new FakeLane({ crash: true }) });
    await expect(pool.builtin('boulder', {}, 1, { key: 'k', priority: 0 })).rejects.toBeInstanceOf(LaneFailure);
    const sandbox = { run: async () => builtin('boulder'), dispose: () => undefined };
    const out = await pool.custom(sandbox, { id: 'x', description: '', params: {}, source: 'x' }, {}, 1, { key: 'k', priority: 0 });
    expect(out.parts.length).toBeGreaterThan(0);
    expect(pool.stats.fallbacks).toBeGreaterThan(0);
    pool.dispose();
  });
});

describe('generation from the scene', () => {
  const rock = (id: string, x: number, seed: number) => ({ id, transform: { position: [x, 0, 0] as [number, number, number] }, shape: { kind: 'procedural' as const, generator: 'boulder', params: {}, seed } });
  /** The seed field of a logged output key (`generator|seed|source|params`). */
  const seedOf = (line: string): string => line.split('|')[1] ?? '';

  it('generates nearest the focus first, and an edit regenerates only the edited entity', async () => {
    FakeLane.log = [];
    const pool = new GenPool({ lanes: 1, createWorker: () => new FakeLane() });
    const source = createProcgenGeometrySource({ pool, cache: new GeneratorCache(64) });
    const { sync } = makeSync({ source });
    sync.setGenerationFocus([100, 0, 0]);
    const w0 = world([rock('far', 0, 1), rock('near', 90, 2), rock('mid', 50, 3)]);
    await sync.setWorld(w0);
    expect(FakeLane.log.map(seedOf)).toEqual(['2', '3', '1']);
    FakeLane.log = [];
    await sync.setWorld(patch(w0, [{ op: 'update', id: 'mid', set: { shape: { kind: 'procedural', generator: 'boulder', params: {}, seed: 9 } } }]));
    expect(FakeLane.log.map(seedOf)).toEqual(['9']);
    sync.dispose();
    pool.dispose();
  });
});
