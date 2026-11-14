/**
 * Coplanar flat surfaces: two flat boxes or planes whose tops lie in the same plane and overlap (a stone forecourt laid over
 * the end of a gravel drive, a rug plane on a floor plane) fight in depth, and the texture of one flickers through the other
 * as the camera moves. Each such surface is drawn lifted a few millimetres over the larger ones it overlaps (the smaller
 * patch reads as laid on the larger), enough for the depth buffer from a fly-in's distance down to eye level. Pure: the
 * scene sync applies the lifts to the drawn content only (colliders and the document keep their heights).
 */
import type { EntityId, WorldDoc } from '@aether/core';

/** Lift (m) of one layer over the coplanar surface under it. */
export const COPLANAR_LIFT = 0.012;
/** Tops closer than this (m) are in one plane. */
const PLANE_EPS = 0.004;
/** Overlap (m) along both axes below which two footprints only touch. */
const OVERLAP_MIN = 0.02;
/** Thickest box (m) taken for a flat surface (a slab, a path, a rug); thicker boxes are volumes. */
const FLAT_MAX = 0.6;
/** Cell size (m) of the footprint grid that pairs the surfaces of one plane when there are many. */
const GRID_CELL = 4;
/** Surfaces in one plane compared pairwise up to this many; more go through the grid. */
const PAIRWISE_MAX = 48;
/** Steepest roll or pitch (degrees) of a surface still taken as horizontal. */
const LEVEL_EPS = 0.5;

interface Flat {
  id: EntityId;
  top: number;
  cx: number;
  cz: number;
  /** Half extents along the footprint's own axes. */
  hx: number;
  hz: number;
  /** Footprint yaw (radians). */
  yaw: number;
  area: number;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
}

/** World pose of an entity with only yaw in its chain, or null (a tilted ancestor, a cycle). */
function poseOf(world: WorldDoc, id: EntityId, cache: Map<EntityId, Pose | null>, depth = 0): Pose | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  const e = world.entities[id];
  if (!e || depth > 32) return null;
  const t = e.transform;
  const [rx, ry, rz] = t.rotation;
  if (Math.abs(rx) > LEVEL_EPS || Math.abs(rz) > LEVEL_EPS) {
    cache.set(id, null);
    return null;
  }
  const local: Pose = { x: t.position[0], y: t.position[1], z: t.position[2], yaw: (ry * Math.PI) / 180, sx: t.scale[0], sy: t.scale[1], sz: t.scale[2] };
  let pose: Pose | null = local;
  if (e.parent) {
    const p = poseOf(world, e.parent, cache, depth + 1);
    if (!p) pose = null;
    else {
      // Three.js Object3D: world = parent.T · parent.R(yaw) · parent.S · local.
      const lx = local.x * p.sx;
      const lz = local.z * p.sz;
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      // A non-uniform parent scale under a yawed child would shear the footprint: not taken.
      const uniform = Math.abs(p.sx - p.sz) < 1e-6 || Math.abs(Math.sin(local.yaw)) < 1e-6;
      pose = uniform ? { x: p.x + c * lx + s * lz, y: p.y + local.y * p.sy, z: p.z - s * lx + c * lz, yaw: p.yaw + local.yaw, sx: p.sx * local.sx, sy: p.sy * local.sy, sz: p.sz * local.sz } : null;
    }
  }
  cache.set(id, pose);
  return pose;
}

/** The flat, level, static surfaces of a world (boxes up to {@link FLAT_MAX} thick and planes). */
function flats(world: WorldDoc): Flat[] {
  const out: Flat[] = [];
  const cache = new Map<EntityId, Pose | null>();
  for (const id in world.entities) {
    const e = world.entities[id];
    if (!e || e.template || !e.visible) continue;
    const s = e.shape;
    if (s.kind !== 'primitive' || (s.primitive !== 'box' && s.primitive !== 'plane')) continue;
    const body = e.physics?.body;
    if (body === 'dynamic' || body === 'kinematic') continue;
    if (s.primitive === 'box' && s.size[1] > FLAT_MAX) continue;
    const p = poseOf(world, id, cache);
    if (!p || !(p.sx > 0 && p.sy > 0 && p.sz > 0)) continue;
    const top = s.primitive === 'box' ? p.y + (s.size[1] * p.sy) / 2 : p.y;
    const hx = (s.size[0] * p.sx) / 2;
    const hz = (s.size[2] * p.sz) / 2;
    if (!(hx > 0 && hz > 0) || !Number.isFinite(top)) continue;
    out.push({ id, top, cx: p.x, cz: p.z, hx, hz, yaw: p.yaw, area: 4 * hx * hz });
  }
  return out;
}

/** True when the two rotated footprints overlap by more than {@link OVERLAP_MIN} (separating axes). */
function overlaps(a: Flat, b: Flat): boolean {
  const axes: Array<[number, number]> = [
    [Math.cos(a.yaw), -Math.sin(a.yaw)],
    [Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(b.yaw), -Math.sin(b.yaw)],
    [Math.sin(b.yaw), Math.cos(b.yaw)],
  ];
  const radius = (f: Flat, ax: number, az: number): number => {
    const ux = Math.cos(f.yaw);
    const uz = -Math.sin(f.yaw);
    const vx = Math.sin(f.yaw);
    const vz = Math.cos(f.yaw);
    return f.hx * Math.abs(ux * ax + uz * az) + f.hz * Math.abs(vx * ax + vz * az);
  };
  for (const [ax, az] of axes) {
    const d = Math.abs((b.cx - a.cx) * ax + (b.cz - a.cz) * az);
    if (radius(a, ax, az) + radius(b, ax, az) - d < OVERLAP_MIN) return false;
  }
  return true;
}

/**
 * Drawing lift (m) of each flat surface lying in the plane of a larger one it overlaps: {@link COPLANAR_LIFT} over the
 * highest-lifted larger surface under it (a stack of three gets 0, 1 and 2 lifts). Surfaces with no coplanar overlap are
 * absent from the map.
 */
export function coplanarLifts(world: WorldDoc): Map<EntityId, number> {
  const list = flats(world).sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lifts = new Map<EntityId, number>();
  if (list.length < 2) return lifts;
  const rank = new Map<Flat, number>(list.map((f, i) => [f, i]));
  const under = new Map<number, number[]>();
  const pair = (a: Flat, b: Flat): void => {
    if (!overlaps(a, b)) return;
    const ra = rank.get(a) ?? 0;
    const rb = rank.get(b) ?? 0;
    const [big, small] = ra < rb ? [ra, rb] : [rb, ra];
    const arr = under.get(small) ?? [];
    if (!arr.includes(big)) arr.push(big);
    under.set(small, arr);
  };
  // Planes: runs of tops within PLANE_EPS of their neighbour.
  const byTop = [...list].sort((a, b) => a.top - b.top);
  for (let start = 0; start < byTop.length; ) {
    let end = start + 1;
    while (end < byTop.length && byTop[end]!.top - byTop[end - 1]!.top <= PLANE_EPS) end++;
    const plane = byTop.slice(start, end);
    start = end;
    if (plane.length < 2) continue;
    const near = (a: Flat, b: Flat): boolean => Math.abs(a.top - b.top) <= PLANE_EPS;
    if (plane.length <= PAIRWISE_MAX) {
      for (let k = 0; k < plane.length; k++) for (let m = k + 1; m < plane.length; m++) if (near(plane[k]!, plane[m]!)) pair(plane[k]!, plane[m]!);
      continue;
    }
    // Many surfaces in one plane (a tiled yard, a test grid): only those sharing a grid cell can overlap.
    const cells = new Map<string, Flat[]>();
    const seen = new Set<string>();
    for (const f of plane) {
      const r = Math.hypot(f.hx, f.hz);
      for (let gx = Math.floor((f.cx - r) / GRID_CELL); gx <= Math.floor((f.cx + r) / GRID_CELL); gx++) {
        for (let gz = Math.floor((f.cz - r) / GRID_CELL); gz <= Math.floor((f.cz + r) / GRID_CELL); gz++) {
          const key = `${gx},${gz}`;
          const there = cells.get(key);
          if (!there) {
            cells.set(key, [f]);
            continue;
          }
          for (const g of there) {
            const id = f.id < g.id ? `${f.id}\u0000${g.id}` : `${g.id}\u0000${f.id}`;
            if (seen.has(id)) continue;
            seen.add(id);
            if (near(f, g)) pair(f, g);
          }
          there.push(f);
        }
      }
    }
  }
  const level: number[] = list.map(() => 0);
  for (let i = 0; i < list.length; i++) {
    const below = under.get(i);
    if (!below) continue;
    for (const j of below) level[i] = Math.max(level[i]!, level[j]! + 1);
    lifts.set(list[i]!.id, level[i]! * COPLANAR_LIFT);
  }
  return lifts;
}
