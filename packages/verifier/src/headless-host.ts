/**
 * Minimal `LogicHost` backed only by a `PhysicsWorld` — used to run world
 * rules/behaviors headless during verification (no renderer, no audio, no
 * UI). Bodiless kinematic poses are tracked in a side table so zone and
 * position queries stay consistent.
 */
import { worldTransform, type Entity, type EntityId, type Json, type Vec3, type WorldDoc } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime, type LogicHost, type QuatTuple, type ScriptRunner } from '@aether/logic';
import type { LogicHook, PhysicsWorld } from '@aether/physics';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics/bounds';
import { PosePool } from './pose-pool';

/** Outcome recorded by the headless host. */
export interface HeadlessOutcome {
  result: 'win' | 'lose' | null;
  text: string;
  messages: number;
}

const MAX_TRACKED_POSES = 5000;

/** LogicHost implementation over a headless physics world. */
export class HeadlessLogicHost implements LogicHost {
  private readonly poses = new Map<EntityId, { position: Vec3; quaternion: QuatTuple }>();
  private readonly destroyed = new Set<EntityId>();
  /** Reused per-entity pose records (getTransform runs many times per tick). */
  private readonly pool = new PosePool();
  readonly outcome: HeadlessOutcome = { result: null, text: '', messages: 0 };

  constructor(
    private readonly pw: PhysicsWorld,
    private readonly world: WorldDoc,
  ) {}

  getTransform(id: EntityId): { position: Vec3; quaternion: QuatTuple } | undefined {
    if (this.destroyed.has(id)) return undefined;
    const slot = this.pool.slot(id);
    if (this.pw.readPose(id, slot.position, slot.quaternion)) return slot;
    const p = this.poses.get(id);
    if (p) return p;
    if (!Object.prototype.hasOwnProperty.call(this.world.entities, id)) return undefined;
    try {
      const t = worldTransform(this.world, id);
      return this.pool.fill(id, t.position, t.quaternion);
    } catch {
      return undefined;
    }
  }

  setKinematic(id: EntityId, position: Vec3, quaternion: QuatTuple): void {
    if (this.pw.has(id)) this.pw.setKinematicTarget(id, position, quaternion);
    if (this.poses.has(id) || this.poses.size < MAX_TRACKED_POSES) this.poses.set(id, { position: [...position], quaternion: [...quaternion] });
  }

  applyImpulse(id: EntityId, v: Vec3): void {
    this.pw.applyImpulse(id, v);
  }

  setVelocity(id: EntityId, v: Vec3): void {
    this.pw.setVelocity(id, v);
  }

  getVelocity(id: EntityId): Vec3 | undefined {
    return this.pw.getVelocity(id);
  }

  setAngularVelocity(id: EntityId, v: Vec3): void {
    this.pw.setAngularVelocity(id, v);
  }

  teleport(id: EntityId, p: Vec3): void {
    this.pw.teleport(id, p);
    const pose = this.poses.get(id);
    if (pose) pose.position = [...p];
  }

  explode(center: Vec3, force: number, radius: number): void {
    this.pw.explode(center, force, radius);
  }

  setGravity(v: Vec3): void {
    this.pw.setGravity(v);
  }

  spawn(entity: Entity): void {
    this.destroyed.delete(entity.id);
    // Logic spawns are clones of templates from the validated world.
    this.pw.addEntity(entity, { trusted: true });
  }

  destroy(id: EntityId): void {
    this.destroyed.add(id);
    this.poses.delete(id);
    this.pool.release(id);
    this.pw.removeEntity(id);
  }

  setProperty(_id: EntityId, _path: string, _value: Json): void {
    // Visual-only in a headless run.
  }

  message(_text: string, _duration: number): void {
    this.outcome.messages++;
  }

  sound(_name: string): void {
    // Silent in a headless run.
  }

  gameOver(result: 'win' | 'lose', text: string): void {
    if (this.outcome.result === null) {
      this.outcome.result = result;
      this.outcome.text = text.slice(0, 200);
    }
  }

  reset(): void {
    // A reset during verification would loop forever; ignored.
  }

  playerId(): EntityId | undefined {
    return undefined;
  }

  getBounds(id: EntityId): { min: Vec3; max: Vec3 } | undefined {
    return entityWorldBounds(this.world, id) ?? undefined;
  }

  getColliderBounds(id: EntityId): Array<{ min: Vec3; max: Vec3 }> {
    return entityColliderBounds(this.world, id);
  }

  groundHeight(x: number, z: number, fromY: number, exclude?: EntityId): number | undefined {
    const hit = this.pw.raycast([x, fromY, z], [0, -1, 0], fromY + 8, exclude);
    return hit ? hit.point[1] : undefined;
  }
}

/**
 * Build the `logic` option of `@aether/physics.verify`: each call constructs
 * a fresh headless `LogicRuntime` against the given physics world. Runtimes
 * are tracked so the caller can dispose them once verification finished.
 */
export function createVerifyLogic(world: WorldDoc, opts: { scripts?: () => ScriptRunner | undefined } = {}): {
  factory: (pw: PhysicsWorld) => LogicHook;
  dispose: () => void;
} {
  const runtimes: Array<{ runtime: LogicRuntime | null; scripts: ScriptRunner | undefined }> = [];
  const factory = (pw: PhysicsWorld): LogicHook => {
    const host = new HeadlessLogicHost(pw, world);
    const scripts = opts.scripts?.();
    // Track the runner before constructing the runtime so it is freed even if construction throws.
    const entry: { runtime: LogicRuntime | null; scripts: ScriptRunner | undefined } = { runtime: null, scripts };
    runtimes.push(entry);
    const runtime = new LogicRuntime(world, host, scripts ? { scripts } : {});
    entry.runtime = runtime;
    runtime.start();
    return {
      tick: (dt, _pw, events) => runtime.tick(dt, EMPTY_INPUT, events),
      readState: (key) => runtime.readState(key),
    };
  };
  const dispose = (): void => {
    for (const r of runtimes.splice(0)) {
      // Separate guards: a failing runtime dispose must not leak the QuickJS runner.
      try {
        r.runtime?.dispose();
      } catch {
        /* already disposed */
      }
      try {
        r.scripts?.dispose();
      } catch {
        /* already disposed */
      }
    }
  };
  return { factory, dispose };
}
