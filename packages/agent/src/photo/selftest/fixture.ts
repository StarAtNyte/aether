/**
 * Self-test fixture helpers: which worlds are used, and how the per-pixel truth (a label and a depth for every cell of a
 * grid) is made from rays cast on the real meshes. Pure; the GPU part lives in scripts/photo-selftest/render.ts.
 */
import type { WorldDoc } from '@aether/core';
import { basis, planToRoom, type PoseSpec, type TruthCamera, type TruthItem, type TruthRoom } from './truth';

export interface SelftestWorld {
  name: string;
  /** Poses (default: standard end and corner poses). */
  poses?: PoseSpec[];
  /** Add a wide-lens pose. */
  wide?: boolean;
  /** Eye height above the floor, metres (default 1.5). */
  eye?: number;
  note: string;
}

/** The worlds with realistic content and known truth: the four rooms rebuilt from photographs, plus built-in homes. */
export const SELFTEST_WORLDS: readonly SelftestWorld[] = [
  { name: 'photo-twin-room', wide: true, note: 'two single beds, desk, chair, curtains (shell rebuilt from a photograph)' },
  { name: 'photo-hotel-bedroom', note: 'bed, window wall, nightstands (rebuilt from a photograph)' },
  { name: 'photo-four-poster', note: 'four-poster bed, rug, beams' },
  { name: 'photo-vaulted-bedroom', note: 'vaulted ceiling, zigzag rug, four-poster' },
  { name: 'scandi-living-room', wide: true, note: 'sofa, fireplace, curtains, table: a crafted living room' },
  { name: 'pool-house', note: 'a crafted pool house interior' },
  { name: 'cafe-interior', note: 'a crafted venue: counter, tables, chairs' },
];

export interface RayHit {
  id: string;
  p: [number, number, number];
  /** Normal y of the face hit. */
  ny: number;
}

export interface TruthMasks {
  width: number;
  height: number;
  /** Index 0 is "nothing" (sky or beyond the range); then structure (floor, ceiling, wall, other) and every piece id that was hit. */
  labels: string[];
  /** One byte per cell: the label index, base64. */
  data: string;
  /** Float32 per cell, base64: distance along the optical axis (z depth) and along the ray, 0 where nothing was hit. */
  depthZ: string;
  depthRay: string;
}

export interface Visible {
  /** Trimmed (4 to 96 percent) extents of the points the camera sees, in the room frame, as the perception layer measures them. */
  centre: { u: number; v: number };
  size: { w: number; d: number; h: number };
  low: number;
  high: number;
  samples: number;
  /** Share of the grid. */
  area: number;
}

const b64 = (a: ArrayBufferView): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const un64 = (s: string): Buffer => Buffer.from(s, 'base64');

export function decodeMasks(m: TruthMasks): { data: Uint8Array; depthZ: Float32Array; depthRay: Float32Array } {
  const d = un64(m.data);
  const z = un64(m.depthZ);
  const r = un64(m.depthRay);
  return {
    data: new Uint8Array(d.buffer, d.byteOffset, d.byteLength),
    depthZ: new Float32Array(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength)),
    depthRay: new Float32Array(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength)),
  };
}

const pct = (a: number[], q: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))] as number;
};

/** Labels and depths of a grid from the ray hits, and the visible extents of every piece. */
export function buildMasks(cam: TruthCamera, room: TruthRoom, items: readonly TruthItem[], w: number, h: number, hits: ReadonlyArray<RayHit | null>): { masks: TruthMasks; visible: Record<string, Visible>; surfaces: Record<string, number> } {
  const itemIds = new Set(items.map((i) => i.id));
  const labels = ['none', 'floor', 'ceiling', 'wall', 'other'];
  const idx = new Map<string, number>(labels.map((l, i) => [l, i]));
  const data = new Uint8Array(w * h);
  const dz = new Float32Array(w * h);
  const dr = new Float32Array(w * h);
  const { fwd } = basis(cam.heading, cam.pitch);
  const pts = new Map<string, Array<[number, number, number]>>();
  const surfaces: Record<string, number> = { floor: 0, ceiling: 0, wall: 0, other: 0 };
  const [x0, z0, x1, z1] = room.bbox;
  for (let k = 0; k < hits.length; k++) {
    const hit = hits[k];
    if (!hit) continue;
    let label: string;
    if (itemIds.has(hit.id)) label = hit.id;
    else label = hit.ny > 0.6 ? 'floor' : hit.ny < -0.6 ? 'ceiling' : 'wall';
    let li = idx.get(label);
    if (li === undefined) { li = labels.length; labels.push(label); idx.set(label, li); }
    data[k] = li;
    const dx = hit.p[0] - cam.pos[0];
    const dy = hit.p[1] - cam.pos[1];
    const dzz = hit.p[2] - cam.pos[2];
    dz[k] = dx * fwd[0] + dy * fwd[1] + dzz * fwd[2];
    dr[k] = Math.hypot(dx, dy, dzz);
    if (surfaces[label] !== undefined) surfaces[label] = (surfaces[label] as number) + 1;
    else {
      const [u, v] = planToRoom(room.back, hit.p[0] - x0, hit.p[2] - z0, x1 - x0, z1 - z0);
      const arr = pts.get(label) ?? [];
      arr.push([u, v, hit.p[1]]);
      pts.set(label, arr);
    }
  }
  const visible: Record<string, Visible> = {};
  for (const [id, a] of pts) {
    if (a.length < 4) continue;
    const us = a.map((p) => p[0]);
    const vs = a.map((p) => p[1]);
    const ys = a.map((p) => p[2]);
    const u0 = pct(us, 0.04), u1 = pct(us, 0.96), v0 = pct(vs, 0.04), v1 = pct(vs, 0.96), y0 = pct(ys, 0.04), y1 = pct(ys, 0.96);
    visible[id] = { centre: { u: (pct(us, 0.5)), v: (pct(vs, 0.5)) }, size: { w: u1 - u0, d: v1 - v0, h: y1 - y0 }, low: y0 - 0, high: y1, samples: a.length, area: a.length / (w * h) };
  }
  const total = w * h;
  for (const k of Object.keys(surfaces)) surfaces[k] = (surfaces[k] as number) / total;
  return { masks: { width: w, height: h, labels, data: b64(data), depthZ: b64(dz), depthRay: b64(dr) }, visible, surfaces };
}

/** Floor, wall and ceiling colours the building's plan names for a room, as truth for the surface colours. */
export function surfaceTruth(world: WorldDoc, building: string, roomKey: string): { floor: string | null; walls: string | null; ceiling: string | null } {
  const plan = (world.entities[building as never]?.arch as { plan?: { levels?: Array<{ rooms?: Array<Record<string, unknown>> }> } } | undefined)?.plan;
  const r = plan?.levels?.[0]?.rooms?.find((x) => x['id'] === roomKey);
  const col = (o: unknown): string | null => (o && typeof o === 'object' && typeof (o as { color?: unknown }).color === 'string' ? ((o as { color: string }).color) : null);
  return { floor: col(r?.['floor']), walls: typeof r?.['wallColor'] === 'string' ? (r['wallColor'] as string) : col(r?.['finish']), ceiling: col(r?.['ceiling']) };
}
