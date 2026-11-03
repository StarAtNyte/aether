/**
 * The NPC system: owns every brain of a running world, the shared navigation
 * grids, noise, speech bubbles, the single active conversation and the
 * player-facing talk prompt. One instance per logic engine.
 */
import { worldTransform, type DialogueEffect, type EntityId, type Json, type NpcMode, type NpcSpec, type Vec3, type WorldDoc } from '@aether/core';
import type { BehaviorEnv, BehaviorInstance } from '../behaviors/types';
import type { RuntimeEntity } from '../entities';
import { NpcBrain, type NpcInfo } from './brain';
import { DialogueSession, type DialogueHost, type DialogueView } from './dialogue';
import { resolveNpc, type NpcEff } from './graph';
import type { NavGrid } from './nav';
import { hasBuildings, NavLayers, type LayerPoint } from './layers';
import { buildNavFor, npcOpensDoor, type BoundsProvider } from './obstacles';
import { flockAdd, flockReset, flockSteer, type FlockSums } from './steering';
import { hyp } from './math';

/** Speech bubbles shown at once. */
export const MAX_BUBBLES = 6;
/** Most NPC brains one world runs (the rest are inert). */
export const MAX_NPCS = 400;
/** Most grids kept (level × agent size). */
const MAX_GRIDS = 6;
/** Neighbour hash cell (m). */
const HASH_CELL = 3;
/** Separation radius between NPCs (m). */
const SEPARATE = 1.0;

/** What the system needs from the engine. */
export interface NpcContext {
  env: BehaviorEnv;
  world(): WorldDoc;
  bounds: BoundsProvider;
}

/** A line floating above (or captioning) an NPC. */
export interface NpcBubble {
  npc: EntityId;
  name: string;
  text: string;
  kind: 'bark' | 'line';
  /** Simulation time the bubble expires. */
  until: number;
  /** Head position in world space. */
  x: number;
  y: number;
  z: number;
}

/** The "press E to talk" hint. */
export interface TalkPrompt {
  npc: EntityId;
  name: string;
  distance: number;
}

const SKY_HOURS: Readonly<Record<string, number>> = { day: 12, dawn: 6.5, sunset: 17.5, night: 22, overcast: 12, space: 12, studio: 12 };
const sepOut: [number, number] = [0, 0];
const flockOut = new Float64Array(2);
const flockSums: FlockSums = { n: 0, px: 0, pz: 0, hx: 0, hz: 0 };
/** Neighbours a flocking character keeps with (m). */
const FLOCK_RADIUS = 5;
/** An NPC within this of a door (plan, m) holds it open; for this long after (s). */
const DOOR_REACH = 1.4;
const DOOR_HOLD = 0.8;
/** Most doors NPCs open (the rest stay as they are). */
const MAX_NPC_DOORS = 128;

/** Keys that choose dialogue options, in order. */
const CHOICE_KEYS = ['1', '2', '3', '4', '5', '6'];

/** Runtime of all NPCs in one world. */
export class NpcSystem implements DialogueHost {
  /** Live brains in creation order. */
  readonly brains: NpcBrain[] = [];
  tickNo = 0;
  /** Bumps whenever navigation data became stale (brains rebuild their grid reference). */
  navVersion = 0;
  private readonly byId = new Map<EntityId, NpcBrain>();
  private readonly grids = new Map<string, NavGrid>();
  /** Layered navigation per body size (null: the world has no stairs, single-floor grids do). */
  private readonly layerSets = new Map<string, NavLayers | null>();
  private stairsKnown: boolean | null = null;
  /** Doors NPCs open as they pass (key-operated `door` behaviours), with their positions; null until first needed. */
  private doorIds: EntityId[] | null = null;
  private readonly doorPos = new Float64Array(MAX_NPC_DOORS * 3);
  private readonly effCache = new WeakMap<NpcSpec, NpcEff>();
  private nextIndex = 0;
  // --- dialogue ---------------------------------------------------------------------
  private session: DialogueSession | null = null;
  private sessionBrain: NpcBrain | null = null;
  private readonly usedChoices = new Map<EntityId, Set<string>>();
  private promptOut: TalkPrompt = { npc: '', name: '', distance: 0 };
  private promptOn = false;
  private cooldown = 0;
  // --- bubbles ----------------------------------------------------------------------
  private readonly slots: NpcBubble[] = [];
  private liveN = 0;
  // --- noise / player tracking --------------------------------------------------------
  private px = Number.NaN;
  private pz = Number.NaN;
  /** The player's feet this tick (NaN without a player): NPCs make way for them on stairs. */
  playerX = Number.NaN;
  playerY = Number.NaN;
  playerZ = Number.NaN;
  private noise = 0;
  private hourTick = -1;
  private hourVal = 12;
  // --- neighbour hash ------------------------------------------------------------------
  private readonly hash = new Map<number, Bucket>();
  private readonly buckets: Bucket[] = [];
  /** World damage taken by the player from NPCs this session (diagnostics). */
  playerDamage = 0;

  constructor(private readonly ctx: NpcContext) {
    for (let i = 0; i < MAX_BUBBLES; i++) this.slots.push({ npc: '', name: '', text: '', kind: 'bark', until: -1, x: 0, y: 0, z: 0 });
  }

  /** The behaviour environment (the logic engine). */
  get env(): BehaviorEnv {
    return this.ctx.env;
  }

  // ---------------------------------------------------------------------------
  // Brain lifecycle
  // ---------------------------------------------------------------------------

  /** Create the brain of `e` (called by the engine for entities with `npc`). */
  createBrain(e: RuntimeEntity, random: () => number): BehaviorInstance {
    if (this.brains.length >= MAX_NPCS) return {};
    const brain = new NpcBrain(e, this, random, this.nextIndex++);
    this.brains.push(brain);
    this.byId.set(e.id, brain);
    if (this.grids.size > 0) {
      // A late arrival may stand outside the area the grids cover.
      const first = this.grids.values().next().value as NavGrid | undefined;
      if (first && first.index(e.anchor[0], e.anchor[2]) < 0) this.invalidate();
    }
    return brain;
  }

  /** Drop a disposed brain. */
  forget(b: NpcBrain): void {
    const i = this.brains.indexOf(b);
    if (i >= 0) this.brains.splice(i, 1);
    if (this.byId.get(b.id) === b) this.byId.delete(b.id);
    if (this.sessionBrain === b) this.endDialogue();
  }

  /** Live brain of an entity. */
  brainOf(id: EntityId): NpcBrain | undefined {
    return this.byId.get(id);
  }

  /** Resolve (and cache) the effective parameters of a spec. */
  effective(spec: NpcSpec): NpcEff {
    let eff = this.effCache.get(spec);
    if (!eff) {
      eff = resolveNpc(spec);
      this.effCache.set(spec, eff);
    }
    return eff;
  }

  /** Static geometry changed (hot reload): grids are rebuilt on demand. */
  invalidate(): void {
    this.grids.clear();
    this.layerSets.clear();
    this.stairsKnown = null;
    this.doorIds = null;
    this.navVersion++;
  }

  /** Clear transient state (a world reset). */
  reset(): void {
    this.endDialogue();
    this.usedChoices.clear();
    for (const b of this.slots) b.until = -1;
    this.liveN = 0;
    this.px = Number.NaN;
    this.cooldown = 0;
    this.promptOn = false;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Entity pivots are centred for primitives and at the feet for generated/asset shapes. */
  feetGuess(self: RuntimeEntity, y: number): number {
    if (self.spec.shape.kind === 'primitive') return y - self.zone.half[1];
    return y;
  }

  /** The navigation grid for a brain's floor level and body size (built on first use). */
  gridFor(b: NpcBrain): NavGrid | null {
    const spec = b.spec;
    const level = Math.round(b.feetY / 1.5);
    const rKey = Math.round(spec.radius * 4);
    const key = `${level}|${rKey}|${Math.round(spec.height * 2)}`;
    const have = this.grids.get(key);
    if (have) return have;
    if (this.grids.size >= MAX_GRIDS) return null;
    const world = this.ctx.world();
    const points: Vec3[] = [];
    for (const o of this.brains) {
      if (Math.round(o.feetY / 1.5) !== level) continue;
      points.push([o.self.anchor[0], 0, o.self.anchor[2]]);
      for (const w of o.spec.waypoints) points.push(w);
    }
    points.push(world.player.spawn);
    if (points.length === 0) return null;
    try {
      const grid = buildNavFor(world, { refY: level * 1.5, radius: spec.radius, height: spec.height, points }, this.ctx.bounds);
      this.grids.set(key, grid);
      return grid;
    } catch (err) {
      this.ctx.env.log(`navigation grid failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * The floors and stairs for a brain's body size, when the world has buildings (built on first use, shared by every
   * NPC of that size); null otherwise (each floor level gets its own grid from {@link gridFor}, as before).
   */
  layersFor(b: NpcBrain): NavLayers | null {
    const world = this.ctx.world();
    if (this.stairsKnown === null) {
      this.stairsKnown = hasBuildings(world);
    }
    if (!this.stairsKnown) return null;
    const spec = b.spec;
    const key = `${Math.round(spec.radius * 4)}|${Math.round(spec.height * 2)}`;
    if (this.layerSets.has(key)) return this.layerSets.get(key) ?? null;
    const points: LayerPoint[] = [];
    for (const o of this.brains) {
      if (`${Math.round(o.spec.radius * 4)}|${Math.round(o.spec.height * 2)}` !== key) continue;
      points.push({ x: o.self.anchor[0], y: o.feetY, z: o.self.anchor[2] });
      for (const w of o.spec.waypoints) points.push({ x: w[0], y: w[1], z: w[2] });
      for (const r of o.spec.routine ?? []) points.push({ x: r.at[0], y: r.at[1], z: r.at[2] });
    }
    let layers: NavLayers | null = null;
    try {
      layers = NavLayers.build(world, { radius: spec.radius, height: spec.height, points }, this.ctx.bounds);
    } catch (err) {
      this.ctx.env.log(`navigation layers failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.layerSets.set(key, layers);
    return layers;
  }

  /** A walking NPC opens the doors it passes (holds them open a moment; see the `door` behaviour). */
  holdDoorsNear(b: NpcBrain): void {
    let ids = this.doorIds;
    if (ids === null) {
      ids = [];
      const world = this.ctx.world();
      for (const id of Object.keys(world.entities)) {
        if (ids.length >= MAX_NPC_DOORS) break;
        const e = world.entities[id];
        if (!e || e.template || !npcOpensDoor(e)) continue;
        try {
          const p = worldTransform(world, id).position;
          const k = ids.length * 3;
          this.doorPos[k] = p[0];
          this.doorPos[k + 1] = p[1];
          this.doorPos[k + 2] = p[2];
          ids.push(id);
        } catch {
          // An entity without a transform chain is skipped.
        }
      }
      this.doorIds = ids;
    }
    if (ids.length === 0) return;
    const env = this.ctx.env;
    const x = b.x;
    const z = b.z;
    const feet = b.feetY;
    for (let i = 0; i < ids.length; i++) {
      const k = i * 3;
      const dx = (this.doorPos[k] as number) - x;
      const dz = (this.doorPos[k + 2] as number) - z;
      if (dx * dx + dz * dz > DOOR_REACH * DOOR_REACH) continue;
      // The leaf's pivot is at its foot or its middle: within a storey of the feet.
      const dy = (this.doorPos[k + 1] as number) - feet;
      if (dy < -0.5 || dy > 2.2) continue;
      const door = env.entity(ids[i] as EntityId);
      if (door) door.npcHoldUntil = env.time + DOOR_HOLD;
    }
  }

  /** Ground height under (x, z) from the host (a ray cast), or undefined. */
  groundHeight(x: number, z: number, fromY: number, exclude?: EntityId): number | undefined {
    const host = this.ctx.env.host;
    return host.groundHeight?.(x, z, fromY, exclude);
  }

  /** Steering push away from nearby NPCs; the returned pair is reused. */
  separation(b: NpcBrain): readonly [number, number] {
    const x = b.x;
    const z = b.z;
    sepOut[0] = 0;
    sepOut[1] = 0;
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.hash.get(hashKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.n; i++) {
          const o = bucket.items[i] as NpcBrain;
          if (o === b || o.layer !== b.layer) continue;
          const ox = x - o.x;
          const oz = z - o.z;
          const d = hyp(ox, oz);
          if (d >= SEPARATE) continue;
          const k = (1 - d / SEPARATE) / Math.max(d, 0.05);
          sepOut[0] += ox * k;
          sepOut[1] += oz * k;
        }
      }
    }
    return sepOut;
  }

  /**
   * Cohesion and alignment with nearby characters of the same faction on the same floor (a herd, a pack); the
   * returned pair is reused. Zero without neighbours.
   */
  flock(b: NpcBrain): Float64Array {
    flockReset(flockSums);
    const cx = Math.floor(b.x / HASH_CELL);
    const cz = Math.floor(b.z / HASH_CELL);
    const r2 = FLOCK_RADIUS * FLOCK_RADIUS;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = this.hash.get(hashKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.n; i++) {
          const o = bucket.items[i] as NpcBrain;
          if (o === b || o.layer !== b.layer || o.spec.faction !== b.spec.faction) continue;
          const ox = o.x - b.x;
          const oz = o.z - b.z;
          if (ox * ox + oz * oz > r2) continue;
          flockAdd(flockSums, o.x, o.z, o.headingX, o.headingZ);
        }
      }
    }
    flockSteer(flockSums, b.x, b.z, flockOut);
    return flockOut;
  }

  private rebuildHash(): void {
    // Buckets persist between ticks and are refilled by index: `length = 0` would free their storage.
    const list = this.buckets;
    for (let i = 0; i < list.length; i++) (list[i] as Bucket).n = 0;
    if (this.tickNo % 900 === 0 && list.length > this.brains.length * 4 + 16) {
      this.hash.clear();
      list.length = 0;
    }
    for (const b of this.brains) {
      if (b.dead) continue;
      const key = hashKey(Math.floor(b.x / HASH_CELL), Math.floor(b.z / HASH_CELL));
      let bucket = this.hash.get(key);
      if (!bucket) {
        bucket = { n: 0, items: [] };
        this.hash.set(key, bucket);
        list.push(bucket);
      }
      bucket.items[bucket.n++] = b;
    }
  }

  // ---------------------------------------------------------------------------
  // World facts
  // ---------------------------------------------------------------------------

  /** Hour of day: a `timeOfDay` world state wins, then the environment. */
  hour(): number {
    if (this.hourTick === this.tickNo) return this.hourVal;
    this.hourTick = this.tickNo;
    const live = this.ctx.env.readState('timeOfDay');
    if (typeof live === 'number' && Number.isFinite(live)) this.hourVal = ((live % 24) + 24) % 24;
    else {
      const env = this.ctx.world().environment;
      this.hourVal = env.timeOfDay ?? SKY_HOURS[env.sky] ?? 12;
    }
    return this.hourVal;
  }

  /** Multiplier on sight range: darkness hampers everyone except hunters and light carriers. */
  sightFactor(b: NpcBrain): number {
    if (b.spec.archetype === 'predator') return 1;
    const h = this.hour();
    const night = h >= 20.5 || h < 5;
    if (!night) return 1;
    return b.spec.carries.includes('torch') || b.spec.carries.includes('lantern') ? 1 : 0.7;
  }

  /** Radius within which `b` hears the player right now (m). */
  hearingRadius(b: NpcBrain): number {
    return b.spec.perception.hearing * this.noise;
  }

  /** Read a world/entity state value for conditions. */
  readValue(key: string): string | number | boolean | null | undefined {
    const v = this.ctx.env.readState(key);
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null ? v : undefined;
  }

  /** Make a noise at (x, z): hostile-capable NPCs within `radius` hear it. */
  makeNoise(x: number, z: number, radius: number, source: NpcBrain | null, y = Number.NaN): void {
    const r2 = radius * radius;
    for (const o of this.brains) {
      if (o === source || o.dead) continue;
      const dx = o.x - x;
      const dz = o.z - z;
      if (dx * dx + dz * dz <= r2 && (source === null || o.isHostileTo(source))) o.hear(x, z, y);
    }
  }

  /** `from` spotted a foe: allies within its alert radius learn where. */
  alertAllies(from: NpcBrain, x: number, z: number): void {
    const r = from.eff.alert;
    const r2 = r * r;
    const t = from.targetRef;
    const kind = t.kind;
    const id = t.id;
    for (const o of this.brains) {
      if (o === from || o.dead) continue;
      if (o.spec.faction !== from.spec.faction && !from.eff.allies.has(o.spec.faction)) continue;
      const dx = o.x - from.x;
      const dz = o.z - from.z;
      if (dx * dx + dz * dz <= r2) o.warn(x, z, kind, id, from.targetY);
    }
  }

  /** A blow lands: damage the player or another NPC and make a noise. */
  hit(from: NpcBrain, kind: number, id: EntityId | null, damage: number): void {
    const env = this.ctx.env;
    if (kind === 1) {
      const cur = env.readState('health');
      const hp = typeof cur === 'number' && Number.isFinite(cur) ? cur : 100;
      const next = Math.max(0, hp - damage);
      this.playerDamage += hp - next;
      env.setState('health', next);
      const pid = env.playerId();
      env.feedback('damage', pid !== undefined ? env.positionOf(pid) : undefined, { source: from.id, ...(pid !== undefined ? { target: pid } : {}), amount: -(hp - next) });
      env.host.sound('hit');
      env.log(`npc ${from.id} hits the player for ${damage} (health ${hp}→${next})`);
      if (next <= 0) env.gameOver('lose', `${this.nameOf(from)} brought you down`, `npc ${from.id} attack`);
    } else if (kind === 2 && id !== null) {
      const o = this.byId.get(id);
      if (o && !o.dead) {
        const cur = o.self.state['health'];
        o.self.state['health'] = (typeof cur === 'number' ? cur : o.hp) - damage;
        env.feedback('hit', env.positionOf(id), { source: from.id, target: id, amount: -damage });
        env.log(`npc ${from.id} hits ${id} for ${damage}`);
      }
    }
    this.makeNoise(from.x, from.z, 10, from, from.feetY);
  }

  /**
   * A ranged attack (`attack.ranged`): a muzzle flash at the shooter's hands, then either the blow lands
   * ({@link hit}) or the shot strikes the ground beside the target. Either way it makes the noise of a shot.
   */
  shoot(from: NpcBrain, kind: number, id: EntityId | null, damage: number, lands: boolean): void {
    const env = this.ctx.env;
    const hx = from.headingX;
    const hz = from.headingZ;
    const muzzle: Vec3 = [from.x + hx * 0.75, from.feetY + from.spec.height * 0.75, from.z + hz * 0.75];
    env.effect?.('muzzle', muzzle, undefined, '#ffc477', 0.6);
    env.host.sound('enemy-shot');
    if (lands) {
      this.hit(from, kind, id, damage);
      return;
    }
    const tid = kind === 1 ? env.playerId() : id;
    const tp = tid !== undefined && tid !== null ? env.positionOf(tid) : undefined;
    if (tp) {
      // A miss kicks up dirt a little way off the target, on the shooter's side.
      const dx = tp[0] - from.x;
      const dz = tp[2] - from.z;
      const d = Math.max(0.01, hyp(dx, dz));
      const side = (this.tickNo + from.index) % 2 === 0 ? 1 : -1;
      const at: Vec3 = [tp[0] - (dx / d) * 0.6 + (-dz / d) * 0.7 * side, from.feetY + 0.05, tp[2] - (dz / d) * 0.6 + (dx / d) * 0.7 * side];
      env.effect?.('impact', at, undefined, '#c9b79a', 0.6);
    }
    this.makeNoise(from.x, from.z, 14, from, from.feetY);
  }

  /** A telegraphed melee blow begins (`attack.windup`): a warning sound and a burst at the attacker, so the player can react. */
  telegraph(from: NpcBrain): void {
    const env = this.ctx.env;
    env.host.sound('warn');
    env.effect?.('shockwave', [from.x, from.feetY + 1.1, from.z], undefined, '#ff5a3a', 0.6);
  }

  /** An NPC died. */
  onDeath(b: NpcBrain): void {
    if (this.sessionBrain === b) this.endDialogue();
  }

  /** Deal damage to an NPC from outside (rules, scripts, tools). */
  damage(id: EntityId, amount: number): boolean {
    const b = this.byId.get(id);
    if (!b || b.dead || !Number.isFinite(amount)) return false;
    const cur = b.self.state['health'];
    b.self.state['health'] = (typeof cur === 'number' ? cur : b.hp) - amount;
    return true;
  }

  private nameOf(b: NpcBrain): string {
    return b.self.spec.name || b.spec.role || b.id;
  }

  // ---------------------------------------------------------------------------
  // Speech
  // ---------------------------------------------------------------------------

  /** Show a line above an NPC (a bark). */
  say(b: NpcBrain, text: string, kind: 'bark' | 'line'): void {
    const t = this.ctx.env.time;
    let slot: NpcBubble | undefined;
    for (const s of this.slots) if (s.npc === b.id && s.until > t) slot = s;
    if (!slot) slot = this.slots.find((s) => s.until <= t);
    if (!slot) {
      slot = this.slots[0] as NpcBubble;
      for (const s of this.slots) if (s.until < slot.until) slot = s;
    }
    slot.npc = b.id;
    slot.name = this.nameOf(b);
    slot.text = text.slice(0, 160);
    slot.kind = kind;
    slot.until = t + 2.4 + Math.min(3, text.length * 0.045);
    this.placeBubble(slot, b);
  }

  private placeBubble(s: NpcBubble, b: NpcBrain): void {
    s.x = b.x;
    s.z = b.z;
    s.y = b.feetY + b.spec.height + 0.35;
  }

  /** Number of active bubbles (the first `bubbleCount` entries of {@link bubbleAt}). */
  get bubbleCount(): number {
    return this.liveN;
  }

  /** Active bubble `i` (< `bubbleCount`); the object is reused by the system. */
  bubbleAt(i: number): NpcBubble | undefined {
    return i >= 0 && i < this.liveN ? this.slots[i] : undefined;
  }

  /** Active bubbles as a fresh array (for UI code that runs a few times a second). */
  activeBubbles(): NpcBubble[] {
    return this.slots.slice(0, this.liveN);
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /** Per-tick bookkeeping before the brains update. */
  beginTick(dt: number): void {
    this.tickNo++;
    const env = this.ctx.env;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.trackPlayerNoise(dt);
    this.rebuildHash();
    // Live bubbles follow their speakers and expire.
    // Compact the live bubbles to the front of the slot array (stable, no allocation).
    const t = env.time;
    let n = 0;
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] as NpcBubble;
      if (s.until <= t) continue;
      const b = this.byId.get(s.npc);
      if (b) this.placeBubble(s, b);
      if (n !== i) {
        slots[i] = slots[n] as NpcBubble;
        slots[n] = s;
      }
      n++;
    }
    this.liveN = n;
    if (this.session) this.handleDialogue();
    else this.handleTalkStart();
  }

  private trackPlayerNoise(dt: number): void {
    const env = this.ctx.env;
    const pid = env.playerId();
    const pp = pid !== undefined ? env.positionOf(pid) : undefined;
    if (!pp) {
      this.noise = 0;
      this.playerX = this.playerY = this.playerZ = Number.NaN;
      return;
    }
    this.playerX = pp[0];
    this.playerY = pp[1];
    this.playerZ = pp[2];
    if (!Number.isNaN(this.px) && dt > 1e-6) {
      const speed = hyp(pp[0] - this.px, pp[2] - this.pz) / dt;
      // Relative to the player's top speed: full pace is loud, a sneak (half pace) is quiet, standing still is silent.
      const loud = this.ctx.world().player.moveSpeed * 0.7;
      this.noise = speed > loud ? 1 : speed > 0.8 ? 0.4 : 0;
    }
    if (env.input.jump) this.noise = Math.max(this.noise, 0.6);
    this.px = pp[0];
    this.pz = pp[2];
  }

  // ---------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------

  /** The running conversation's view, or null. The object is reused (see `version`). */
  get dialogue(): DialogueView | null {
    return this.session && !this.session.ended ? this.session.view : null;
  }

  /** The "talk" hint for the nearest NPC in reach, or null. */
  get prompt(): TalkPrompt | null {
    return this.promptOn && !this.session ? this.promptOut : null;
  }

  /** True while `id` is in a conversation. */
  talkingWith(id: EntityId): boolean {
    return this.sessionBrain !== null && this.sessionBrain.id === id && this.session !== null && !this.session.ended;
  }

  /** Mode the conversation puts its NPC in. */
  talkMode(id: EntityId): NpcMode {
    return this.session && this.sessionBrain?.id === id && this.session.view.mode === 'trade' ? 'trade' : 'talk';
  }

  private canTalk(b: NpcBrain): boolean {
    if (b.dead || !b.spec.dialogue) return false;
    const m = b.mode;
    if (m === 'chase' || m === 'attack' || m === 'flee') return false;
    return !b.isResting();
  }

  private playerPos(): Readonly<Vec3> | undefined {
    const env = this.ctx.env;
    const pid = env.playerId();
    return pid !== undefined ? env.positionOf(pid) : undefined;
  }

  private nearestTalkable(): { b: NpcBrain; d: number } | null {
    const pp = this.playerPos();
    if (!pp) return null;
    let best: NpcBrain | null = null;
    let bestD = Infinity;
    for (const b of this.brains) {
      if (!this.canTalk(b)) continue;
      const d = hyp(b.x - pp[0], b.z - pp[2]);
      if (d <= b.spec.talkRange && d < bestD && Math.abs(b.feetY - pp[1]) < 3) {
        bestD = d;
        best = b;
      }
    }
    return best ? { b: best, d: bestD } : null;
  }

  private handleTalkStart(): void {
    const env = this.ctx.env;
    const near = this.nearestTalkable();
    if (!near) {
      this.promptOn = false;
      return;
    }
    this.promptOn = true;
    this.promptOut.npc = near.b.id;
    this.promptOut.name = this.nameOf(near.b);
    this.promptOut.distance = near.d;
    if (this.cooldown <= 0 && env.pressed.has('e')) this.startWith(near.b);
  }

  /** Start a conversation with NPC `id` (touch buttons, rules). Returns false when it cannot talk. */
  startDialogue(id: EntityId): boolean {
    const b = this.byId.get(id);
    if (!b || this.session || !this.canTalk(b)) return false;
    this.startWith(b);
    return this.session !== null;
  }

  private startWith(b: NpcBrain): void {
    const tree = b.spec.dialogue;
    if (!tree) return;
    let used = this.usedChoices.get(b.id);
    if (!used) {
      used = new Set();
      this.usedChoices.set(b.id, used);
    }
    this.promptOn = false;
    this.sessionBrain = b;
    this.session = new DialogueSession(b.id, this.nameOf(b), tree, this, used);
    this.session.view.chat = b.spec.chat !== undefined;
    this.ctx.env.log(`dialogue with ${b.id} started`);
    if (this.session.ended) this.endDialogue();
  }

  private handleDialogue(): void {
    const s = this.session as DialogueSession;
    const b = this.sessionBrain as NpcBrain;
    const env = this.ctx.env;
    const pp = this.playerPos();
    const far = !pp || hyp(b.x - pp[0], b.z - pp[2]) > b.spec.talkRange * 2;
    if (s.ended || b.dead || far || b.mode === 'chase' || b.mode === 'attack' || b.mode === 'flee') {
      this.endDialogue();
      return;
    }
    const pressed = env.pressed;
    if (pressed.size === 0) return;
    for (let i = 0; i < CHOICE_KEYS.length; i++) {
      if (pressed.has(CHOICE_KEYS[i] as string)) {
        this.choose(i);
        return;
      }
    }
    if (pressed.has('e') || pressed.has('enter')) {
      if (s.awaitingChoice) {
        if (s.view.choices.length === 1) this.choose(0);
      } else this.advance();
    }
  }

  /** Take choice `i` (0-based) of the running conversation. */
  choose(i: number): boolean {
    const s = this.session;
    if (!s || s.ended) return false;
    const ok = s.choose(i);
    if (s.ended) this.endDialogue();
    return ok;
  }

  /** Continue the running conversation (no-op while a choice is pending). */
  advance(): boolean {
    const s = this.session;
    if (!s || s.ended) return false;
    const ok = s.advance();
    if (s.ended) this.endDialogue();
    return ok;
  }

  /**
   * What a language model needs to play the character in the running
   * conversation, or null (no conversation, or the NPC has no `chat` spec).
   * Plain data: the studio sends it to a connected model; the logic runtime
   * itself never talks to a network.
   */
  chatContext(): { npc: EntityId; name: string; role: string; persona: string; facts: readonly string[]; maxTurns: number; shown: string; choices: readonly string[] } | null {
    const s = this.session;
    const b = this.sessionBrain;
    if (!s || s.ended || !b || !b.spec.chat) return null;
    const c = b.spec.chat;
    return { npc: b.id, name: this.nameOf(b), role: b.spec.role, persona: c.persona, facts: c.facts, maxTurns: c.maxTurns, shown: s.view.text, choices: s.view.choices };
  }

  /** Show a free-conversation reply from the character (the authored choices stay). Returns false without a conversation. */
  freeReply(text: string): boolean {
    const s = this.session;
    if (!s || s.ended || typeof text !== 'string') return false;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
    if (clean.length === 0) return false;
    s.say(clean);
    return true;
  }

  /** Close the running conversation. */
  endDialogue(): void {
    if (!this.session) return;
    this.session.end();
    this.ctx.env.log(`dialogue with ${this.sessionBrain?.id ?? '?'} ended`);
    this.session = null;
    this.sessionBrain = null;
    this.cooldown = 0.6;
  }

  // --- DialogueHost -----------------------------------------------------------------

  read(key: string): string | number | boolean | null | undefined {
    return this.readValue(key);
  }

  apply(fx: DialogueEffect, npc: EntityId): void {
    const env = this.ctx.env;
    const b = this.byId.get(npc);
    try {
      switch (fx.do) {
        case 'set':
          env.log(`dialogue: ${env.setState(fx.key, fx.value as Json)}`);
          break;
        case 'add':
          env.log(`dialogue: ${env.addState(fx.key, fx.amount)}`);
          break;
        case 'give':
          env.log(`dialogue: ${env.addState(fx.item, fx.count)}`);
          {
            const pid = env.playerId();
            env.feedback('pickup', pid !== undefined ? env.positionOf(pid) : undefined, { source: npc, amount: fx.count });
          }
          env.host.sound('pickup');
          env.host.message(fx.count > 1 ? `Received ${fx.count} × ${fx.item}` : `Received: ${fx.item}`, 2.5);
          break;
        case 'take': {
          const cur = env.readState(fx.item);
          const have = typeof cur === 'number' ? cur : 0;
          env.log(`dialogue: ${env.addState(fx.item, -Math.min(fx.count, have))}`);
          break;
        }
        case 'openDoor':
          env.log(`dialogue: ${env.setState(`${fx.target}-unlocked`, true)}`);
          env.host.sound('click');
          break;
        case 'emit':
          env.emit(fx.event);
          break;
        case 'message':
          env.host.message(fx.text, 3);
          break;
        case 'provoke':
          b?.provoke();
          break;
        case 'calm':
          b?.calm();
          break;
        case 'follow':
          if (b) b.following = fx.on;
          break;
        case 'win':
          env.gameOver('win', fx.text, `dialogue with ${npc}`);
          break;
      }
    } catch (err) {
      env.log(`dialogue effect '${fx.do}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------------

  /** Snapshot of every NPC (tests, inspector, verification). Allocates. */
  infos(): NpcInfo[] {
    return this.brains.map((b) => b.info());
  }

  /** Snapshot of one NPC. */
  info(id: EntityId): NpcInfo | undefined {
    return this.byId.get(id)?.info();
  }

  /** Number of live NPC brains. */
  get count(): number {
    return this.brains.length;
  }
}

/** A neighbour-hash cell; `items[0..n)` are live. */
interface Bucket {
  n: number;
  items: NpcBrain[];
}

function hashKey(ix: number, iz: number): number {
  // Stays inside the small-integer range (no boxed keys): 14 bits per axis.
  return (ix & 0x3fff) * 16384 + (iz & 0x3fff);
}
