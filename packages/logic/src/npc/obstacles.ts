/**
 * Turns the solids of a world document into navigation {@link Obstacle}s
 * and builds {@link NavGrid}s around NPCs. Primitive shapes are exact; other
 * shapes (generated buildings, trees, assets) use world-space bounds from the
 * host when it can provide them (`LogicHost.getBounds`) and a scaled unit box
 * otherwise.
 */
import { worldTransform, type Entity, type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { zoneShapeOf } from '../bounds';
import { yawOfQuat } from '../vec';
import { hyp } from './math';
import { NavGrid, type Obstacle } from './nav';

/** Optional world-space bounds source (a physics-backed host provides it). */
export interface BoundsProvider {
  getBounds?(id: EntityId): { min: Vec3; max: Vec3 } | undefined;
  getColliderBounds?(id: EntityId): ReadonlyArray<{ min: Vec3; max: Vec3 }>;
  /** Height of the open terrain under (x, z) (see {@link terrainSampler}); grids drape over it when given. */
  terrainHeight?(x: number, z: number): number | undefined;
}

/** Axis-aligned area in world metres. */
export interface Area {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Generators / names that stand for open terrain or water: floor, never a wall. */
const TERRAINISH = /terrain|island|mountain|hill|ground|water|river|lake|sea|ocean|road|path|floor|lawn|meadow|field|beach|dune/i;
/** Footprints above this area (m²) are scenery floors, not obstacles. */
const HUGE_AREA = 2500;
/** Default agent size used for grids. */
export const DEFAULT_STEP = 0.55;

const DEG = 180 / Math.PI;

/** True when `e` (or an ancestor) is an NPC: NPC bodies are not obstacles for other NPCs. */
function underNpc(world: WorldDoc, e: Entity): boolean {
  let cur: Entity | undefined = e;
  for (let depth = 0; cur && depth < 12; depth++) {
    if (cur.npc) return true;
    cur = cur.parent === null ? undefined : world.entities[cur.parent];
  }
  return false;
}

/**
 * True for open ground: terrain-like generators or names (terrain, hill, path, river …), which are floor, never a wall.
 * `area` (m², optional) also counts scenery-sized footprints.
 */
export function isTerrainish(e: Entity, id: string, area = 0): boolean {
  return area > HUGE_AREA || TERRAINISH.test(e.shape.kind === 'procedural' ? e.shape.generator : '') || TERRAINISH.test(id);
}

/**
 * A terrain height sampler for {@link BoundsProvider.terrainHeight} from a host's downward ray casts: the first
 * terrain-like solid under (x, z), seen through trees, rocks and anything else above it. Undefined when the world
 * has no terrain-like solids.
 */
export function terrainSampler(
  world: WorldDoc,
  castDown: (x: number, fromY: number, z: number, maxDist: number) => ReadonlyArray<{ id: EntityId | null; point: Vec3 }>,
  bounds?: BoundsProvider,
): ((x: number, z: number) => number | undefined) | undefined {
  const ids = new Set<EntityId>();
  let top = -Infinity;
  for (const id of Object.keys(world.entities)) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.physics || e.physics.sensor || e.physics.collider === 'none' || e.physics.body === 'dynamic' || e.shape.kind === 'none' || e.shape.kind === 'scatter') continue;
    const b = bounds?.getBounds?.(id);
    const area = b ? (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) : 0;
    if (!isTerrainish(e, id, area)) continue;
    ids.add(id);
    top = Math.max(top, b ? b.max[1] : 50);
  }
  if (ids.size === 0) return undefined;
  const from = Math.min(2000, top + 1);
  return (x, z) => {
    for (const h of castDown(x, from, z, from + 200)) if (h.id !== null && ids.has(h.id)) return h.point[1];
    return undefined;
  };
}

/** Collect obstacles intersecting `area` (expanded by `margin`). Deterministic order (document order). */
export function collectObstacles(world: WorldDoc, area: Area, margin: number, bounds?: BoundsProvider, skipTerrain = false): Obstacle[] {
  const out: Obstacle[] = [];
  for (const id of Object.keys(world.entities)) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.physics || e.shape.kind === 'none' || e.shape.kind === 'scatter') continue;
    // Draped grids take open ground from the terrain sampler (it is the floor there, not a box).
    if (skipTerrain && isTerrainish(e, id)) continue;
    const p = e.physics;
    if (p.sensor || p.collider === 'none' || p.body === 'dynamic') continue;
    if (p.body === 'kinematic' && !e.behaviors.some((b) => b.type === 'door')) continue;
    if (underNpc(world, e)) continue;
    let pos: Vec3;
    let quat: [number, number, number, number];
    try {
      const t = worldTransform(world, id);
      pos = t.position;
      quat = t.quaternion;
    } catch {
      continue;
    }
    const prim = e.shape.kind === 'primitive' ? e.shape : null;
    let ob: Obstacle | null = null;
    // Generated shapes: one obstacle per collider when the host knows them (trunk and canopy are different heights).
    const parts = !prim ? bounds?.getColliderBounds?.(id) : undefined;
    if (parts && parts.length > 0) {
      for (const b of parts) {
        const part = boxFromBounds(b);
        if (!inArea(part, area, margin)) continue;
        out.push(floorish(e, id, part));
      }
      continue;
    }
    if (prim) {
      const z = zoneShapeOf(e);
      const tilt = Math.abs(quat[0]) + Math.abs(quat[2]);
      if (prim.primitive === 'plane') {
        ob = box(pos[0], pos[2], z.half[0], z.half[2], -yawOfQuat(quat) / DEG, pos[1] - 0.05, pos[1] + 0.0);
      } else if (z.kind === 'box' && tilt < 0.13) {
        ob = box(pos[0], pos[2], z.half[0], z.half[2], -yawOfQuat(quat) / DEG, pos[1] - z.half[1], pos[1] + z.half[1]);
      } else if (z.kind === 'box') {
        const r = rotatedAabb(pos, quat, z.half);
        ob = box(r.cx, r.cz, r.hx, r.hz, 0, r.bottom, r.top);
      } else {
        const rad = z.half[0];
        ob = { cx: pos[0], cz: pos[2], hx: rad, hz: rad, cos: 1, sin: 0, circle: true, bottom: pos[1] - z.half[1], top: pos[1] + z.half[1] };
      }
    } else {
      const b = bounds?.getBounds?.(id);
      const size = e.shape.kind === 'procedural' && /^(?:terrain|island|mountain)$/.test(e.shape.generator) ? e.shape.params['size'] : undefined;
      if (b) {
        ob = boxFromBounds(b);
      } else if (typeof size === 'number' && size > 0 && size <= 2000) {
        // No host bounds (a static analysis): a terrain is the ground over its footprint, at its base level.
        ob = box(pos[0], pos[2], size / 2, size / 2, 0, pos[1] - 0.1, pos[1]);
      } else {
        const z = zoneShapeOf(e);
        const r = rotatedAabb(pos, quat, z.half);
        ob = box(r.cx, r.cz, r.hx, r.hz, 0, r.bottom, r.top);
      }
    }
    if (!ob) continue;
    if (!inArea(ob, area, margin)) continue;
    ob = floorish(e, id, ob);
    out.push(ob);
  }
  return out;
}

function boxFromBounds(b: { min: Vec3; max: Vec3 }): Obstacle {
  return box((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, (b.max[0] - b.min[0]) / 2, (b.max[2] - b.min[2]) / 2, 0, b.min[1], b.max[1]);
}

function inArea(ob: Obstacle, area: Area, margin: number): boolean {
  const reach = (ob.circle ? ob.hx : hyp(ob.hx, ob.hz)) + margin;
  return !(ob.cx + reach < area.minX || ob.cx - reach > area.maxX || ob.cz + reach < area.minZ || ob.cz - reach > area.maxZ);
}

/** Open ground (huge footprints, terrain-like names) is a floor at its top, not a wall. */
function floorish(e: Entity, id: string, ob: Obstacle): Obstacle {
  const footprint = ob.circle ? Math.PI * ob.hx * ob.hx : 4 * ob.hx * ob.hz;
  if (isTerrainish(e, id, footprint)) {
    let o = { ...ob, bottom: Math.min(ob.bottom, ob.top - 0.1) };
    // A tall terrain box (a heightfield with relief, whose bounds reach tens of metres) is the ground at its base level
    // here, not a wall: the level plot of an estate, a village green. (Hills are not walkable by this grid, which has a
    // flat floor per level; nothing on them is navigated.) Lower boxes keep their top as the floor.
    if (o.top - o.bottom > 3) o = { ...o, top: o.bottom + 0.05 };
    return o;
  }
  return ob;
}

function box(cx: number, cz: number, hx: number, hz: number, yaw: number, bottom: number, top: number): Obstacle {
  return { cx, cz, hx: Math.max(0.01, hx), hz: Math.max(0.01, hz), cos: Math.cos(yaw), sin: Math.sin(yaw), circle: false, bottom, top };
}

function rotatedAabb(pos: Vec3, q: readonly [number, number, number, number], half: Vec3): { cx: number; cz: number; hx: number; hz: number; bottom: number; top: number } {
  const [x, y, z, w] = q;
  // Rotation matrix rows (absolute values give the AABB half extents).
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
  const hx = Math.abs(r00) * half[0] + Math.abs(r01) * half[1] + Math.abs(r02) * half[2];
  const hy = Math.abs(r10) * half[0] + Math.abs(r11) * half[1] + Math.abs(r12) * half[2];
  const hz = Math.abs(r20) * half[0] + Math.abs(r21) * half[1] + Math.abs(r22) * half[2];
  return { cx: pos[0], cz: pos[2], hx, hz, bottom: pos[1] - hy, top: pos[1] + hy };
}

/** Options of {@link buildNavFor}. */
export interface NavFor {
  /** Feet height of the level. */
  refY: number;
  radius: number;
  height: number;
  /** Points the grid must cover (spawn, waypoints, ...). */
  points: ReadonlyArray<Readonly<Vec3>>;
  /** Extra room around the points (m). */
  pad?: number;
}

/**
 * Build a grid covering `points` ± `pad` (default 40 m) at one floor level.
 * Pure function of the document (and host bounds): same input, same grid.
 */
export function buildNavFor(world: WorldDoc, o: NavFor, bounds?: BoundsProvider): NavGrid {
  const pad = o.pad ?? 40;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of o.points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }
  if (!Number.isFinite(minX)) {
    minX = minZ = -10;
    maxX = maxZ = 10;
  }
  const area: Area = { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
  const surface = bounds?.terrainHeight ? (x: number, z: number): number | undefined => bounds.terrainHeight?.(x, z) : undefined;
  const obstacles = collectObstacles(world, area, o.radius, bounds, surface !== undefined);
  const ground = world.environment.ground;
  return NavGrid.build(obstacles, {
    ...(surface ? { surface } : {}),
    ...area,
    refY: o.refY,
    radius: o.radius,
    height: o.height,
    step: DEFAULT_STEP,
    ground: ground ? 0 : NaN,
    groundHalf: ground ? ground.size / 2 : 0,
  });
}
