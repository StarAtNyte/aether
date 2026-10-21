/**
 * Internal contract between the runtime and built-in behaviors.
 */
import type { BuiltinBehavior, EntityId, FeelEvent, Json, Vec3 } from '@aether/core';
import type { RuntimeEntity } from '../entities';
import type { ParamReader } from '../params';
import type { BehaviorParamSpec, InputState, LogicHost } from '../types';

/** A physics contact that started this tick and involves a given entity. */
export interface ContactInfo {
  other: EntityId;
  kind: 'collision' | 'sensor';
  impulse: number;
}

/**
 * Services the runtime offers to behaviors. Positions returned are read-only
 * views valid until the next call that moves entities; copy them to keep them.
 */
export interface BehaviorEnv {
  readonly host: LogicHost;
  /** Simulation time (s). */
  readonly time: number;
  /** Current fixed step (s). */
  readonly dt: number;
  readonly input: InputState;
  /** Normalized keys that went down this tick. */
  readonly pressed: ReadonlySet<string>;
  /** Entities the player used (aimed at and pressed the use key) this tick. */
  readonly used: ReadonlySet<EntityId>;
  playerId(): EntityId | undefined;
  entity(id: EntityId): RuntimeEntity | undefined;
  positionOf(id: EntityId): Readonly<Vec3> | undefined;
  velocityOf(id: EntityId): Vec3 | undefined;
  /** Live ids for a selector. The array is reused between calls; copy to keep. */
  resolve(selector: string): readonly EntityId[];
  matches(id: EntityId, selector: string): boolean;
  /** Dynamic bodies plus the player: things that can stand on plates, be pushed, collect coins. */
  movers(): readonly EntityId[];
  /** True when `otherId` overlaps `zone` (physics contact or geometric containment with `margin`). */
  touching(zone: RuntimeEntity, otherId: EntityId, margin: number): boolean;
  /**
   * True when `otherId` rests on top of `zone` (inside its footprint, between its
   * bottom and `height` meters above its top) or is in physics contact with it.
   */
  onTopOf(zone: RuntimeEntity, otherId: EntityId, height: number): boolean;
  /** Contacts that began this tick involving `id`. */
  contactsOf(id: EntityId): readonly ContactInfo[];
  /** Start composing a kinematic pose for `self` this tick (idempotent within a tick). */
  pose(self: RuntimeEntity): void;
  readState(key: string): Json | undefined;
  /** Set a state key; returns a log fragment "key a→b". */
  setState(key: string, value: Json): string;
  addState(key: string, amount: number): string;
  spawn(template: EntityId, at: Vec3 | string | undefined, count: number, spread: number): EntityId[];
  /** Remove an entity (callers log their own reason). */
  destroy(id: EntityId): void;
  emit(event: string): void;
  gameOver(result: 'win' | 'lose', text: string, why: string): void;
  teleport(id: EntityId, p: Readonly<Vec3>): void;
  setVelocity(id: EntityId, v: Readonly<Vec3>): void;
  explode(center: Readonly<Vec3>, force: number, radius: number): void;
  log(text: string): void;
  /**
   * Tell the host's feel layer that `kind` happened at `at` (visual only, never read back; a no-op without
   * `host.feedback`). `amount` is the signed number floating text shows.
   */
  feedback(kind: FeelEvent, at: Readonly<Vec3> | undefined, opts?: { source?: EntityId; target?: EntityId; amount?: number; intensity?: number }): void;
  /** Respawn point set by checkpoints (undefined → `playerSpawn`). */
  respawnPoint: Vec3 | undefined;
  /** `world.player.spawn`. */
  readonly playerSpawn: Readonly<Vec3>;
}

/** A behavior attached to one entity. */
export interface BehaviorInstance {
  /** Called every tick while enabled and the game is playing. */
  update?(env: BehaviorEnv, dt: number): void;
  /** Release resources (spawned ids, timers). */
  dispose?(env: BehaviorEnv): void;
}

/** Definition of a built-in behavior type. */
export interface BehaviorDef {
  type: BuiltinBehavior;
  description: string;
  requires?: string;
  params: Record<string, BehaviorParamSpec>;
  /** `random` is a deterministic stream in [0, 1) private to this instance. */
  create(self: RuntimeEntity, p: ParamReader, random: () => number): BehaviorInstance;
}

/** A behavior instance bound to an entity, with its enabled flag. */
export interface BehaviorSlot {
  /** Built-in type or "script". */
  type: string;
  enabled: boolean;
  /** Stable key of the spec (for hot reload change detection). */
  key: string;
  instance: BehaviorInstance;
  /** Script id for "script" slots. */
  scriptId?: string;
  /** Simulated time a deferred script slot has not consumed yet (round-robin budget). */
  deferredDt?: number;
}
