/**
 * Can the player play this world? A check made from the physics world itself (the geometry the player collides with), at
 * publish and when Play starts:
 *
 * - **ground**: a ray down from the spawn finds something solid;
 * - **no fall-through**: the player's own character controller, left standing at the spawn for two seconds, stays on it;
 * - **walkable area**: a flood over a one-metre grid from the spawn's floor (steps up to the character's, drops of a storey,
 *   no wall at knee height in between) counts the floor the player can reach.
 *
 * When the spawn has no ground and the world's static meshes have no colliders (an imported scene, a world made of loaded
 * models), {@link deriveStaticColliders} makes them solid the way Cloudwatch Harbour's are: models as static triangle meshes
 * read from the loaded glTF (`collider: 'trimesh'`), other shapes with their automatic colliders. A mesh that encloses the
 * spawn from far above (a sky dome) is left out.
 *
 * Queries only: nothing is stepped, so dynamic bodies stay where they are. Work is cut into slices with yields to the host.
 */
import type { Entity, EntityId, Vec3, WorldDoc } from '@aether/core';
import { entityWorldBounds } from './bounds';
import { CharacterController } from './character';
import type { ColliderProvider } from './types';
import { yieldToHost } from './yield';
import { PhysicsWorld } from './world';

export const PLAYABILITY_LIMITS = Object.freeze({
  /** How far below the spawn a floor still counts (m). */
  GROUND_DEPTH: 500,
  /** Seconds the character stands at the spawn. */
  STAND_SECONDS: 2,
  /** Grid of the walkable flood (m) and its reach from the spawn (m). */
  CELL: 1,
  REACH: 30,
  MAX_CELLS: 2500,
  /** Highest step up and drop down between two cells (m). */
  STEP_UP: 0.45,
  DROP: 3.2,
  /** Steepest walkable floor (degrees). */
  MAX_SLOPE_DEG: 50,
  /** Below this the walkable area is a warning (m²). */
  MIN_AREA: 12,
  /** A mesh the spawn's upward ray meets this far up, and this wide, encloses it (a sky): not made solid. */
  DOME_HEIGHT: 20,
  DOME_WIDTH: 100,
  /** Milliseconds of queries between two yields. */
  SLICE_MS: 8,
});

export type PlayabilityCode = 'no-ground' | 'falls' | 'spawn-blocked' | 'small-area' | 'derived';

export interface PlayabilityIssue {
  code: PlayabilityCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface PlayabilityReport {
  /** No error: the spawn stands on ground and the player does not fall through it. */
  ok: boolean;
  spawn: Vec3;
  /** The floor under the spawn, or null. */
  ground: Vec3 | null;
  /** Floor reachable from the spawn (m², on the flood's grid, capped by its reach). */
  walkableArea: number;
  /** Where the character stood after {@link PLAYABILITY_LIMITS.STAND_SECONDS}. */
  settled: Vec3 | null;
  issues: PlayabilityIssue[];
}

export interface PlayabilityOptions {
  colliders?: ColliderProvider;
  /** The player's capsule (default 0.35 m radius, 1.7 m tall). */
  radius?: number;
  height?: number;
  signal?: AbortSignal;
}

/** Whether the world is played on foot (a character at the spawn), so it needs ground under the spawn. */
export function playedOnFoot(world: WorldDoc): boolean {
  return world.player.mode === 'firstPerson' || world.player.mode === 'thirdPerson';
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Check the world as {@link PlayabilityReport} describes. */
export async function checkPlayability(world: WorldDoc, opts: PlayabilityOptions = {}): Promise<PlayabilityReport> {
  const pw = await PhysicsWorld.create(world, opts.colliders ? { colliders: opts.colliders } : {});
  try {
    return await checkIn(pw, world, opts);
  } finally {
    pw.dispose();
  }
}

async function checkIn(pw: PhysicsWorld, world: WorldDoc, opts: PlayabilityOptions): Promise<PlayabilityReport> {
  const L = PLAYABILITY_LIMITS;
  const spawn: Vec3 = [...world.player.spawn];
  const issues: PlayabilityIssue[] = [];
  const radius = opts.radius ?? 0.35;
  const height = opts.height ?? 1.7;
  const fmt = (v: Vec3): string => `(${v.map((x) => x.toFixed(1)).join(', ')})`;
  const down = pw.raycast([spawn[0], spawn[1] + 0.5, spawn[2]], [0, -1, 0], L.GROUND_DEPTH);
  if (!down) {
    issues.push({ code: 'no-ground', severity: 'error', message: `Nothing solid under the player's spawn ${fmt(spawn)}: the player would fall forever. Give the ground or the floor a collider, or move the spawn onto it.` });
    return { ok: false, spawn, ground: null, walkableArea: 0, settled: null, issues };
  }
  const ground = down.point;
  // Room to stand: nothing solid in the capsule at the floor.
  const head = pw.raycast([ground[0], ground[1] + 0.05, ground[2]], [0, 1, 0], height);
  if (head && head.distance < height - 0.1) issues.push({ code: 'spawn-blocked', severity: 'warning', message: `Only ${head.distance.toFixed(2)} m of head room above the spawn's floor${head.id ? ` (under "${head.id}")` : ''}: the player may start stuck.` });

  // The player's own controller, standing still: it must stay on the floor.
  let settled: Vec3 | null = null;
  const ch = new CharacterController(pw, { radius, height, spawn, settleSpawn: true });
  try {
    const dt = 1 / 60;
    for (let i = 0; i < L.STAND_SECONDS / dt; i++) settled = ch.move({ forward: 0, right: 0, jump: false, yawDeg: 0 }, dt, 0, 0);
  } finally {
    ch.dispose();
  }
  if (settled && settled[1] < ground[1] - 1) {
    issues.push({ code: 'falls', severity: 'error', message: `The player falls through the floor under the spawn (from ${ground[1].toFixed(1)} m to ${settled[1].toFixed(1)} m in ${L.STAND_SECONDS} s): the floor is not solid for the character.` });
  }

  const walkableArea = await walkable(pw, ground, radius, opts.signal);
  if (walkableArea < L.MIN_AREA) issues.push({ code: 'small-area', severity: 'warning', message: `The player can reach only about ${Math.round(walkableArea)} m² of floor from the spawn: walls, steps over ${L.STEP_UP} m or missing floor close it in.` });
  return { ok: !issues.some((i) => i.severity === 'error'), spawn, ground, walkableArea, settled, issues };
}

/** Floor reachable from `start` over the flood grid (m²). */
async function walkable(pw: PhysicsWorld, start: Vec3, radius: number, signal?: AbortSignal): Promise<number> {
  const L = PLAYABILITY_LIMITS;
  const C = L.CELL;
  const n = Math.round(L.REACH / C);
  const cos = Math.cos((L.MAX_SLOPE_DEG * Math.PI) / 180);
  const seen = new Map<string, number>();
  const queue: Array<[number, number, number]> = [[0, 0, start[1]]];
  seen.set('0,0', start[1]);
  let count = 0;
  let until = now() + L.SLICE_MS;
  const knee = Math.max(L.STEP_UP + 0.05, radius);
  while (queue.length > 0 && count < L.MAX_CELLS) {
    if (now() > until) {
      if (signal?.aborted) break;
      await yieldToHost();
      until = now() + L.SLICE_MS;
    }
    const [i, j, y] = queue.shift()!;
    count++;
    const x = start[0] + i * C, z = start[2] + j * C;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      if (Math.abs(ni) > n || Math.abs(nj) > n || seen.has(`${ni},${nj}`)) continue;
      // A wall at knee height between the two cells closes the way.
      if (pw.raycast([x, y + knee, z], [di, 0, dj], C)) continue;
      const nx = start[0] + ni * C, nz = start[2] + nj * C;
      const hit = pw.raycast([nx, y + knee, nz], [0, -1, 0], knee + L.DROP);
      if (!hit || hit.normal[1] < cos || hit.point[1] > y + L.STEP_UP) continue;
      seen.set(`${ni},${nj}`, hit.point[1]);
      queue.push([ni, nj, hit.point[1]]);
    }
  }
  return count * C * C;
}

/** Entities {@link deriveStaticColliders} may make solid: drawn, static, not people, not inside a body of their own. */
function candidate(world: WorldDoc, e: Entity): boolean {
  if (e.physics || e.template || e.visible === false || e.arch || e.character) return false;
  const k = e.shape.kind;
  if (k !== 'model' && k !== 'primitive' && k !== 'procedural' && k !== 'asset' && k !== 'mesh') return false;
  if (k === 'asset' && e.shape.animation !== undefined && e.shape.animation !== 'none') return false;
  // A physics-less child of a body is part of that body already.
  const seen = new Set<EntityId>();
  for (let p = e.parent; p && !seen.has(p); p = Object.hasOwn(world.entities, p) ? (world.entities[p]?.parent ?? null) : null) {
    seen.add(p);
    if (world.entities[p]?.physics) return false;
  }
  return true;
}

/**
 * The world with its static meshes made solid (models as triangle meshes from the loaded glTF, other shapes with their
 * automatic colliders), and the ids changed. Entities that already have physics are left as they are.
 */
export function deriveStaticColliders(world: WorldDoc, skip: ReadonlySet<EntityId> = new Set()): { world: WorldDoc; ids: EntityId[] } {
  const ids: EntityId[] = [];
  const entities: WorldDoc['entities'] = { ...world.entities };
  for (const [id, e] of Object.entries(world.entities)) {
    if (skip.has(id) || !candidate(world, e)) continue;
    entities[id] = { ...e, physics: { body: 'static', collider: e.shape.kind === 'model' ? 'trimesh' : 'auto', friction: 0.6, restitution: 0.1, sensor: false, linearDamping: 0, angularDamping: 0.05, gravityScale: 1, lockRotation: false, ccd: false } };
    ids.push(id);
  }
  return { world: ids.length > 0 ? { ...world, entities } : world, ids };
}

export interface PlayableResult {
  /** The world to play and publish: the given one, or with derived colliders when those made it playable. */
  world: WorldDoc;
  report: PlayabilityReport;
  /** Entities given colliders (empty: none were needed, or none helped). */
  derived: EntityId[];
}

/**
 * Check the world; when its spawn has no ground or the player falls, make its static meshes solid
 * ({@link deriveStaticColliders}, a sky dome over the spawn left out) and check again. The derived world is returned only
 * when it fixed the errors.
 */
export async function makePlayable(world: WorldDoc, opts: PlayabilityOptions = {}): Promise<PlayableResult> {
  const first = await checkPlayability(world, opts);
  if (first.ok) return { world, report: first, derived: [] };
  let derived = deriveStaticColliders(world);
  if (derived.ids.length === 0) return { world, report: first, derived: [] };
  // A sky: a wide mesh the spawn's upward ray meets far above.
  const pw = await PhysicsWorld.create(derived.world, opts.colliders ? { colliders: opts.colliders } : {});
  const domes = new Set<EntityId>();
  try {
    const s = world.player.spawn;
    for (const h of pw.raycastAll([s[0], s[1] + 2, s[2]], [0, 1, 0], 5000, 16)) {
      if (!h.id || !derived.ids.includes(h.id) || h.distance < PLAYABILITY_LIMITS.DOME_HEIGHT) continue;
      const b = entityWorldBounds(derived.world, h.id, 0, opts.colliders);
      if (b && b.max[0] - b.min[0] > PLAYABILITY_LIMITS.DOME_WIDTH && b.max[2] - b.min[2] > PLAYABILITY_LIMITS.DOME_WIDTH) domes.add(h.id);
    }
  } finally {
    pw.dispose();
  }
  if (domes.size > 0) derived = deriveStaticColliders(world, domes);
  const second = await checkPlayability(derived.world, opts);
  if (!second.ok) return { world, report: second, derived: [] };
  const issue: PlayabilityIssue = { code: 'derived', severity: 'info', message: `${derived.ids.length} static mesh${derived.ids.length === 1 ? ' was' : 'es were'} made solid for play (they had no colliders and the spawn had no ground).` };
  return { world: derived.world, report: { ...second, issues: [issue, ...second.issues] }, derived: derived.ids };
}
