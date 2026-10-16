/**
 * Where the water of a world is: the horizontal surfaces of its water entities (primitive planes, boxes and
 * cylinders drawn with the "water" material). Pure and fast; the renderer (ripples, reflection, underwater) and the
 * level tools (fish need water, deer must not stand in it) read the same list.
 */
import type { Entity, WorldDoc } from './schema';

/** One horizontal water surface. */
export interface WaterBody {
  /** Entity id. */
  id: string;
  /** Height of the surface (m). */
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The footprint is the ellipse inscribed in the box (a cylinder pond), not the box. */
  round: boolean;
  /** Footprint (m²). */
  area: number;
}

/** True for an entity drawn as water. */
export function isWaterEntity(e: Entity): boolean {
  return e.material?.preset === 'water' && e.visible && !e.template;
}

/** Surfaces of every water entity with a primitive shape, parent offsets applied by translation only, largest first. */
export function findWaterBodies(world: Pick<WorldDoc, 'entities'>): WaterBody[] {
  const out: WaterBody[] = [];
  for (const e of Object.values(world.entities)) {
    if (!isWaterEntity(e) || e.shape.kind !== 'primitive') continue;
    const s = e.shape;
    const sc = e.transform.scale;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let p = e.parent ? world.entities[e.parent] : undefined, hops = 0; p && hops < 8; p = p.parent ? world.entities[p.parent] : undefined, hops++) {
      ox += p.transform.position[0];
      oy += p.transform.position[1];
      oz += p.transform.position[2];
    }
    const cx = e.transform.position[0] + ox;
    const cy = e.transform.position[1] + oy;
    const cz = e.transform.position[2] + oz;
    let w = Math.abs((s.size[0] ?? 1) * (sc[0] ?? 1));
    let d = Math.abs((s.primitive === 'cylinder' ? (s.size[2] ?? s.size[0] ?? 1) : (s.size[2] ?? 1)) * (sc[2] ?? 1));
    const h = Math.abs((s.size[1] ?? 0) * (sc[1] ?? 1));
    const yaw = (((e.transform.rotation[1] ?? 0) % 180) + 180) % 180;
    if (Math.abs(yaw - 90) < 1) [w, d] = [d, w];
    const top = s.primitive === 'plane' ? cy : cy + h / 2;
    if (![cx, cy, cz, w, d, top].every(Number.isFinite) || w <= 0 || d <= 0) continue;
    out.push({ id: e.id, y: top, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, round: s.primitive === 'cylinder', area: w * d });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** The body containing `(x, z)` whose height is nearest `y`, or null. */
export function waterAt<T extends WaterBody>(bodies: readonly T[], x: number, z: number, y: number): T | null {
  let best: T | null = null;
  let bestDy = Number.POSITIVE_INFINITY;
  for (const s of bodies) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    if (s.round) {
      const nx = (x - (s.minX + s.maxX) / 2) / ((s.maxX - s.minX) / 2);
      const nz = (z - (s.minZ + s.maxZ) / 2) / ((s.maxZ - s.minZ) / 2);
      if (nx * nx + nz * nz > 1) continue;
    }
    const dy = Math.abs(y - s.y);
    if (dy < bestDy) {
      best = s;
      bestDy = dy;
    }
  }
  return best;
}

/** Distance (m) from `(x, z)` to the nearest edge of a body's footprint (0 outside). */
export function edgeDistance(b: WaterBody, x: number, z: number): number {
  const hx = (b.maxX - b.minX) / 2;
  const hz = (b.maxZ - b.minZ) / 2;
  const nx = (x - (b.minX + b.maxX) / 2) / hx;
  const nz = (z - (b.minZ + b.maxZ) / 2) / hz;
  if (b.round) {
    const r = Math.hypot(nx, nz);
    return r >= 1 ? 0 : (1 - r) * Math.min(hx, hz);
  }
  return Math.max(0, Math.min(hx - Math.abs(x - (b.minX + b.maxX) / 2), hz - Math.abs(z - (b.minZ + b.maxZ) / 2)));
}
