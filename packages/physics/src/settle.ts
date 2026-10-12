/**
 * "Drop & freeze" settling: simulate the dynamic bodies until they rest,
 * then express rest poses as World IR `update` patches (positions rounded to
 * millimeters, rotations to 0.1°) relative to each entity's parent.
 */
import type { EntityId, Patch, Vec3, WorldDoc } from '@aether/core';
import { quatToEulerDeg } from '@aether/core';
import { entityPose, relativePose } from './plan';
import type { ColliderProvider, Quat, SettleReport } from './types';
import { rapier } from './rapier';
import { distance, round } from './vec';
import { PhysicsWorld } from './world';

/** Tunables of {@link settle}. */
export const SETTLE_LIMITS = Object.freeze({
  DEFAULT_SECONDS: 2,
  MAX_SECONDS: 30,
  /** Bodies below this height fell out of the world. */
  FELL_OUT_Y: -20,
  /** Minimum translation (m) for a pose change to be written back. */
  MOVE_EPSILON: 0.01,
  /** Minimum rotation (deg) for a pose change to be written back. */
  TURN_EPSILON: 1,
  /** Bodies still moving faster than this (m/s or rad/s) at the end are unstable. */
  REST_SPEED: 0.05,
  /** Check for "everything asleep" every N steps. */
  SLEEP_CHECK_EVERY: 15,
});

function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

/**
 * Settle dynamic bodies (all, or only `opts.only`) for up to `opts.seconds`
 * (default 2 s, early exit when everything sleeps). Bodies that fell below
 * y = −20 or are still moving are reported instead of patched.
 */
export async function settle(world: WorldDoc, opts: { seconds?: number; colliders?: ColliderProvider; only?: EntityId[] } = {}): Promise<SettleReport> {
  const t0 = performance.now();
  const seconds = Math.min(SETTLE_LIMITS.MAX_SECONDS, Math.max(0, Number.isFinite(opts.seconds) ? (opts.seconds as number) : SETTLE_LIMITS.DEFAULT_SECONDS));
  const pw = await PhysicsWorld.create(world, opts.colliders ? { colliders: opts.colliders } : {});
  try {
    const only = opts.only ? new Set(opts.only) : null;
    const targets = pw.dynamicIds().filter((id) => !only || only.has(id));
    // Bodies outside `only` must not move: freeze them for this run.
    if (only) for (const id of pw.dynamicIds()) if (!only.has(id)) pw._records().get(id)?.body.setBodyType(rapier().RigidBodyType.Fixed, false);
    const start = new Map<EntityId, { p: Vec3; q: Quat }>();
    for (const id of targets) {
      const s = pw.getState(id);
      if (s) start.set(id, { p: s.position, q: s.quaternion });
    }
    const maxSteps = Math.ceil(seconds / pw.dt - 1e-9);
    let steps = 0;
    while (steps < maxSteps) {
      pw.stepFixed();
      steps++;
      if (steps % SETTLE_LIMITS.SLEEP_CHECK_EVERY === 0 && targets.every((id) => pw.getState(id)?.sleeping ?? true)) break;
    }
    const patches: Patch[] = [];
    const moved: SettleReport['moved'] = [];
    const unstable: EntityId[] = [];
    const fellOut: EntityId[] = [];
    for (const id of targets) {
      const s = pw.getState(id);
      const s0 = start.get(id);
      if (!s || !s0) continue;
      if (s.position[1] < SETTLE_LIMITS.FELL_OUT_Y) {
        fellOut.push(id);
        continue;
      }
      const speed = Math.hypot(...s.linvel);
      const spin = Math.hypot(...s.angvel);
      if (!s.sleeping && (speed > SETTLE_LIMITS.REST_SPEED || spin > SETTLE_LIMITS.REST_SPEED * 2)) {
        unstable.push(id);
        continue;
      }
      const d = distance(s.position, s0.p);
      if (d <= SETTLE_LIMITS.MOVE_EPSILON && quatAngleDeg(s.quaternion, s0.q) <= SETTLE_LIMITS.TURN_EPSILON) continue;
      patches.push(restPatch(world, id, s.position, s.quaternion));
      moved.push({ id, distance: round(d, 3) });
    }
    return { patches, moved, unstable, fellOut, seconds: round(steps * pw.dt, 4), ms: performance.now() - t0 };
  } finally {
    pw.dispose();
  }
}

/** `update` patch writing a world-space rest pose back in parent-local terms. */
function restPatch(world: WorldDoc, id: EntityId, position: Vec3, quaternion: Quat): Patch {
  const e = world.entities[id];
  let localPos: Vec3 = position;
  let localQ: Quat = quaternion;
  if (e && e.parent !== null && Object.hasOwn(world.entities, e.parent)) {
    const parent = entityPose(world, e.parent);
    const rel = relativePose(parent, { position, quaternion, scale: [1, 1, 1] });
    localPos = [rel.position[0] / (parent.scale[0] || 1), rel.position[1] / (parent.scale[1] || 1), rel.position[2] / (parent.scale[2] || 1)];
    localQ = rel.quaternion;
  }
  const rot = quatToEulerDeg(localQ);
  return {
    op: 'update',
    id,
    set: {
      transform: {
        position: [round(localPos[0], 3), round(localPos[1], 3), round(localPos[2], 3)],
        rotation: [round(rot[0], 1), round(rot[1], 1), round(rot[2], 1)],
      },
    },
  };
}

