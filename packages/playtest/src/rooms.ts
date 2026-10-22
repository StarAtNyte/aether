/**
 * Goals of a walkthrough: every room of every building must be walked into
 * from the entrance (the player spawn), through its doors, up its stairs.
 * Rooms come from the `arch` metadata of the document; a room is "visited"
 * when the bot's feet are inside its floor outline at the room's floor
 * height.
 */
import { rotateVec3, worldTransform, type Entity, type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { pointInPolygon } from '@aether/arch';
import { entityBounds } from '@aether/physics';
import { deriveGoals, type GoalModel, type GoalObjective } from './goals';
import { PLAYTEST_LIMITS } from './types';

type P2 = [number, number];

/** World-space floor outline of a room entity, or null. */
export function roomOutline(world: WorldDoc, room: Entity): P2[] | null {
  const shape = room.shape;
  if (shape.kind !== 'procedural') return null;
  const raw = shape.params['polygon'];
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 256) return null;
  let t;
  try {
    t = worldTransform(world, room.id);
  } catch {
    return null;
  }
  const out: P2[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    const w = rotateVec3(t.quaternion, [p[0] * t.scale[0], 0, p[1] * t.scale[2]]);
    out.push([t.position[0] + w[0], t.position[2] + w[2]]);
  }
  return out;
}

/** World-space openings in the floor of a room (the stairwells cut through it), or none. */
export function roomHoles(world: WorldDoc, room: Entity): P2[][] {
  const shape = room.shape;
  if (shape.kind !== 'procedural') return [];
  const raw = shape.params['holes'];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) return [];
  let t;
  try {
    t = worldTransform(world, room.id);
  } catch {
    return [];
  }
  const out: P2[][] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring) || ring.length < 3 || ring.length > 256) continue;
    const pts: P2[] = [];
    for (const p of ring) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') break;
      const w = rotateVec3(t.quaternion, [p[0] * t.scale[0], 0, p[1] * t.scale[2]]);
      pts.push([t.position[0] + w[0], t.position[2] + w[2]]);
    }
    if (pts.length === ring.length) out.push(pts);
  }
  return out;
}

/** Distance from a point to the outline of a polygon (m). */
function outlineDistance(p: P2, poly: readonly P2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    d = Math.min(d, Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz));
  }
  return d;
}

/** A point well inside a polygon: the centroid when it is inside, else the middle of the widest horizontal span. */
export function interiorPoint(poly: readonly P2[], holes: readonly (readonly P2[])[] = []): { point: P2; radius: number } {
  let cx = 0, cz = 0, area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const f = a[0] * b[1] - b[0] * a[1];
    area += f;
    cx += (a[0] + b[0]) * f;
    cz += (a[1] + b[1]) * f;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  let point: P2 = Math.abs(area) > 1e-6 ? [cx / (3 * area), cz / (3 * area)] : [(minX + maxX) / 2, (minZ + maxZ) / 2];
  if (!pointInPolygon(point[0], point[1], poly)) {
    // Scan a coarse grid for the interior point farthest from the outline's bounding box edges.
    let best = -1;
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 20; j++) {
        const x = minX + ((maxX - minX) * i) / 20;
        const z = minZ + ((maxZ - minZ) * j) / 20;
        if (!pointInPolygon(x, z, poly)) continue;
        const score = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
        if (score > best) {
          best = score;
          point = [x, z];
        }
      }
    }
  }
  let radius = Math.max(0.35, Math.min(1.4, Math.min(maxX - minX, maxZ - minZ) * 0.3));
  // A stairwell in the middle of the floor (a landing is where the stair comes out): the point to walk to is the floor
  // farthest from the opening and the walls, not the middle of the hole (nobody can stand there).
  if (holes.some((h) => pointInPolygon(point[0], point[1], h) || outlineDistance(point, h) < 0.7)) {
    let best = -Infinity;
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 40; j++) {
        const x = minX + ((maxX - minX) * i) / 40;
        const z = minZ + ((maxZ - minZ) * j) / 40;
        if (!pointInPolygon(x, z, poly) || holes.some((h) => pointInPolygon(x, z, h))) continue;
        const clear = Math.min(outlineDistance([x, z], poly), ...holes.map((h) => outlineDistance([x, z], h)));
        if (clear > best) {
          best = clear;
          point = [x, z];
        }
      }
    }
    radius = Math.max(0.35, Math.min(radius, best * 0.9));
  }
  return { point, radius };
}

/** Rooms of a document as objectives (bounded). */
export function deriveWalkGoals(world: WorldDoc): GoalModel {
  const base = deriveGoals(world);
  const objectives: GoalObjective[] = [];
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || e.arch?.role !== 'room') continue;
    const poly = roomOutline(world, e);
    if (!poly) continue;
    const { point, radius } = interiorPoint(poly, roomHoles(world, e));
    const b = entityBounds(world, id);
    const floorY = b ? b.max[1] : (worldTransformSafe(world, id)?.[1] ?? 0);
    const center: Vec3 = [point[0], floorY, point[1]];
    objectives.push({
      id: `room:${id}`,
      kind: 'room',
      label: e.name && e.name !== id ? e.name : id,
      entity: id as EntityId,
      position: center,
      required: true,
      touch: { shape: { kind: 'cylinder', half: [radius, 1.3, radius] }, center: [point[0], floorY + 0.7, point[1]], rot: [0, 0, 0, 1], margin: 0 },
      completes: 'state',
      region: { poly, y0: floorY - 0.4, y1: floorY + 2.4 },
    });
    if (objectives.length >= PLAYTEST_LIMITS.MAX_OBJECTIVES) break;
  }
  return { ...base, objectives, winDefined: true, requiredKeys: new Set(), timerSeconds: 0, producible: new Map() };
}

function worldTransformSafe(world: WorldDoc, id: EntityId): Vec3 | null {
  try {
    return worldTransform(world, id).position;
  } catch {
    return null;
  }
}
