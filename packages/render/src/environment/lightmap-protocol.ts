/**
 * Messages between the main thread and the lightmap worker (`lightmap.worker.ts`). Requests and replies are validated
 * on arrival (sizes, finiteness, caps): the worker only runs our own bake code on numbers, and the main thread never
 * uploads a malformed reply.
 */
import { MAX_SUN_KEYS, MAX_TRACE_TRIANGLES, PART_FLOATS, VOLUME_ALLOC, type V3, type VolumeGrid, type VolumeLamp } from './light-volume';
import { lightmapLayers, partCount, scaleCount } from './relight';
import { parseGrid } from './light-volume-protocol';
import { LIGHTMAP_MAX_TRIANGLES, meshTriangleCount, type LightmapMesh } from './lightmap';

/** A bake job: the trace scene, the meshes to unwrap, the finished re-lightable volume, the sun keys and the lamps. */
export interface LightmapRequest {
  type: 'bake';
  id: number;
  /** Largest atlas edge, texels per metre and rays per texel. */
  maxSize: number;
  density: number;
  samples: number;
  meshes: LightmapMesh[];
  positions: Float32Array;
  albedo: Float32Array;
  twoSided: Uint8Array;
  /** Furniture boxes of the trace scene: lo (3), hi (3), first triangle, seven floats each. */
  proxies: Float32Array;
  grid: VolumeGrid;
  /** The volume as one field (`light-volume.ts` `partsField`) and its free-distance codes. */
  field: Float32Array;
  stride: number;
  codes: Float32Array;
  sunKeys: V3[];
  ground: { y: number; albedo: V3 };
  lamps: VolumeLamp[];
}

export interface LightmapDone {
  type: 'lightmap';
  id: number;
  ok: true;
  size: number;
  /** Layers of {@link rgba} (`relight.ts` `lightmapLayers`). */
  layers: number;
  /** The value a code of 255 stands for, per stored value (`relight.ts` `scaleCount`). */
  scales: Float32Array;
  density: number;
  charts: number;
  texels: number;
  rays: number;
  /** `layers` layers of `size × size` RGBA. */
  rgba: Uint8Array;
  /** Per mesh: six floats per triangle, or null when the mesh was left out. */
  uv: Array<Float32Array | null>;
}

export type LightmapReply =
  | LightmapDone
  | { type: 'lightmap'; id: number; ok: false; error: string }
  | { type: 'progress'; id: number; value: number };

const MAX_MESHES = 4096;
const MAX_LAMPS = 64;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function v3(v: unknown, lo = -1e6, hi = 1e6): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => isNum(x) && x >= lo && x <= hi)) return null;
  return [v[0] as number, v[1] as number, v[2] as number];
}

/** Validate a bake request (worker side). */
export function parseLightmapRequest(raw: unknown): LightmapRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r['type'] !== 'bake' || !isNum(r['id']) || !Number.isSafeInteger(r['id'])) return null;
  const { maxSize, density, samples } = r;
  if (!isNum(maxSize) || ![256, 512, 1024].includes(maxSize) || !isNum(density) || density < 1 || density > 64 || !isNum(samples) || samples < 4 || samples > 1024) return null;
  const grid = parseGrid(r['grid']);
  const field = r['field'];
  const codes = r['codes'];
  const stride = r['stride'];
  const positions = r['positions'];
  const albedo = r['albedo'];
  const twoSided = r['twoSided'];
  const proxies = r['proxies'];
  if (!grid || !(field instanceof Float32Array) || !(codes instanceof Float32Array) || !isNum(stride) || !(positions instanceof Float32Array) || !(albedo instanceof Float32Array) || !(twoSided instanceof Uint8Array) || !(proxies instanceof Float32Array)) return null;
  const probes = grid.nx * grid.ny * grid.nz;
  const keysRaw = r['sunKeys'];
  if (!Array.isArray(keysRaw) || keysRaw.length > MAX_SUN_KEYS) return null;
  const sunKeys: V3[] = [];
  for (const k of keysRaw as unknown[]) {
    const d = v3(k, -1.01, 1.01);
    if (!d || Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) > 0.01) return null;
    sunKeys.push(d);
  }
  if (stride !== 4 + partCount(sunKeys.length) * PART_FLOATS || field.length !== probes * stride || codes.length !== probes * 2) return null;
  const tris = positions.length / 9;
  if (!Number.isInteger(tris) || tris < 1 || tris > MAX_TRACE_TRIANGLES || albedo.length !== tris * 3 || twoSided.length !== tris) return null;
  if (proxies.length % 7 !== 0 || proxies.length > 7 * 4096) return null;
  const meshesRaw = r['meshes'];
  if (!Array.isArray(meshesRaw) || meshesRaw.length < 1 || meshesRaw.length > MAX_MESHES) return null;
  const meshes: LightmapMesh[] = [];
  let total = 0;
  for (const m of meshesRaw as unknown[]) {
    const o = m as Record<string, unknown> | null;
    const p = o?.['positions'];
    const n = o?.['normals'];
    const index = o?.['index'];
    if (!(p instanceof Float32Array) || !(n instanceof Float32Array) || p.length !== n.length || p.length % 3 !== 0) return null;
    if (index === null) {
      if (p.length % 9 !== 0) return null;
    } else if (index instanceof Uint32Array) {
      if (index.length % 3 !== 0) return null;
      const vc = p.length / 3;
      for (let i = 0; i < index.length; i++) if ((index[i] as number) >= vc) return null;
    } else return null;
    const mesh: LightmapMesh = { positions: p, normals: n, index: index instanceof Uint32Array ? index : null };
    total += meshTriangleCount(mesh);
    if (total > LIGHTMAP_MAX_TRIANGLES * 4) return null;
    meshes.push(mesh);
  }
  const gr = r['ground'] as Record<string, unknown> | undefined;
  const gy = gr?.['y'];
  const galb = v3(gr?.['albedo'], 0, 1);
  if (!isNum(gy) || !galb) return null;
  const lampsRaw = r['lamps'];
  if (!Array.isArray(lampsRaw) || lampsRaw.length > MAX_LAMPS) return null;
  const lamps: VolumeLamp[] = [];
  for (const l of lampsRaw as unknown[]) {
    const o = l as Record<string, unknown> | null;
    const position = v3(o?.['position']);
    const color = v3(o?.['color'], 0, 1e6);
    const range = o?.['range'];
    if (!position || !color || !isNum(range) || range <= 0 || range > 1e4) return null;
    lamps.push({ position, color, range });
  }
  return { type: 'bake', id: r['id'] as number, maxSize, density, samples, meshes, positions, albedo, twoSided, proxies, grid, field, stride, codes, sunKeys, ground: { y: gy, albedo: galb }, lamps };
}

/**
 * Validate a reply against the triangle counts of the meshes it was asked for (main-thread side): the atlas must be a
 * square of an allowed size and the coordinates finite and inside it.
 */
export function parseLightmapReply(raw: unknown, triCounts: readonly number[], keys: number): LightmapReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r['id'])) return null;
  if (r['type'] === 'progress') return isNum(r['value']) ? { type: 'progress', id: r['id'], value: Math.max(0, Math.min(1, r['value'])) } : null;
  if (r['type'] !== 'lightmap') return null;
  if (r['ok'] !== true) return { type: 'lightmap', id: r['id'], ok: false, error: typeof r['error'] === 'string' ? (r['error'] as string).slice(0, 300) : 'bake failed' };
  const { size, density, charts, texels, rays } = r;
  const rgba = r['rgba'];
  const uv = r['uv'];
  const scales = r['scales'];
  const layers = lightmapLayers(keys);
  if (!isNum(size) || ![256, 512, 1024].includes(size) || r['layers'] !== layers || !isNum(density) || !isNum(charts) || !isNum(texels) || !isNum(rays)) return null;
  if (!(scales instanceof Float32Array) || scales.length !== scaleCount(keys) || !scales.every((x) => Number.isFinite(x) && x > 0)) return null;
  if (!(rgba instanceof Uint8Array) || rgba.length !== size * size * 4 * layers) return null;
  if (!Array.isArray(uv) || uv.length !== triCounts.length) return null;
  const outUv: Array<Float32Array | null> = [];
  for (let i = 0; i < uv.length; i++) {
    const u = uv[i] as unknown;
    if (u === null) {
      outUv.push(null);
      continue;
    }
    if (!(u instanceof Float32Array) || u.length !== (triCounts[i] as number) * 6) return null;
    for (let k = 0; k < u.length; k++) if (!(u[k]! >= 0 && u[k]! <= 1)) return null;
    outUv.push(u);
  }
  return { type: 'lightmap', id: r['id'], ok: true, size, layers, scales, density, charts, texels, rays, rgba, uv: outUv };
}

/** Whether the volume allocation can hold `grid` (a lightmap needs a finished volume of the same building). */
export function gridFits(grid: VolumeGrid): boolean {
  return grid.nx <= VOLUME_ALLOC.nx && grid.ny <= VOLUME_ALLOC.ny && grid.nz <= VOLUME_ALLOC.nz;
}

// --- A bake split over several workers (the publish bake, `view/publish-bake.ts`) ---------------------------------------

/** Most shares of one split bake. */
export const MAX_SHARES = 512;

/** Gather share `index` of `count` of the job the worker holds (sent after the request with `hold: true`). */
export interface ShareRequest {
  type: 'share';
  id: number;
  index: number;
  count: number;
}

/** A share's gather: per texel of the share, in order, the visibility, the parts' RGB and the inside-a-wall flag. */
export interface ShareReply {
  type: 'share';
  id: number;
  index: number;
  count: number;
  vis: Float32Array;
  bounce: Float32Array;
  bad: Uint8Array;
  rays: number;
}

/** Finish the held job from every share, in index order, and pack its `.lmap` file. */
export interface FinishRequest {
  type: 'finish';
  id: number;
  shares: Array<{ vis: Float32Array; bounce: Float32Array; bad: Uint8Array; rays: number }>;
  meta: { key: string; quality: string; bakeMs: number; triCounts: number[] };
}

/** The finished file of a split bake. */
export interface FileReply {
  type: 'file';
  id: number;
  bytes: Uint8Array;
  texels: number;
  rays: number;
  image: 'webp' | 'png' | 'raw';
}

const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Validate a share request (worker side). */
export function parseShare(raw: unknown): ShareRequest | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r['type'] !== 'share' || !intIn(r['id'], 0, Number.MAX_SAFE_INTEGER) || !intIn(r['count'], 1, MAX_SHARES) || !intIn(r['index'], 0, (r['count'] as number) - 1)) return null;
  return { type: 'share', id: r['id'] as number, index: r['index'] as number, count: r['count'] as number };
}

/** Validate a share's gather; `parts` is the job's part count (`relight.ts` `partCount`). */
export function parseShareReply(raw: unknown, parts: number): ShareReply | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r['type'] !== 'share' || !isNum(r['id']) || !intIn(r['count'], 1, MAX_SHARES) || !intIn(r['index'], 0, (r['count'] as number) - 1) || !isNum(r['rays'])) return null;
  const { vis, bounce, bad } = r;
  if (!(vis instanceof Float32Array) || !(bounce instanceof Float32Array) || !(bad instanceof Uint8Array)) return null;
  if (bounce.length !== vis.length * parts * 3 || bad.length !== vis.length) return null;
  return { type: 'share', id: r['id'] as number, index: r['index'] as number, count: r['count'] as number, vis, bounce, bad, rays: r['rays'] as number };
}

/** Validate a finish request (worker side). */
export function parseFinish(raw: unknown): FinishRequest | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r['type'] !== 'finish' || !intIn(r['id'], 0, Number.MAX_SAFE_INTEGER)) return null;
  const shares = r['shares'];
  const meta = r['meta'] as Record<string, unknown> | null;
  if (!Array.isArray(shares) || shares.length < 1 || shares.length > MAX_SHARES || !meta) return null;
  for (const s of shares as unknown[]) {
    const q = s as Record<string, unknown> | null;
    if (!q || !(q['vis'] instanceof Float32Array) || !(q['bounce'] instanceof Float32Array) || !(q['bad'] instanceof Uint8Array) || !isNum(q['rays'])) return null;
    if ((q['bad'] as Uint8Array).length !== (q['vis'] as Float32Array).length) return null;
  }
  const { key, quality, bakeMs, triCounts } = meta;
  if (typeof key !== 'string' || !/^lm\d+-[0-9a-f]{32}$/.test(key) || typeof quality !== 'string' || quality.length > 16 || !isNum(bakeMs) || !Array.isArray(triCounts) || !triCounts.every((t) => intIn(t, 0, 1e8))) return null;
  return { type: 'finish', id: r['id'] as number, shares: shares as FinishRequest['shares'], meta: { key, quality, bakeMs, triCounts: triCounts as number[] } };
}

/** Validate the finished file (main side). */
export function parseFileReply(raw: unknown): FileReply | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r['type'] !== 'file' || !isNum(r['id']) || !(r['bytes'] instanceof Uint8Array) || !isNum(r['texels']) || !isNum(r['rays'])) return null;
  const image = r['image'];
  if (image !== 'webp' && image !== 'png' && image !== 'raw') return null;
  return { type: 'file', id: r['id'] as number, bytes: r['bytes'] as Uint8Array, texels: r['texels'] as number, rays: r['rays'] as number, image };
}
