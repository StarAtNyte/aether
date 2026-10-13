/**
 * Per-entity reusable pose records for `LogicHost.getTransform`: the logic
 * runtime asks for many transforms every tick, and returning fresh arrays
 * for each call was a steady stream of garbage. Each entity id owns one
 * record that is overwritten in place on the next query for the same id
 * (the runtime caches poses per tick by id, so this is safe). Beyond
 * {@link MAX_POOLED_POSES} ids, records are allocated per call instead of
 * growing the pool without bound.
 */
import type { EntityId, Vec3 } from '@aether/core';

/** Quaternion [x, y, z, w]. */
type Quat = [number, number, number, number];

/** A reusable world pose. */
export interface PooledPose {
  position: Vec3;
  quaternion: Quat;
}

/** Upper bound of pooled records (one per entity id). */
export const MAX_POOLED_POSES = 4096;

/** Pool of per-entity pose records. */
export class PosePool {
  private readonly poses = new Map<EntityId, PooledPose>();

  /** The record of `id` (created once; overwritten by the caller). */
  slot(id: EntityId): PooledPose {
    const known = this.poses.get(id);
    if (known) return known;
    const fresh: PooledPose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    if (this.poses.size < MAX_POOLED_POSES) this.poses.set(id, fresh);
    return fresh;
  }

  /**
   * Fill the record of `id` from plain arrays (copies; never aliases the inputs).
   * @returns the filled record
   */
  fill(id: EntityId, position: Readonly<Vec3>, quaternion: Readonly<Quat>): PooledPose {
    const p = this.slot(id);
    p.position[0] = position[0];
    p.position[1] = position[1];
    p.position[2] = position[2];
    p.quaternion[0] = quaternion[0];
    p.quaternion[1] = quaternion[1];
    p.quaternion[2] = quaternion[2];
    p.quaternion[3] = quaternion[3];
    return p;
  }

  /** Drop the record of a removed entity. */
  release(id: EntityId): void {
    this.poses.delete(id);
  }

  /** Number of pooled records. */
  get size(): number {
    return this.poses.size;
  }

  /** Forget everything (end of a play session). */
  clear(): void {
    this.poses.clear();
  }
}
