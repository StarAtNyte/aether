/**
 * Messages between the main thread and the light-volume worker (`light-volume.worker.ts`). Requests and
 * replies are validated on arrival (sizes, finiteness, grid bounds): the worker only runs our own bake code
 * on numbers, and the main thread never uploads a malformed reply.
 */
import { FLOATS_PER_PROBE, MAX_SUN_KEYS, MAX_TRACE_TRIANGLES, VOLUME_ALLOC, type V3, type VolumeBakeInput, type VolumeGrid, type VolumeLamp } from './light-volume';
import { volumeLightFloats } from './relight';

/** A bake job: the trace scene as raw arrays plus the sun keys, the ground and the lamps at full strength. */
export interface VolumeRequest {
  type: 'bake';
  id: number;
  grid: VolumeGrid;
  positions: Float32Array;
  albedo: Float32Array;
  twoSided: Uint8Array;
  sunKeys: V3[];
  ground: VolumeBakeInput['ground'];
  lamps: VolumeLamp[];
}

/** The worker's answer. */
export type VolumeReply = { type: 'volume'; id: number; ok: true; data: Float32Array; light: Float32Array } | { type: 'volume'; id: number; ok: false; error: string };

const MAX_LAMPS = 64;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function v3(v: unknown, lo = -1e6, hi = 1e6): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => isNum(x) && x >= lo && x <= hi)) return null;
  return [v[0] as number, v[1] as number, v[2] as number];
}

/** A grid the atlas can hold, or null. */
export function parseGrid(raw: unknown): VolumeGrid | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const min = v3(g['min']);
  const { spacing, nx, ny, nz } = g;
  if (!min || !isNum(spacing) || spacing < 0.05 || spacing > 50) return null;
  const ok = (n: unknown, max: number): n is number => isNum(n) && Number.isInteger(n) && n >= 2 && n <= max;
  if (!ok(nx, VOLUME_ALLOC.nx) || !ok(ny, VOLUME_ALLOC.ny) || !ok(nz, VOLUME_ALLOC.nz)) return null;
  return { min, spacing, nx, ny, nz };
}

/** Validate a bake request (worker side). */
export function parseVolumeRequest(raw: unknown): VolumeRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r['type'] !== 'bake' || !isNum(r['id']) || !Number.isSafeInteger(r['id'])) return null;
  const grid = parseGrid(r['grid']);
  const positions = r['positions'];
  const albedo = r['albedo'];
  const twoSided = r['twoSided'];
  if (!grid || !(positions instanceof Float32Array) || !(albedo instanceof Float32Array) || !(twoSided instanceof Uint8Array)) return null;
  const tris = positions.length / 9;
  if (!Number.isInteger(tris) || tris < 1 || tris > MAX_TRACE_TRIANGLES || albedo.length !== tris * 3 || twoSided.length !== tris) return null;
  const keysRaw = r['sunKeys'];
  if (!Array.isArray(keysRaw) || keysRaw.length > MAX_SUN_KEYS) return null;
  const sunKeys: V3[] = [];
  for (const k of keysRaw as unknown[]) {
    const d = v3(k, -1.01, 1.01);
    if (!d || Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) > 0.01) return null;
    sunKeys.push(d);
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
  return { type: 'bake', id: r['id'] as number, grid, positions, albedo, twoSided, sunKeys, ground: { y: gy, albedo: galb }, lamps };
}

/** Validate a reply against the grid and sun-key count it was asked for (main-thread side): the data must fit and be finite. */
export function parseVolumeReply(raw: unknown, grid: VolumeGrid, keys: number): VolumeReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r['type'] !== 'volume' || !isNum(r['id'])) return null;
  if (r['ok'] !== true) return { type: 'volume', id: r['id'] as number, ok: false, error: typeof r['error'] === 'string' ? (r['error'] as string).slice(0, 300) : 'bake failed' };
  const data = r['data'];
  if (!(data instanceof Float32Array) || data.length !== grid.nx * grid.ny * grid.nz * FLOATS_PER_PROBE) return null;
  const light = r['light'];
  if (!(light instanceof Float32Array) || light.length !== grid.nx * grid.ny * grid.nz * volumeLightFloats(keys)) return null;
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i]!)) return null;
  for (let i = 0; i < light.length; i++) if (!Number.isFinite(light[i]!)) return null;
  return { type: 'volume', id: r['id'] as number, ok: true, data, light };
}
