/**
 * The logic host of a playtest: physics only (no renderer, audio or UI),
 * with the bot's capsule standing in for "the player". It records what the
 * game does (messages, destroyed entities, the win / lose) for the report.
 */
import { worldTransform, type Entity, type EntityId, type Json, type Vec3, type WorldDoc } from '@aether/core';
import type { LogicHost, QuatTuple } from '@aether/logic';
import type { CharacterController, PhysicsWorld } from '@aether/physics';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics/bounds';

/** Id the logic runtime knows the player by (same as the studio's). */
export const PLAYER_ID = 'player';

/** Capsule of the studio's built-in player. */
export const PLAYER_CAPSULE = Object.freeze({ radius: 0.35, height: 1.7 });

/** What the host observed. */
export interface HostObservations {
  outcome: 'win' | 'lose' | null;
  endText: string;
  messages: string[];
  destroyed: Set<EntityId>;
  /** Hidden by a respawning pickup. */
  hidden: Set<EntityId>;
  /** Number of times logic moved the player (checkpoint respawns, teleports). */
  playerTeleports: number;
}

const MAX_MESSAGES = 50;
const MAX_TRACKED_POSES = 5000;

interface Pose {
  position: Vec3;
  quaternion: QuatTuple;
}

/** LogicHost over a headless physics world and the bot's character. */
export class PlaytestHost implements LogicHost {
  readonly seen: HostObservations = { outcome: null, endText: '', messages: [], destroyed: new Set(), hidden: new Set(), playerTeleports: 0 };
  private readonly poses = new Map<EntityId, Pose>();
  private readonly scratch = new Map<EntityId, Pose>();
  private readonly playerPose: Pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  /** Called with the entity id when the game removes an entity (a pickup collected). */
  onDestroy: ((id: EntityId) => void) | null = null;
  /** Called when the game shows a message. */
  onMessage: ((text: string) => void) | null = null;
  /** Called when the game ends. */
  onGameOver: ((result: 'win' | 'lose', text: string) => void) | null = null;
  /** Called when a pickup toggles visibility (respawning collectibles). */
  onVisible: ((id: EntityId, visible: boolean) => void) | null = null;
  yawDeg = 0;
  /** The entity the player drives (vehicle worlds); `undefined` when the player is the capsule. */
  controlled: EntityId | undefined;

  constructor(
    private readonly pw: PhysicsWorld,
    private readonly world: WorldDoc,
    private readonly character: CharacterController,
  ) {}

  getTransform(id: EntityId): { position: Vec3; quaternion: QuatTuple } | undefined {
    if (id === PLAYER_ID) {
      const p = this.character.position;
      const slot = this.playerPose;
      slot.position[0] = p[0];
      slot.position[1] = p[1];
      slot.position[2] = p[2];
      const h = (this.yawDeg * Math.PI) / 360;
      slot.quaternion[1] = Math.sin(h);
      slot.quaternion[3] = Math.cos(h);
      return slot;
    }
    if (this.seen.destroyed.has(id)) return undefined;
    let slot = this.scratch.get(id);
    if (!slot) {
      slot = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
      if (this.scratch.size < MAX_TRACKED_POSES) this.scratch.set(id, slot);
    }
    if (this.pw.readPose(id, slot.position, slot.quaternion)) return slot;
    const p = this.poses.get(id);
    if (p) return p;
    if (!Object.prototype.hasOwnProperty.call(this.world.entities, id)) return undefined;
    try {
      const t = worldTransform(this.world, id);
      slot.position[0] = t.position[0];
      slot.position[1] = t.position[1];
      slot.position[2] = t.position[2];
      slot.quaternion[0] = t.quaternion[0];
      slot.quaternion[1] = t.quaternion[1];
      slot.quaternion[2] = t.quaternion[2];
      slot.quaternion[3] = t.quaternion[3];
      return slot;
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
    if (id === PLAYER_ID) return [0, this.character.verticalSpeed, 0];
    return this.pw.getVelocity(id);
  }

  setAngularVelocity(id: EntityId, v: Vec3): void {
    this.pw.setAngularVelocity(id, v);
  }
  driveJoint(id: EntityId, target: number): void {
    this.pw.driveJoint(id, target);
  }

  teleport(id: EntityId, p: Vec3): void {
    if (id === PLAYER_ID) {
      this.character.teleport(p);
      this.seen.playerTeleports++;
      return;
    }
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
    this.seen.destroyed.delete(entity.id);
    this.pw.addEntity(entity, { trusted: true });
  }

  destroy(id: EntityId): void {
    this.seen.destroyed.add(id);
    this.poses.delete(id);
    this.scratch.delete(id);
    this.pw.removeEntity(id);
    this.onDestroy?.(id);
  }

  setProperty(id: EntityId, path: string, value: Json): void {
    if (path === 'visible' && typeof value === 'boolean') {
      if (value) this.seen.hidden.delete(id);
      else this.seen.hidden.add(id);
      this.onVisible?.(id, value);
    }
  }

  message(text: string, _duration: number): void {
    if (this.seen.messages.length < MAX_MESSAGES) this.seen.messages.push(text.slice(0, 200));
    this.onMessage?.(text);
  }

  sound(_name: string): void {
    // Silent.
  }

  gameOver(result: 'win' | 'lose', text: string): void {
    if (this.seen.outcome !== null) return;
    this.seen.outcome = result;
    this.seen.endText = text.slice(0, 200);
    this.onGameOver?.(result, text);
  }

  reset(): void {
    // A reset inside a playtest would loop; the run ends instead of restarting.
  }

  playerId(): EntityId | undefined {
    return this.controlled ?? PLAYER_ID;
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
