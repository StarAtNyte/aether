/**
 * Packed world-space poses `[px, py, pz, qx, qy, qz, qw]*` for every entity
 * whose transform changes at runtime. Physics writes into it with
 * `PhysicsWorld.writeTransforms`, logic writes kinematic poses of bodiless
 * entities directly, and the renderer consumes it with `applyTransforms` —
 * one shared buffer, no per-frame allocation.
 */
import type { EntityId, Vec3 } from '@aether/core';

const STRIDE = 7;
const INITIAL_CAPACITY = 64;
/** Hard cap on tracked entities (spawn storms cannot grow the buffer forever). */
export const MAX_TRACKED = 20_000;

/** Packed pose buffer with stable id → slot mapping. */
export class TransformTable {
  private data = new Float32Array(INITIAL_CAPACITY * STRIDE);
  private readonly index = new Map<EntityId, number>();
  /** Slot order; `order[i]` owns `packed[i*7 .. i*7+6]`. */
  readonly order: EntityId[] = [];
  private view: Float32Array = this.data.subarray(0, 0);

  /** The packed buffer, exactly `order.length * 7` floats long. */
  get packed(): Float32Array {
    return this.view;
  }

  /** Number of tracked ids. */
  get size(): number {
    return this.order.length;
  }

  /** True when `id` has a slot. */
  has(id: EntityId): boolean {
    return this.index.has(id);
  }

  /** Slot of `id`, creating one (initialized to the given pose) when missing. Returns -1 when full. */
  ensure(id: EntityId, position?: Vec3, quaternion?: readonly number[]): number {
    const existing = this.index.get(id);
    if (existing !== undefined) return existing;
    if (this.order.length >= MAX_TRACKED) return -1;
    const slot = this.order.length;
    if ((slot + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(Math.min(MAX_TRACKED, Math.max(slot + 1, this.data.length / STRIDE * 2)) * STRIDE);
      next.set(this.data);
      this.data = next;
    }
    this.order.push(id);
    this.index.set(id, slot);
    this.view = this.data.subarray(0, this.order.length * STRIDE);
    const o = slot * STRIDE;
    this.data[o] = position?.[0] ?? 0;
    this.data[o + 1] = position?.[1] ?? 0;
    this.data[o + 2] = position?.[2] ?? 0;
    this.data[o + 3] = quaternion?.[0] ?? 0;
    this.data[o + 4] = quaternion?.[1] ?? 0;
    this.data[o + 5] = quaternion?.[2] ?? 0;
    this.data[o + 6] = quaternion?.[3] ?? 1;
    return slot;
  }

  /** Write a pose (creates the slot when missing). Non-finite input is ignored. */
  write(id: EntityId, position: Vec3, quaternion: readonly number[]): void {
    for (let i = 0; i < 3; i++) if (!Number.isFinite(position[i])) return;
    for (let i = 0; i < 4; i++) if (!Number.isFinite(quaternion[i])) return;
    const slot = this.ensure(id);
    if (slot < 0) return;
    const o = slot * STRIDE;
    this.data[o] = position[0];
    this.data[o + 1] = position[1];
    this.data[o + 2] = position[2];
    this.data[o + 3] = quaternion[0] as number;
    this.data[o + 4] = quaternion[1] as number;
    this.data[o + 5] = quaternion[2] as number;
    this.data[o + 6] = quaternion[3] as number;
  }

  /** Read a pose into the provided tuples; false when `id` is untracked. */
  read(id: EntityId, outPos: Vec3, outQuat: [number, number, number, number]): boolean {
    const slot = this.index.get(id);
    if (slot === undefined) return false;
    const o = slot * STRIDE;
    outPos[0] = this.data[o] as number;
    outPos[1] = this.data[o + 1] as number;
    outPos[2] = this.data[o + 2] as number;
    outQuat[0] = this.data[o + 3] as number;
    outQuat[1] = this.data[o + 4] as number;
    outQuat[2] = this.data[o + 5] as number;
    outQuat[3] = this.data[o + 6] as number;
    return true;
  }

  /** Remove `id` (swap-remove; O(1)). */
  remove(id: EntityId): void {
    const slot = this.index.get(id);
    if (slot === undefined) return;
    const last = this.order.length - 1;
    if (slot !== last) {
      const lastId = this.order[last] as EntityId;
      this.data.copyWithin(slot * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
      this.order[slot] = lastId;
      this.index.set(lastId, slot);
    }
    this.order.pop();
    this.index.delete(id);
    this.view = this.data.subarray(0, this.order.length * STRIDE);
  }

  /** Drop everything. */
  clear(): void {
    this.order.length = 0;
    this.index.clear();
    this.view = this.data.subarray(0, 0);
  }
}
