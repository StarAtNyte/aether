/**
 * One playthrough: an isolated headless physics world built from the
 * document (never the live editor session), the bot's capsule, the logic
 * runtime and the replay trace recorder, stepped at the studio's fixed rate.
 */
import type { EntityId, Vec3, WorldDoc } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime, type InputState, type ScriptRunner } from '@aether/logic';
import { CharacterController, PhysicsWorld } from '@aether/physics';
import { PLAYER_CAPSULE, PLAYER_ID, PlaytestHost } from './host';
import { levelColliders } from './level/colliders';
import { TRACE_STRIDE, PLAYTEST_LIMITS, type PlaytestTrace, type TraceEvent } from './types';

/** Fixed step of the studio simulation. */
export const STEP = 1 / 60;
/** Below this height the studio respawns the player at the spawn. */
export const KILL_Y = -40;

/** What the bot presses for one tick. */
export interface BotInput {
  forward: number;
  right: number;
  jump: boolean;
  yawDeg: number;
  /** Keys that go down this tick. */
  keys?: readonly string[];
  /** The weapon's trigger is held (worlds with `player.weapon`). */
  fire?: boolean;
  /** The crosshair ray (eye and unit direction); without it shots follow `yawDeg` and `pitchDeg`. */
  aim?: { origin: Vec3; dir: Vec3 };
  pitchDeg?: number;
}

const NO_KEYS: ReadonlySet<string> = new Set<string>();

/** A running playthrough. */
export class Session {
  readonly host: PlaytestHost;
  readonly runtime: LogicRuntime;
  readonly character: CharacterController;
  time = 0;
  steps = 0;
  falls = 0;
  private readonly input: { -readonly [K in keyof InputState]: InputState[K] } = { ...EMPTY_INPUT, keys: NO_KEYS };
  private readonly keySet = new Set<string>();
  private readonly frames: number[] = [];
  private readonly events: TraceEvent[] = [];
  private traceDt: number;
  private nextSample = 0;
  private recording: boolean;
  private yaw = 0;
  private readonly scripts: ScriptRunner | undefined;
  /** The driven entity of a vehicle world (the trace follows it instead of the capsule). */
  private driven: EntityId | undefined;

  private constructor(
    readonly world: WorldDoc,
    readonly pw: PhysicsWorld,
    scripts: ScriptRunner | undefined,
    opts: { trace: boolean; traceHz: number; held?: boolean },
  ) {
    this.scripts = scripts;
    this.recording = opts.trace;
    this.traceDt = 1 / Math.max(1, Math.min(30, opts.traceHz));
    this.character = new CharacterController(pw, { radius: PLAYER_CAPSULE.radius, height: PLAYER_CAPSULE.height, spawn: world.player.spawn, id: PLAYER_ID });
    this.host = new PlaytestHost(pw, world, this.character);
    this.runtime = new LogicRuntime(world, this.host, scripts ? { scripts, seed: world.seed } : { seed: world.seed });
    this.begun = opts.held !== true;
    if (this.begun) this.runtime.start();
  }

  /** False while a held session waits behind its title card (see `create`'s `held`). */
  begun: boolean;

  /** Start a held session's logic (the player pressed the title card's button); no-op once begun. */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    this.runtime.start();
  }

  /**
   * Build a session for `world` (physics must be loadable; scripts optional). `held`: the logic does not start until
   * `begin()`, as the studio holds a world with a title card until the player presses its button.
   */
  static async create(world: WorldDoc, opts: { trace?: boolean; traceHz?: number; scripts?: ScriptRunner; held?: boolean } = {}): Promise<Session> {
    const pw = await PhysicsWorld.create(world, { fixedDt: STEP, ...levelColliders() });
    try {
      return new Session(world, pw, opts.scripts, { trace: opts.trace ?? true, traceHz: opts.traceHz ?? 12, held: opts.held === true });
    } catch (err) {
      pw.dispose();
      throw err;
    }
  }

  /** Feet position of the bot. */
  get position(): Vec3 {
    return this.character.position;
  }

  /** True when the game has ended (win or lose). */
  get over(): boolean {
    return this.host.seen.outcome !== null;
  }

  /** Facing of the bot in degrees. */
  get yawDeg(): number {
    return this.yaw;
  }

  /** Record a replay event at the current time. */
  note(kind: TraceEvent['kind'], label: string, position?: Vec3): void {
    if (this.events.length < 400) this.events.push({ t: Math.round(this.time * 100) / 100, kind, label: label.slice(0, 80), position: position ?? this.position });
  }

  /** One fixed tick with the given input. */
  tick(input: BotInput): void {
    if (this.over) return;
    this.begin();
    this.yaw = input.yawDeg;
    this.host.yawDeg = input.yawDeg;
    this.character.move({ forward: input.forward, right: input.right, jump: input.jump, yawDeg: input.yawDeg }, STEP, this.world.player.moveSpeed, this.world.player.jumpSpeed);
    if (this.character.position[1] < KILL_Y) {
      this.character.teleport(this.world.player.spawn);
      this.falls++;
      this.note('fall', 'fell out of the world');
    }
    const events = this.pw.stepFixed();
    const s = this.input;
    s.forward = input.forward;
    s.right = input.right;
    s.jump = input.jump;
    s.pointerYawDeg = input.yawDeg;
    s.fire = input.fire === true;
    s.pitchDeg = input.pitchDeg ?? 0;
    if (input.aim) s.aim = input.aim;
    else delete s.aim;
    if (input.keys && input.keys.length > 0) {
      this.keySet.clear();
      for (const k of input.keys) this.keySet.add(k);
      s.keys = this.keySet;
    } else {
      s.keys = NO_KEYS;
    }
    this.runtime.tick(STEP, s, events);
    this.time += STEP;
    this.steps++;
    if (this.recording) this.sample();
  }

  /**
   * Hand the controls to a vehicle: the player is `id` from now on, the bot's capsule is parked far below the world (it never
   * collides with anything) and the replay trace follows the vehicle.
   */
  drive(id: EntityId): void {
    this.driven = id;
    this.host.controlled = id;
    this.character.teleport([0, -30, 0]);
  }

  /** The driven vehicle's position and heading (degrees, 0 faces −Z), or undefined when nothing is driven. */
  get vehicle(): { position: Vec3; yawDeg: number; speed: number } | undefined {
    if (!this.driven) return undefined;
    const t = this.host.getTransform(this.driven);
    if (!t) return undefined;
    const q = t.quaternion;
    const fx = -(2 * (q[0] * q[2] + q[3] * q[1]));
    const fz = -(1 - 2 * (q[0] * q[0] + q[1] * q[1]));
    const v = this.host.getVelocity(this.driven);
    return { position: [t.position[0], t.position[1], t.position[2]], yawDeg: (Math.atan2(-fx, -fz) * 180) / Math.PI, speed: v ? v[0] * fx + v[2] * fz : 0 };
  }

  /** One fixed tick of a driven vehicle: `throttle` (−1 brake/reverse … 1) and `steer` (−1 left … 1 right). */
  driveTick(throttle: number, steer: number): void {
    if (this.over || !this.driven) return;
    this.begin();
    const events = this.pw.stepFixed();
    const s = this.input;
    s.forward = throttle;
    s.right = steer;
    s.jump = false;
    s.keys = NO_KEYS;
    this.runtime.tick(STEP, s, events);
    this.time += STEP;
    this.steps++;
    if (this.recording) this.sample();
  }

  /** Idle for `seconds` of simulated time. */
  idle(seconds: number): void {
    const n = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < n && !this.over; i++) this.tick({ forward: 0, right: 0, jump: false, yawDeg: this.yaw });
  }

  private sample(): void {
    if (this.time + 1e-9 < this.nextSample) return;
    if (this.frames.length / TRACE_STRIDE >= PLAYTEST_LIMITS.MAX_TRACE_FRAMES) {
      this.recording = false;
      return;
    }
    const v = this.vehicle;
    const p = v ? v.position : this.character.position;
    this.frames.push(p[0], p[1], p[2], v ? v.yawDeg : this.yaw);
    this.nextSample += this.traceDt;
  }

  /** Force a final sample (so the replay ends exactly where the run did). */
  finishTrace(): PlaytestTrace | undefined {
    if (this.frames.length < TRACE_STRIDE * 2 && !this.over && this.time === 0) return undefined;
    const v = this.vehicle;
    const p = v ? v.position : this.character.position;
    if (this.frames.length / TRACE_STRIDE < PLAYTEST_LIMITS.MAX_TRACE_FRAMES) this.frames.push(p[0], p[1], p[2], v ? v.yawDeg : this.yaw);
    const frames = this.frames.length / TRACE_STRIDE;
    if (frames < 2) return undefined;
    return { dt: this.traceDt, frames, poses: Float32Array.from(this.frames), events: this.events.slice() };
  }

  /** Every sampled position (for the path summary). */
  sampledPath(): Vec3[] {
    const out: Vec3[] = [];
    for (let i = 0; i + 2 < this.frames.length; i += TRACE_STRIDE) out.push([this.frames[i] as number, this.frames[i + 1] as number, this.frames[i + 2] as number]);
    return out;
  }

  /** Reads a world state value. */
  state(key: string): unknown {
    return this.runtime.readState(key);
  }

  /** Entity runtime state (door `open` …). */
  entityState(id: EntityId): Readonly<Record<string, unknown>> {
    return this.runtime.entityState(id);
  }

  /** Release physics, logic and the script runner's runtimes (the runner itself is the caller's). */
  dispose(): void {
    try {
      this.runtime.dispose();
    } catch {
      /* already disposed */
    }
    try {
      this.character.dispose();
    } catch {
      /* already disposed */
    }
    this.pw.dispose();
  }
}
