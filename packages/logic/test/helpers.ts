/**
 * Test doubles for @aether/logic: a recording LogicHost and world builders.
 */
import { createWorld, type Entity, type EntityId, type EntityInput, type Json, type RuleInput, type Vec3, type WorldDoc, type WorldDocInput } from '@aether/core';
import { EMPTY_INPUT, type InputState, type LogicHost, type LogicRuntime, type QuatTuple } from '../src';

/** One recorded host call. */
export interface HostCall {
  fn: string;
  args: unknown[];
}

/** LogicHost fake: records every call and keeps a tiny world of poses/velocities. */
export class FakeHost implements LogicHost {
  readonly calls: HostCall[] = [];
  readonly transforms = new Map<EntityId, { position: Vec3; quaternion: QuatTuple }>();
  readonly velocities = new Map<EntityId, Vec3>();
  readonly angular = new Map<EntityId, Vec3>();
  readonly spawned: Entity[] = [];
  readonly destroyed: EntityId[] = [];
  readonly messages: string[] = [];
  readonly sounds: string[] = [];
  readonly properties: Array<{ id: EntityId; path: string; value: Json }> = [];
  gameOverResult: { result: 'win' | 'lose'; text: string } | undefined;
  resets = 0;
  kinematicWrites = 0;
  player: EntityId | undefined;
  /** When false, setKinematic is counted but not recorded (perf tests). */
  recordKinematic = true;

  private rec(fn: string, ...args: unknown[]): void {
    this.calls.push({ fn, args: JSON.parse(JSON.stringify(args)) as unknown[] });
  }

  /** Calls of one kind. */
  callsOf(fn: string): HostCall[] {
    return this.calls.filter((c) => c.fn === fn);
  }

  /** Place an entity (or the player avatar) at a position. */
  place(id: EntityId, position: Vec3, quaternion: QuatTuple = [0, 0, 0, 1]): void {
    this.transforms.set(id, { position: [position[0], position[1], position[2]], quaternion: [...quaternion] as QuatTuple });
  }

  getTransform(id: EntityId): { position: Vec3; quaternion: QuatTuple } | undefined {
    return this.transforms.get(id);
  }
  setKinematic(id: EntityId, position: Vec3, quaternion: QuatTuple): void {
    this.kinematicWrites++;
    const t = this.transforms.get(id);
    if (t) {
      t.position[0] = position[0];
      t.position[1] = position[1];
      t.position[2] = position[2];
      t.quaternion[0] = quaternion[0];
      t.quaternion[1] = quaternion[1];
      t.quaternion[2] = quaternion[2];
      t.quaternion[3] = quaternion[3];
    } else this.place(id, position, quaternion);
    if (this.recordKinematic) this.rec('setKinematic', id, position, quaternion);
  }
  applyImpulse(id: EntityId, v: Vec3): void {
    this.rec('applyImpulse', id, v);
  }
  setVelocity(id: EntityId, v: Vec3): void {
    this.velocities.set(id, [v[0], v[1], v[2]]);
    this.rec('setVelocity', id, v);
  }
  getVelocity(id: EntityId): Vec3 | undefined {
    return this.velocities.get(id);
  }
  setAngularVelocity(id: EntityId, v: Vec3): void {
    this.angular.set(id, [v[0], v[1], v[2]]);
  }
  teleport(id: EntityId, p: Vec3): void {
    const t = this.transforms.get(id);
    this.place(id, p, t?.quaternion);
    this.rec('teleport', id, p);
  }
  explode(center: Vec3, force: number, radius: number): void {
    this.rec('explode', center, force, radius);
  }
  setGravity(v: Vec3): void {
    this.rec('setGravity', v);
  }
  spawn(entity: Entity): void {
    this.spawned.push(entity);
    this.place(entity.id, entity.transform.position);
    this.rec('spawn', entity.id);
  }
  destroy(id: EntityId): void {
    this.destroyed.push(id);
    this.transforms.delete(id);
    this.rec('destroy', id);
  }
  setProperty(id: EntityId, path: string, value: Json): void {
    this.properties.push({ id, path, value });
    this.rec('setProperty', id, path, value);
  }
  message(text: string, duration: number): void {
    this.messages.push(text);
    this.rec('message', text, duration);
  }
  sound(name: string): void {
    this.sounds.push(name);
    this.rec('sound', name);
  }
  gameOver(result: 'win' | 'lose', text: string): void {
    this.gameOverResult = { result, text };
    this.rec('gameOver', result, text);
  }
  reset(): void {
    this.resets++;
    this.rec('reset');
  }
  /** Joint servo targets requested by physical doors and drawers. */
  readonly driven: Array<{ id: EntityId; target: number }> = [];
  driveJoint(id: EntityId, target: number): void {
    this.driven.push({ id, target });
  }
  playerId(): EntityId | undefined {
    return this.player;
  }
}

/** Build a validated world from loose input. */
export function world(input: WorldDocInput = {}): WorldDoc {
  return createWorld(input);
}

/** Shorthand world from entities and rules. */
export function worldOf(entities: EntityInput[], rules: RuleInput[] = [], extra: WorldDocInput = {}): WorldDoc {
  const map: Record<string, EntityInput> = {};
  for (const e of entities) map[e.id] = e;
  return createWorld({ ...extra, entities: map, rules });
}

/** Input with overrides. */
export function input(over: Partial<InputState> = {}): InputState {
  return { ...EMPTY_INPUT, ...over };
}

/** Input holding the given keys. */
export function keys(...k: string[]): InputState {
  return input({ keys: new Set(k) });
}

/** Fixed step used in tests. */
export const DT = 1 / 60;

/** Run `n` ticks with constant input and no events. */
export function run(rt: LogicRuntime, n: number, inp: InputState = EMPTY_INPUT): void {
  for (let i = 0; i < n; i++) rt.tick(DT, inp, []);
}

/** Texts of a runtime log. */
export function logText(log: ReadonlyArray<{ text: string }>): string {
  return log.map((e) => e.text).join('\n');
}
