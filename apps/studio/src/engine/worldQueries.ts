/**
 * Pure queries over a world document used by the simulation and studio
 * (avatar lookup, runtime-moving entities, camera framing decisions).
 */
import { deepEqual, type EntityId, type Vec3, type WorldDoc } from '@aether/core';

/** Entity the player controls: `player.controls`, else the first `playerController` entity. */
export function findAvatar(world: WorldDoc): EntityId | null {
  const c = world.player.controls;
  if (c && Object.prototype.hasOwnProperty.call(world.entities, c) && !world.entities[c]?.template) return c;
  for (const id in world.entities) {
    const e = world.entities[id];
    if (e && !e.template && e.behaviors.some((b) => b.type === 'playerController' && b.enabled)) return id;
  }
  const p = Object.prototype.hasOwnProperty.call(world.entities, 'player') ? world.entities['player'] : undefined;
  return p && !p.template ? 'player' : null;
}

/** Entity to frame when a world is first opened: the first one tagged `focus`, if any. */
export function focusTarget(world: WorldDoc): EntityId | null {
  for (const id in world.entities) {
    const e = world.entities[id];
    if (e && !e.template && e.tags.includes('focus')) return id;
  }
  return null;
}

/**
 * Ids simulated by non-static physics bodies (their poses are streamed from
 * physics every frame). Bodiless entities moved by logic are added lazily.
 */
export function movingIds(world: WorldDoc): EntityId[] {
  const out: EntityId[] = [];
  for (const id in world.entities) {
    const e = world.entities[id];
    if (e && !e.template && e.physics && e.physics.body !== 'static') out.push(id);
  }
  return out;
}

/**
 * True when `next` is essentially a different world from `prev`: its block
 * terrain is new (added, or another seed / preset), or fewer than half of
 * its entities are unchanged objects from `prev` (History shares untouched
 * entities structurally, so a rebuilt world has new objects even when ids
 * repeat). The camera re-frames such worlds.
 */
export function isNewWorld(prev: WorldDoc, next: WorldDoc): boolean {
  if (prev === next) return false;
  // Block terrain that appeared or was regenerated (other seed or preset) is a new world,
  // even with no entities at all (most block worlds have none).
  const v = next.voxel;
  if (v && (!prev.voxel || prev.voxel.preset !== v.preset || (prev.voxel.seed ?? prev.seed) !== (v.seed ?? next.seed))) return true;
  const ids = Object.keys(next.entities);
  if (ids.length === 0) return false;
  let kept = 0;
  for (const id of ids) if (Object.prototype.hasOwnProperty.call(prev.entities, id) && prev.entities[id] === next.entities[id]) kept++;
  return kept * 2 < ids.length;
}

/**
 * Index of the first block edit `next` added to the same block terrain as
 * `prev` (the camera shows edits from there on), or null when the terrain's
 * edits did not grow. Edits replaced in place count from the first change.
 */
export function addedVoxelEdits(prev: WorldDoc, next: WorldDoc): number | null {
  const a = prev.voxel?.edits;
  const b = next.voxel?.edits;
  if (!a || !b || a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && (a[i] === b[i] || deepEqual(a[i], b[i]))) i++;
  return i < b.length ? i : null;
}

/** Smallest / largest radius {@link framingSphere} returns (metres). */
const MIN_FRAME_RADIUS = 6;
const MAX_FRAME_RADIUS = 60;
/** Share of candidate entities the framing sphere must contain (outliers such as backdrop mountains are dropped). */
const FRAME_COVERAGE = 0.8;

/**
 * A sphere that frames the interesting part of a world: the moving bodies
 * when there are any (that is where the action is), otherwise every root
 * entity. The center is the per-axis median and the radius covers 80 % of
 * the candidates, so distant backdrop props do not zoom the camera out.
 * Null when the world has no placeable entities.
 */
export function framingSphere(world: WorldDoc): { center: Vec3; radius: number } | null {
  const moving: Vec3[] = [];
  const roots: Vec3[] = [];
  for (const id in world.entities) {
    const e = world.entities[id];
    if (!e || e.template || e.parent) continue;
    const p = e.transform.position;
    if (!p.every(Number.isFinite)) continue;
    roots.push(p);
    if (e.physics && e.physics.body !== 'static') moving.push(p);
  }
  const pts = moving.length > 0 ? moving : roots;
  if (pts.length === 0) return null;
  const median = (axis: 0 | 1 | 2): number => {
    const v = pts.map((p) => p[axis]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 0;
  };
  const center: Vec3 = [median(0), median(1), median(2)];
  const dists = pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])).sort((a, b) => a - b);
  const covered = dists[Math.min(dists.length - 1, Math.floor((dists.length - 1) * FRAME_COVERAGE))] ?? 0;
  return { center, radius: Math.min(MAX_FRAME_RADIUS, Math.max(MIN_FRAME_RADIUS, covered + 2)) };
}
