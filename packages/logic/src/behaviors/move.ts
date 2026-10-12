/**
 * Shared locomotion: kinematic entities move their pose anchor, dynamic bodies
 * get a horizontal velocity (vertical velocity is left to gravity).
 */
import type { Vec3 } from '@aether/core';
import type { RuntimeEntity } from '../entities';
import { angleDelta, yawFromDirection, yawOfQuat } from '../vec';
import type { BehaviorEnv } from './types';

/** Options for {@link moveToward}. */
export interface MoveOptions {
  /** Ignore the Y difference (ground movement). */
  flat: boolean;
  /** Turn to face the movement direction (kinematic only). */
  face: boolean;
  /** Max turn rate for facing, deg/s (0 = instant). */
  turnSpeed?: number;
}

const vel: Vec3 = [0, 0, 0];

/** Current position used for steering (anchor for kinematic, physics for dynamic). */
export function steeringPosition(env: BehaviorEnv, self: RuntimeEntity): Readonly<Vec3> {
  if (self.dynamic) return env.positionOf(self.id) ?? self.anchor;
  return self.anchor;
}

/** Turn a kinematic entity's yaw toward `targetYaw`, limited by `turnSpeed` (deg/s, 0 = instant). */
export function turnToward(self: RuntimeEntity, targetYaw: number, turnSpeed: number, dt: number): void {
  const d = angleDelta(self.yawDeg, targetYaw);
  if (turnSpeed <= 0) self.yawDeg += d;
  else {
    const maxStep = turnSpeed * dt;
    self.yawDeg += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
  }
  self.yawDeg = ((self.yawDeg % 360) + 540) % 360 - 180;
}

/** Turn a kinematic entity so its −Z forward axis points along (dx, dz) in world space. */
export function faceDirection(self: RuntimeEntity, dx: number, dz: number, turnSpeed: number, dt: number): void {
  if (dx * dx + dz * dz < 1e-12) return;
  turnToward(self, yawFromDirection(dx, dz, 0) - yawOfQuat(self.baseRot), turnSpeed, dt);
}

/**
 * Move `self` toward `target` at `speed` m/s for one step. Returns the
 * remaining distance after the step (0 when arrived).
 */
export function moveToward(env: BehaviorEnv, self: RuntimeEntity, target: Readonly<Vec3>, speed: number, dt: number, opts: MoveOptions): number {
  const pos = steeringPosition(env, self);
  const dx = target[0] - pos[0];
  const dy = opts.flat ? 0 : target[1] - pos[1];
  const dz = target[2] - pos[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (self.dynamic) {
    const v = env.velocityOf(self.id);
    const s = d > 1e-6 ? Math.min(speed, d / Math.max(dt, 1e-6)) / d : 0;
    vel[0] = dx * s;
    vel[1] = opts.flat ? (v ? v[1] : 0) : dy * s;
    vel[2] = dz * s;
    env.setVelocity(self.id, vel);
    return d;
  }
  env.pose(self);
  if (d < 1e-9) return 0;
  const step = Math.min(speed * dt, d);
  const k = step / d;
  self.anchor[0] += dx * k;
  self.anchor[1] += dy * k;
  self.anchor[2] += dz * k;
  if (opts.face) faceDirection(self, dx, dz, opts.turnSpeed ?? 0, dt);
  return d - step;
}

/** Stop a dynamic body's horizontal motion (kinematic entities simply stay put). */
export function halt(env: BehaviorEnv, self: RuntimeEntity): void {
  if (!self.dynamic) return;
  const v = env.velocityOf(self.id);
  vel[0] = 0;
  vel[1] = v ? v[1] : 0;
  vel[2] = 0;
  env.setVelocity(self.id, vel);
}
