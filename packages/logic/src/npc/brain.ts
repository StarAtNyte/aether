/**
 * One NPC's mind: perception, the behaviour graph, steering and animation
 * state. Instances are created by the {@link NpcSystem}; `update` is called
 * once per fixed tick by the logic engine.
 *
 * Hot-path rules: no allocation per tick (scratch buffers and typed arrays
 * are created once per brain), no string building outside state changes, and
 * all randomness comes from the instance's seeded stream, so the same world,
 * seed and input always replay identically.
 */
import type { EntityId, NpcMode, NpcRoutineStop, NpcSpec, Vec3 } from '@aether/core';
import type { BehaviorEnv, BehaviorInstance } from '../behaviors/types';
import type { RuntimeEntity } from '../entities';
import { faceDirection } from '../behaviors/move';
import { angleDelta, clamp, yawFromDirection, yawOfQuat } from '../vec';
import { evalCond, inHours, newSenses, type NpcEff, type Senses } from './graph';
import { NAV_MAX_PATH, type NavGrid } from './nav';
import { NavRoute, type NavLayers } from './layers';
import { pointAlong, type StairLink } from './stairs';
import { arriveSpeed, wanderDirection, type WanderState } from './steering';
import type { NpcSystem } from './system';
import { hyp } from './math';

const DEG2RAD = Math.PI / 180;
/** Perception runs on every Nth tick per NPC (staggered by index). */
const PERCEIVE_EVERY = 3;
/** Distance within which a foe is noticed whatever the cone says (m). */
const CLOSE_AWARE = 1.6;
/** Seconds a hearing event stays readable by conditions. */
const HEARD_LATCH = 0.6;
const STUCK_WINDOW = 0.5;
/** Ground ray casts run on every Nth tick per NPC. */
const GROUND_EVERY = 6;
/** Within this of a stair's end an NPC steps onto it (m). */
const STAIR_ENTRY = 0.75;
/** Pace on a stair relative to the walking speed. */
const STAIR_PACE = 0.75;
/** How far right of the walking line an NPC keeps on a stair, at most (m): people pass each other. */
const STAIR_KEEP_RIGHT = 0.2;
/** Seconds after leaving a stair during which an NPC may walk out of blocked cells (the line's ends are close to the stairwell). */
const STAIR_EXIT_GRACE = 1.5;
/** An NPC waits this long at most for the player to clear a stair (s), then goes on (characters pass through each other). */
const STAIR_YIELD_MAX = 6;
/** How close ahead on a stair the player makes an NPC stop (m). */
const STAIR_YIELD_AHEAD = 1.1;
/** In a building a resident gives way to a player who is this close ahead of it on its floor (m). */
const WAY_AHEAD = 1.2;
/** It stands for this long (s), then steps aside (or back) if there is room, for this long at most (s) before it goes on. */
const WAY_STAND_S = 0.5;
const WAY_MAX_S = 8;
/** Pace of the step aside, relative to the walking speed. */
const WAY_PACE = 0.5;
/** Seconds an NPC takes to turn round before sitting, and to stand up again before walking on. */
const SIT_TURN_S = 0.9;
const SIT_RISE_S = 1.9;

/** Animation hints published on `state.npcAnim`. */
type Anim = 'idle' | 'walk' | 'run' | 'attack' | 'talk' | 'hurt' | 'dead' | 'sit';

/** Target kinds. */
const T_NONE = 0;
const T_PLAYER = 1;
const T_NPC = 2;

/** Public read-only snapshot of a brain (tests, inspector, verification). */
export interface NpcInfo {
  id: EntityId;
  mode: NpcMode;
  anim: string;
  health: number;
  dead: boolean;
  x: number;
  z: number;
  target: string | null;
  stuck: number;
  legs: number;
  waypoint: number;
  /** Floor level (0 without stairs), feet height, and the stair being walked (entity id) if any. */
  layer: number;
  y: number;
  stair: string | null;
}

/** A single NPC's behaviour runtime. */
export class NpcBrain implements BehaviorInstance {
  readonly id: EntityId;
  readonly eff: NpcEff;
  readonly spec: NpcSpec;
  readonly senses: Senses;
  /** `#tag` selectors of the fear tags (built once). */
  private readonly fearSelectors: string[];
  mode: NpcMode;
  modeT = 0;
  dead = false;
  /** Seconds since death, and whether the body was cleared away (`spec.corpse`). */
  private deadT = 0;
  private cleared = false;
  hp: number;
  angry = false;
  /** Seconds the player stays this character's chosen foe while seen (shot at by the player: it turns on them). */
  private aggroT = 0;
  following: boolean;
  // --- position bookkeeping ------------------------------------------------------
  private homeX: number;
  private homeZ: number;
  private feetOffset = Number.NaN;
  private grid: NavGrid | null = null;
  private gridTick = -1;
  // --- floors and stairs (worlds with stairs) ------------------------------------
  private layers: NavLayers | null = null;
  /** Floor level the NPC stands on (index into the layers; 0 without stairs). */
  layer = 0;
  private readonly route = new NavRoute();
  private routeIdx = 0;
  private routeGoalX = Number.NaN;
  private routeGoalZ = Number.NaN;
  private routeGoalL = -1;
  private routeT = 0;
  /** Stair being walked (index into the layers' links), or −1. */
  private trav = -1;
  private travDir: 1 | -1 = 1;
  private travU = 0;
  private travLead = 0;
  private travEX = 0;
  private travEY = 0;
  private travEZ = 0;
  private exitT = 0;
  private yieldT = 0;
  /** Seconds spent giving way to the player on a floor (decays while the way is clear). */
  private wayT = 0;
  private readonly pt = new Float32Array(5);
  private readonly aim = new Float64Array(3);
  // --- daily routine ----------------------------------------------------------------
  private stopIdx = -1;
  private atStop = false;
  /** Sitting at a routine stop: 0 not, 1 turning to face out of the seat, 2 seated, 3 rising. */
  private sitPhase = 0;
  private sitT = 0;
  /** Entity id of the seat in use while seated, or null. */
  get seatId(): string | null {
    return this.sitPhase === 2 ? this.sitSeat : null;
  }
  private sitSeat = '';
  private stayT = 0;
  private readonly wanderState: WanderState = { theta: 0 };
  private readonly dirOut = new Float64Array(2);
  // --- targeting -----------------------------------------------------------------
  private targetKind = T_NONE;
  private targetId: EntityId | null = null;
  private lastX = 0;
  private lastZ = 0;
  /** Feet height of the foe where last known (NaN when unknown: assume this floor). */
  private lastY = Number.NaN;
  private hasLast = false;
  private lostT = 1e9;
  private heardT = 1e9;
  private fearX = 0;
  private fearZ = 0;
  private threatKnown = false;
  private sawFoeNow = false;
  private fearNow = false;
  // --- movement ------------------------------------------------------------------
  private readonly path = new Float32Array(NAV_MAX_PATH * 2);
  private pathLen = 0;
  private pathIdx = 0;
  private pathGoalX = Number.NaN;
  private pathGoalZ = Number.NaN;
  private repathT = 0;
  private pathFailT = 0;
  private arrived = false;
  private speedNow = 0;
  private wantMove = false;
  // --- patrol / wander -------------------------------------------------------------
  private wp = 0;
  private wpDir = 1;
  private waitT = 0;
  legs = 0;
  private wanderX = Number.NaN;
  private wanderZ = Number.NaN;
  // --- combat / feedback -------------------------------------------------------------
  private attackCd = 0;
  private attackAnimT = 0;
  /** A telegraphed blow is coming (`attack.windup`): seconds until it lands. */
  private windupOn = false;
  private windupT = 0;
  private hurtT = 0;
  private hpSeen: number;
  private barkCd = 0;
  private scanT = 0;
  private scanDir = 1;
  private fleeT = 0;
  private fleeX = Number.NaN;
  private fleeZ = Number.NaN;
  // --- stuck detection --------------------------------------------------------------
  private stuckCheckT = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private stuckT = 0;
  private unstuckCount = 0;
  private phase = 0;
  private shownSpeed = -1;
  private groundOff = 0;
  private shownStuck = -1;
  private anim: Anim = 'idle';
  private firstTick = true;
  private modeBeforeTalk: NpcMode;
  private lastDx = 0;
  private lastDz = 1;

  constructor(
    readonly self: RuntimeEntity,
    private readonly sys: NpcSystem,
    private readonly random: () => number,
    readonly index: number,
  ) {
    this.id = self.id;
    this.spec = self.spec.npc as NpcSpec;
    this.eff = sys.effective(this.spec);
    this.homeX = self.anchor[0];
    this.homeZ = self.anchor[2];
    this.x = this.homeX;
    this.z = this.homeZ;
    this.mode = this.eff.home;
    this.modeBeforeTalk = this.mode;
    this.following = this.spec.follow;
    const stored = self.state['health'];
    this.hp = typeof stored === 'number' && Number.isFinite(stored) ? stored : this.spec.health;
    this.hpSeen = this.hp;
    self.state['health'] = this.hp;
    this.fearSelectors = this.spec.fears.map((t) => `#${t}`);
    this.senses = newSenses((key) => sys.readValue(key));
    this.publish();
    // Stagger the first perception and waypoint choice.
    this.scanDir = random() < 0.5 ? -1 : 1;
  }

  // ---------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------

  /** Current horizontal position (refreshed at the start of every update and after each step). */
  x = 0;
  z = 0;

  private syncPos(): void {
    const s = this.self;
    if (s.dynamic) {
      const p = this.sys.env.positionOf(s.id);
      if (p) {
        this.x = p[0];
        this.z = p[2];
        return;
      }
    }
    this.x = s.anchor[0];
    this.z = s.anchor[2];
  }

  /** Feet height (for level checks). */
  get feetY(): number {
    const y = this.self.dynamic ? (this.sys.env.positionOf(this.id)?.[1] ?? this.self.anchor[1]) : this.self.anchor[1];
    return Number.isFinite(this.feetOffset) ? y - this.feetOffset : this.sys.feetGuess(this.self, y);
  }

  /** Current animation hint (`npcAnim`): what a renderer should show. Visual only. */
  get animation(): string {
    return this.anim;
  }

  /** True while in a conversation or trading (a renderer shows talking gestures). */
  get conversing(): boolean {
    return this.mode === 'talk' || this.mode === 'trade';
  }

  /** True while the character is paying attention to the player (a renderer turns its head). */
  get attentive(): boolean {
    return this.conversing || this.mode === 'chase' || this.mode === 'attack' || this.mode === 'investigate' || this.mode === 'flee' || this.mode === 'follow' || this.targetKind === T_PLAYER;
  }

  /** Kind (1 player, 2 npc) and id of the current target, for alarms. */
  get targetRef(): { kind: number; id: EntityId | null } {
    targetOut.kind = this.targetKind;
    targetOut.id = this.targetId;
    return targetOut;
  }

  /** Snapshot for tests and tools. */
  info(): NpcInfo {
    return {
      id: this.id,
      mode: this.mode,
      anim: this.anim,
      health: this.hp,
      dead: this.dead,
      x: this.x,
      z: this.z,
      target: this.targetId,
      stuck: this.stuckT,
      legs: this.legs,
      waypoint: this.wp,
      layer: this.layer,
      y: this.feetY,
      stair: this.trav >= 0 ? (this.layers?.links[this.trav]?.id ?? null) : null,
    };
  }

  /** Direction the NPC is walking in (unit), or zero while it stands: what a flock aligns with. */
  get headingX(): number {
    return this.speedNow > 0.2 ? this.lastDx : 0;
  }

  get headingZ(): number {
    return this.speedNow > 0.2 ? this.lastDz : 0;
  }

  /** Feet height of the current foe where last known (NaN when unknown). */
  get targetY(): number {
    return this.lastY;
  }

  /** True while walking a stair between floors. */
  get onStair(): boolean {
    return this.trav >= 0;
  }

  /** World yaw (degrees) of the forward axis. */
  private yaw(): number {
    return this.self.yawDeg + yawOfQuat(this.self.baseRot);
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  update(env: BehaviorEnv, dt: number): void {
    const sys = this.sys;
    if (this.dead) {
      this.clearBody(env, dt);
      return;
    }
    this.modeT += dt;
    this.barkCd = Math.max(0, this.barkCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackAnimT = Math.max(0, this.attackAnimT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.lostT += dt;
    this.heardT += dt;
    this.exitT = Math.max(0, this.exitT - dt);
    this.aggroT = Math.max(0, this.aggroT - dt);
    if (this.windupOn && this.mode !== 'attack') this.windupOn = false;
    this.syncPos();
    if (this.firstTick) this.initGround(env);
    this.syncHealth();
    if (this.dead) return;

    const talking = sys.talkingWith(this.id);
    const resting = this.isResting();
    const percept = (sys.tickNo + this.index) % PERCEIVE_EVERY === 0 || this.firstTick;
    this.firstTick = false;
    if (percept) this.perceive(env, resting);
    this.fillSenses(env, talking);

    // Conversations override the graph and restore the previous mode afterwards.
    if (talking) {
      const want: NpcMode = sys.talkMode(this.id);
      if (this.mode !== 'talk' && this.mode !== 'trade') this.modeBeforeTalk = this.mode;
      if (this.mode !== want) this.enter(want, 'conversation');
    } else if (this.mode === 'talk' || this.mode === 'trade') {
      this.enter(this.modeBeforeTalk === 'talk' || this.modeBeforeTalk === 'trade' ? this.eff.home : this.modeBeforeTalk, 'conversation ended');
    } else if (resting) {
      if (this.mode !== 'idle') this.enter('idle', 'resting');
    } else {
      this.transition();
    }

    this.wantMove = false;
    switch (this.mode) {
      case 'idle': this.doIdle(env, dt); break;
      case 'patrol': this.doPatrol(env, dt); break;
      case 'investigate': this.doInvestigate(env, dt); break;
      case 'chase': this.doChase(env, dt); break;
      case 'flee': this.doFlee(env, dt); break;
      case 'attack': this.doAttack(env, dt); break;
      case 'follow': this.doFollow(env, dt); break;
      case 'talk':
      case 'trade': this.doTalk(env, dt); break;
    }
    if (!this.wantMove) this.speedNow = Math.max(0, this.speedNow - 14 * dt);
    this.trackStuck(dt);
    this.animate(env, dt);
  }

  dispose(): void {
    this.sys.forget(this);
  }

  /** A body with `corpse` seconds is cleared away after that long (waves of attackers do not pile up). */
  private clearBody(env: BehaviorEnv, dt: number): void {
    const keep = this.spec.corpse;
    if (keep === undefined || this.cleared) return;
    this.deadT += dt;
    if (this.deadT < keep) return;
    this.cleared = true;
    env.destroy(this.id);
  }

  // ---------------------------------------------------------------------------
  // Ground, health
  // ---------------------------------------------------------------------------

  private initGround(env: BehaviorEnv): void {
    const s = this.self;
    this.refreshGrid();
    const grid = this.grid;
    const y = s.dynamic ? (env.positionOf(s.id)?.[1] ?? s.anchor[1]) : s.anchor[1];
    const guess = this.sys.feetGuess(s, y);
    const floor = grid ? grid.floorAt(s.anchor[0], s.anchor[2], guess) : guess;
    const off = y - floor;
    this.feetOffset = off > -0.3 && off < this.spec.height + 0.3 ? off : y - guess;
    if (!Number.isFinite(this.feetOffset)) this.feetOffset = 0;
  }

  private syncHealth(): void {
    const s = this.self;
    const v = s.state['health'];
    const hp = typeof v === 'number' && Number.isFinite(v) ? v : this.hp;
    if (hp < this.hpSeen - 1e-6) {
      this.hurtT = 0.5;
      this.bark('hurt', this.spec.barks?.hurt);
      if (!this.hasLast && this.eff.spec.archetype !== 'prey') this.provoke();
      else if (this.hasLast) this.heardT = 0;
    }
    this.hpSeen = hp;
    this.hp = hp;
    if (hp <= 0) this.die();
  }

  /** Turn hostile to the player and remember where they are. */
  provoke(): void {
    const pid = this.sys.env.playerId();
    const pp = pid !== undefined ? this.sys.env.positionOf(pid) : undefined;
    if (!pp) return;
    this.targetKind = T_PLAYER;
    this.targetId = pid ?? null;
    this.lastX = pp[0];
    this.lastZ = pp[2];
    this.lastY = pp[1];
    this.hasLast = true;
    this.lostT = 0;
    this.angry = true;
  }

  /**
   * Shot by the player: turn on them and keep them as the foe for `seconds` while they are in sight (a raider firing at
   * a building turns around when you hit it).
   */
  aggro(seconds: number): void {
    if (this.dead || !Number.isFinite(seconds)) return;
    this.aggroT = Math.max(this.aggroT, Math.min(60, seconds));
    if (this.isHostileToPlayer() || !this.eff.timid) this.provoke();
  }

  /** Stop being hostile: forget the current foe. */
  calm(): void {
    this.angry = false;
    this.hasLast = false;
    this.lastY = Number.NaN;
    this.lostT = 1e9;
    this.heardT = 1e9;
    this.targetKind = T_NONE;
    this.targetId = null;
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    const s = this.self;
    s.state['health'] = 0;
    this.anim = 'dead';
    s.state['npcAnim'] = 'dead';
    s.state['npcState'] = 'dead';
    s.state['talking'] = false;
    this.sys.env.pose(s);
    if (!s.dynamic) {
      // Topple over: a quarter turn about the local Z axis.
      const c = Math.SQRT1_2;
      s.extraRot[0] = 0;
      s.extraRot[1] = 0;
      s.extraRot[2] = c;
      s.extraRot[3] = c;
      s.offset[1] = -Math.max(0, this.spec.height * 0.25);
    }
    this.sys.env.log(`npc ${this.id} died`);
    this.dropLoot();
    this.sys.env.emit('npc-died');
    this.sys.env.emit(`${this.id}-died`);
    // Per tag as well (`raider-died`, `heavy-died`): rules can answer a kind of character, including spawned clones.
    let n = 0;
    for (const t of s.tags) {
      if (++n > 8) break;
      if (t !== 'npc' && t.length <= 58) this.sys.env.emit(`${t}-died`);
    }
    this.sys.onDeath(this);
  }

  /** Spawn what the character leaves behind (`spec.drops`), each with its chance, side by side where it fell. */
  private dropLoot(): void {
    const drops = this.spec.drops;
    if (!drops || drops.length === 0) return;
    const env = this.sys.env;
    let k = 0;
    for (const d of drops) {
      if (this.random() >= d.chance) continue;
      const a = k * 2.1 + this.index;
      const r = k === 0 ? 0 : 0.7;
      k++;
      try {
        env.spawn(d.template, [this.x + Math.cos(a) * r, this.feetY + 0.6, this.z + Math.sin(a) * r], 1, 0);
      } catch (err) {
        env.log(`npc ${this.id}: drop '${d.template}' failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  /** True outside the NPC's active hours (it rests). */
  isResting(): boolean {
    const h = this.spec.activeHours;
    return h !== undefined && !inHours(this.sys.hour(), h[0], h[1]);
  }

  private perceive(env: BehaviorEnv, resting: boolean): void {
    const sys = this.sys;
    const x = this.x;
    const z = this.z;
    const per = this.spec.perception;
    this.fearNow = false;
    this.sawFoeNow = false;
    if (resting) return;
    const grid = this.grid;
    const feet = this.feetY;
    // Fear: any tagged thing nearby.
    const fears = this.spec.fears;
    if (fears.length > 0) {
      const range2 = this.spec.fearRange * this.spec.fearRange;
      for (let f = 0; f < fears.length && !this.fearNow; f++) {
        const ids = env.resolve(this.fearSelectors[f] as string);
        for (let i = 0; i < ids.length; i++) {
          if (ids[i] === this.id) continue;
          // A flame carried by a character (a torch child) burns where its carrier stands.
          const p = env.positionOf(carrierOf(env, ids[i] as string));
          if (!p) continue;
          const dx = p[0] - x;
          const dz = p[2] - z;
          if (dx * dx + dz * dz <= range2) {
            this.fearNow = true;
            this.fearX = p[0];
            this.fearZ = p[2];
            break;
          }
        }
      }
    }
    // Foes: the player first, then hostile NPCs.
    let bestD2 = Infinity;
    let bestKind = T_NONE;
    let bestId: EntityId | null = null;
    let bx = 0;
    let by = Number.NaN;
    let bz = 0;
    const sightMul = sys.sightFactor(this);
    const sight = per.sight * sightMul;
    const sight2 = sight * sight;
    const halfFov = (per.fov * 0.5) * DEG2RAD;
    const cosHalf = Math.cos(halfFov);
    const fwdYaw = this.yaw() * DEG2RAD;
    const fx = -Math.sin(fwdYaw);
    const fz = -Math.cos(fwdYaw);
    const pid = env.playerId();
    const pp = pid !== undefined ? env.positionOf(pid) : undefined;
    if (pp && this.isHostileToPlayer()) {
      const dx = pp[0] - x;
      const dz = pp[2] - z;
      const d2 = dx * dx + dz * dz;
      if (Math.abs(pp[1] - feet) < 3 + this.spec.height) {
        // A floor between them blocks sight (not hearing); on a stair the stairwell is open.
        if (d2 <= sight2 && this.sameFloor(pp[0], pp[1], pp[2]) && this.cone(dx, dz, d2, fx, fz, cosHalf) && this.clear(grid, x, z, pp[0], pp[2])) {
          bestD2 = d2;
          bestKind = T_PLAYER;
          bestId = pid ?? null;
          bx = pp[0];
          by = pp[1];
          bz = pp[2];
        } else if (d2 <= sys.hearingRadius(this) * sys.hearingRadius(this)) {
          if (this.heardT > HEARD_LATCH * 0.5) this.onHeard(pp[0], pp[2], pp[1]);
        }
      }
    }
    const others = sys.brains;
    // Recently shot by the player and seeing them: the player stays the foe, however near anyone else is.
    const fixed = this.aggroT > 0 && bestKind === T_PLAYER;
    for (let i = 0; i < others.length && !fixed; i++) {
      const o = others[i] as NpcBrain;
      if (o === this || o.dead || !this.isHostileTo(o)) continue;
      const dx = o.x - x;
      const dz = o.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > sight2 || d2 >= bestD2) continue;
      if (Math.abs(o.feetY - feet) > 3 + this.spec.height) continue;
      if (this.layers !== null && o.layer !== this.layer && !o.onStair && this.trav < 0) continue;
      if (!this.cone(dx, dz, d2, fx, fz, cosHalf) || !this.clear(grid, x, z, o.x, o.z)) continue;
      bestD2 = d2;
      bestKind = T_NPC;
      bestId = o.id;
      bx = o.x;
      by = o.feetY;
      bz = o.z;
    }
    if (bestKind !== T_NONE) {
      const first = !this.sawFoeBefore();
      this.sawFoeNow = true;
      this.targetKind = bestKind;
      this.targetId = bestId;
      this.lastX = bx;
      this.lastZ = bz;
      this.lastY = by;
      this.hasLast = true;
      this.lostT = 0;
      if (first) {
        this.bark('spot', this.spec.barks?.spot);
        if (this.eff.alert > 0) sys.alertAllies(this, bx, bz);
      }
    }
  }

  private sawFoeBefore(): boolean {
    return this.lostT < this.spec.perception.memory && this.hasLast;
  }

  private cone(dx: number, dz: number, d2: number, fx: number, fz: number, cosHalf: number): boolean {
    if (d2 <= CLOSE_AWARE * CLOSE_AWARE) return true;
    if (cosHalf <= -0.999) return true;
    const d = Math.sqrt(d2);
    return (dx * fx + dz * fz) / d >= cosHalf;
  }

  private clear(grid: NavGrid | null, x0: number, z0: number, x1: number, z1: number): boolean {
    return grid === null || grid.lineOfSight(x0, z0, x1, z1);
  }

  /** Whether a feet position is on this NPC's floor (always without stairs; a stair joins the floors it links). */
  private sameFloor(x: number, y: number, z: number): boolean {
    const l = this.layers;
    if (l === null || this.trav >= 0) return true;
    if (l.stairAt(x, y, z) >= 0) return true;
    return l.levelAt(x, y, z) === this.layer;
  }

  private onHeard(x: number, z: number, y = Number.NaN): void {
    this.heardT = 0;
    if (!this.sawFoeNow) {
      this.lastX = x;
      this.lastZ = z;
      this.lastY = y;
      this.hasLast = true;
    }
    this.bark('alert', this.spec.barks?.alert);
  }

  /** A noise (or an ally's alarm) at (x, z) that this NPC can hear (`y`: the feet height there, when known). */
  hear(x: number, z: number, y = Number.NaN): void {
    if (this.dead || this.isResting()) return;
    this.onHeard(x, z, y);
  }

  /** An ally saw a foe at (x, z) (feet height `y` when known): remember it. */
  warn(x: number, z: number, kind: number, id: EntityId | null, y = Number.NaN): void {
    if (this.dead || this.isResting()) return;
    if (this.lostT < 1) return;
    this.hasLast = true;
    this.lastX = x;
    this.lastZ = z;
    this.lastY = y;
    this.lostT = Math.min(this.lostT, this.spec.perception.memory * 0.5);
    if (this.targetKind === T_NONE) {
      this.targetKind = kind;
      this.targetId = id;
    }
    this.heardT = 0;
  }

  isHostileToPlayer(): boolean {
    if (this.angry) return true;
    const e = this.eff;
    return e.enemies.has('player') && !e.allies.has('player');
  }

  isHostileTo(o: NpcBrain): boolean {
    const e = this.eff;
    const f = o.spec.faction;
    if (f === this.spec.faction || e.allies.has(f)) return false;
    if (e.enemies.has(f)) return true;
    // Timid folk see anyone who hunts their kind as a threat.
    return e.timid && o.eff.enemies.has(this.spec.faction);
  }

  private fillSenses(env: BehaviorEnv, talking: boolean): void {
    const s = this.senses;
    const memory = this.spec.perception.memory;
    s.seesFoe = this.lostT < PERCEIVE_EVERY / 30 + 0.02 && this.hasLast;
    s.hearsFoe = this.heardT < HEARD_LATCH;
    s.remembersFoe = this.hasLast && this.lostT < memory;
    s.fearNear = this.fearNow;
    s.healthFrac = this.hp / this.spec.health;
    s.timeInState = this.modeT;
    s.arrived = this.arrived;
    s.hour = this.sys.hour();
    s.talkRequested = talking;
    s.following = this.following;
    const x = this.x;
    const z = this.z;
    s.homeDist = hyp(x - this.homeX, z - this.homeZ);
    s.foeDist = this.hasLast && s.remembersFoe ? this.distToTarget(env, x, z) : Infinity;
    // A foe on another floor is not within reach, however close in plan: it counts the climb.
    if (this.layers !== null && s.foeDist !== Infinity && !Number.isNaN(this.lastY)) {
      const dy = Math.abs(this.lastY - this.feetY);
      if (dy > 1.4) s.foeDist += dy * 2;
    }
    const pid = env.playerId();
    const pp = pid !== undefined ? env.positionOf(pid) : undefined;
    s.playerDist = pp ? hyp(pp[0] - x, pp[2] - z) : Infinity;
  }

  private distToTarget(env: BehaviorEnv, x: number, z: number): number {
    // While the foe is in view use its live position; afterwards the last known one.
    if (this.lostT < 0.2) {
      if (this.targetKind === T_PLAYER && this.targetId !== null) {
        const p = env.positionOf(this.targetId);
        if (p) {
          this.lastX = p[0];
          this.lastZ = p[2];
          this.lastY = p[1];
        }
      } else if (this.targetKind === T_NPC && this.targetId !== null) {
        const o = this.sys.brainOf(this.targetId);
        if (o && !o.dead) {
          this.lastX = o.x;
          this.lastZ = o.z;
          this.lastY = o.feetY;
        }
      }
    }
    return hyp(this.lastX - x, this.lastZ - z);
  }

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------

  private transition(): void {
    const edges = this.eff.edges;
    const mode = this.mode;
    for (let i = 0; i < edges.length; i++) {
      const t = edges[i];
      if (t === undefined) continue;
      if (t.from !== '*' && t.from !== mode) continue;
      if (!evalCond(t.when, this.senses)) continue;
      if (t.to === mode) return; // a "hold" edge
      // The graph cannot walk an NPC that cannot move into chase/flee/follow/patrol.
      if (this.eff.stationary && (t.to === 'chase' || t.to === 'flee' || t.to === 'patrol' || t.to === 'follow')) continue;
      this.enter(t.to, t.say ?? null, t.say);
      return;
    }
  }

  private enter(next: NpcMode, why: string | null, say?: string): void {
    const prev = this.mode;
    this.mode = next;
    this.modeT = 0;
    this.pathLen = 0;
    this.pathGoalX = Number.NaN;
    this.arrived = false;
    this.waitT = 0;
    this.scanT = 0;
    this.fleeT = 0;
    this.fleeX = Number.NaN;
    if (next === 'patrol') this.wp = this.nearestWaypoint();
    if (next === 'chase' && prev !== 'attack') this.bark('spot', this.spec.barks?.spot);
    if (next === 'flee') this.bark('flee', this.spec.barks?.flee);
    if (next === 'investigate' && prev === 'chase') this.bark('lose', this.spec.barks?.lose);
    if (say) this.sys.say(this, say, 'bark');
    this.publish();
    const log = `npc ${this.id}: ${prev} → ${next}${why ? ` (${why})` : ''}`;
    this.sys.env.log(log);
  }

  private publish(): void {
    const s = this.self.state;
    s['npcState'] = this.mode;
    s['talking'] = this.mode === 'talk' || this.mode === 'trade';
    s['npcMode'] = this.mode;
  }

  private bark(kind: string, lines: readonly string[] | undefined): void {
    if (lines === undefined || lines.length === 0 || this.barkCd > 0) return;
    this.barkCd = 3;
    const line = lines[Math.floor(this.random() * lines.length)] as string;
    this.sys.say(this, line, 'bark');
    void kind;
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private nearestWaypoint(): number {
    const w = this.spec.waypoints;
    let best = 0;
    let bestD = Infinity;
    const x = this.x;
    const z = this.z;
    for (let i = 0; i < w.length; i++) {
      const p = w[i] as Vec3;
      const d = (p[0] - x) * (p[0] - x) + (p[2] - z) * (p[2] - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private refreshGrid(): void {
    if (this.gridTick !== this.sys.navVersion) {
      this.gridTick = this.sys.navVersion;
      this.layers = this.sys.layersFor(this);
      this.trav = -1;
      this.route.n = 0;
      this.routeGoalL = -1;
      if (this.layers !== null) {
        this.layer = this.layers.levelAt(this.x, this.feetY, this.z);
        this.grid = this.layers.grids[this.layer] ?? null;
      } else {
        this.layer = 0;
        this.grid = this.sys.gridFor(this);
      }
    }
  }

  /** Floor level of a point the NPC is sent to (`y` is the floor it stands on); its own level without stairs. */
  private levelOf(p: Readonly<Vec3>): number {
    return this.layers === null ? this.layer : this.layers.levelAt(p[0], p[1], p[2]);
  }

  /**
   * Walk toward (gx, gz) on floor level `gl` (−1: this floor). Returns true once within `arriveR` on that floor.
   * On another floor it takes the stairs of a route between the floors, walking each along its line; on this floor
   * it plans a path on the nav grid when needed (cheap A* with a bounded budget) and steers along it with
   * separation from neighbours.
   */
  private goTo(env: BehaviorEnv, dt: number, gx: number, gz: number, speed: number, arriveR: number, gl = -1): boolean {
    this.refreshGrid();
    if (this.trav >= 0) {
      this.arrived = false;
      this.traverse(env, dt, speed);
      return false;
    }
    if (this.layers !== null && gl >= 0 && gl !== this.layer) {
      this.arrived = false;
      this.goVia(env, dt, gx, gz, speed, gl);
      return false;
    }
    return this.walkTo(env, dt, gx, gz, speed, arriveR);
  }

  /** Head for the next stair of the route to floor `gl` and step onto it at its end. */
  private goVia(env: BehaviorEnv, dt: number, gx: number, gz: number, speed: number, gl: number): void {
    const layers = this.layers as NavLayers;
    this.routeT -= dt;
    const moved = !(Math.abs(gx - this.routeGoalX) < 0.9 && Math.abs(gz - this.routeGoalZ) < 0.9) || gl !== this.routeGoalL;
    if (moved || this.routeT <= 0 || this.routeIdx >= this.route.n) {
      this.routeGoalX = gx;
      this.routeGoalZ = gz;
      this.routeGoalL = gl;
      this.routeT = 2;
      this.routeIdx = 0;
      if (!layers.route(this.layer, this.x, this.z, gl, gx, gz, this.route) || this.route.n === 0) {
        // No way up or down (or the goal is walled off): wait a moment, then the caller tries again.
        this.route.n = 0;
        this.pathLen = 0;
        this.pathFailT = 1.5;
        this.stop(env);
        return;
      }
    }
    const step = this.route.steps[this.routeIdx] as number;
    const li = Math.abs(step) - 1;
    const dir: 1 | -1 = step > 0 ? 1 : -1;
    const link = layers.links[li] as StairLink;
    const k = dir > 0 ? 0 : (link.n - 1) * 3;
    const ex = link.line[k] as number;
    const ez = link.line[k + 2] as number;
    if (hyp(ex - this.x, ez - this.z) < STAIR_ENTRY) {
      // The player on that stair goes first (a person on a stair blocks it; characters are solid to the player). A
      // hunter does not wait.
      const sys = this.sys;
      if (!Number.isNaN(sys.playerX) && !this.isHostileToPlayer() && layers.stairAt(sys.playerX, sys.playerY, sys.playerZ) === li && this.yieldT < STAIR_YIELD_MAX) {
        this.yieldT += dt;
        this.stop(env);
        this.face(env, dt, sys.playerX, sys.playerZ);
        return;
      }
      this.yieldT = 0;
      this.startTraverse(li, dir);
      this.traverse(env, dt, speed);
      return;
    }
    this.walkTo(env, dt, ex, ez, speed, STAIR_ENTRY * 0.6);
  }

  private startTraverse(li: number, dir: 1 | -1): void {
    const link = (this.layers as NavLayers).links[li] as StairLink;
    const k = dir > 0 ? 0 : (link.n - 1) * 3;
    this.trav = li;
    this.travDir = dir;
    this.travU = 0;
    this.travEX = this.x;
    this.travEZ = this.z;
    this.travEY = this.feetY;
    this.travLead = hyp((link.line[k] as number) - this.x, (link.line[k + 2] as number) - this.z);
    this.pathLen = 0;
    this.sys.env.log(`npc ${this.id}: takes the stair ${link.id} ${dir > 0 ? 'up' : 'down'}`);
  }

  /**
   * One tick on a stair: along its walking line (from where the NPC stepped on to the line's start, then the line),
   * feet at the height of the treads, keeping a little to the right so two people pass; off at the other end onto
   * that floor's grid.
   */
  private traverse(env: BehaviorEnv, dt: number, speed: number): void {
    const layers = this.layers as NavLayers;
    const link = layers.links[this.trav] as StairLink;
    const s = this.self;
    let target = speed * STAIR_PACE;
    // The player just ahead on the stair: wait for them to pass (for a few seconds at most).
    const sys = this.sys;
    if (!Number.isNaN(sys.playerX) && this.yieldT < STAIR_YIELD_MAX && !this.isHostileToPlayer()) {
      const ox = sys.playerX - this.x;
      const oz = sys.playerZ - this.z;
      const od = hyp(ox, oz);
      if (od < STAIR_YIELD_AHEAD && Math.abs(sys.playerY - this.feetY) < 1.2 && ox * this.lastDx + oz * this.lastDz > 0.3 * od) {
        target = 0;
        this.yieldT += dt;
      } else this.yieldT = Math.max(0, this.yieldT - dt);
    }
    this.wantMove = target > 0;
    this.speedNow += clamp(target - this.speedNow, -18 * dt, 9 * dt);
    this.travU += this.speedNow * dt;
    const total = this.travLead + link.length;
    const pt = this.pt;
    if (this.travU < this.travLead) {
      // From where it stepped on to the start of the line (a few decimetres on the floor).
      pointAlong(link, 0, this.travDir, pt);
      const t = this.travU / Math.max(1e-6, this.travLead);
      const dx = (pt[0] as number) - this.travEX;
      const dz = (pt[2] as number) - this.travEZ;
      const l = Math.max(1e-6, hyp(dx, dz));
      pt[3] = dx / l;
      pt[4] = dz / l;
      pt[0] = this.travEX + dx * t;
      pt[1] = this.travEY + ((pt[1] as number) - this.travEY) * t;
      pt[2] = this.travEZ + dz * t;
    } else pointAlong(link, this.travU - this.travLead, this.travDir, pt);
    const hx = pt[3] as number;
    const hz = pt[4] as number;
    // Keep right (of the way it is walking), easing in and out at the ends of the line.
    const room = Math.max(0, Math.min(STAIR_KEEP_RIGHT, link.halfWidth - this.spec.radius - 0.05));
    const ease = Math.max(0, Math.min(1, this.travU / 0.6, (total - this.travU) / 0.6));
    const px = (pt[0] as number) - hz * room * ease;
    const pz = (pt[2] as number) + hx * room * ease;
    this.lastDx = hx;
    this.lastDz = hz;
    if (s.dynamic) {
      // A physics body is steered along the line; the solver climbs the stair's ramps.
      const v = env.velocityOf(s.id);
      const ax = px + hx * 0.5 - this.x;
      const az = pz + hz * 0.5 - this.z;
      const al = Math.max(1e-6, hyp(ax, az));
      tmpVel[0] = (ax / al) * this.speedNow;
      tmpVel[1] = v ? v[1] : 0;
      tmpVel[2] = (az / al) * this.speedNow;
      env.setVelocity(s.id, tmpVel);
      faceDirection(s, hx, hz, this.spec.turnRate, dt);
    } else {
      env.pose(s);
      s.anchor[0] = px;
      s.anchor[2] = pz;
      s.anchor[1] = (pt[1] as number) + this.feetOffset;
      this.x = px;
      this.z = pz;
      faceDirection(s, hx, hz, this.spec.turnRate, dt);
      this.phase += this.speedNow * dt * 2.2;
    }
    if (this.travU >= total) {
      const li = this.trav;
      this.trav = -1;
      this.layer = this.travDir > 0 ? (layers.upper[li] as number) : (layers.lower[li] as number);
      this.grid = layers.grids[this.layer] ?? null;
      this.routeIdx++;
      this.exitT = STAIR_EXIT_GRACE;
      this.pathLen = 0;
      this.repathT = 0;
      this.groundOff = 0;
      this.stuckT = 0;
      this.sys.env.log(`npc ${this.id}: off the stair ${link.id} on level ${this.layer}`);
    }
  }

  /** Walk on this floor's grid toward (gx, gz); true once within `arriveR`. */
  private walkTo(env: BehaviorEnv, dt: number, gx: number, gz: number, speed: number, arriveR: number): boolean {
    const x = this.x;
    const z = this.z;
    const dGoal = hyp(gx - x, gz - z);
    if (dGoal <= arriveR) {
      this.arrived = true;
      return true;
    }
    this.arrived = false;
    this.repathT -= dt;
    this.pathFailT = Math.max(0, this.pathFailT - dt);
    const goalMoved = !(Math.abs(gx - this.pathGoalX) < 0.9 && Math.abs(gz - this.pathGoalZ) < 0.9);
    if (goalMoved || this.pathLen === 0 || this.repathT <= 0) {
      if (goalMoved || this.pathFailT <= 0) this.plan(x, z, gx, gz);
      this.repathT = this.mode === 'chase' ? 0.4 : 1.2;
    }
    if (this.pathLen === 0) return false;
    // Advance along the path.
    const grid = this.grid;
    while (this.pathIdx < this.pathLen) {
      const px = this.path[this.pathIdx * 2] as number;
      const pz = this.path[this.pathIdx * 2 + 1] as number;
      const last = this.pathIdx === this.pathLen - 1;
      const dp = hyp(px - x, pz - z);
      if (!(dp < (last ? Math.max(0.2, arriveR * 0.6) : 0.4))) break;
      // In a building a corner point is passed only once the next one is in clear sight on the floor grid (or right at
      // it): cutting a doorway's corner from a little off the path walks into the jamb.
      if (!last && this.layers !== null && grid !== null && dp > 0.12 && !grid.lineClear(x, z, this.path[this.pathIdx * 2 + 2] as number, this.path[this.pathIdx * 2 + 3] as number)) break;
      this.pathIdx++;
    }
    if (this.pathIdx >= this.pathLen) {
      this.arrived = dGoal <= arriveR + 0.8;
      return this.arrived;
    }
    // In a building, pushed off the path's line beside a door frame (the next point no longer in clear sight): back
    // to the corner point first, from where the stretch is clear.
    if (this.layers !== null && grid !== null && this.pathIdx > 0) {
      const px = this.path[this.pathIdx * 2 - 2] as number;
      const pz = this.path[this.pathIdx * 2 - 1] as number;
      if (hyp(px - x, pz - z) < 1.5 && !grid.lineClear(x, z, this.path[this.pathIdx * 2] as number, this.path[this.pathIdx * 2 + 1] as number) && grid.lineClear(x, z, px, pz)) this.pathIdx--;
    }
    const tx = this.path[this.pathIdx * 2] as number;
    const tz = this.path[this.pathIdx * 2 + 1] as number;
    this.steer(env, dt, tx, tz, speed, this.pathIdx === this.pathLen - 1 ? Math.min(dGoal, hyp(tx - x, tz - z)) : Infinity);
    return false;
  }

  private plan(x: number, z: number, gx: number, gz: number): void {
    this.pathGoalX = gx;
    this.pathGoalZ = gz;
    this.pathIdx = 0;
    const grid = this.grid;
    if (grid === null) {
      this.path[0] = gx;
      this.path[1] = gz;
      this.pathLen = 1;
      return;
    }
    const n = grid.findPath(x, z, gx, gz, this.path);
    this.pathLen = n;
    if (n === 0) this.pathFailT = 1.5;
    // Skip a first point that is behind us (the start cell centre).
    if (n > 1) {
      const p0x = this.path[0] as number;
      const p0z = this.path[1] as number;
      if (hyp(p0x - x, p0z - z) < 0.45) this.pathIdx = 1;
    }
  }

  private steer(env: BehaviorEnv, dt: number, tx: number, tz: number, speed: number, remaining: number): void {
    const s = this.self;
    const x = this.x;
    const z = this.z;
    let dx = tx - x;
    let dz = tz - z;
    const d = hyp(dx, dz);
    if (d < 1e-6) return;
    dx /= d;
    dz /= d;
    // Separation from other NPCs (and a soft margin around the player).
    const sep = this.sys.separation(this);
    let vx = dx + sep[0] * 1.4;
    let vz = dz + sep[1] * 1.4;
    // A pack keeps together: cohesion and alignment with its own kind nearby.
    const flock = this.spec.flock ?? 0;
    if (flock > 0) {
      const f = this.sys.flock(this);
      vx += (f[0] as number) * flock;
      vz += (f[1] as number) * flock;
    }
    const vl = hyp(vx, vz);
    if (vl > 1e-6) {
      vx /= vl;
      vz /= vl;
    }
    // Ramp speed; slow into the final point.
    let target = speed;
    if (remaining < 1.2) target = arriveSpeed(remaining, target);
    // In a building the player ahead on a narrow way goes first: stand, then step aside (right, left, else back) while
    // they pass; after a few seconds the resident goes on (characters pass through each other then).
    let giving = false;
    const sys = this.sys;
    if (this.layers !== null && this.grid !== null && !Number.isNaN(sys.playerX) && !s.dynamic && !this.isHostileToPlayer()) {
      const ox = sys.playerX - x;
      const oz = sys.playerZ - z;
      const od = hyp(ox, oz);
      if (od < WAY_AHEAD && Math.abs(sys.playerY - this.feetY) < 1.2 && ox * dx + oz * dz > 0.35 * od && this.wayT < WAY_MAX_S) {
        giving = true;
        this.wayT += dt;
        target = 0;
        if (this.wayT > WAY_STAND_S) {
          const grid = this.grid;
          const reach = this.spec.radius + 0.35;
          // Right of the way it walks, then left, then back the way it came; whichever is open on the floor grid.
          const sides: ReadonlyArray<readonly [number, number]> = [[-dz, dx], [dz, -dx], [-dx, -dz]];
          for (const [sx, sz] of sides) {
            if (free(grid, x + sx * reach, z + sz * reach, false)) {
              vx = sx;
              vz = sz;
              target = speed * WAY_PACE;
              break;
            }
          }
        }
      } else this.wayT = Math.max(0, this.wayT - dt);
    }
    this.wantMove = true;
    this.speedNow += clamp(target - this.speedNow, -18 * dt, 9 * dt);
    const step = this.speedNow * dt;
    this.lastDx = vx;
    this.lastDz = vz;
    if (s.dynamic) {
      const v = env.velocityOf(s.id);
      tmpVel[0] = vx * this.speedNow;
      tmpVel[1] = v ? v[1] : 0;
      tmpVel[2] = vz * this.speedNow;
      env.setVelocity(s.id, tmpVel);
      faceDirection(s, vx, vz, this.spec.turnRate, dt);
      this.sys.holdDoorsNear(this);
      return;
    }
    env.pose(s);
    this.sys.holdDoorsNear(this);
    let nx = s.anchor[0] + vx * step;
    let nz = s.anchor[2] + vz * step;
    const grid = this.grid;
    // Just off a stair the NPC may stand in a blocked cell beside the stairwell: let it walk out.
    const escaping = this.exitT > 0 && grid !== null && !grid.walkable(s.anchor[0], s.anchor[2]);
    if (grid !== null && this.layers !== null) {
      // In a building the NPC follows its path (each stretch is clear on the floor grid): neighbours push it aside
      // only where there is room, and its body may brush a door frame (the squeeze mask), never cross a wall.
      if (giving && !free(grid, nx, nz, true)) {
        nx = s.anchor[0];
        nz = s.anchor[2];
      } else if (!escaping && !free(grid, nx, nz, true)) {
        nx = s.anchor[0] + dx * step;
        nz = s.anchor[2] + dz * step;
        if (!free(grid, nx, nz, true) && free(grid, s.anchor[0], s.anchor[2], true)) {
          // Off the path's line at a corner: back toward the middle of the nearest open cell.
          const c = grid.nearest(s.anchor[0], s.anchor[2], 2);
          nx = s.anchor[0];
          nz = s.anchor[2];
          if (c >= 0) {
            const cx = grid.cellX(c) - nx;
            const cz = grid.cellZ(c) - nz;
            const cd = hyp(cx, cz);
            if (cd > 1e-4) {
              const k = Math.min(1, step / cd);
              nx += cx * k;
              nz += cz * k;
            }
          }
        }
      }
    } else if (grid !== null && !escaping && !grid.walkable(nx, nz)) {
      // Slide along the obstacle, else stay.
      if (grid.walkable(nx, s.anchor[2])) nz = s.anchor[2];
      else if (grid.walkable(s.anchor[0], nz)) nx = s.anchor[0];
      else {
        nx = s.anchor[0];
        nz = s.anchor[2];
      }
    }
    s.anchor[0] = nx;
    s.anchor[2] = nz;
    this.x = nx;
    this.z = nz;
    this.snapToFloor(env);
    faceDirection(s, vx, vz, this.spec.turnRate, dt);
    this.phase += this.speedNow * dt * 2.2;
  }

  /** Keep a kinematic NPC on the floor under it. */
  private snapToFloor(env: BehaviorEnv): void {
    const s = this.self;
    if (s.dynamic) return;
    const grid = this.grid;
    const guess = s.anchor[1] - this.feetOffset;
    const floor = grid ? grid.floorAt(s.anchor[0], s.anchor[2], guess) : guess;
    // Hills: a ray cast corrects the flat grid floor, a few times a second per NPC. In a world with buildings only on
    // the lowest floor and only by less than a step: the floor grids are exact indoors, and a larger correction stood
    // people on the sofa they walked past.
    if ((this.layers === null || this.layer === 0) && (this.sys.tickNo + this.index) % GROUND_EVERY === 0) {
      const ground = this.sys.groundHeight(s.anchor[0], s.anchor[2], floor + this.spec.height + 0.6, this.id);
      const reach = this.layers === null ? 1.2 : 0.3;
      this.groundOff = ground !== undefined && Math.abs(ground - floor) < reach ? ground - floor : 0;
    }
    s.anchor[1] = floor + this.groundOff + this.feetOffset;
    void env;
  }

  private face(env: BehaviorEnv, dt: number, tx: number, tz: number): void {
    const s = this.self;
    if (s.dynamic) return;
    env.pose(s);
    faceDirection(s, tx - this.x, tz - this.z, this.spec.turnRate, dt);
  }

  private stop(env: BehaviorEnv): void {
    if (this.self.dynamic) {
      const v = env.velocityOf(this.id);
      tmpVel[0] = 0;
      tmpVel[1] = v ? v[1] : 0;
      tmpVel[2] = 0;
      env.setVelocity(this.id, tmpVel);
    }
    this.speedNow = 0;
  }

  private trackStuck(dt: number): void {
    this.stuckCheckT += dt;
    if (this.stuckCheckT < STUCK_WINDOW) return;
    this.stuckCheckT = 0;
    const x = this.x;
    const z = this.z;
    const moved = hyp(x - this.stuckX, z - this.stuckZ);
    this.stuckX = x;
    this.stuckZ = z;
    const intended = this.wantMove && this.speedNow > 0.2 && !this.arrived;
    if (intended && moved < 0.06 + this.speedNow * 0.06) this.stuckT += STUCK_WINDOW;
    else if (moved > 0.1 || !this.wantMove) this.stuckT = 0;
    if (this.stuckT >= 1) {
      // Re-plan with a side-step, then snap back onto walkable ground, then give the goal up.
      this.pathLen = 0;
      this.pathFailT = 0;
      this.repathT = 0;
      if (this.stuckT >= 2.5) this.unstick();
      if (this.stuckT >= 5 && this.mode === 'patrol') {
        this.wp = (this.wp + 1) % Math.max(1, this.spec.waypoints.length);
        this.stuckT = 0;
      }
    }
    const stuck = Math.round(this.stuckT * 2) / 2;
    if (stuck !== this.shownStuck) {
      this.shownStuck = stuck;
      this.self.state['npcStuck'] = stuck;
    }
  }

  private unstick(): void {
    const grid = this.grid;
    const s = this.self;
    this.unstuckCount++;
    if (grid === null || s.dynamic) return;
    const i = grid.nearest(s.anchor[0], s.anchor[2], 8);
    if (i < 0) return;
    this.sys.env.pose(s);
    // Nudge to the centre of the nearest free cell, offset by a deterministic side.
    s.anchor[0] = grid.cellX(i) + (this.random() - 0.5) * 0.2;
    s.anchor[2] = grid.cellZ(i) + (this.random() - 0.5) * 0.2;
    this.x = s.anchor[0];
    this.z = s.anchor[2];
    this.snapToFloor(this.sys.env);
    this.sys.env.log(`npc ${this.id}: unstuck (#${this.unstuckCount})`);
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------

  private doIdle(env: BehaviorEnv, dt: number): void {
    const spec = this.spec;
    const routine = spec.routine;
    if (routine !== undefined && routine.length > 0 && !this.eff.stationary) {
      this.doRoutine(env, dt, routine);
      return;
    }
    if (spec.roam === true && !this.eff.stationary && spec.wander > 0) {
      this.roam(env, dt, this.homeX, this.homeZ, spec.wander, spec.speed * 0.6);
      return;
    }
    if (this.eff.stationary || spec.wander <= 0) {
      this.stop(env);
      if (this.eff.spec.archetype === 'sentinel') this.scan(env, dt, 50);
      else if (this.eff.spec.archetype === 'merchant') this.facePlayerIfNear(env, dt, 6);
      return;
    }
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.stop(env);
      return;
    }
    if (Number.isNaN(this.wanderX)) this.pickWander(spec.wander);
    if (this.goTo(env, dt, this.wanderX, this.wanderZ, spec.speed * 0.6, 0.5)) {
      this.wanderX = Number.NaN;
      this.waitT = 1 + this.random() * 3.5;
      this.stop(env);
    } else if (this.pathLen === 0 && this.pathFailT > 0) {
      this.wanderX = Number.NaN;
      this.waitT = 0.5;
    }
  }

  /**
   * A day's routine: go to the stop of the hour (or the next one in turn), across floors by the stairs, then linger
   * there, drifting within its wander radius, for its stay.
   */
  private doRoutine(env: BehaviorEnv, dt: number, routine: readonly NpcRoutineStop[]): void {
    const hour = this.sys.hour();
    let want = -1;
    for (let i = 0; i < routine.length; i++) {
      const h = (routine[i] as NpcRoutineStop).hours;
      if (h !== undefined && inHours(hour, h[0], h[1])) {
        want = i;
        break;
      }
    }
    if (want < 0) {
      const cur = routine[this.stopIdx];
      want = this.stopIdx >= 0 && cur !== undefined && cur.hours === undefined ? this.stopIdx : this.nextStop(routine, this.stopIdx);
    }
    if (this.sitPhase === 3) {
      // Standing up before anything else.
      this.stop(env);
      this.sitT += dt;
      if (this.sitT >= SIT_RISE_S) this.sitPhase = 0;
      return;
    }
    if (want !== this.stopIdx && this.sitPhase !== 0) {
      this.sitPhase = 3;
      this.sitT = 0;
      this.stop(env);
      return;
    }
    if (want !== this.stopIdx) {
      this.stopIdx = want;
      this.atStop = false;
      this.wanderX = Number.NaN;
      this.waitT = 0;
    }
    const st = routine[this.stopIdx] as NpcRoutineStop;
    if (!this.atStop) {
      if (this.goTo(env, dt, st.at[0], st.at[2], this.spec.speed, 0.6, this.levelOf(st.at))) {
        this.atStop = true;
        this.stayT = st.stay * (0.8 + this.random() * 0.4);
        this.homeX = st.at[0];
        this.homeZ = st.at[2];
        this.wanderX = Number.NaN;
        this.waitT = 1 + this.random() * 2;
        this.stop(env);
      } else if (this.trav < 0 && this.pathLen === 0 && this.pathFailT > 0) {
        // Out of reach (walled off, no stair to it): try the next stop after a moment.
        this.stayT -= dt;
        if (this.stayT < -3) {
          this.stopIdx = this.nextStop(routine, this.stopIdx);
          this.stayT = 0;
        }
      }
      return;
    }
    if (st.sit !== undefined && (this.stayT > 0 || this.sitPhase !== 0 || st.hours !== undefined) && this.doSit(env, dt, st)) return;
    this.stayT -= dt;
    if (this.stayT <= 0 && st.hours === undefined && this.trav < 0) {
      const next = this.nextStop(routine, this.stopIdx);
      if (next !== this.stopIdx) {
        this.stopIdx = next;
        this.atStop = false;
        this.wanderX = Number.NaN;
        return;
      }
      this.stayT = st.stay;
    }
    if (st.wander <= 0) {
      this.stop(env);
      return;
    }
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.stop(env);
      return;
    }
    if (Number.isNaN(this.wanderX)) this.pickWander(st.wander);
    if (this.goTo(env, dt, this.wanderX, this.wanderZ, this.spec.speed * 0.6, 0.4)) {
      this.wanderX = Number.NaN;
      this.waitT = 1.5 + this.random() * 4;
      this.stop(env);
    } else if (this.pathLen === 0 && this.pathFailT > 0) {
      this.wanderX = Number.NaN;
      this.waitT = 0.5;
    }
  }

  /**
   * Sitting at a stop: turn to face out of the seat, sit for the stay (a stop with hours: while it is the stop of the hour), then
   * rise (the caller moves on once standing). True while it holds the character.
   */
  private doSit(env: BehaviorEnv, dt: number, st: NpcRoutineStop): boolean {
    const seat = st.sit !== undefined ? env.positionOf(st.sit) : undefined;
    if (!seat) return false;
    this.stop(env);
    if (this.sitPhase === 0) {
      this.sitPhase = 1;
      this.sitT = 0;
      this.sitSeat = st.sit as string;
    }
    if (this.sitPhase === 1) {
      // Out of the seat is away from its centre.
      this.face(env, dt, this.x + (this.x - seat[0]), this.z + (this.z - seat[2]));
      this.sitT += dt;
      if (this.sitT >= SIT_TURN_S) this.sitPhase = 2;
      return true;
    }
    this.stayT -= dt;
    if (this.stayT <= 0 && st.hours === undefined) {
      this.sitPhase = 3;
      this.sitT = 0;
      this.stayT = 0;
    }
    return true;
  }

  /** The next stop without hours after `i` (cyclic), or `i` itself when there is none. */
  private nextStop(routine: readonly NpcRoutineStop[], i: number): number {
    for (let k = 1; k <= routine.length; k++) {
      const j = (((i + k) % routine.length) + routine.length) % routine.length;
      if ((routine[j] as NpcRoutineStop).hours === undefined) return j;
    }
    return Math.max(0, i);
  }

  /**
   * Roam: meander within `radius` of (cx, cz) with a steering wander (a target jittering on a circle ahead), turning
   * back toward the centre near the edge or at a wall. Draws from the seeded stream only.
   */
  private roam(env: BehaviorEnv, dt: number, cx: number, cz: number, radius: number, speed: number): void {
    this.refreshGrid();
    const out = this.dirOut;
    wanderDirection(this.wanderState, this.random, dt, this.lastDx, this.lastDz, out);
    let dx = out[0] as number;
    let dz = out[1] as number;
    const fx = this.x - cx;
    const fz = this.z - cz;
    const far = hyp(fx, fz);
    // Past three quarters of the radius the pull home grows; ahead blocked turns it home too.
    const grid = this.grid;
    const blocked = grid !== null && !grid.walkable(this.x + dx * 1.2, this.z + dz * 1.2);
    if (far > radius * 0.75 || blocked) {
      const k = blocked ? 1 : Math.min(1, (far - radius * 0.75) / Math.max(0.1, radius * 0.25));
      dx = dx * (1 - k) - (fx / Math.max(1e-6, far)) * k;
      dz = dz * (1 - k) - (fz / Math.max(1e-6, far)) * k;
      if (blocked) this.wanderState.theta += Math.PI * 0.5;
    }
    const l = hyp(dx, dz);
    if (l < 1e-6) return;
    this.steer(env, dt, this.x + (dx / l) * 2, this.z + (dz / l) * 2, speed, Infinity);
  }

  private pickWander(r: number): void {
    this.refreshGrid();
    for (let k = 0; k < 8; k++) {
      const a = this.random() * Math.PI * 2;
      const d = (0.35 + this.random() * 0.65) * r;
      const px = this.homeX + Math.cos(a) * d;
      const pz = this.homeZ + Math.sin(a) * d;
      if (this.grid === null || this.grid.walkable(px, pz)) {
        this.wanderX = px;
        this.wanderZ = pz;
        return;
      }
    }
    this.wanderX = this.homeX;
    this.wanderZ = this.homeZ;
  }

  private facePlayerIfNear(env: BehaviorEnv, dt: number, range: number): void {
    const pid = env.playerId();
    const pp = pid !== undefined ? env.positionOf(pid) : undefined;
    if (pp && hyp(pp[0] - this.x, pp[2] - this.z) < range) this.face(env, dt, pp[0], pp[2]);
  }

  private scan(env: BehaviorEnv, dt: number, amplitude: number): void {
    if (this.self.dynamic) return;
    this.scanT += dt;
    if (this.scanT > 2.2) {
      this.scanT = 0;
      this.scanDir = -this.scanDir;
    }
    env.pose(this.self);
    this.self.yawDeg += this.scanDir * amplitude * dt;
  }

  private doPatrol(env: BehaviorEnv, dt: number): void {
    const w = this.spec.waypoints;
    if (w.length === 0 || this.eff.stationary) {
      this.stop(env);
      return;
    }
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.stop(env);
      return;
    }
    const p = w[this.wp % w.length] as Vec3;
    if (this.goTo(env, dt, p[0], p[2], this.spec.speed, 0.6, this.levelOf(p))) {
      this.legs++;
      this.self.state['npcLegs'] = this.legs;
      this.waitT = this.spec.patrol.wait;
      this.stop(env);
      this.advanceWaypoint(w.length);
      this.pathLen = 0;
    } else if (this.trav < 0 && this.pathLen === 0 && this.pathFailT > 0) {
      // Unreachable waypoint: skip it after a moment instead of freezing.
      this.stuckT = Math.max(this.stuckT, 1.5);
      this.advanceWaypoint(w.length);
    }
  }

  private advanceWaypoint(n: number): void {
    if (n <= 1) return;
    switch (this.spec.patrol.mode) {
      case 'loop': this.wp = (this.wp + 1) % n; break;
      case 'pingpong':
        if (this.wp + this.wpDir >= n || this.wp + this.wpDir < 0) this.wpDir = -this.wpDir;
        this.wp += this.wpDir;
        break;
      case 'random': {
        let next = Math.floor(this.random() * n);
        if (next === this.wp) next = (next + 1) % n;
        this.wp = next;
        break;
      }
    }
  }

  private doInvestigate(env: BehaviorEnv, dt: number): void {
    if (!this.hasLast) {
      this.stop(env);
      return;
    }
    if (this.eff.stationary) {
      this.face(env, dt, this.lastX, this.lastZ);
      this.stop(env);
      return;
    }
    if (!this.arrived) {
      this.aimAtFoe();
      this.goTo(env, dt, this.aim[1] as number, this.aim[2] as number, this.spec.speed * 1.35, 1.1, this.aim[0] as number);
    } else {
      this.stop(env);
      this.scan(env, dt, 70);
    }
  }

  private doChase(env: BehaviorEnv, dt: number): void {
    if (!this.hasLast || this.eff.stationary) {
      this.stop(env);
      return;
    }
    const range = this.eff.attackRange;
    this.aimAtFoe();
    this.goTo(env, dt, this.aim[1] as number, this.aim[2] as number, this.spec.runSpeed, Math.max(0.5, range * 0.7), this.aim[0] as number);
  }

  /**
   * Where to go for the foe: its last known position and floor, or — when it was last seen on a stair — the end of
   * that stair it was nearer (into `aim` as level, x, z). Without stairs, simply the last known position.
   */
  private aimAtFoe(): void {
    const a = this.aim;
    const l = this.layers;
    if (l === null || Number.isNaN(this.lastY)) {
      a[0] = -1;
      a[1] = this.lastX;
      a[2] = this.lastZ;
      return;
    }
    l.aimFor(this.lastX, this.lastY, this.lastZ, a);
  }

  private doAttack(env: BehaviorEnv, dt: number): void {
    const atk = this.spec.attack;
    if (!this.hasLast) {
      this.stop(env);
      return;
    }
    const x = this.x;
    const z = this.z;
    const d = hyp(this.lastX - x, this.lastZ - z);
    const range = this.eff.attackRange;
    this.aimAtFoe();
    // On another floor (not on a stair between them) the foe is out of reach whatever the plan distance.
    const elsewhere = (this.aim[0] as number) >= 0 && (this.aim[0] as number) !== this.layer && this.trav < 0 && Math.abs(this.lastY - this.feetY) > 1.4;
    if ((d > range * 0.85 || elsewhere) && !this.eff.stationary) this.goTo(env, dt, elsewhere ? (this.aim[1] as number) : this.lastX, elsewhere ? (this.aim[2] as number) : this.lastZ, this.spec.runSpeed * 0.7, range * 0.7, this.aim[0] as number);
    else this.stop(env);
    this.face(env, dt, this.lastX, this.lastZ);
    if (atk && this.windupOn) {
      // The telegraphed blow lands when the wind-up ends, if the foe is still in reach (stepping back dodges it).
      this.windupT -= dt;
      if (this.windupT > 0) return;
      this.windupOn = false;
      this.attackCd = atk.cooldown;
      if (d <= range * 1.2 && this.lostT <= 0.5 && !elsewhere && (atk.accuracy === undefined || this.random() < atk.accuracy)) this.sys.hit(this, this.targetKind, this.targetId, atk.damage);
      return;
    }
    if (!atk || this.attackCd > 0 || d > range * 1.05 || this.lostT > 0.5 || elsewhere) return;
    this.attackAnimT = 0.35;
    if (atk.ranged) {
      // Gunfire is not a metronome: each shot comes a little early or late.
      this.attackCd = atk.cooldown * (0.8 + this.random() * 0.4);
      // Accuracy falls from `accuracy` up close to `farAccuracy` at the edge of the range.
      const near = atk.accuracy ?? 1;
      const far = atk.farAccuracy ?? near;
      const k = Math.min(1, Math.max(0, d / Math.max(0.1, range)));
      this.sys.shoot(this, this.targetKind, this.targetId, atk.damage, this.random() < near + (far - near) * k);
    } else if (atk.windup !== undefined && atk.windup > 0) {
      // Telegraph the blow: the swing starts now (with a warning cue), the damage comes at the end of it.
      this.windupOn = true;
      this.windupT = atk.windup;
      this.attackAnimT = atk.windup + 0.2;
      this.sys.telegraph(this);
    } else {
      this.attackCd = atk.cooldown;
      if (atk.accuracy === undefined || this.random() < atk.accuracy) this.sys.hit(this, this.targetKind, this.targetId, atk.damage);
    }
  }

  private doFlee(env: BehaviorEnv, dt: number): void {
    if (this.eff.stationary) {
      this.stop(env);
      return;
    }
    const x = this.x;
    const z = this.z;
    this.fleeT -= dt;
    if (Number.isNaN(this.fleeX) || this.fleeT <= 0 || this.arrived) {
      this.fleeT = 0.7;
      let tx: number;
      let tz: number;
      if (this.fearNow) {
        tx = this.fearX;
        tz = this.fearZ;
      } else if (this.hasLast) {
        tx = this.lastX;
        tz = this.lastZ;
      } else {
        tx = x - this.lastDx;
        tz = z - this.lastDz;
      }
      this.pickFlee(x, z, tx, tz);
    }
    this.goTo(env, dt, this.fleeX, this.fleeZ, this.spec.runSpeed, 0.8);
  }

  private pickFlee(x: number, z: number, tx: number, tz: number): void {
    this.refreshGrid();
    let dx = x - tx;
    let dz = z - tz;
    const d = hyp(dx, dz);
    if (d < 1e-4) {
      const a = this.random() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
    } else {
      dx /= d;
      dz /= d;
    }
    const grid = this.grid;
    const base = Math.atan2(dz, dx);
    let fallback = false;
    for (let k = 0; k < 7; k++) {
      // 0, +40, -40, +80, -80, +120, -120 degrees around the away direction.
      const off = ((k + 1) >> 1) * 40 * DEG2RAD * (k % 2 === 1 ? 1 : -1);
      const a = base + (k === 0 ? 0 : off);
      for (let dist = 12; dist >= 4; dist -= 4) {
        const px = x + Math.cos(a) * dist;
        const pz = z + Math.sin(a) * dist;
        if (grid === null || (grid.walkable(px, pz) && grid.lineClear(x, z, px, pz))) {
          this.fleeX = px;
          this.fleeZ = pz;
          return;
        }
        fallback = true;
      }
    }
    void fallback;
    this.fleeX = this.homeX;
    this.fleeZ = this.homeZ;
  }

  private doFollow(env: BehaviorEnv, dt: number): void {
    const pid = env.playerId();
    const pp = pid !== undefined ? env.positionOf(pid) : undefined;
    if (!pp || this.eff.stationary) {
      this.stop(env);
      return;
    }
    const x = this.x;
    const z = this.z;
    const d = hyp(pp[0] - x, pp[2] - z);
    if (d > 2.6) {
      const speed = d > 7 ? this.spec.runSpeed : this.spec.speed * 1.2;
      const l = this.layers;
      if (l !== null) {
        l.aimFor(pp[0], pp[1], pp[2], this.aim);
        this.goTo(env, dt, this.aim[1] as number, this.aim[2] as number, speed, 2.2, this.aim[0] as number);
      } else this.goTo(env, dt, pp[0], pp[2], speed, 2.2);
    } else {
      this.stop(env);
      this.face(env, dt, pp[0], pp[2]);
    }
  }

  private doTalk(env: BehaviorEnv, dt: number): void {
    this.stop(env);
    const pid = env.playerId();
    const pp = pid !== undefined ? env.positionOf(pid) : undefined;
    if (pp) this.face(env, dt, pp[0], pp[2]);
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------

  private animate(env: BehaviorEnv, dt: number): void {
    const s = this.self;
    let next: Anim;
    if (this.sitPhase !== 0 && this.mode !== 'idle') this.sitPhase = 0;
    if (this.hurtT > 0) next = 'hurt';
    else if (this.attackAnimT > 0) next = 'attack';
    else if (this.mode === 'talk' || this.mode === 'trade') next = 'talk';
    else if (this.sitPhase === 2) next = 'sit';
    else if (this.speedNow > this.spec.speed * 1.5 + 0.2) next = 'run';
    else if (this.speedNow > 0.15) next = 'walk';
    else next = 'idle';
    if (next !== this.anim) {
      this.anim = next;
      s.state['npcAnim'] = next;
    }
    s.state['npcSpeed'] = Math.round(this.speedNow * 10) / 10;
    if (s.dynamic) return;
    env.pose(s);
    // A person drawn by the character renderer animates itself (skeleton clips); no bob or lunge.
    if (this.self.spec.character) return;
    // Procedural life: a walking bob, a lean into runs, a lunge when striking.
    const moving = this.speedNow > 0.15;
    if (moving) {
      s.offset[1] += Math.abs(Math.sin(this.phase)) * 0.045 * Math.min(1.5, this.speedNow / 2);
    } else {
      s.offset[1] += Math.sin(env.time * 1.6 + this.index) * 0.008;
    }
    if (this.attackAnimT > 0) {
      const k = Math.sin((this.attackAnimT / 0.35) * Math.PI) * 0.35;
      const yaw = this.yaw() * DEG2RAD;
      s.offset[0] += -Math.sin(yaw) * k;
      s.offset[2] += -Math.cos(yaw) * k;
    }
    void dt;
  }

  /** Face direction used for angle helpers in tests. */
  headingTo(tx: number, tz: number): number {
    return angleDelta(this.yaw(), yawFromDirection(tx - this.x, tz - this.z, this.yaw()));
  }
}

/** Root of a parent chain made of NPCs: the entity whose pose actually moves (or `id` itself). */
function carrierOf(env: BehaviorEnv, id: EntityId): EntityId {
  let cur = id;
  for (let depth = 0; depth < 4; depth++) {
    const parent = env.entity(cur)?.spec.parent;
    if (parent === null || parent === undefined) return cur;
    cur = parent;
  }
  return cur;
}

/** Whether a body's centre may step to (x, z) on `grid` (squeezing past corners when `squeeze`). */
function free(grid: NavGrid, x: number, z: number, squeeze: boolean): boolean {
  return grid.walkable(x, z) || (squeeze && grid.passable(x, z));
}

const tmpVel: Vec3 = [0, 0, 0];
const targetOut: { kind: number; id: EntityId | null } = { kind: 0, id: null };
