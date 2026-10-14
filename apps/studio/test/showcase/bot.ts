/**
 * Headless playtest bot: plays a world the way a person does — physics, the
 * player capsule (or a driven vehicle) and the logic runtime stepped at the
 * studio's fixed rate with keyboard-like input — so tests can prove a
 * template's main loop is completable (reach every pickup, ride the lifts,
 * win) without a browser.
 */
import { type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime, type InputState, type QuatTuple } from '@aether/logic';
import { CharacterController, PhysicsWorld } from '@aether/physics';
import { HeadlessLogicHost } from '../../src/engine/headlessHost';
import { PLAYER_CAPSULE, PLAYER_PSEUDO_ID } from '../../src/config';

/** Fixed step of the studio simulation. */
export const BOT_DT = 1 / 60;

/** Logic host whose "player" is the bot's capsule (or the driven vehicle). */
class BotHost extends HeadlessLogicHost {
  readonly messages: string[] = [];
  private readonly pose = { position: [0, 0, 0] as Vec3, quaternion: [0, 0, 0, 1] as QuatTuple };

  constructor(
    pw: PhysicsWorld,
    world: WorldDoc,
    private readonly character: CharacterController | null,
    private readonly vehicle: EntityId | null,
  ) {
    super(pw, world);
  }

  override getTransform(id: EntityId): { position: Vec3; quaternion: QuatTuple } | undefined {
    if (id === PLAYER_PSEUDO_ID && this.character) {
      const p = this.character.position;
      this.pose.position[0] = p[0];
      this.pose.position[1] = p[1];
      this.pose.position[2] = p[2];
      return this.pose;
    }
    return super.getTransform(id);
  }

  override teleport(id: EntityId, p: Vec3): void {
    if (id === PLAYER_PSEUDO_ID && this.character) this.character.teleport(p);
    else super.teleport(id, p);
  }

  override message(text: string, duration: number): void {
    this.messages.push(text);
    super.message(text, duration);
  }

  override playerId(): EntityId | undefined {
    return this.vehicle ?? (this.character ? PLAYER_PSEUDO_ID : undefined);
  }
}

/** Mutable input the bot "presses". */
interface BotInput extends InputState {
  keys: Set<string>;
}

/** A world being played by the bot. */
export class Bot {
  readonly host: BotHost;
  readonly runtime: LogicRuntime;
  readonly character: CharacterController | null;
  readonly vehicle: EntityId | null;
  time = 0;
  private readonly input: BotInput = { ...EMPTY_INPUT, keys: new Set<string>() };

  private constructor(
    readonly world: WorldDoc,
    readonly pw: PhysicsWorld,
  ) {
    this.vehicle = world.player.mode === 'vehicle' && world.player.controls ? world.player.controls : null;
    this.character = this.vehicle ? null : new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_PSEUDO_ID });
    this.host = new BotHost(pw, world, this.character, this.vehicle);
    this.runtime = new LogicRuntime(world, this.host, { seed: world.seed });
    this.runtime.start();
  }

  /** Start playing `world` (call `initPhysics()` first). */
  static async play(world: WorldDoc): Promise<Bot> {
    return new Bot(world, await PhysicsWorld.create(world, { fixedDt: BOT_DT }));
  }

  /** The player's (or vehicle's) position. */
  get position(): Vec3 {
    if (this.character) return this.character.position;
    const s = this.vehicle ? this.pw.getState(this.vehicle) : undefined;
    return s ? [s.position[0], s.position[1], s.position[2]] : [0, 0, 0];
  }

  /** Game result so far. */
  get outcome(): 'win' | 'lose' | null {
    return this.host.outcome.result;
  }

  /** A world state value (score, lanterns …). */
  state(key: string): unknown {
    return this.runtime.readState(key);
  }

  /** Advance `seconds` with the given input held. */
  step(seconds: number, input: Partial<Pick<InputState, 'forward' | 'right' | 'jump' | 'pointerYawDeg'>> & { keys?: string[] } = {}): void {
    const n = Math.max(1, Math.round(seconds / BOT_DT));
    this.input.forward = input.forward ?? 0;
    this.input.right = input.right ?? 0;
    this.input.jump = input.jump ?? false;
    this.input.pointerYawDeg = input.pointerYawDeg ?? 0;
    this.input.keys.clear();
    for (const k of input.keys ?? []) this.input.keys.add(k);
    for (let i = 0; i < n && this.outcome === null; i++) {
      if (this.character) this.character.move({ forward: this.input.forward, right: this.input.right, jump: this.input.jump, yawDeg: this.input.pointerYawDeg }, BOT_DT, this.world.player.moveSpeed, this.world.player.jumpSpeed);
      const events = this.pw.stepFixed();
      this.runtime.tick(BOT_DT, this.input, events);
      this.time += BOT_DT;
    }
  }

  /**
   * Walk toward (x, z) until within `radius` (horizontal) or `timeout`
   * seconds pass; jumps when blocked. Returns whether it arrived.
   */
  walkTo(x: number, z: number, opts: { radius?: number; timeout?: number; jump?: boolean } = {}): boolean {
    const radius = opts.radius ?? 0.6;
    const deadline = this.time + (opts.timeout ?? 30);
    let stuck = 0;
    let last = this.position;
    while (this.time < deadline && this.outcome === null) {
      const p = this.position;
      const dx = x - p[0];
      const dz = z - p[2];
      const d = Math.hypot(dx, dz);
      if (d <= radius) return true;
      const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const slow = d < 1.5 ? Math.max(0.35, d / 1.5) : 1;
      this.step(0.1, { forward: slow, pointerYawDeg: yaw, jump: opts.jump === true || stuck > 6 });
      const moved = Math.hypot(this.position[0] - last[0], this.position[2] - last[2]);
      stuck = moved < 0.05 ? stuck + 1 : 0;
      last = this.position;
    }
    return Math.hypot(x - this.position[0], z - this.position[2]) <= radius;
  }

  /** Heading (degrees, 0 = facing −Z) of the driven vehicle. */
  get heading(): number {
    const q = this.vehicle ? this.pw.getState(this.vehicle)?.quaternion : undefined;
    if (!q) return 0;
    const [x, y, z, w] = q;
    // Forward = q · (0, 0, −1)
    const fx = -2 * (x * z + w * y);
    const fz = -(1 - 2 * (x * x + y * y));
    return (Math.atan2(-fx, -fz) * 180) / Math.PI;
  }

  /**
   * Drive the vehicle toward (x, z) with throttle and steering (like a
   * player holding W and A/D) until within `radius` or `timeout` seconds.
   */
  driveTo(x: number, z: number, opts: { radius?: number; timeout?: number; throttle?: number } = {}): boolean {
    const radius = opts.radius ?? 4;
    const deadline = this.time + (opts.timeout ?? 20);
    while (this.time < deadline && this.outcome === null) {
      const p = this.position;
      const dx = x - p[0];
      const dz = z - p[2];
      if (Math.hypot(dx, dz) <= radius) return true;
      const want = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const err = ((want - this.heading + 540) % 360) - 180;
      const right = Math.max(-1, Math.min(1, -err / 25));
      const throttle = (opts.throttle ?? 1) * (Math.abs(err) > 60 ? 0.45 : 1);
      this.step(1 / 30, { forward: throttle, right });
    }
    return Math.hypot(x - this.position[0], z - this.position[2]) <= radius;
  }

  /** Stand still until `cond` holds (or `timeout` seconds pass). */
  waitUntil(cond: () => boolean, timeout = 20): boolean {
    const deadline = this.time + timeout;
    while (this.time < deadline && this.outcome === null) {
      if (cond()) return true;
      this.step(0.1);
    }
    return cond();
  }

  /** Release physics and logic. */
  dispose(): void {
    this.runtime.dispose();
    this.character?.dispose();
    this.pw.dispose();
  }
}
