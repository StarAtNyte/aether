/**
 * The publish lightmap baked outside the page: by Cycles (Blender, GPU when one is free, else its CPU) or by the renderer's own
 * CPU baker on several threads, from a bake job the cook takes from the page (`renderer.lightBakeJob(quality, samples)`). The
 * output is the `.lmap` file the page itself would write (`lightmap-controller.ts` `finishBake`): same unwrap, same texels,
 * same denoise, same encoding (`lightmap.ts` `encodeLightmap` through `LightmapBaker.finishFrom`), PNG image.
 *
 *   npx tsx scripts/blender-bake.ts --job=<file.lbjob> --out=<dir> [--blender=<path>] [--device=auto|GPU|OPTIX|CUDA|CPU] [--bounces=4] [--ground=lit|emit] [--keep]
 *   npx tsx scripts/blender-bake.ts --job=<file.lbjob> --out=<dir> --cpu[=<threads>]
 *
 * Writes `<out>/<key>.lmap` and prints one line `RESULT {json}` (file, device, wall times). Run it in a capped scope; Blender
 * is started under its own (`systemd-run --user --scope -p MemoryMax=12G nice -n 10`).
 *
 * What a Cycles part is (`relight.ts`; scripts/blender/bake-light.py bakes them): indirect irradiance only (direct sun and
 * lamps stay real time), every surface the trace scene's per-triangle albedo (Lambertian), the open ground a plane at
 * `ground.y` with its albedo:
 * - sky0: from a uniform sky of radiance 1/π above the horizon (irradiance 1 on an open up-facing surface: the CPU bake's
 *   `vis · a` at a hit);
 * - sky1: from a cosine sky, radiance 3/(2π) · max(0, dir.y) (irradiance 1 on an open up-facing surface and on the ground,
 *   0 on a down-facing one: the CPU bake's `vis · b · n.y` at a hit, which no sky reproduces exactly; a vertical wall open to
 *   the sky gets 1/π here and 0 there). A split into an upper and a lower sky (sky1 = (up − down) / 2) does not work: the
 *   ground plane hides the lower half, which then bakes as nothing and sky1 comes out equal to sky0;
 * - lamp: every lamp as a point light of 4π × its candela (no range cut);
 * - sun k: a sun of irradiance 1 toward key k (0.5°);
 * - vis: the cosine-weighted share of rays that reach the sky (the ground plane stops those below the horizon), and the share
 *   that hits a one-sided back face (a texel inside a wall: filled from its neighbours, as the CPU bake does).
 * Differences from the CPU bake (`LightmapBaker`): Cycles traces every bounce (the CPU bake gathers one bounce and reads the
 * rest from the light volume), the ground is shadowed by the building (the CPU bake's ground is always unoccluded), lamps have
 * no range cut, and rays are not cut at 30–60 m.
 *
 * Job file (`.lbjob`, {@link encodeJob}): u32 magic 'AELJ', u32 header length, header JSON, padding to 8, then the arrays,
 * each 8-aligned; in the header a typed array is `{ "$ta": "<constructor>", "o": <byte offset into the data>, "n": <length> }`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { crc32, deflateSync } from 'node:zlib';
import { TraceScene } from '../packages/render/src/environment/light-volume';
import { LIGHTMAP_VERSION, LightmapBaker, meshTriangleCount, quantizeUv, rasterizeTexels, unwrapLightmap, type LightmapLayout, type LightmapResult, type ProxyBox, type Texels } from '../packages/render/src/environment/lightmap';
import { LIGHTMAP_MAX_ASSET_BYTES, packAsset, stackAtlas, type LightmapAssetMeta } from '../packages/render/src/environment/lightmap-asset';
import { parseLightmapRequest, type LightmapRequest } from '../packages/render/src/environment/lightmap-protocol';
import { partCount, PART_LAMP, PART_SKY0, PART_SKY1, PART_SUN0 } from '../packages/render/src/environment/relight';

export const DEFAULT_BLENDER = '/home/at-office/tools/blender-4.2.3-linux-x64/blender';
const HERE = dirname(fileURLToPath(import.meta.url));
const PY = join(HERE, 'blender', 'bake-light.py');
/** Metres a receiver sits off its surface: the CPU bake's ray bias (`lightmap.ts` RAY_BIAS). */
const BIAS = 0.02;
const MAGIC = 0x4a4c4541; // 'AELJ'

export interface BakeJob {
  key: string;
  quality: string;
  triCounts: number[];
  request: LightmapRequest;
}

type Share = ReturnType<LightmapBaker['gathered']>;

// --- the job file ---------------------------------------------------------------------------------------------------------

const TYPED = { Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array } as const;

/** Serialise a job (the cook's page writes the same bytes, scripts/cook.ts). */
export function encodeJob(job: unknown): Uint8Array {
  const blobs: Array<{ bytes: Uint8Array; o: number }> = [];
  let size = 0;
  const walk = (v: unknown): unknown => {
    if (ArrayBuffer.isView(v)) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const o = size;
      blobs.push({ bytes, o });
      size += Math.ceil(bytes.length / 8) * 8;
      return { $ta: v.constructor.name, o, n: (v as unknown as { length: number }).length };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const head = new TextEncoder().encode(JSON.stringify(walk(job)));
  const start = Math.ceil((8 + head.length) / 8) * 8;
  const out = new Uint8Array(start + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  for (const b of blobs) out.set(b.bytes, start + b.o);
  return out;
}

export function decodeJob(bytes: Uint8Array): BakeJob {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a bake job file');
  const len = dv.getUint32(4, true);
  const start = Math.ceil((8 + len) / 8) * 8;
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as unknown;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['$ta'] === 'string') {
        const C = TYPED[o['$ta'] as keyof typeof TYPED];
        if (!C) throw new Error(`job: unknown array type ${o['$ta']}`);
        const n = o['n'] as number;
        const at = start + (o['o'] as number);
        if (at + n * C.BYTES_PER_ELEMENT > bytes.length) throw new Error('job: truncated');
        // A copy: the file's bytes are not aligned for every type.
        return new (C as Float32ArrayConstructor)(bytes.buffer.slice(bytes.byteOffset + at, bytes.byteOffset + at + n * C.BYTES_PER_ELEMENT) as ArrayBuffer);
      }
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const raw = walk(head) as { key: string; quality: string; triCounts: number[]; request: unknown };
  const request = parseLightmapRequest(raw.request);
  if (!request) throw new Error('job: the bake request does not validate');
  if (typeof raw.key !== 'string' || !/^lm\d+-[0-9a-f]{32}$/.test(raw.key)) throw new Error('job: bad key');
  if (!Array.isArray(raw.triCounts) || raw.triCounts.length !== request.meshes.length) throw new Error('job: bad triangle counts');
  return { key: raw.key, quality: String(raw.quality), triCounts: raw.triCounts, request };
}

// --- shared ----------------------------------------------------------------------------------------------------------

function proxiesOf(r: LightmapRequest): ProxyBox[] {
  const out: ProxyBox[] = [];
  for (let i = 0; i + 6 < r.proxies.length; i += 7) {
    const p = r.proxies;
    out.push({ lo: [p[i]!, p[i + 1]!, p[i + 2]!], hi: [p[i + 3]!, p[i + 4]!, p[i + 5]!], tri: p[i + 6]! });
  }
  return out;
}

/** A CPU baker of the job (split: one thread's share of the gather). */
export function bakerFor(r: LightmapRequest, layout: LightmapLayout, split?: { index: number; count: number }): LightmapBaker {
  const scene = new TraceScene({ positions: r.positions, albedo: r.albedo, twoSided: r.twoSided });
  return new LightmapBaker({ scene, proxies: proxiesOf(r), meshes: r.meshes, layout, grid: r.grid, field: r.field, stride: r.stride, codes: r.codes, sunKeys: r.sunKeys, ground: r.ground, lamps: r.lamps, samples: r.samples, ...(split ? { split } : {}) });
}

export function layoutOf(r: LightmapRequest): LightmapLayout {
  const layout = unwrapLightmap(r.meshes, r.maxSize, r.density);
  if (!layout) throw new Error('no surface could be unwrapped');
  return layout;
}

/** Covered texels in the bakers' order (`LightmapBaker` raster: increasing atlas index). */
function coveredOrder(t: Texels): Int32Array {
  const list: number[] = [];
  for (let o = 0; o < t.cov.length; o++) if (t.cov[o] === 1) list.push(o);
  return Int32Array.from(list);
}

// --- Cycles ----------------------------------------------------------------------------------------------------------

/**
 * A triangle's atlas coordinates grown by one texel on every side (its world corners stay): `rasterizeTexels` gives a texel to
 * a triangle up to a texel outside it (the nearest point of the triangle), Cycles only where the texel's centre lies inside; a
 * chart thinner than a texel would otherwise bake no texel at all. A corner moves at most two texels (slivers; charts are
 * four texels apart, `CHART_PAD` on each side, so a grown triangle never reaches another chart).
 */
export function dilateUv(uv: Float32Array, at: number, S: number): number[] {
  const p = [0, 1, 2].map((k) => [uv[at + k * 2]! * S, uv[at + k * 2 + 1]! * S] as [number, number]);
  const area = (p[1]![0] - p[0]![0]) * (p[2]![1] - p[0]![1]) - (p[2]![0] - p[0]![0]) * (p[1]![1] - p[0]![1]);
  if (!(Math.abs(area) > 1e-9)) return Array.from(uv.subarray(at, at + 6));
  const sgn = area > 0 ? 1 : -1;
  // Each edge's line moved one texel outward: a point and the direction.
  const lines = [0, 1, 2].map((k) => {
    const a = p[k]!, b = p[(k + 1) % 3]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    // Outward normal of a counter-clockwise triangle is (dy, −dx).
    const nx = (sgn * dy) / l, ny = (-sgn * dx) / l;
    return { x: a[0] + nx, y: a[1] + ny, dx, dy };
  });
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    // Corner k is where the moved edges k−1 (into k) and k (out of k) meet.
    const A = lines[(k + 2) % 3]!, B = lines[k]!;
    const den = A.dx * B.dy - A.dy * B.dx;
    let x = p[k]![0], y = p[k]![1];
    if (Math.abs(den) > 1e-12) {
      const s = ((B.x - A.x) * B.dy - (B.y - A.y) * B.dx) / den;
      x = A.x + A.dx * s;
      y = A.y + A.dy * s;
    }
    const mx = x - p[k]![0], my = y - p[k]![1];
    const m = Math.hypot(mx, my);
    if (m > 2) {
      x = p[k]![0] + (mx * 2) / m;
      y = p[k]![1] + (my * 2) / m;
    }
    out.push(Math.max(0, Math.min(1, x / S)), Math.max(0, Math.min(1, y / S)));
  }
  return out;
}

export interface CyclesOptions {
  blender?: string;
  device?: string;
  bounces?: number;
  /** Keep the job directory (debugging). */
  keep?: boolean;
  log?: (s: string) => void;
  /** Memory cap of Blender's scope. */
  memoryMax?: string;
  /** Diagnostic: `emit` lights the ground as the CPU bake models it (never shadowed by the building) instead of tracing it. */
  ground?: 'lit' | 'emit';
}

/**
 * Bake the job's parts with Cycles. Returns the share (every covered texel, baker order) that `LightmapBaker.finishFrom`
 * turns into the lightmap, and the device and time Blender reported.
 */
export async function cyclesShare(r: LightmapRequest, layout: LightmapLayout, texels: Texels, o: CyclesOptions = {}): Promise<{ share: Share; device: string; seconds: Record<string, number>; ms: number }> {
  const log = o.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const dir = mkdtempSync(join(tmpdir(), 'aether-cycles-'));
  const t0 = Date.now();
  try {
    const S = layout.size;
    const K = r.sunKeys.length;
    // The trace scene.
    writeFileSync(join(dir, 'trace.f32'), r.positions);
    writeFileSync(join(dir, 'trace_alb.f32'), r.albedo);
    writeFileSync(join(dir, 'trace_ts.u8'), r.twoSided);
    const px = new Uint8Array(r.twoSided.length);
    for (const p of proxiesOf(r)) for (let t = p.tri; t < p.tri + 12 && t < px.length; t++) px[t] = 1;
    writeFileSync(join(dir, 'trace_px.u8'), px);
    // The receivers: every baked triangle with its atlas coordinates, pushed off its surface by the ray bias.
    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [];
    for (let mi = 0; mi < r.meshes.length; mi++) {
      const uv = layout.uv[mi];
      if (!uv) continue;
      const m = r.meshes[mi]!;
      const T = meshTriangleCount(m);
      for (let t = 0; t < T; t++) {
        const c = [0, 1, 2].map((k) => (m.index ? m.index[t * 3 + k]! : t * 3 + k) * 3);
        const P = c.map((a) => [m.positions[a]!, m.positions[a + 1]!, m.positions[a + 2]!]);
        const e1 = [P[1]![0]! - P[0]![0]!, P[1]![1]! - P[0]![1]!, P[1]![2]! - P[0]![2]!];
        const e2 = [P[2]![0]! - P[0]![0]!, P[2]![1]! - P[0]![1]!, P[2]![2]! - P[0]![2]!];
        const fn = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        const fl = Math.hypot(fn[0]!, fn[1]!, fn[2]!);
        if (!(fl > 1e-12)) continue;
        // Facing the way the mesh's normals do (as the unwrap orients its charts).
        let sx = 0, sy = 0, sz = 0;
        for (const a of c) {
          sx += m.normals[a]!;
          sy += m.normals[a + 1]!;
          sz += m.normals[a + 2]!;
        }
        const flip = fn[0]! * sx + fn[1]! * sy + fn[2]! * sz < 0;
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        const duv = dilateUv(uv, t * 6, S);
        for (const k of order) {
          const a = c[k]!;
          let nx = m.normals[a]!, ny = m.normals[a + 1]!, nz = m.normals[a + 2]!;
          const nl = Math.hypot(nx, ny, nz);
          if (nl > 1e-6) {
            nx /= nl;
            ny /= nl;
            nz /= nl;
          } else {
            const s = flip ? -1 / fl : 1 / fl;
            nx = fn[0]! * s;
            ny = fn[1]! * s;
            nz = fn[2]! * s;
          }
          pos.push(P[k]![0]! + nx * BIAS, P[k]![1]! + ny * BIAS, P[k]![2]! + nz * BIAS);
          nrm.push(nx, ny, nz);
          uvs.push(duv[k * 2]!, duv[k * 2 + 1]!);
        }
      }
    }
    writeFileSync(join(dir, 'recv.f32'), Float32Array.from(pos));
    writeFileSync(join(dir, 'recv_n.f32'), Float32Array.from(nrm));
    writeFileSync(join(dir, 'recv_uv.f32'), Float32Array.from(uvs));
    const passes = ['vis', 'sky', 'grad', ...(r.lamps.length > 0 ? ['lamp'] : []), ...Array.from({ length: K }, (_, k) => `sun${k}`)];
    writeFileSync(
      join(dir, 'job.json'),
      JSON.stringify({ size: S, samples: r.samples, bounces: o.bounces ?? 4, ground: r.ground, lamps: r.lamps.map((l) => ({ position: l.position, color: l.color })), keys: r.sunKeys, passes, covered: texels.covered, ground_model: o.ground ?? 'lit' }),
    );
    const blender = o.blender ?? DEFAULT_BLENDER;
    const args = ['--user', '--scope', '--quiet', '-p', `MemoryMax=${o.memoryMax ?? '12G'}`, 'nice', '-n', '10', blender, '-b', '--factory-startup', '-P', PY, '--', '--job', dir, '--device', o.device ?? 'auto'];
    log(`cycles: ${passes.length} passes, atlas ${S}, ${r.samples} samples, ${pos.length / 9} receiver triangles`);
    await new Promise<void>((ok, fail) => {
      const p = spawn('systemd-run', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = '';
      const take = (b: Buffer): void => {
        const s = b.toString();
        tail = (tail + s).slice(-4000);
        for (const line of s.split('\n')) if (line.startsWith('[bake-light]') || /out of (GPU )?memory|error/i.test(line)) log(line.trim());
      };
      p.stdout.on('data', take);
      p.stderr.on('data', take);
      p.on('error', fail);
      p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`blender exited ${code}: ${tail.slice(-600)}`))));
    });
    const done = JSON.parse(readFileSync(join(dir, 'out', 'done.json'), 'utf8')) as { device: string; seconds: Record<string, number> };
    const read = (name: string): Float32Array | null => {
      const f = join(dir, 'out', `${name}.f32`);
      if (!existsSync(f)) return null;
      const b = readFileSync(f);
      const a = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      if (a.length !== S * S * 4) throw new Error(`cycles: ${name} has ${a.length} floats, not ${S * S * 4}`);
      return a;
    };
    const vis = read('vis')!, sky = read('sky')!, grad = read('grad')!, lamp = read('lamp');
    const suns = Array.from({ length: K }, (_, k) => read(`sun${k}`)!);
    const order = coveredOrder(texels);
    const P = partCount(K);
    const PL = P * 3;
    const n = order.length;
    const share: Share = { vis: new Float32Array(n), bounce: new Float32Array(n * PL), bad: new Uint8Array(n), rays: r.samples * n };
    const PI = Math.PI;
    let missing = 0;
    for (let k = 0; k < n; k++) {
      const o4 = order[k]! * 4;
      // No sample landed on it (alpha 0: off every triangle and out of the margin's reach), or it lies inside a wall.
      if (!(vis[o4 + 3]! > 0.5)) {
        share.bad[k] = 1;
        missing++;
        continue;
      }
      if (vis[o4 + 1]! > 0.3) {
        share.bad[k] = 1;
        continue;
      }
      share.vis[k] = Math.max(0, Math.min(1, vis[o4]!));
      const b = k * PL;
      for (let c = 0; c < 3; c++) {
        share.bounce[b + PART_SKY0 * 3 + c] = PI * sky[o4 + c]!;
        share.bounce[b + PART_SKY1 * 3 + c] = PI * grad[o4 + c]!;
        share.bounce[b + PART_LAMP * 3 + c] = lamp ? PI * lamp[o4 + c]! : 0;
        for (let s = 0; s < K; s++) share.bounce[b + (PART_SUN0 + s) * 3 + c] = PI * suns[s]![o4 + c]!;
      }
    }
    if (missing > 0) log(`cycles: ${missing} of ${n} texels got no sample (filled from their neighbours)`);
    return { share, device: done.device, seconds: done.seconds, ms: Date.now() - t0 };
  } finally {
    if (!o.keep) rmSync(dir, { recursive: true, force: true });
    else log(`cycles: job kept in ${dir}`);
  }
}

// --- threaded CPU bake -----------------------------------------------------------------------------------------------

export function defaultThreads(): number {
  return Math.max(1, Math.min(12, availableParallelism() - 4));
}

/** The CPU baker's gather on `threads` worker threads (each reads the job file itself); shares in index order. */
export async function cpuShares(jobPath: string, threads: number): Promise<Share[]> {
  const count = Math.max(1, Math.min(64, Math.floor(threads)));
  return Promise.all(
    Array.from({ length: count }, (_, index) => new Promise<Share>((ok, fail) => {
      // The thread loads this file through tsx's loader (registered in the thread itself: a worker does not inherit it).
      const boot = `import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then((m) => { m.register(); return import(${JSON.stringify(import.meta.url)}); })`;
      const w = new Worker(boot, { eval: true, workerData: { jobPath, index, count } });
      w.once('message', (m: Share) => ok(m));
      w.once('error', fail);
      w.once('exit', (code) => (code !== 0 ? fail(new Error(`bake thread ${index} exited ${code}`)) : undefined));
    })),
  );
}

// --- the file --------------------------------------------------------------------------------------------------------

/** A minimal PNG (8-bit RGB, Sub filter on every row) of RGBA pixels; alpha is dropped (the stacked atlas has none). */
export function encodePngRgb(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    const d = y * row;
    raw[d] = 1;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const left = x > 0 ? rgba[s - 4 + c]! : 0;
        raw[d + 1 + x * 3 + c] = (rgba[s + c]! - left) & 255;
      }
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

/** The `.lmap` bytes of a finished bake, as `lightmap-controller.ts` `finishBake` packs them (PNG image). */
export function packLightmap(job: BakeJob, layout: LightmapLayout, res: LightmapResult, bakeMs: number): Uint8Array {
  const meta: LightmapAssetMeta = {
    version: LIGHTMAP_VERSION,
    key: job.key,
    size: res.size,
    layers: res.layers,
    scales: Array.from(res.scales),
    keys: job.request.sunKeys.map((k) => [k[0], k[1], k[2]] as [number, number, number]),
    quality: job.quality,
    samples: job.request.samples,
    density: layout.density,
    charts: layout.charts,
    texels: res.texels,
    rays: res.rays,
    bakeMs: Math.round(bakeMs),
    tris: layout.uv.map((u, i) => (u ? job.triCounts[i]! : -1)),
    image: 'png',
  };
  const stacked = stackAtlas(res.rgba, res.size, res.layers);
  const image = encodePngRgb(stacked, res.size, res.size * (res.layers + 1));
  return packAsset(meta, layout.uv.map((u) => (u ? quantizeUv(u) : null)), image);
}

// --- main ------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (k: string): string | undefined => {
    const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`));
    return a === undefined ? undefined : a.includes('=') ? a.slice(k.length + 3) : '';
  };
  const jobPath = flag('job');
  const outDir = resolve(flag('out') ?? '.');
  if (!jobPath) throw new Error('usage: scripts/blender-bake.ts --job=<file.lbjob> --out=<dir> [--blender=<path>] [--cpu[=<threads>]]');
  const log = (s: string): void => void process.stderr.write(`[blender-bake] ${s}\n`);
  const t0 = Date.now();
  const job = decodeJob(new Uint8Array(readFileSync(jobPath)));
  const r = job.request;
  const layout = layoutOf(r);
  const baker = bakerFor(r, layout);
  const texels = rasterizeTexels(r.meshes, layout);
  log(`${job.key}: atlas ${layout.size}, ${layout.charts} charts, ${texels.covered} texels, ${r.sunKeys.length} keys, ${r.lamps.length} lamps, ${r.positions.length / 9} trace triangles`);
  const cpu = flag('cpu');
  let device: string;
  let seconds: Record<string, number> | undefined;
  let shares: Share[];
  if (cpu !== undefined) {
    const threads = cpu === '' ? defaultThreads() : Math.max(1, Math.min(12, Number(cpu) || defaultThreads()));
    device = `node-cpu-${threads}`;
    shares = await cpuShares(resolve(jobPath), threads);
  } else {
    const b = flag('bounces');
    const c = await cyclesShare(r, layout, texels, { blender: flag('blender') || DEFAULT_BLENDER, device: flag('device') || 'auto', ...(b ? { bounces: Number(b) } : {}), keep: flag('keep') !== undefined, ground: flag('ground') === 'emit' ? 'emit' : 'lit', log });
    device = `cycles-${c.device}`;
    seconds = c.seconds;
    shares = [c.share];
  }
  const res = baker.finishFrom(shares);
  const ms = Date.now() - t0;
  const bytes = packLightmap(job, layout, res, ms);
  if (bytes.byteLength > LIGHTMAP_MAX_ASSET_BYTES) log(`warning: ${bytes.byteLength} B is over the ${LIGHTMAP_MAX_ASSET_BYTES} B cap of a lightmap file`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${job.key}.lmap`);
  writeFileSync(file, bytes);
  log(`${file}: ${(bytes.byteLength / 1e6).toFixed(2)} MB, ${device}, ${(ms / 1000).toFixed(1)} s (${baker.leftover} texels left to the volume)`);
  process.stdout.write(`RESULT ${JSON.stringify({ file, key: job.key, bytes: bytes.byteLength, device, ms, seconds, texels: res.texels, leftover: baker.leftover })}\n`);
}

if (!isMainThread) {
  // A bake thread: its share of the gather.
  const { jobPath, index, count } = workerData as { jobPath: string; index: number; count: number };
  const job = decodeJob(new Uint8Array(readFileSync(jobPath)));
  const b = bakerFor(job.request, layoutOf(job.request), { index, count });
  b.run();
  const g = b.gathered();
  parentPort!.postMessage(g, [g.vis.buffer, g.bounce.buffer, g.bad.buffer] as ArrayBuffer[]);
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[blender-bake] ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
  });
}
