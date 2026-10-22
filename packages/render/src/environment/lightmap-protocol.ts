/**
 * Messages between the main thread and the lightmap worker (`lightmap.worker.ts`). Requests and replies are validated
 * on arrival (sizes, finiteness, caps): the worker only runs our own bake code on numbers, and the main thread never
 * uploads a malformed reply.
 */
import { MAX_TRACE_TRIANGLES, VOLUME_ALLOC, FLOATS_PER_PROBE, type V3, type VolumeGrid, type VolumeLamp } from './light-volume';
import { parseGrid } from './light-volume-protocol';
import { LIGHTMAP_MAX_TRIANGLES, meshTriangleCount, type LightmapMesh } from './lightmap';

/** A bake job: the trace scene, the meshes to unwrap, the finished volume and the light. */
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
  volume: Float32Array;
  sun: { direction: V3; irradiance: V3 } | null;
  ambient: { a: V3; b: V3 };
  ground: { y: number; albedo: V3 };
  lamps: VolumeLamp[];
}

export interface LightmapDone {
  type: 'lightmap';
  id: number;
  ok: true;
  size: number;
  scale: number;
  density: number;
  charts: number;
  texels: number;
  rays: number;
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
  if (!isNum(maxSize) || ![256, 512, 1024].includes(maxSize) || !isNum(density) || density < 1 || density > 64 || !isNum(samples) || samples < 4 || samples > 512) return null;
  const grid = parseGrid(r['grid']);
  const volume = r['volume'];
  const positions = r['positions'];
  const albedo = r['albedo'];
  const twoSided = r['twoSided'];
  const proxies = r['proxies'];
  if (!grid || !(volume instanceof Float32Array) || !(positions instanceof Float32Array) || !(albedo instanceof Float32Array) || !(twoSided instanceof Uint8Array) || !(proxies instanceof Float32Array)) return null;
  if (volume.length !== grid.nx * grid.ny * grid.nz * FLOATS_PER_PROBE) return null;
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
  let sun: LightmapRequest['sun'] = null;
  if (r['sun'] !== null) {
    const s = r['sun'] as Record<string, unknown> | undefined;
    const direction = v3(s?.['direction'], -1.01, 1.01);
    const irradiance = v3(s?.['irradiance'], 0, 1e4);
    if (!direction || !irradiance) return null;
    sun = { direction, irradiance };
  }
  const amb = r['ambient'] as Record<string, unknown> | undefined;
  const a = v3(amb?.['a'], -1e4, 1e4);
  const b = v3(amb?.['b'], -1e4, 1e4);
  const gr = r['ground'] as Record<string, unknown> | undefined;
  const gy = gr?.['y'];
  const galb = v3(gr?.['albedo'], 0, 1);
  if (!a || !b || !isNum(gy) || !galb) return null;
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
  return { type: 'bake', id: r['id'] as number, maxSize, density, samples, meshes, positions, albedo, twoSided, proxies, grid, volume, sun, ambient: { a, b }, ground: { y: gy, albedo: galb }, lamps };
}

/**
 * Validate a reply against the triangle counts of the meshes it was asked for (main-thread side): the atlas must be a
 * square of an allowed size and the coordinates finite and inside it.
 */
export function parseLightmapReply(raw: unknown, triCounts: readonly number[]): LightmapReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r['id'])) return null;
  if (r['type'] === 'progress') return isNum(r['value']) ? { type: 'progress', id: r['id'], value: Math.max(0, Math.min(1, r['value'])) } : null;
  if (r['type'] !== 'lightmap') return null;
  if (r['ok'] !== true) return { type: 'lightmap', id: r['id'], ok: false, error: typeof r['error'] === 'string' ? (r['error'] as string).slice(0, 300) : 'bake failed' };
  const { size, scale, density, charts, texels, rays } = r;
  const rgba = r['rgba'];
  const uv = r['uv'];
  if (!isNum(size) || ![256, 512, 1024].includes(size) || !isNum(scale) || scale <= 0 || !isNum(density) || !isNum(charts) || !isNum(texels) || !isNum(rays)) return null;
  if (!(rgba instanceof Uint8Array) || rgba.length !== size * size * 4) return null;
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
  return { type: 'lightmap', id: r['id'], ok: true, size, scale, density, charts, texels, rays, rgba, uv: outUv };
}

/** Whether the volume allocation can hold `grid` (a lightmap needs a finished volume of the same building). */
export function gridFits(grid: VolumeGrid): boolean {
  return grid.nx <= VOLUME_ALLOC.nx && grid.ny <= VOLUME_ALLOC.ny && grid.nz <= VOLUME_ALLOC.nz;
}
