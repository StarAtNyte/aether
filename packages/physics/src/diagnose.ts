/**
 * Static scene checks at t = 0 (no simulation): interpenetrations, floating
 * dynamic objects, out-of-bounds bodies, body count and joint problems.
 * Every message names the entities and a concrete fix so an LLM can repair
 * the world in one patch.
 */
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Entity, EntityId, Vec3, WorldDoc } from '@aether/core';
import { LIMITS, bodilessPeople } from '@aether/core';
import { rapier } from './rapier';
import { GROUND_ID, type ColliderProvider, type Diagnostic } from './types';
import { fmt } from './vec';
import { PhysicsWorld, type BodyRecord } from './world';

/** Thresholds used by {@link diagnose}. */
export const DIAGNOSE_LIMITS = Object.freeze({
  /** Penetration depth (m) below which touching bodies are fine. */
  OVERLAP_TOLERANCE: 0.01,
  /** Penetration depth (m) above which an overlap is an error. */
  OVERLAP_ERROR: 0.1,
  /** Gap (m) above support beyond which a dynamic body is floating. */
  FLOAT_GAP: 0.05,
  /** Bodies below this y are out of bounds. */
  MIN_Y: -5,
  /** More bodies than this is too many for a smooth browser simulation. */
  MAX_BODIES: 3000,
  /** Max diagnostics of one code (keeps LLM context small). */
  MAX_PER_CODE: 25,
});

/** One interpenetrating pair found at t = 0. */
export interface OverlapPair {
  a: EntityId;
  /** Other entity or {@link GROUND_ID}. */
  b: EntityId;
  depth: number;
  /** Contact normal pointing from `a` towards `b`. */
  normal: Vec3;
}

function isAncestor(doc: WorldDoc, ancestor: EntityId, id: EntityId): boolean {
  let cur: Entity | undefined = Object.hasOwn(doc.entities, id) ? doc.entities[id] : undefined;
  let depth = 0;
  while (cur && cur.parent !== null && depth++ < LIMITS.MAX_HIERARCHY_DEPTH) {
    if (cur.parent === ancestor) return true;
    cur = Object.hasOwn(doc.entities, cur.parent) ? doc.entities[cur.parent] : undefined;
  }
  return false;
}

function related(doc: WorldDoc, a: BodyRecord, b: BodyRecord | undefined): boolean {
  if (!b) return false;
  if (a.jointTarget === b.id || b.jointTarget === a.id) return true;
  return isAncestor(doc, a.id, b.id) || isAncestor(doc, b.id, a.id);
}

/**
 * Interpenetrating pairs at the current state (dynamic vs anything solid;
 * static/kinematic-only pairs, sensors, parent/child and jointed pairs are
 * ignored). Requires up-to-date narrow phase (fresh worlds are primed).
 */
export function findOverlaps(pw: PhysicsWorld, only?: ReadonlySet<EntityId>): OverlapPair[] {
  const world = pw._world();
  const records = pw._records();
  const doc = pw.document;
  const best = new Map<string, OverlapPair>();
  for (const rec of records.values()) {
    if (rec.type !== 'dynamic' || rec.sensor) continue;
    for (const c of rec.colliders) {
      world.contactPairsWith(c, (other: Collider) => {
        if (other.isSensor()) return;
        const otherId = pw._ownerOf(other.handle);
        if (otherId === undefined || otherId === rec.id) return;
        const otherRec = records.get(otherId);
        if (only && !only.has(rec.id) && !only.has(otherId)) return;
        if (related(doc, rec, otherRec)) return;
        // Visit each dynamic-dynamic pair once (from the lexicographically smaller id).
        if (otherRec && otherRec.type === 'dynamic' && !otherRec.sensor && otherId < rec.id) return;
        const contact = c.contactCollider(other, 0);
        if (!contact || contact.distance >= -DIAGNOSE_LIMITS.OVERLAP_TOLERANCE) return;
        const depth = -contact.distance;
        const key = `${rec.id}\u0000${otherId}`;
        const prev = best.get(key);
        if (!prev || depth > prev.depth) {
          best.set(key, { a: rec.id, b: otherId, depth, normal: [contact.normal1.x, contact.normal1.y, contact.normal1.z] });
        }
      });
    }
  }
  return [...best.values()].sort((x, y) => y.depth - x.depth);
}

function entityY(doc: WorldDoc, id: EntityId): { y: number; local: boolean } | null {
  const e = Object.hasOwn(doc.entities, id) ? doc.entities[id] : undefined;
  if (!e) return null;
  return { y: e.transform.position[1], local: e.parent !== null };
}

/** "move crate up to y=1.02" / "lower crate by 0.3m" (relative wording for parented entities). */
function moveVertical(doc: WorldDoc, id: EntityId, delta: number): string {
  const y = entityY(doc, id);
  const verb = delta >= 0 ? `move ${id} up` : `lower ${id}`;
  if (!y || y.local) return `${verb} by ${fmt(Math.abs(delta))}m`;
  return `${verb} to y=${fmt(y.y + delta)}`;
}

function overlapDiagnostic(doc: WorldDoc, records: ReadonlyMap<EntityId, BodyRecord>, p: OverlapPair): Diagnostic {
  const severity = p.depth > DIAGNOSE_LIMITS.OVERLAP_ERROR ? 'error' : 'warning';
  const depth = fmt(p.depth);
  const lift = p.depth;
  if (p.b === GROUND_ID) {
    return {
      severity,
      code: 'overlap',
      entities: [p.a],
      message: `${p.a} is sunk ${depth}m into the ground; it will be pushed out violently when simulation starts`,
      suggestion: moveVertical(doc, p.a, lift),
    };
  }
  const other = records.get(p.b);
  const [nx, ny, nz] = p.normal;
  let suggestion: string;
  if (ny < -0.5) {
    suggestion = moveVertical(doc, p.a, lift);
  } else if (ny > 0.5) {
    suggestion = other && other.type === 'dynamic' ? moveVertical(doc, p.b, lift) : moveVertical(doc, p.a, -lift);
  } else {
    const h = Math.hypot(nx, nz) || 1;
    suggestion = `move ${p.a} ${fmt(lift)}m along [${fmt(-nx / h)}, 0, ${fmt(-nz / h)}] (away from ${p.b})`;
  }
  return { severity, code: 'overlap', entities: [p.a, p.b], message: `${p.a} overlaps ${p.b} by ${depth}m`, suggestion };
}

function floatingDiagnostics(pw: PhysicsWorld, out: Diagnostic[]): void {
  const R = rapier();
  const world = pw._world();
  const doc = pw.document;
  const g = pw.getGravity();
  if (!(g[1] < 0) || Math.abs(g[0]) + Math.abs(g[2]) > Math.abs(g[1])) return; // only for downward gravity
  const down = { x: 0, y: -1, z: 0 };
  const jointTargets = new Set<EntityId>();
  for (const rec of pw._records().values()) if (rec.jointTarget) jointTargets.add(rec.jointTarget);
  let count = 0;
  for (const rec of pw._records().values()) {
    if (count >= DIAGNOSE_LIMITS.MAX_PER_CODE) break;
    const spec = rec.entity.physics;
    if (rec.type !== 'dynamic' || rec.sensor || !spec || rec.colliders.length === 0) continue;
    if (spec.gravityScale <= 0 || spec.initialVelocity || rec.joint || jointTargets.has(rec.id)) continue;
    let gap = Infinity;
    let hitId: EntityId | undefined;
    for (const c of rec.colliders) {
      let hit;
      try {
        hit = world.castShape(c.translation(), c.rotation(), down, c.shape, 0, 1000, false, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, rec.body);
      } catch {
        hit = null;
      }
      if (hit && hit.time_of_impact < gap) {
        gap = hit.time_of_impact;
        hitId = pw._ownerOf(hit.collider.handle);
      }
    }
    if (gap === Infinity) {
      if (pw._ground()) continue; // beyond the ground's edge: reported as outOfBounds
      count++;
      out.push({
        severity: 'warning',
        code: 'floating',
        entities: [rec.id],
        message: `${rec.id} is dynamic but has nothing below it; it will fall forever`,
        suggestion: `place ${rec.id} on a surface, or set physics.body to "static" if it should hover`,
      });
      continue;
    }
    if (gap <= DIAGNOSE_LIMITS.FLOAT_GAP) continue;
    count++;
    const below = hitId === undefined || hitId === GROUND_ID ? 'the ground' : hitId;
    out.push({
      severity: 'warning',
      code: 'floating',
      entities: hitId && hitId !== GROUND_ID ? [rec.id, hitId] : [rec.id],
      message: `${rec.id} floats ${fmt(gap)}m above ${below} and will drop when simulation starts`,
      suggestion: `${moveVertical(doc, rec.id, -(gap - 0.002))} (or set physics.body to "static" if it should hover)`,
    });
  }
}

function boundsDiagnostics(pw: PhysicsWorld, out: Diagnostic[]): void {
  const ground = pw._ground();
  const half = ground ? ground.size / 2 : Infinity;
  let count = 0;
  for (const rec of pw._records().values()) {
    if (count >= DIAGNOSE_LIMITS.MAX_PER_CODE) break;
    const t = rec.body.translation();
    if (Math.abs(t.x) > half || Math.abs(t.z) > half) {
      count++;
      out.push({
        severity: 'warning',
        code: 'outOfBounds',
        entities: [rec.id],
        message: `${rec.id} at x=${fmt(t.x)}, z=${fmt(t.z)} is outside the ${fmt(half * 2, 0)}m ground`,
        suggestion: `move ${rec.id} within ±${fmt(half, 0)}m on x and z, or enlarge environment.ground.size`,
      });
    } else if (t.y < DIAGNOSE_LIMITS.MIN_Y) {
      count++;
      out.push({
        severity: 'warning',
        code: 'outOfBounds',
        entities: [rec.id],
        message: `${rec.id} is at y=${fmt(t.y)}, below the world`,
        suggestion: `move ${rec.id} above y=0`,
      });
    }
  }
}

/** All static diagnostics for an existing (freshly built or primed) PhysicsWorld. */
export function diagnoseWorld(pw: PhysicsWorld): Diagnostic[] {
  const out: Diagnostic[] = [];
  const records = pw._records();
  if (records.size > DIAGNOSE_LIMITS.MAX_BODIES) {
    out.push({
      severity: 'warning',
      code: 'tooManyBodies',
      entities: [],
      message: `${records.size} physics bodies (more than ${DIAGNOSE_LIMITS.MAX_BODIES}) will slow the simulation down`,
      suggestion: 'remove physics from decorative entities or use a scatter shape for repeated static props',
    });
  }
  out.push(...pw.diagnostics());
  // A person left as a capsule or box: the design tools attach a character, this catches every other path.
  const bodiless = bodilessPeople(pw.document);
  for (const id of bodiless.slice(0, DIAGNOSE_LIMITS.MAX_PER_CODE)) {
    out.push({
      severity: 'warning',
      code: 'noCharacter',
      entities: [id],
      message: `${id} stands for a person but has no character, so it shows as a capsule or box`,
      suggestion: `update ${id} with character {wardrobe:"casual"|"guard"|"merchant"|"villager"|…, gender?, age?}: a rigged, animated person replaces the shape (the shape stays the collider)`,
    });
  }
  const overlaps = findOverlaps(pw);
  for (const p of overlaps.slice(0, DIAGNOSE_LIMITS.MAX_PER_CODE)) out.push(overlapDiagnostic(pw.document, records, p));
  floatingDiagnostics(pw, out);
  boundsDiagnostics(pw, out);
  return out;
}

/**
 * Static checks without simulating: overlaps at t = 0, floating dynamic
 * bodies, out-of-bounds bodies, too many bodies and invalid joints.
 */
export async function diagnose(world: WorldDoc, opts: { colliders?: ColliderProvider } = {}): Promise<Diagnostic[]> {
  const pw = await PhysicsWorld.create(world, opts.colliders ? { colliders: opts.colliders } : {});
  try {
    return diagnoseWorld(pw);
  } finally {
    pw.dispose();
  }
}
