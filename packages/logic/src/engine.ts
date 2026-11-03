/**
 * The logic engine: owns runtime entities, state, rules, behaviors and the
 * script bridge, and implements the services behaviors and actions use.
 * {@link LogicRuntime} is the public facade over it.
 */
import {
  hashString,
  hasOwn,
  LIMITS,
  rng,
  stableStringify,
  worldTransform,
  type Entity,
  type EntityId,
  type FeelEvent,
  type Json,
  type Vec3,
  type VfxPreset,
  type WorldDoc,
} from '@aether/core';
import { executeAction, locate, type ActionContext } from './actions';
import { insideZone, onTopOfZone, zoneShapeOf } from './bounds';
import { BEHAVIORS } from './behaviors';
import { moveToward } from './behaviors/move';
import type { BehaviorEnv, BehaviorSlot, ContactInfo } from './behaviors/types';
import { EntityRegistry, lookupEntity, quatFromEulerDeg, RuntimeEntity } from './entities';
import { KeyEdges } from './keys';
import { NpcSystem } from './npc/system';
import { WeaponSystem, type WeaponEnv } from './weapon';
import { ParamReader } from './params';
import { errorText, RuleEngine, type RuleHost } from './rules';
import { checkIntent } from './scripting/intents';
import { cloneState, readState, showValue, writeState, type StateRecord, type StateScope } from './state';
import type { FeedbackEvent, InputState, LogEntry, LogicHost, PhysicsEventLike, QuatTuple, ScriptRunner, ScriptSnapshot } from './types';
import { copy3 } from './vec';

/** Max log entries kept (ring buffer). */
export const MAX_LOG_ENTRIES = 500;
/** Max entities spawned per tick. */
export const MAX_SPAWNS_PER_TICK = 200;
/** Max runtime-spawned entities alive at once. */
export const MAX_LIVE_SPAWNED = 1000;
/** Max physics events processed per tick. */
const MAX_EVENTS_PER_TICK = 4096;
/** Max queued clicks / external events between ticks. */
const MAX_PENDING_INPUTS = 64;
/** Largest accepted fixed step (s): protects against huge catch-up steps. */
const MAX_DT = 0.25;
/** Script snapshot: neighbours within this radius… */
const NEARBY_RADIUS = 15;
/** …and at most this many. */
const NEARBY_MAX = 16;
/** Script snapshot: scan at most this many entities for neighbours. */
const NEARBY_SCAN_LIMIT = 4000;
/**
 * Script calls per tick across all entities. Deterministic (a count, not wall
 * time): beyond it, script slots are served round-robin over the next ticks
 * and receive the simulated time they missed.
 */
export const MAX_SCRIPT_CALLS_PER_TICK = 24;
/** Longest catch-up step handed to a deferred script (s). */
const MAX_SCRIPT_CATCHUP = 0.5;

function cellCoord(v: number): number {
  return Math.floor(v / NEARBY_RADIUS);
}

/** Hash of a grid cell (collisions only add candidates; distances are exact). */
function cellKey(ix: number, iy: number, iz: number): number {
  return ((ix & 0x3ff) << 20) | ((iy & 0x3ff) << 10) | (iz & 0x3ff);
}

/** Options shared by the engine and the runtime facade. */
export interface EngineOptions {
  scripts?: ScriptRunner;
  seed?: number;
}

/** Game status. */
export type GameStatus = 'playing' | 'won' | 'lost';

const EMPTY_STATE: Readonly<Record<string, Json>> = Object.freeze({});
const EMPTY_USED: ReadonlySet<string> = new Set<string>();
const EMPTY_CONTACTS: readonly ContactInfo[] = Object.freeze([]) as readonly ContactInfo[];

function clampAxis(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** Engine implementation. Not exported from the package: use LogicRuntime. */
export class Engine implements BehaviorEnv, RuleHost {
  /** Trace ring buffer storage: O(1) writes, ordered view materialized on read. */
  private readonly ring: Array<LogEntry | undefined> = new Array<LogEntry | undefined>(MAX_LOG_ENTRIES);
  private ringHead = 0;
  private ringSize = 0;
  private ringView: LogEntry[] | null = [];
  readonly host: LogicHost;
  private world: WorldDoc;
  private readonly scripts: ScriptRunner | undefined;
  private readonly seed: number;
  private readonly registry = new EntityRegistry();
  private worldState: StateRecord = {};
  /**
   * JSON of {@link worldState} shared by every script call of a tick;
   * cleared at tick start and on every state write, so scripts always see
   * current values but the record is serialized once in the common case.
   */
  private worldJson: string | null = null;
  private readonly scope: StateScope;
  private readonly rules: RuleEngine;
  private readonly keyEdges = new KeyEdges();
  private readonly inputState: { forward: number; right: number; jump: boolean; action: boolean; keys: ReadonlySet<string>; pointerYawDeg: number; fire: boolean; pitchDeg: number; aim?: { origin: Vec3; dir: Vec3 } } = {
    forward: 0,
    right: 0,
    jump: false,
    action: false,
    keys: new Set<string>(),
    pointerYawDeg: 0,
    fire: false,
    pitchDeg: 0,
  };
  private readonly aimScratch: { origin: Vec3; dir: Vec3 } = { origin: [0, 0, 0], dir: [0, 0, -1] };
  private spawnRandom: () => number;
  private _time = 0;
  private _dt = 0;
  private tickNo = 0;
  private _status: GameStatus = 'playing';
  private started = false;
  private disposed = false;
  private resetPending = false;
  private clicks: EntityId[] = [];
  private uses: EntityId[] = [];
  private usedNow: ReadonlySet<EntityId> = new Set<EntityId>();
  private externalEvents: string[] = [];
  private readonly contacts = new Map<EntityId, ContactInfo[]>();
  private readonly active = new Map<EntityId, Set<EntityId>>();
  private readonly poseDirty: RuntimeEntity[] = [];
  private readonly hostPos = new Map<EntityId, Vec3>();
  /** Per-tick cache of dynamic zone frames (one host.getTransform per zone per tick). */
  private readonly zoneFrames = new Map<EntityId, { pos: Readonly<Vec3>; rot: Readonly<QuatTuple> }>();
  private readonly spawnCounters = new Map<string, number>();
  private spawnedThisTick = 0;
  private liveSpawned = 0;
  private defaultPlayer: EntityId | undefined;
  private playerTick = -1;
  private playerCache: EntityId | undefined;
  private moversTick = -1;
  /** Script slots encountered this tick / last tick, and the round-robin offset. */
  private scriptSeen = 0;
  private scriptTotalPrev = 0;
  private scriptRotation = 0;
  /** Uniform grid (cell = NEARBY_RADIUS) over live entities, rebuilt at most once per tick. */
  private readonly nearGrid = new Map<number, RuntimeEntity[]>();
  private readonly nearPool: RuntimeEntity[][] = [];
  private nearGridTick = -1;
  private readonly moversList: EntityId[] = [];
  private readonly resolveScratch: EntityId[] = [];
  private readonly quatScratch: QuatTuple = [0, 0, 0, 1];
  private readonly warned = new Set<string>();
  respawnPoint: Vec3 | undefined;
  /** NPC minds, navigation, dialogue and speech (see `./npc`). */
  readonly npcs: NpcSystem;
  /** The player's gun (`world.player.weapon`), or null. */
  weapon: WeaponSystem | null = null;

  constructor(world: WorldDoc, host: LogicHost, opts: EngineOptions = {}) {
    this.world = world;
    this.host = host;
    this.npcs = new NpcSystem({ env: this, world: () => this.world, bounds: host });
    this.scripts = opts.scripts;
    this.seed = (Number.isFinite(opts.seed) ? (opts.seed as number) : world.seed) >>> 0;
    this.spawnRandom = rng(this.seed ^ 0x5bd1e995);
    const states = { world: (): StateRecord => this.worldState, entity: (id: string) => this.registry.get(id)?.state };
    this.scope = {
      get world(): StateRecord {
        return states.world();
      },
      entityState: states.entity,
    };
    this.rules = new RuleEngine(this);
    this.loadScripts(world);
    this.build(world);
  }

  // ---------------------------------------------------------------------------
  // Public facade API
  // ---------------------------------------------------------------------------

  get time(): number {
    return this._time;
  }

  get dt(): number {
    return this._dt;
  }

  get status(): GameStatus {
    return this._status;
  }

  get input(): InputState {
    return this.inputState;
  }

  get pressed(): ReadonlySet<string> {
    return this.keyEdges.pressed;
  }

  get playerSpawn(): Readonly<Vec3> {
    return this.world.player.spawn;
  }

  /** World state record (live; treat as read-only). */
  get state(): Readonly<Record<string, Json>> {
    return this.worldState;
  }

  /** Entity state record (live; treat as read-only). Empty for unknown entities. */
  entityState(id: EntityId): Readonly<Record<string, Json>> {
    return this.registry.get(id)?.state ?? EMPTY_STATE;
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.log('play started');
    this.guard('start rules', () => this.rules.fireStart());
  }

  /** Queue a click on an entity; processed at the next tick. */
  click(id: EntityId): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return;
    if (this.clicks.length < MAX_PENDING_INPUTS) this.clicks.push(id);
  }

  /** Queue a use (aim + use key) of an entity; its `operable` behaviors react at the next tick. */
  use(id: EntityId): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return;
    if (this.uses.length < MAX_PENDING_INPUTS) this.uses.push(id);
  }

  get used(): ReadonlySet<EntityId> {
    return this.usedNow;
  }

  /** Queue an external event; processed at the next tick. */
  emitExternal(event: string): void {
    if (typeof event !== 'string' || event.length === 0 || event.length > 100) return;
    if (this.externalEvents.length < MAX_PENDING_INPUTS) this.externalEvents.push(event);
  }

  tick(dt: number, input: InputState, events: readonly PhysicsEventLike[]): void {
    if (this.disposed) return;
    this.readInput(input);
    if (!this.started) this.start();
    if (this._status !== 'playing') return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    this.tickNo++;
    this._dt = step;
    this._time += step;
    this.hostPos.clear();
    this.zoneFrames.clear();
    this.worldJson = null;
    this.scriptTotalPrev = this.scriptSeen;
    this.scriptSeen = 0;
    if (this.scriptTotalPrev > MAX_SCRIPT_CALLS_PER_TICK) {
      this.scriptRotation = (this.scriptRotation + MAX_SCRIPT_CALLS_PER_TICK) % this.scriptTotalPrev;
    } else this.scriptRotation = 0;
    this.rules.beginTick();
    this.spawnedThisTick = 0;
    this.guard('physics events', () => this.ingestEvents(events));
    this.guard('delayed events', () => this.rules.processDue());
    if (this.externalEvents.length > 0) {
      const evs = this.externalEvents;
      this.externalEvents = [];
      for (const e of evs) this.guard('event', () => this.rules.dispatch(e, 0));
    }
    if (this.clicks.length > 0) {
      const cs = this.clicks;
      this.clicks = [];
      for (const id of cs) this.guard('click', () => this.rules.click(id));
    }
    this.guard('timers', () => this.rules.timers(step));
    this.guard('keys', () => this.rules.keys(this.keyEdges.pressed));
    this.guard('collisions', () => this.rules.collisions(events));
    this.guard('zones', () => this.rules.zones());
    this.guard('falls', () => this.rules.falls());
    this.usedNow = this.uses.length > 0 ? new Set(this.uses) : EMPTY_USED;
    this.uses = [];
    this.updateBehaviors(step);
    const gun = this.weapon;
    if (gun) this.guard('weapon', () => gun.tick(step, this.inputState, this.keyEdges.pressed));
    this.guard('state rules', () => this.rules.states());
    this.guard('poses', () => this.flushPoses());
    this.drainScriptDiagnostics();
    if (this.resetPending) this.guard('reset', () => this.performReset());
  }

  readState(key: string): Json | undefined {
    if (typeof key !== 'string') return undefined;
    return readState(this.scope, key);
  }

  /** Hot reload: replace rules/behaviors/entities while preserving runtime state. */
  updateWorld(next: WorldDoc): void {
    if (this.disposed) return;
    const prev = this.world;
    this.world = next;
    this.loadScripts(next);
    this.worldJson = null;
    this.npcs.invalidate();
    for (const k of Object.keys(next.state)) {
      if (!hasOwn(this.worldState, k) && Object.keys(this.worldState).length < LIMITS.MAX_STATE_KEYS) {
        this.worldState[k] = cloneState({ [k]: next.state[k] as Json })[k] as Json;
      }
    }
    // Entities: update changed, add new, drop removed (spawned entities are kept).
    for (const e of this.registry.all().slice()) {
      if (e.spawned) continue;
      const spec = lookupEntity(next.entities, e.id);
      if (!spec || spec.template) this.removeEntity(e);
    }
    for (const id of Object.keys(next.entities)) {
      const spec = next.entities[id] as Entity;
      if (spec.template) continue;
      const existing = this.registry.get(id);
      if (!existing || existing.spawned) {
        if (existing) this.removeEntity(existing);
        this.addEntity(spec, false);
        continue;
      }
      const old = lookupEntity(prev.entities, id);
      if (old === spec) continue;
      this.refreshEntity(existing, spec, old);
    }
    this.defaultPlayer = this.findDefaultPlayer();
    this.playerTick = -1;
    this.rules.load(next.rules);
    this.log('world updated (hot reload)');
  }

  dispose(): void {
    if (this.disposed) return;
    for (const e of this.registry.all()) this.disposeBehaviors(e);
    this.registry.clear();
    this.rules.load([]);
    this.contacts.clear();
    this.active.clear();
    this.poseDirty.length = 0;
    this.disposed = true;
  }

  // ---------------------------------------------------------------------------
  // Construction / reload
  // ---------------------------------------------------------------------------

  private build(world: WorldDoc): void {
    this.registry.clear();
    this.worldState = cloneState(world.state);
    this.worldJson = null;
    for (const id of Object.keys(world.entities)) {
      const spec = world.entities[id] as Entity;
      if (!spec.template) this.addEntity(spec, false);
    }
    this.defaultPlayer = this.findDefaultPlayer();
    this.rules.load(world.rules);
    const gun = world.player.weapon;
    this.weapon = gun ? new WeaponSystem(this.weaponEnv(), gun, rng(this.seed ^ 0x2f6b9c31)) : null;
    this.weapon?.arm();
  }

  /** The engine as seen by the weapon. */
  private weaponEnv(): WeaponEnv {
    return {
      host: this.host,
      npcs: this.npcs,
      playerId: () => this.playerId(),
      positionOf: (id) => this.positionOf(id),
      readState: (k) => this.readState(k),
      setState: (k, v) => this.setState(k, v),
      isDynamic: (id) => this.registry.get(id)?.dynamic === true,
      feedback: (kind, at, opts) => this.feedback(kind, at, opts),
      effect: (vfx, at, feel, color, scale) => this.effect(vfx, at, feel, color, scale),
      log: (t) => void this.log(t),
    };
  }

  private loadScripts(world: WorldDoc): void {
    if (!this.scripts) return;
    for (const id of Object.keys(world.scripts)) {
      const def = world.scripts[id];
      if (!def) continue;
      try {
        this.scripts.load(def);
      } catch (err) {
        this.log(`script '${id}' failed to load: ${errorText(err)}`);
      }
    }
  }

  private findDefaultPlayer(): EntityId | undefined {
    const controls = this.world.player.controls;
    if (controls !== undefined && this.registry.has(controls)) return controls;
    for (const e of this.registry.all()) {
      if (e.spec.behaviors.some((b) => b.type === 'playerController')) return e.id;
    }
    return this.registry.has('player') ? 'player' : undefined;
  }

  private worldPose(spec: Entity): { pos: Vec3; rot: QuatTuple } {
    if (spec.parent !== null && hasOwn(this.world.entities, spec.id)) {
      try {
        const t = worldTransform(this.world, spec.id);
        return { pos: t.position, rot: t.quaternion };
      } catch {
        // broken chain: fall back to the local transform
      }
    }
    const p = spec.transform.position;
    return { pos: [p[0], p[1], p[2]], rot: quatFromEulerDeg(spec.transform.rotation) };
  }

  private addEntity(spec: Entity, spawned: boolean, at?: Readonly<Vec3>): RuntimeEntity {
    const pose = this.worldPose(spec);
    if (at) copy3(pose.pos, at);
    const e = new RuntimeEntity(spec, pose.pos, pose.rot, spawned);
    this.registry.add(e);
    this.createBehaviors(e);
    return e;
  }

  private refreshEntity(e: RuntimeEntity, spec: Entity, old: Entity | undefined): void {
    const oldSpec = e.spec;
    e.spec = spec;
    if (stableStringify(oldSpec.tags) !== stableStringify(spec.tags)) this.registry.retag(e, spec.tags);
    e.dynamic = spec.physics?.body === 'dynamic';
    const transformChanged = !old || stableStringify(old.transform) !== stableStringify(spec.transform) || old.parent !== spec.parent;
    if (transformChanged || stableStringify(oldSpec.shape) !== stableStringify(spec.shape)) {
      e.zone = zoneShapeOf(spec);
    }
    if (transformChanged) {
      const pose = this.worldPose(spec);
      e.setBase(pose.pos, pose.rot);
      e.hasPose = false;
    }
    // New state keys from the document are added; existing runtime values are preserved.
    for (const k of Object.keys(spec.state)) {
      if (!hasOwn(e.state, k)) e.state[k] = cloneState({ [k]: spec.state[k] as Json })[k] as Json;
    }
    const keys = spec.behaviors.map((b, i) => `${i}:${stableStringify(b)}`);
    if (spec.npc) keys.push(npcKey(spec.npc));
    const same = keys.length === e.behaviors.length && keys.every((k, i) => e.behaviors[i]?.key === k);
    if (!same) {
      this.disposeBehaviors(e);
      this.createBehaviors(e);
    }
  }

  private createBehaviors(e: RuntimeEntity): void {
    const slots: BehaviorSlot[] = [];
    e.spec.behaviors.forEach((b, i) => {
      const key = `${i}:${stableStringify(b)}`;
      const random = rng(this.seed ^ hashString(`${e.id}#${i}#${b.type}`));
      if (b.type === 'script') {
        const raw = b.params['script'] ?? b.params['id'];
        const scriptId = typeof raw === 'string' ? raw : '';
        const slot: BehaviorSlot = { type: 'script', enabled: b.enabled, key, scriptId, instance: {} };
        slot.instance = { update: (_env, dt) => this.runScript(e, slot, dt) };
        slots.push(slot);
        return;
      }
      const def = BEHAVIORS[b.type];
      if (!def) {
        this.warnOnce(`unknown:${b.type}`, `unknown behavior '${b.type}' on ${e.id}`);
        return;
      }
      try {
        const instance = def.create(e, new ParamReader(def.params, b.params), random);
        slots.push({ type: b.type, enabled: b.enabled, key, instance });
      } catch (err) {
        this.log(`behavior ${b.type} on ${e.id} failed to start: ${errorText(err)}`);
      }
    });
    if (e.spec.npc) {
      try {
        slots.push({ type: 'npc-brain', enabled: true, key: npcKey(e.spec.npc), instance: this.npcs.createBrain(e, rng(this.seed ^ hashString(`${e.id}#npc`))) });
      } catch (err) {
        this.log(`npc brain on ${e.id} failed to start: ${errorText(err)}`);
      }
    }
    e.behaviors = slots;
  }

  private disposeBehaviors(e: RuntimeEntity): void {
    for (const slot of e.behaviors) {
      try {
        slot.instance.dispose?.(this);
      } catch (err) {
        this.log(`behavior ${slot.type} on ${e.id} failed to dispose: ${errorText(err)}`);
      }
    }
    e.behaviors = [];
  }

  private removeEntity(e: RuntimeEntity): void {
    this.disposeBehaviors(e);
    this.registry.remove(e.id);
    if (e.spawned) this.liveSpawned = Math.max(0, this.liveSpawned - 1);
    this.dropContacts(e.id);
  }

  private performReset(): void {
    this.resetPending = false;
    this.host.reset();
    for (const e of this.registry.all()) this.disposeBehaviors(e);
    this.rules.resetState();
    this.npcs.reset();
    this.spawnCounters.clear();
    this.spawnRandom = rng(this.seed ^ 0x5bd1e995);
    this.contacts.clear();
    this.active.clear();
    this.poseDirty.length = 0;
    this.keyEdges.clear();
    this.liveSpawned = 0;
    this.respawnPoint = undefined;
    this.clicks = [];
    this.uses = [];
    this.usedNow = EMPTY_USED;
    this.externalEvents = [];
    this._time = 0;
    this._status = 'playing';
    this.started = false;
    this.build(this.world);
    this.log('world reset');
  }

  // ---------------------------------------------------------------------------
  // Tick phases
  // ---------------------------------------------------------------------------

  private readInput(input: InputState): void {
    const s = this.inputState;
    s.forward = clampAxis(input?.forward);
    s.right = clampAxis(input?.right);
    s.jump = input?.jump === true;
    s.action = input?.action === true;
    const keys: unknown = input?.keys;
    s.keys = isKeySet(keys) ? keys : EMPTY_KEYS;
    const yaw = input?.pointerYawDeg;
    s.pointerYawDeg = typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : 0;
    s.fire = input?.fire === true;
    const pitch = input?.pitchDeg;
    s.pitchDeg = typeof pitch === 'number' && Number.isFinite(pitch) ? Math.max(-89, Math.min(89, pitch)) : 0;
    const aim: unknown = input?.aim;
    const a = aim as { origin?: unknown; dir?: unknown } | undefined;
    if (a && isVec3(a.origin) && isVec3(a.dir)) {
      copy3(this.aimScratch.origin, a.origin);
      copy3(this.aimScratch.dir, a.dir);
      s.aim = this.aimScratch;
    } else delete s.aim;
    this.keyEdges.update(s.keys);
  }

  private ingestEvents(events: readonly PhysicsEventLike[]): void {
    this.contacts.clear();
    if (!Array.isArray(events)) return;
    const n = Math.min(events.length, MAX_EVENTS_PER_TICK);
    for (let i = 0; i < n; i++) {
      const ev = events[i];
      if (!ev || typeof ev.a !== 'string' || typeof ev.b !== 'string') continue;
      switch (ev.type) {
        case 'collisionStart':
        case 'sensorEnter': {
          const kind = ev.type === 'collisionStart' ? 'collision' : 'sensor';
          const impulse = typeof ev.impulse === 'number' && Number.isFinite(ev.impulse) ? ev.impulse : 0;
          this.link(ev.a, ev.b);
          this.link(ev.b, ev.a);
          this.pushContact(ev.a, { other: ev.b, kind, impulse });
          this.pushContact(ev.b, { other: ev.a, kind, impulse });
          break;
        }
        case 'collisionEnd':
        case 'sensorExit':
          this.active.get(ev.a)?.delete(ev.b);
          this.active.get(ev.b)?.delete(ev.a);
          break;
      }
    }
  }

  private link(a: EntityId, b: EntityId): void {
    let s = this.active.get(a);
    if (!s) {
      if (this.active.size >= LIMITS.MAX_ENTITIES * 2) return;
      this.active.set(a, (s = new Set()));
    }
    if (s.size < 1024) s.add(b);
  }

  private pushContact(id: EntityId, c: ContactInfo): void {
    const list = this.contacts.get(id);
    if (list) {
      if (list.length < 256) list.push(c);
    } else this.contacts.set(id, [c]);
  }

  private dropContacts(id: EntityId): void {
    const s = this.active.get(id);
    if (s) for (const other of s) this.active.get(other)?.delete(id);
    this.active.delete(id);
  }

  private updateBehaviors(dt: number): void {
    if (this.npcs.count > 0) this.guard('npc tick', () => this.npcs.beginTick(dt));
    const list = this.registry.all();
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const e = list[i] as RuntimeEntity;
      const slots = e.behaviors;
      for (let j = 0; j < slots.length; j++) {
        if (!e.alive || this._status !== 'playing') break;
        const slot = slots[j] as BehaviorSlot;
        if (!slot.enabled || !slot.instance.update) continue;
        try {
          slot.instance.update(this, dt);
        } catch (err) {
          slot.enabled = false;
          this.log(`behavior ${slot.type} on ${e.id} disabled after error: ${errorText(err)}`);
        }
      }
    }
  }

  private flushPoses(): void {
    const q = this.quatScratch;
    for (const e of this.poseDirty) {
      if (!e.alive || e.dynamic) continue;
      e.composePose(q);
      this.host.setKinematic(e.id, e.outPos, e.outRot);
    }
    this.poseDirty.length = 0;
  }

  private drainScriptDiagnostics(): void {
    const take = this.scripts?.takeDiagnostics;
    if (!take) return;
    let diags;
    try {
      diags = take.call(this.scripts);
    } catch {
      return;
    }
    for (const d of diags) this.log(`script '${d.scriptId}'${d.entityId ? ` on ${d.entityId}` : ''}: ${d.text}`);
  }

  private guard(phase: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log(`internal error during ${phase}: ${errorText(err)}`);
    }
  }

  private warnOnce(key: string, text: string): void {
    if (this.warned.has(key) || this.warned.size > 256) return;
    this.warned.add(key);
    this.log(text);
  }

  // ---------------------------------------------------------------------------
  // Scripts
  // ---------------------------------------------------------------------------

  private runScript(e: RuntimeEntity, slot: BehaviorSlot, tickDt: number): void {
    const id = slot.scriptId ?? '';
    // Deterministic aggregate budget: at most MAX_SCRIPT_CALLS_PER_TICK calls,
    // rotating which slots run so none starves.
    const idx = this.scriptSeen++;
    const total = Math.max(this.scriptTotalPrev, idx + 1);
    if (total > MAX_SCRIPT_CALLS_PER_TICK && (idx - this.scriptRotation + total) % total >= MAX_SCRIPT_CALLS_PER_TICK) {
      slot.deferredDt = Math.min(MAX_SCRIPT_CATCHUP, (slot.deferredDt ?? 0) + tickDt);
      return;
    }
    const dt = Math.min(MAX_SCRIPT_CATCHUP, tickDt + (slot.deferredDt ?? 0));
    slot.deferredDt = 0;
    if (!this.scripts) {
      this.warnOnce(`norunner:${id}`, `script '${id}' on ${e.id} skipped: no ScriptRunner configured`);
      return;
    }
    if (!id || !hasOwn(this.world.scripts, id)) {
      this.warnOnce(`noscript:${e.id}:${id}`, `script '${id}' on ${e.id} not found in world.scripts`);
      return;
    }
    const intents = this.scripts.update(id, e.id, this.snapshot(e, dt), { worldJson: this.sharedWorldJson() });
    if (!Array.isArray(intents)) return;
    const ctx: ActionContext = { depth: 0, selfId: e.id };
    const n = Math.min(intents.length, 32);
    for (let i = 0; i < n; i++) {
      if (!e.alive) return;
      const checked = checkIntent(intents[i]);
      if (!checked.ok) {
        this.log(`script '${id}' on ${e.id}: intent rejected: ${checked.error}`);
        continue;
      }
      const intent = checked.intent;
      try {
        if (intent.do === 'moveTo') {
          moveToward(this, e, intent.target, intent.speed, dt, { flat: false, face: false });
        } else if (intent.do === 'setSelfState') {
          this.worldJson = null;
          writeState(this.scope, `${e.id}.${intent.key}`, intent.value);
        } else {
          const desc = executeAction(intent, this, ctx);
          if (intent.do !== 'setVelocity' && intent.do !== 'impulse' && intent.do !== 'setProperty') {
            this.log(`script '${id}' on ${e.id}: ${desc}`);
          }
        }
      } catch (err) {
        this.log(`script '${id}' on ${e.id}: ${intent.do} failed: ${errorText(err)}`);
      }
    }
  }

  /** Serialized world state for this tick (see {@link worldJson}); undefined when it cannot be serialized. */
  private sharedWorldJson(): string | undefined {
    if (this.worldJson === null) {
      try {
        this.worldJson = JSON.stringify(this.worldState);
      } catch {
        return undefined;
      }
    }
    return this.worldJson;
  }

  private snapshot(e: RuntimeEntity, dt: number): ScriptSnapshot {
    const p = this.positionOf(e.id) ?? e.basePos;
    const position: Vec3 = [p[0], p[1], p[2]];
    const v = this.host.getVelocity(e.id);
    const snap: ScriptSnapshot = {
      dt,
      time: this._time,
      self: { id: e.id, position, velocity: v ? [v[0], v[1], v[2]] : [0, 0, 0], state: e.state },
      world: this.worldState,
      nearby: this.nearby(e, position),
      input: { forward: this.inputState.forward, right: this.inputState.right, jump: this.inputState.jump, action: this.inputState.action },
    };
    const pid = this.playerId();
    const pp = pid !== undefined ? this.positionOf(pid) : undefined;
    if (pp) snap.player = { position: [pp[0], pp[1], pp[2]] };
    return snap;
  }

  /** Bucket live entities into the per-tick neighbour grid (O(n) once per tick). */
  private buildNearGrid(): void {
    for (const bucket of this.nearGrid.values()) {
      bucket.length = 0;
      this.nearPool.push(bucket);
    }
    this.nearGrid.clear();
    const list = this.registry.all();
    const n = Math.min(list.length, NEARBY_SCAN_LIMIT);
    for (let i = 0; i < n; i++) {
      const o = list[i] as RuntimeEntity;
      const q = this.positionOf(o.id);
      if (!q) continue;
      const key = cellKey(cellCoord(q[0]), cellCoord(q[1]), cellCoord(q[2]));
      let bucket = this.nearGrid.get(key);
      if (!bucket) {
        bucket = this.nearPool.pop() ?? [];
        this.nearGrid.set(key, bucket);
      }
      bucket.push(o);
    }
    this.nearGridTick = this.tickNo;
  }

  private nearby(self: RuntimeEntity, at: Readonly<Vec3>): ScriptSnapshot['nearby'] {
    if (this.nearGridTick !== this.tickNo) this.buildNearGrid();
    const found: Array<{ d: number; e: RuntimeEntity; p: Vec3 }> = [];
    const r2 = NEARBY_RADIUS * NEARBY_RADIUS;
    const cx = cellCoord(at[0]);
    const cy = cellCoord(at[1]);
    const cz = cellCoord(at[2]);
    const visited = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = cellKey(cx + dx, cy + dy, cz + dz);
          if (visited.has(key)) continue;
          visited.add(key);
          const bucket = this.nearGrid.get(key);
          if (!bucket) continue;
          for (const o of bucket) {
            if (o === self || !o.alive) continue;
            const q = this.positionOf(o.id);
            if (!q) continue;
            const ox = q[0] - at[0], oy = q[1] - at[1], oz = q[2] - at[2];
            const d = ox * ox + oy * oy + oz * oz;
            if (d <= r2) found.push({ d, e: o, p: [q[0], q[1], q[2]] });
          }
        }
      }
    }
    found.sort((a, b) => a.d - b.d || (a.e.id < b.e.id ? -1 : 1));
    return found.slice(0, NEARBY_MAX).map((f) => ({ id: f.e.id, tags: f.e.spec.tags.slice(0, 16), position: f.p }));
  }

  // ---------------------------------------------------------------------------
  // BehaviorEnv / RuleHost services
  // ---------------------------------------------------------------------------

  playing(): boolean {
    return this._status === 'playing';
  }

  log(text: string, rule?: string): LogEntry {
    const entry: LogEntry = rule === undefined ? { t: Math.round(this._time * 1000) / 1000, text } : { t: Math.round(this._time * 1000) / 1000, rule, text };
    // Fixed-size ring: O(1) per entry even when rules log every tick.
    this.ring[(this.ringHead + this.ringSize) % MAX_LOG_ENTRIES] = entry;
    if (this.ringSize < MAX_LOG_ENTRIES) this.ringSize++;
    else this.ringHead = (this.ringHead + 1) % MAX_LOG_ENTRIES;
    this.ringView = null;
    return entry;
  }

  /**
   * Trace entries, oldest first (at most {@link MAX_LOG_ENTRIES}). The array is
   * rebuilt lazily after new entries and reused between reads; treat it as read-only.
   */
  get entries(): LogEntry[] {
    if (this.ringView) return this.ringView;
    const out = new Array<LogEntry>(this.ringSize);
    for (let i = 0; i < this.ringSize; i++) out[i] = this.ring[(this.ringHead + i) % MAX_LOG_ENTRIES] as LogEntry;
    this.ringView = out;
    return out;
  }

  playerId(): EntityId | undefined {
    if (this.playerTick === this.tickNo) return this.playerCache;
    let id: EntityId | undefined;
    try {
      const h = this.host.playerId();
      id = typeof h === 'string' && h.length > 0 ? h : undefined;
    } catch {
      id = undefined;
    }
    if (id === undefined && this.defaultPlayer !== undefined && this.registry.has(this.defaultPlayer)) id = this.defaultPlayer;
    this.playerCache = id;
    this.playerTick = this.tickNo;
    return id;
  }

  entity(id: EntityId): RuntimeEntity | undefined {
    return this.registry.get(id);
  }

  positionOf(id: EntityId): Readonly<Vec3> | undefined {
    const e = this.registry.get(id);
    if (e && !e.dynamic && e.hasPose) return e.outPos;
    const cached = this.hostPos.get(id);
    if (cached) return cached;
    const t = this.host.getTransform(id);
    if (t && Array.isArray(t.position)) {
      this.hostPos.set(id, t.position);
      return t.position;
    }
    return e ? (e.hasPose ? e.outPos : e.basePos) : undefined;
  }

  velocityOf(id: EntityId): Vec3 | undefined {
    return this.host.getVelocity(id);
  }

  resolve(selector: string): readonly EntityId[] {
    return this.registry.resolve(selector, this.playerId(), this.resolveScratch);
  }

  /** Fresh-array resolution for rule/action code (safe across nested calls). */
  select(selector: string): EntityId[] {
    return this.registry.resolve(selector, this.playerId());
  }

  matches(id: EntityId, selector: string): boolean {
    return this.registry.matches(id, selector, this.playerId());
  }

  movers(): readonly EntityId[] {
    if (this.moversTick === this.tickNo) return this.moversList;
    this.moversTick = this.tickNo;
    const out = this.moversList;
    out.length = 0;
    for (const e of this.registry.all()) if (e.dynamic) out.push(e.id);
    const pid = this.playerId();
    if (pid !== undefined && !out.includes(pid)) out.push(pid);
    return out;
  }

  private frameOf(zone: RuntimeEntity): { pos: Readonly<Vec3>; rot: Readonly<QuatTuple> } {
    if (zone.dynamic) {
      const cached = this.zoneFrames.get(zone.id);
      if (cached) return cached;
      const t = this.host.getTransform(zone.id);
      if (t) {
        const frame = { pos: t.position, rot: t.quaternion };
        this.zoneFrames.set(zone.id, frame);
        return frame;
      }
    }
    return zone.hasPose ? { pos: zone.outPos, rot: zone.outRot } : { pos: zone.basePos, rot: zone.baseRot };
  }

  touching(zone: RuntimeEntity, otherId: EntityId, margin: number): boolean {
    if (this.active.get(zone.id)?.has(otherId)) return true;
    const p = this.positionOf(otherId);
    if (!p) return false;
    const f = this.frameOf(zone);
    return insideZone(zone.zone, f.pos, f.rot, p, margin);
  }

  onTopOf(zone: RuntimeEntity, otherId: EntityId, height: number): boolean {
    if (this.active.get(zone.id)?.has(otherId)) return true;
    const p = this.positionOf(otherId);
    if (!p) return false;
    const f = this.frameOf(zone);
    return onTopOfZone(zone.zone, f.pos, f.rot, p, height);
  }

  inZone(zoneId: EntityId, whoId: EntityId): boolean {
    const zone = this.registry.get(zoneId);
    return zone !== undefined && this.touching(zone, whoId, 0);
  }

  contactsOf(id: EntityId): readonly ContactInfo[] {
    return this.contacts.get(id) ?? EMPTY_CONTACTS;
  }

  pose(self: RuntimeEntity): void {
    if (self.poseTick === this.tickNo) return;
    self.poseTick = this.tickNo;
    self.offset[0] = 0;
    self.offset[1] = 0;
    self.offset[2] = 0;
    self.extraRot[0] = 0;
    self.extraRot[1] = 0;
    self.extraRot[2] = 0;
    self.extraRot[3] = 1;
    this.poseDirty.push(self);
  }

  setState(key: string, value: Json): string {
    this.worldJson = null;
    const before = writeState(this.scope, key, value);
    return `${key} ${showValue(before)}→${showValue(value)}`;
  }

  addState(key: string, amount: number): string {
    const cur = readState(this.scope, key);
    if (cur !== undefined && typeof cur !== 'number') throw new Error(`'${key}' is not a number (${showValue(cur)})`);
    const next = (cur ?? 0) + amount;
    if (!Number.isFinite(next)) throw new Error(`'${key}' would become non-finite`);
    this.worldJson = null;
    writeState(this.scope, key, next);
    return `${key} ${showValue(cur)}→${showValue(next)}`;
  }

  spawn(template: EntityId, at: Vec3 | string | undefined, count: number, spread: number, ctx: ActionContext = { depth: 0 }): EntityId[] {
    const tpl = lookupEntity(this.world.entities, template);
    if (!tpl) throw new Error(`unknown template '${template}'`);
    const n = Math.max(0, Math.min(Math.floor(Number.isFinite(count) ? count : 1), 500));
    const radius = Number.isFinite(spread) && spread > 0 ? Math.min(spread, 1000) : 0;
    let base: Vec3;
    if (at === undefined) base = this.worldPose(tpl).pos;
    else {
      const loc = locate(this, at, ctx);
      if (!loc) throw new Error(`spawn location '${String(at)}' not found`);
      base = loc;
    }
    const ids: EntityId[] = [];
    for (let i = 0; i < n; i++) {
      if (this.spawnedThisTick >= MAX_SPAWNS_PER_TICK || this.liveSpawned >= MAX_LIVE_SPAWNED || this.registry.size >= LIMITS.MAX_ENTITIES) {
        this.warnOnce(`spawncap:${this.tickNo}`, `spawn limit reached (≤${MAX_SPAWNS_PER_TICK}/tick, ≤${MAX_LIVE_SPAWNED} alive)`);
        break;
      }
      const pos: Vec3 = [base[0], base[1], base[2]];
      if (radius > 0) {
        const a = this.spawnRandom() * Math.PI * 2;
        const r = Math.sqrt(this.spawnRandom()) * radius;
        pos[0] += Math.cos(a) * r;
        pos[2] += Math.sin(a) * r;
      }
      const id = this.nextSpawnId(template);
      // The template is part of the validated WorldDoc (plain JSON data): a
      // structured clone is enough; hosts may skip re-validation (trusted spawn).
      const clone = structuredClone(tpl);
      clone.id = id;
      clone.template = false;
      clone.parent = null;
      clone.transform.position = pos;
      this.addEntity(clone, true, pos);
      this.spawnedThisTick++;
      this.liveSpawned++;
      ids.push(id);
      this.host.spawn(clone);
    }
    return ids;
  }

  private nextSpawnId(template: string): EntityId {
    let n = this.spawnCounters.get(template) ?? 0;
    for (;;) {
      n++;
      const suffix = `-${n}`;
      const id = `${template.slice(0, 64 - suffix.length)}${suffix}`;
      if (!this.registry.has(id) && !hasOwn(this.world.entities, id)) {
        this.spawnCounters.set(template, n);
        return id;
      }
    }
  }

  destroy(id: EntityId): void {
    const e = this.registry.get(id);
    if (!e) return;
    this.removeEntity(e);
    this.host.destroy(id);
  }

  emit(event: string, delay = 0, ctx: ActionContext = { depth: 0 }): void {
    this.rules.emit(event, delay, ctx);
  }

  gameOver(result: 'win' | 'lose', text: string, why: string): void {
    if (this._status !== 'playing') return;
    this._status = result === 'win' ? 'won' : 'lost';
    this.log(`${result === 'win' ? 'WIN' : 'LOSE'}: "${text}" (${why})`);
    const pid = this.playerId();
    this.sendFeedback(result === 'win' ? 'win' : 'death', pid !== undefined ? this.positionOf(pid) : undefined, { target: pid });
    this.host.gameOver(result, text);
  }

  teleport(id: EntityId, p: Readonly<Vec3>): void {
    this.host.teleport(id, p as Vec3);
    this.hostPos.delete(id);
    const e = this.registry.get(id);
    if (e && !e.dynamic) {
      copy3(e.anchor, p);
      this.pose(e);
    }
  }

  setVelocity(id: EntityId, v: Readonly<Vec3>): void {
    this.host.setVelocity(id, v as Vec3);
  }

  impulse(id: EntityId, v: Readonly<Vec3>): void {
    this.host.applyImpulse(id, v as Vec3);
  }

  setProperty(id: EntityId, path: string, value: Json): void {
    this.host.setProperty(id, path, value);
  }

  enableBehavior(id: EntityId, behavior: string, enabled: boolean): number {
    const e = this.registry.get(id);
    if (!e) return 0;
    let n = 0;
    for (const slot of e.behaviors) {
      if (behavior === '*' || slot.type === behavior || (slot.type === 'script' && behavior === `script:${slot.scriptId ?? ''}`)) {
        slot.enabled = enabled;
        n++;
      }
    }
    return n;
  }

  explode(center: Readonly<Vec3>, force: number, radius: number): void {
    this.host.explode(center as Vec3, force, radius);
    this.sendFeedback('explosion', center, { intensity: Math.min(2, Math.max(0.3, radius / 5)) });
  }

  setGravity(v: Readonly<Vec3>): void {
    this.host.setGravity(v as Vec3);
  }

  message(text: string, duration: number): void {
    this.host.message(text, duration);
  }

  sound(name: string): void {
    this.host.sound(name);
  }

  /** Reused feedback record (the host copies what it keeps). */
  private readonly fbEvent: FeedbackEvent = { kind: null, tick: 0, time: 0 };
  private readonly fbAt: Vec3 = [0, 0, 0];

  /**
   * Hand a feel event to the host. Presentation only: nothing is read back and a throwing host cannot disturb the
   * tick, so the simulation is identical with or without a feel layer (a test runs both).
   */
  private sendFeedback(kind: FeelEvent | null, at: Readonly<Vec3> | undefined, opts: { source?: EntityId | undefined; target?: EntityId | undefined; amount?: number | undefined; intensity?: number | undefined; vfx?: VfxPreset | 'none' | undefined; color?: string | undefined; scale?: number | undefined }): void {
    const fn = this.host.feedback;
    if (typeof fn !== 'function') return;
    const ev = this.fbEvent;
    ev.kind = kind;
    ev.tick = this.tickNo;
    ev.time = this._time;
    if (at && Number.isFinite(at[0]) && Number.isFinite(at[1]) && Number.isFinite(at[2])) {
      copy3(this.fbAt, at);
      ev.at = this.fbAt;
    } else delete ev.at;
    if (opts.source !== undefined) ev.source = opts.source;
    else delete ev.source;
    if (opts.target !== undefined) ev.target = opts.target;
    else delete ev.target;
    if (opts.amount !== undefined && Number.isFinite(opts.amount)) ev.amount = opts.amount;
    else delete ev.amount;
    if (opts.intensity !== undefined && Number.isFinite(opts.intensity)) ev.intensity = opts.intensity;
    else delete ev.intensity;
    if (opts.vfx !== undefined) ev.vfx = opts.vfx;
    else delete ev.vfx;
    if (opts.color !== undefined) ev.color = opts.color;
    else delete ev.color;
    if (opts.scale !== undefined) ev.scale = opts.scale;
    else delete ev.scale;
    try {
      fn.call(this.host, ev);
    } catch {
      // A failing presentation layer must never change the game.
    }
  }

  feedback(kind: FeelEvent, at: Readonly<Vec3> | undefined, opts: { source?: EntityId; target?: EntityId; amount?: number; intensity?: number } = {}): void {
    this.sendFeedback(kind, at, opts);
  }

  effect(vfx: VfxPreset | 'none', at: Readonly<Vec3> | undefined, feel: FeelEvent | undefined, color: string | undefined, scale: number | undefined): void {
    this.sendFeedback(feel ?? null, at, { vfx, color, scale });
  }

  requestReset(): void {
    this.resetPending = true;
  }
}

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** Hot-reload key of an entity's NPC spec. */
function npcKey(npc: unknown): string {
  return `npc:${stableStringify(npc)}`;
}

/** Accept any iterable set-like (e.g. a ReadonlySet from another realm). */
function isKeySet(v: unknown): v is ReadonlySet<string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { size?: unknown }).size === 'number' &&
    typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}
