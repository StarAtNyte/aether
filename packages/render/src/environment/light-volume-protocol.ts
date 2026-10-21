/**
 * Messages between the main thread and the light-volume worker (`light-volume.worker.ts`). Requests and
 * replies are validated on arrival (sizes, finiteness, grid bounds): the worker only runs our own bake code
 * on numbers, and the main thread never uploads a malformed reply.
 */
import { FLOATS_PER_PROBE, MAX_TRACE_TRIANGLES, VOLUME_ALLOC, type VolumeBakeInput, type VolumeGrid, type VolumeLamp } from './light-volume';

/** A bake job: the trace scene as raw arrays plus the light. */
export interface VolumeRequest {
  type: 'bake';
  id: number;
  grid: VolumeGrid;
  positions: Float32Array;
  albedo: Float32Array;
  twoSided: Uint8Array;
  sun: VolumeBakeInput['sun'];
  ambient: VolumeBakeInput['ambient'];
  ground: VolumeBakeInput['ground'];
  lamps: VolumeLamp[];
}

/** The worker's answer. */
export type VolumeReply = { type: 'volume'; id: number; ok: true; data: Float32Array } | { type: 'volume'; id: number; ok: false; error: string };

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
  let sun: VolumeRequest['sun'] = null;
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
  return { type: 'bake', id: r['id'] as number, grid, positions, albedo, twoSided, sun, ambient: { a, b }, ground: { y: gy, albedo: galb }, lamps };
}

/** Validate a reply against the grid it was asked for (main-thread side): the data must fit and be finite. */
export function parseVolumeReply(raw: unknown, grid: VolumeGrid): VolumeReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r['type'] !== 'volume' || !isNum(r['id'])) return null;
  if (r['ok'] !== true) return { type: 'volume', id: r['id'] as number, ok: false, error: typeof r['error'] === 'string' ? (r['error'] as string).slice(0, 300) : 'bake failed' };
  const data = r['data'];
  if (!(data instanceof Float32Array) || data.length !== grid.nx * grid.ny * grid.nz * FLOATS_PER_PROBE) return null;
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i]!)) return null;
  return { type: 'volume', id: r['id'] as number, ok: true, data };
}
