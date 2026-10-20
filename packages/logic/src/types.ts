/**
 * Public interfaces of @aether/logic. The runtime never touches physics,
 * rendering or the DOM directly: everything goes through {@link LogicHost}.
 */
import type { Action, BuiltinBehavior, Entity, EntityId, Json, ParamSpec, ScriptDef, Vec3 } from '@aether/core';

/** Quaternion [x, y, z, w]. */
export type QuatTuple = [number, number, number, number];

/**
 * Everything the logic runtime needs from the outside world. Implemented by the
 * studio (physics + render) and by tests (fakes).
 *
 * Array arguments (`Vec3`, quaternions) may be scratch buffers reused by the
 * runtime: they are only valid for the duration of the call, so implementations
 * must copy them if they keep them.
 */
export interface LogicHost {
  /**
   * Current world-space pose of an entity (or the player avatar), if known.
   * Implementations may return a record reused per entity id (overwritten
   * by the next query for the same id), so callers copy what they keep
   * beyond the current tick.
   */
  getTransform(id: EntityId): { position: Vec3; quaternion: QuatTuple } | undefined;
  /** Move a kinematic (or physics-less) entity to a world-space pose. */
  setKinematic(id: EntityId, position: Vec3, quaternion: QuatTuple): void;
  /** Instant change of momentum on a dynamic body (N·s). */
  applyImpulse(id: EntityId, v: Vec3): void;
  /** Overwrite a dynamic body's linear velocity (m/s). */
  setVelocity(id: EntityId, v: Vec3): void;
  /** Linear velocity of a body, if it has one. */
  getVelocity(id: EntityId): Vec3 | undefined;
  /**
   * Optional (additive to the contract): overwrite a dynamic body's angular
   * velocity in rad/s. Used by vehicle steering; ignored when absent.
   */
  setAngularVelocity?(id: EntityId, v: Vec3): void;
  /**
   * Optional (additive): servo the hinge or rail joint of an entity to
   * `target` (degrees for revolute, metres for prismatic joints). Behaviors
   * with `motion: "joint"` (physical doors and drawers) call it every time
   * their open state changes; without it they stay where they are.
   */
  driveJoint?(id: EntityId, target: number): void;
  /** Instantly move an entity (any body type). */
  teleport(id: EntityId, p: Vec3): void;
  /** Radial impulse on every dynamic body within `radius` of `center`. */
  explode(center: Vec3, force: number, radius: number): void;
  /** Change world gravity (m/s²). */
  setGravity(v: Vec3): void;
  /** Instantiate a runtime entity (spawned from a template) in physics/render. */
  spawn(entity: Entity): void;
  /** Remove an entity from physics/render. */
  destroy(id: EntityId): void;
  /** Change a presentational property, e.g. "material.color", "visible", "light.intensity". */
  setProperty(id: EntityId, path: string, value: Json): void;
  /** Show an on-screen message for `duration` seconds. */
  message(text: string, duration: number): void;
  /** Play a named sound effect. */
  sound(name: string): void;
  /** The session ended. */
  gameOver(result: 'win' | 'lose', text: string): void;
  /** Restore the world to its initial state (physics/render side). */
  reset(): void;
  /** Id of the entity the player controls, if any. */
  playerId(): EntityId | undefined;
  /**
   * Optional (additive): world-space bounds of an entity's colliders, used to
   * build NPC navigation grids around generated buildings and assets. Without
   * it, such shapes are approximated by their scaled unit box.
   */
  getBounds?(id: EntityId): { min: Vec3; max: Vec3 } | undefined;
  /**
   * Optional (additive): world-space bounds of each collider of an entity
   * separately (a trunk and a canopy, not one box). Preferred over
   * `getBounds` for navigation when present.
   */
  getColliderBounds?(id: EntityId): ReadonlyArray<{ min: Vec3; max: Vec3 }>;
  /**
   * Optional (additive): height of the first solid surface below (x, fromY, z),
   * from a ray cast that skips the `exclude` entity. NPCs use it to follow
   * hills; without it they use the navigation grid's flat floor.
   */
  groundHeight?(x: number, z: number, fromY: number, exclude?: EntityId): number | undefined;
  /**
   * Optional (additive): height of the open terrain under (x, z) (see `terrainSampler`). NPC navigation grids drape
   * over it, so NPCs on hills can be routed; without it a hill is a flat floor at its base.
   */
  terrainHeight?(x: number, z: number): number | undefined;
}

/** Player input sampled by the caller once per fixed tick. */
export interface InputState {
  /** -1 … 1 (W/S, stick Y). */
  forward: number;
  /** -1 … 1 (D/A, stick X). */
  right: number;
  jump: boolean;
  action: boolean;
  /** Currently held keys (`KeyboardEvent.key` or `.code`; normalized internally). */
  keys: ReadonlySet<string>;
  /** Camera yaw in degrees; movement input is relative to it. */
  pointerYawDeg: number;
}

/** Input with nothing pressed. */
export const EMPTY_INPUT: InputState = Object.freeze({
  forward: 0,
  right: 0,
  jump: false,
  action: false,
  keys: new Set<string>() as ReadonlySet<string>,
  pointerYawDeg: 0,
});

/** Physics event as produced by @aether/physics (structurally compatible). */
export type PhysicsEventLike = {
  type: 'collisionStart' | 'collisionEnd' | 'sensorEnter' | 'sensorExit';
  a: EntityId;
  b: EntityId;
  impulse?: number;
};

/** One entry of the runtime trace ("why did this happen" panel). */
export interface LogEntry {
  /** Simulation time in seconds. */
  t: number;
  /** Id of the rule responsible, when a rule fired. */
  rule?: string;
  /** Human-readable explanation. */
  text: string;
}

/**
 * Parameter description for a behavior. Extends the core `ParamSpec` with the
 * structured types behaviors need (vectors, selectors, lists).
 */
export type BehaviorParamSpec =
  | ParamSpec
  | {
      type: 'vec3' | 'string' | 'selector' | 'vec3[]' | 'string[]';
      default: Json;
      description?: string;
    };

/** Catalog entry describing a built-in behavior for the agent prompt and the editor. */
export interface BehaviorCatalogEntry {
  type: BuiltinBehavior;
  description: string;
  params: Record<string, BehaviorParamSpec>;
  /** Preconditions, e.g. "physics.body = dynamic". */
  requires?: string;
}

/** Read-only view of the world handed to a script each tick (serialized to JSON). */
export interface ScriptSnapshot {
  dt: number;
  time: number;
  self: { id: EntityId; position: Vec3; velocity: Vec3; state: Record<string, Json> };
  player?: { position: Vec3 };
  world: Record<string, Json>;
  nearby: Array<{ id: EntityId; tags: string[]; position: Vec3 }>;
  input: { forward: number; right: number; jump: boolean; action: boolean };
}

/** Data the runtime pre-serializes once per tick for {@link ScriptRunner.update}. */
export interface ScriptPrepared {
  /** Exactly `JSON.stringify(snap.world)`. */
  worldJson?: string;
}

/** What a script may ask the runtime to do. */
export type ScriptIntent =
  | Action
  | { do: 'moveTo'; target: Vec3; speed: number }
  | { do: 'setSelfState'; key: string; value: Json };

/** Diagnostic produced by a script runner (overruns, errors, rejected intents). */
export interface ScriptDiagnostic {
  scriptId: string;
  entityId?: EntityId;
  text: string;
}

/** Executes sandboxed custom behavior scripts. */
export interface ScriptRunner {
  /** Compile (or recompile when the source changed) a script. */
  load(def: ScriptDef): void;
  /**
   * Run one update of `scriptId` for `entityId`; never throws, returns
   * validated intents. `prepared.worldJson` (additive) is `JSON.stringify(snap.world)`
   * computed once per tick by the runtime; runners may splice it instead of
   * serializing the world state again for every call.
   */
  update(scriptId: string, entityId: EntityId, snap: ScriptSnapshot, prepared?: ScriptPrepared): ScriptIntent[];
  /** Release every interpreter resource. */
  dispose(): void;
  /** Optional: drain diagnostics accumulated since the last call (additive to the contract). */
  takeDiagnostics?(): ScriptDiagnostic[];
}
