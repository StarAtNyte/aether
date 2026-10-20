/**
 * Grounding: does each object that should rest on something actually touch it?
 *
 * A torii set at y = 9.6 next to a hill whose surface there is at 7.3 hovers 2.3 m in the air; a bounding-box
 * test ("something is below its box") calls that supported. Here the support is measured with rays against the
 * real colliders (terrain, hills, platforms, floors, the ground plane): under the object's footprint, every
 * hit that is not the object itself, and the highest one at or just below its bottom is what it stands on.
 * The smallest gap over the footprint is the hover height (an object on a slope touches at one corner).
 *
 * Things meant to be in the air are left alone: anything tagged floating / flying / hovering / hanging /
 * cloud / sky / bird / balloon / platform, bobbing, orbiting or spinning things, pickups, goals and other
 * trigger zones, moving (dynamic or kinematic) bodies, characters, lights, buildings (their own checks
 * cover them) and terrain itself; so is anything a solid touches from the side or from above (a banner on a
 * tower, a rock clinging under a ledge, a bridge deck held by its ramps). Tag an object "floating" to say it
 * hovers on purpose.
 */
import { findWaterBodies, isWaterEntity, waterAt, worldTransform, type Entity, type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { entityBounds, type Aabb, type PhysicsWorld } from '@aether/physics';

/** Hover height (m) above which an object counts as floating; small gaps are mesh and collider slack. */
export const FLOAT_TOLERANCE = 0.12;
/** Most objects measured per call (the largest first) and rays per object. */
export const GROUNDING_LIMITS = Object.freeze({ MAX_OBJECTS: 400, RAYS_PER_OBJECT: 5 });

/** One object that hovers above its support. */
export interface FloatingObject {
  id: EntityId;
  /** The object's name, or its id. */
  label: string;
  /** Metres between the object's bottom and the surface under it (Infinity: nothing under it at all). */
  gap: number;
  /** Bottom of the object and the support height at the closest point (world y). */
  bottom: number;
  support: number | null;
  /** What it is above (entity id; null: the ground plane or nothing). */
  over: EntityId | null;
  /** Where the gap was measured (the closest point of the footprint, on the support). */
  at: Vec3;
  /** The object's origin (world): move it with these x, z to keep it where it is. */
  origin: Vec3;
}

/** Result of {@link measureGrounding}. */
export interface GroundingReport {
  floating: FloatingObject[];
  /** How many objects were measured. */
  checked: number;
}

const AIRBORNE_TAG = /float|hover|fly|flying|sky|cloud|bird|balloon|airborne|hanging|ceiling|orbit|space|planet|star|moon|sun|drone|kite|platform/;
const TERRAIN_GENERATORS = new Set(['terrain', 'island', 'mountain', 'hill', 'hills', 'cliff', 'cloud', 'water', 'river', 'ocean', 'lake', 'pond', 'waterfall', 'portal', 'crystal']);
const AIRBORNE_BEHAVIORS = new Set(['bob', 'orbit', 'spin', 'collectible', 'magnet', 'goal', 'checkpoint', 'trigger', 'path', 'patrol', 'follow', 'wander', 'flee', 'chase', 'flock']);

/** True when an object is meant to rest on something (and so may be reported as floating). */
export function shouldRest(e: Entity): boolean {
  if (e.template || !e.visible || e.shape.kind === 'scatter') return false;
  if (e.tags.some((t) => AIRBORNE_TAG.test(t) || t === 'terrain' || t === 'ground' || t === 'backdrop' || t === 'scenery' || t === 'water')) return false;
  if (e.behaviors.some((b) => b.enabled !== false && AIRBORNE_BEHAVIORS.has(b.type))) return false;
  if (e.physics && (e.physics.sensor || e.physics.body === 'dynamic' || e.physics.body === 'kinematic')) return false;
  if (e.npc || e.arch || e.light || isWaterEntity(e)) return false;
  if (e.shape.kind === 'procedural' && TERRAIN_GENERATORS.has(e.shape.generator)) return false;
  return true;
}

/** Ids of an entity and everything under it. */
export function subtreeOf(world: WorldDoc, root: EntityId): Set<EntityId> {
  const ids = new Set<EntityId>([root]);
  const children = new Map<EntityId, EntityId[]>();
  for (const id in world.entities) {
    const p = (world.entities[id] as Entity).parent;
    if (p !== null) children.set(p, [...(children.get(p) ?? []), id]);
  }
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop() as EntityId;
    for (const c of children.get(id) ?? []) {
      if (ids.has(c)) continue;
      ids.add(c);
      stack.push(c);
    }
  }
  return ids;
}

/** World box of an entity with everything under it (null when nothing has an extent). */
export function subtreeBounds(world: WorldDoc, ids: Iterable<EntityId>): Aabb | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const id of ids) {
    const b = entityBounds(world, id);
    if (!b) continue;
    any = true;
    for (let k = 0; k < 3; k++) {
      if ((b.min[k] as number) < (min[k] as number)) min[k] = b.min[k] as number;
      if ((b.max[k] as number) > (max[k] as number)) max[k] = b.max[k] as number;
    }
  }
  return any ? { min, max } : null;
}

/** Footprint (m) up to which a plain group is one object (a shrine of posts and beams); larger groups are folders. */
const GROUP_UNIT = 30;

/**
 * The objects that stand on their own: top-level ones; a plain group (no shape, no body) is one object when it
 * is small (a shrine of posts and beams), else a folder whose members stand on their own.
 */
function restingRoots(world: WorldDoc): EntityId[] {
  const out: EntityId[] = [];
  const children = new Map<EntityId, EntityId[]>();
  for (const id in world.entities) {
    const p = (world.entities[id] as Entity).parent;
    if (p !== null) children.set(p, [...(children.get(p) ?? []), id]);
  }
  const plainGroup = (e: Entity): boolean => e.shape.kind === 'none' && !e.physics && !e.arch && !e.npc;
  const visit = (id: EntityId, depth: number): void => {
    const e = world.entities[id] as Entity;
    if (!plainGroup(e)) {
      out.push(id);
      return;
    }
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return;
    const b = subtreeBounds(world, subtreeOf(world, id));
    if (b && Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) <= GROUP_UNIT) out.push(id);
    else if (depth < 2) for (const k of kids) visit(k, depth + 1);
  };
  for (const id in world.entities) if ((world.entities[id] as Entity).parent === null) visit(id, 0);
  return out;
}

/**
 * The surface under (x, z) at or just below `bottom` (the highest hit not belonging to `own`), or null when
 * there is nothing below. Hits above the bottom (the object is sunk in, or something overhangs it) are skipped
 * unless nothing else is there, in which case the object is buried rather than floating (support = bottom).
 */
export function supportBelow(pw: PhysicsWorld, own: ReadonlySet<EntityId>, x: number, z: number, top: number, bottom: number): { y: number; id: EntityId | null } | null {
  const from = top + 0.25;
  const hits = pw.raycastAll([x, from, z], [0, -1, 0], from - bottom + 400, 16).filter((h) => h.id === null || !own.has(h.id));
  let best: { y: number; id: EntityId | null } | null = null;
  let buried = false;
  for (const h of hits) {
    const y = h.point[1];
    if (y > bottom + 0.35) {
      buried = true;
      continue;
    }
    if (!best || y > best.y) best = { y, id: h.id };
  }
  if (!best && buried) return { y: bottom, id: null };
  return best;
}

/** Measure every object that should rest on something; report those that hover. */
export function measureGrounding(world: WorldDoc, pw: PhysicsWorld, only?: ReadonlySet<EntityId>): GroundingReport {
  const roots = restingRoots(world).filter((id) => (only ? only.has(id) : true) && shouldRest(world.entities[id] as Entity));
  // Water holds up what floats on it (boats, rafts, lanterns on a river): its surface counts as a support.
  const water = findWaterBodies(world);
  const measured: Array<{ id: EntityId; own: Set<EntityId>; b: Aabb }> = [];
  for (const id of roots) {
    const own = subtreeOf(world, id);
    // A container's parts that may hover (a lantern hung on a post) do not decide where the whole stands.
    const solid = [...own].filter((x) => shouldRest(world.entities[x] as Entity) && (world.entities[x] as Entity).shape.kind !== 'none');
    const b = subtreeBounds(world, solid);
    if (!b) continue;
    const w = b.max[0] - b.min[0];
    const d = b.max[2] - b.min[2];
    // Scenery-sized slabs and ground covers are supports, not things that rest.
    if (Math.max(w, d) > 60 || b.max[1] - b.min[1] < 0.02) continue;
    measured.push({ id, own, b });
  }
  measured.sort((p, q) => volumeOf(q.b) - volumeOf(p.b));
  const floating: FloatingObject[] = [];
  for (const { id, own, b } of measured.slice(0, GROUNDING_LIMITS.MAX_OBJECTS)) {
    const bottom = b.min[1];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const hx = ((b.max[0] - b.min[0]) / 2) * 0.7;
    const hz = ((b.max[2] - b.min[2]) / 2) * 0.7;
    const samples: Array<[number, number]> = [[cx, cz], [cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]];
    let gap = Infinity;
    let at: Vec3 = [cx, bottom, cz];
    let support: number | null = null;
    let over: EntityId | null = null;
    for (const [x, z] of samples.slice(0, GROUNDING_LIMITS.RAYS_PER_OBJECT)) {
      let s = supportBelow(pw, own, x, z, b.max[1], bottom);
      const wet = waterAt(water, x, z, bottom + 0.35);
      if (wet && !own.has(wet.id) && wet.y <= bottom + 0.35 && (!s || wet.y > s.y)) s = { y: wet.y, id: wet.id };
      if (!s) continue;
      const g = bottom - s.y;
      if (g < gap) {
        gap = g;
        at = [x, s.y, z];
        support = s.y;
        over = s.id;
      }
    }
    if (gap <= FLOAT_TOLERANCE) continue;
    // Hung on a wall, clinging under a ledge or held at its ends (a banner on a tower, a bridge deck between its ramps).
    if (attached(pw, own, b)) continue;
    const e = world.entities[id] as Entity;
    let origin: Vec3 = [cx, bottom, cz];
    try {
      origin = worldTransform(world, id).position;
    } catch {
      /* keep the box centre */
    }
    floating.push({ id, label: e.name && e.name !== id ? `${e.name} (${id})` : id, gap, bottom, support, over, at, origin });
  }
  floating.sort((p, q) => q.gap - p.gap);
  return { floating, checked: Math.min(measured.length, GROUNDING_LIMITS.MAX_OBJECTS) };
}

/** Reach (m) past an object's box within which a solid beside or above it holds it. */
const CONTACT = 0.2;

/**
 * True when something solid touches the object from the side or from above: it hangs on a wall, clings under a
 * ledge, or is held at its ends. Rays from the centre of its box outward (at its bottom, middle and top) and up.
 */
export function attached(pw: PhysicsWorld, own: ReadonlySet<EntityId>, b: Aabb): boolean {
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const hx = (b.max[0] - b.min[0]) / 2;
  const hy = (b.max[1] - b.min[1]) / 2;
  const hz = (b.max[2] - b.min[2]) / 2;
  const near = (o: Vec3, d: Vec3, max: number): boolean => pw.raycastAll(o, d, max, 8).some((h) => (h.id === null || !own.has(h.id)) && h.distance <= max);
  for (const y of [b.min[1] + 0.05, cy, b.max[1] - 0.05]) {
    if (near([cx, y, cz], [1, 0, 0], hx + CONTACT) || near([cx, y, cz], [-1, 0, 0], hx + CONTACT) || near([cx, y, cz], [0, 0, 1], hz + CONTACT) || near([cx, y, cz], [0, 0, -1], hz + CONTACT)) return true;
  }
  if (near([cx, cy, cz], [0, 1, 0], hy + CONTACT)) return true;
  // Clinging under a ledge off its centre: up from the corners of its top face.
  const top = b.max[1] - 0.02;
  for (const [x, z] of [[cx - hx * 0.7, cz - hz * 0.7], [cx + hx * 0.7, cz - hz * 0.7], [cx - hx * 0.7, cz + hz * 0.7], [cx + hx * 0.7, cz + hz * 0.7]] as const) if (near([x, top, z], [0, 1, 0], CONTACT)) return true;
  return false;
}

function volumeOf(b: Aabb): number {
  return Math.max(0.01, b.max[0] - b.min[0]) * Math.max(0.01, b.max[1] - b.min[1]) * Math.max(0.01, b.max[2] - b.min[2]);
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** One line per floating object, with the numbers and the fix. */
export function floatingText(f: FloatingObject, labelOf: (id: EntityId | null) => string): string {
  if (!Number.isFinite(f.gap)) return `${f.label} has nothing under it: its bottom is at y=${r2(f.bottom)} over open air`;
  return `${f.label} hovers ${r2(f.gap)} m above ${labelOf(f.over)}: its bottom is at y=${r2(f.bottom)}, the surface under it at (${r2(f.at[0])}, ${r2(f.at[2])}) is at y=${r2(f.support ?? 0)}`;
}
