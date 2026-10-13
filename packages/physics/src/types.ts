/**
 * Public data types of @aether/physics (see docs/CONTRACTS.md).
 */
import type { Entity, EntityId, Json, Patch, Vec3 } from '@aether/core';
import type { ColliderDesc } from '@aether/procgen';

/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** Snapshot of one rigid body's simulated state (world space). */
export interface BodyState {
  position: Vec3;
  quaternion: Quat;
  linvel: Vec3;
  angvel: Vec3;
  sleeping: boolean;
}

/**
 * A contact/trigger event produced by a fixed step.
 * - `collisionStart`/`collisionEnd`: two solid colliders started/stopped touching.
 *   `impulse` (N·s) is set on `collisionStart` when the impact was strong
 *   enough to produce a contact-force event in the same step.
 * - `sensorEnter`/`sensorExit`: `a` is the sensor entity, `b` the other one.
 * The static ground plane is reported as {@link GROUND_ID}.
 */
export interface PhysicsEvent {
  type: 'collisionStart' | 'collisionEnd' | 'sensorEnter' | 'sensorExit';
  a: EntityId;
  b: EntityId;
  impulse?: number;
}

/**
 * Supplies colliders (in the entity's unscaled local space, procgen
 * convention: base at y = 0) for procedural/model entities, typically from
 * the renderer's already generated output. Return `undefined` to fall back to
 * the built-in default provider.
 */
export type ColliderProvider = (entity: Entity) => ColliderDesc[] | undefined;

/** Options of {@link PhysicsWorld.create}. */
export interface PhysicsWorldOptions {
  colliders?: ColliderProvider;
  /** Fixed simulation step in seconds (default 1/60, clamped to [1/1000, 1/10]). */
  fixedDt?: number;
}

/** Id used for the environment ground plane in {@link PhysicsEvent}s. Never a valid entity id. */
export const GROUND_ID = '__ground';

/** A static-check finding, phrased so an LLM can act on it. */
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: 'overlap' | 'floating' | 'outOfBounds' | 'jointInvalid' | 'tooManyBodies' | 'fellOut' | 'unstable';
  entities: EntityId[];
  message: string;
  suggestion?: string;
}

/** Result of {@link settle}. */
export interface SettleReport {
  patches: Patch[];
  moved: Array<{ id: EntityId; distance: number }>;
  unstable: EntityId[];
  fellOut: EntityId[];
  seconds: number;
  ms: number;
}

/** Outcome of one `WorldTest`. */
export interface TestResult {
  id: string;
  kind: string;
  passed: boolean;
  message: string;
  atTime?: number;
}

/** Result of {@link verify}. */
export interface VerifyReport {
  passed: boolean;
  results: TestResult[];
  diagnostics: Diagnostic[];
  simulatedSeconds: number;
  ms: number;
  /**
   * Set only for a shard run (`VerifyOptions.tests`): the `world.tests`
   * indices that `results` correspond to, in the same order.
   */
  testIndices?: number[];
}

/** Hooks gameplay logic into headless verification. */
export interface LogicHook {
  tick(dt: number, pw: import('./world').PhysicsWorld, events: PhysicsEvent[]): void;
  readState(key: string): Json | undefined;
}

/** A raycast hit. `id` is null for the ground plane. */
export interface RaycastHit {
  id: EntityId | null;
  point: Vec3;
  normal: Vec3;
  distance: number;
}

/** Counters returned by {@link PhysicsWorld.stats}. */
export interface PhysicsStats {
  bodies: number;
  colliders: number;
  joints: number;
  /** Exponential moving average of the wall-clock duration of one fixed step (ms). */
  stepMs: number;
}
