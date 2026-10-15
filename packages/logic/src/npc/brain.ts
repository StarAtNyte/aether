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
import type { EntityId, NpcMode, NpcSpec, Vec3 } from '@aether/core';
import type { BehaviorEnv, BehaviorInstance } from '../behaviors/types';
import type { RuntimeEntity } from '../entities';
import { faceDirection } from '../behaviors/move';
import { angleDelta, clamp, yawFromDirection, yawOfQuat } from '../vec';
import { evalCond, inHours, newSenses, type NpcEff, type Senses } from './graph';
import { NAV_MAX_PATH, type NavGrid } from './nav';
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

/** Animation hints published on `state.npcAnim`. */
type Anim = 'idle' | 'walk' | 'run' | 'attack' | 'talk' | 'hurt' | 'dead';

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
  hp: number;
  angry = false;
  following: boolean;
  // --- position bookkeeping ------------------------------------------------------
  private readonly homeX: number;
  private readonly homeZ: number;
  private feetOffset = Number.NaN;
  private grid: NavGrid | null = null;
  private gridTick = -1;
  // --- targeting -----------------------------------------------------------------
  private targetKind = T_NONE;
  private targetId: EntityId | null = null;
  private lastX = 0;
  private lastZ = 0;
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
    };
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
    if (this.dead) return;
    this.modeT += dt;
    this.barkCd = Math.max(0, this.barkCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackAnimT = Math.max(0, this.attackAnimT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.lostT += dt;
    this.heardT += dt;
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

  // ---------------------------------------------------------------------------
  // Ground, health
  // ---------------------------------------------------------------------------

  private initGround(env: BehaviorEnv): void {
    const s = this.self;
    const grid = this.sys.gridFor(this);
    this.grid = grid;
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
    this.hasLast = true;
    this.lostT = 0;
    this.angry = true;
  }

  /** Stop being hostile: forget the current foe. */
  calm(): void {
    this.angry = false;
    this.hasLast = false;
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
    this.sys.env.emit('npc-died');
    this.sys.env.emit(`${this.id}-died`);
    this.sys.onDeath(this);
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
        if (d2 <= sight2 && this.cone(dx, dz, d2, fx, fz, cosHalf) && this.clear(grid, x, z, pp[0], pp[2])) {
          bestD2 = d2;
          bestKind = T_PLAYER;
          bestId = pid ?? null;
          bx = pp[0];
          bz = pp[2];
        } else if (d2 <= sys.hearingRadius(this) * sys.hearingRadius(this)) {
          if (this.heardT > HEARD_LATCH * 0.5) this.onHeard(pp[0], pp[2]);
        }
      }
    }
    const others = sys.brains;
    for (let i = 0; i < others.length; i++) {
      const o = others[i] as NpcBrain;
      if (o === this || o.dead || !this.isHostileTo(o)) continue;
      const dx = o.x - x;
      const dz = o.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > sight2 || d2 >= bestD2) continue;
      if (Math.abs(o.feetY - feet) > 3 + this.spec.height) continue;
      if (!this.cone(dx, dz, d2, fx, fz, cosHalf) || !this.clear(grid, x, z, o.x, o.z)) continue;
      bestD2 = d2;
      bestKind = T_NPC;
      bestId = o.id;
      bx = o.x;
      bz = o.z;
    }
    if (bestKind !== T_NONE) {
      const first = !this.sawFoeBefore();
      this.sawFoeNow = true;
      this.targetKind = bestKind;
      this.targetId = bestId;
      this.lastX = bx;
      this.lastZ = bz;
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

  private onHeard(x: number, z: number): void {
    this.heardT = 0;
    if (!this.sawFoeNow) {
      this.lastX = x;
      this.lastZ = z;
      this.hasLast = true;
    }
    this.bark('alert', this.spec.barks?.alert);
  }

  /** A noise (or an ally's alarm) at (x, z) that this NPC can hear. */
  hear(x: number, z: number): void {
    if (this.dead || this.isResting()) return;
    this.onHeard(x, z);
  }

  /** An ally saw a foe at (x, z): remember it. */
  warn(x: number, z: number, kind: number, id: EntityId | null): void {
    if (this.dead || this.isResting()) return;
    if (this.lostT < 1) return;
    this.hasLast = true;
    this.lastX = x;
    this.lastZ = z;
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
        }
      } else if (this.targetKind === T_NPC && this.targetId !== null) {
        const o = this.sys.brainOf(this.targetId);
        if (o && !o.dead) {
          this.lastX = o.x;
          this.lastZ = o.z;
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
      this.grid = this.sys.gridFor(this);
    }
  }

  /**
   * Walk toward (gx, gz). Returns true once within `arriveR`. Plans a path on
   * the nav grid when needed (cheap A* with a bounded budget) and steers
   * along it with separation from neighbours.
   */
  private goTo(env: BehaviorEnv, dt: number, gx: number, gz: number, speed: number, arriveR: number): boolean {
    this.refreshGrid();
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
    while (this.pathIdx < this.pathLen) {
      const px = this.path[this.pathIdx * 2] as number;
      const pz = this.path[this.pathIdx * 2 + 1] as number;
      const last = this.pathIdx === this.pathLen - 1;
      if (hyp(px - x, pz - z) < (last ? Math.max(0.2, arriveR * 0.6) : 0.4)) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= this.pathLen) {
      this.arrived = dGoal <= arriveR + 0.8;
      return this.arrived;
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
    const vl = hyp(vx, vz);
    if (vl > 1e-6) {
      vx /= vl;
      vz /= vl;
    }
    // Ramp speed; slow into the final point.
    let target = speed;
    if (remaining < 1.2) target = Math.min(target, 0.5 + remaining * 1.6);
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
      return;
    }
    env.pose(s);
    let nx = s.anchor[0] + vx * step;
    let nz = s.anchor[2] + vz * step;
    const grid = this.grid;
    if (grid !== null && !grid.walkable(nx, nz)) {
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
    // Hills: a ray cast corrects the flat grid floor, a few times a second per NPC.
    if ((this.sys.tickNo + this.index) % GROUND_EVERY === 0) {
      const ground = this.sys.groundHeight(s.anchor[0], s.anchor[2], floor + this.spec.height + 0.6, this.id);
      this.groundOff = ground !== undefined && Math.abs(ground - floor) < 1.2 ? ground - floor : 0;
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
    if (Number.isNaN(this.wanderX)) this.pickWander();
    if (this.goTo(env, dt, this.wanderX, this.wanderZ, spec.speed * 0.6, 0.5)) {
      this.wanderX = Number.NaN;
      this.waitT = 1 + this.random() * 3.5;
      this.stop(env);
    } else if (this.pathLen === 0 && this.pathFailT > 0) {
      this.wanderX = Number.NaN;
      this.waitT = 0.5;
    }
  }

  private pickWander(): void {
    const r = this.spec.wander;
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
    if (this.goTo(env, dt, p[0], p[2], this.spec.speed, 0.6)) {
      this.legs++;
      this.self.state['npcLegs'] = this.legs;
      this.waitT = this.spec.patrol.wait;
      this.stop(env);
      this.advanceWaypoint(w.length);
      this.pathLen = 0;
    } else if (this.pathLen === 0 && this.pathFailT > 0) {
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
      this.goTo(env, dt, this.lastX, this.lastZ, this.spec.speed * 1.35, 1.1);
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
    this.goTo(env, dt, this.lastX, this.lastZ, this.spec.runSpeed, Math.max(0.5, range * 0.7));
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
    if (d > range * 0.85 && !this.eff.stationary) this.goTo(env, dt, this.lastX, this.lastZ, this.spec.runSpeed * 0.7, range * 0.7);
    else this.stop(env);
    this.face(env, dt, this.lastX, this.lastZ);
    if (!atk || this.attackCd > 0 || d > range * 1.05 || this.lostT > 0.5) return;
    this.attackCd = atk.cooldown;
    this.attackAnimT = 0.35;
    this.sys.hit(this, this.targetKind, this.targetId, atk.damage);
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
      this.goTo(env, dt, pp[0], pp[2], speed, 2.2);
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
    if (this.hurtT > 0) next = 'hurt';
    else if (this.attackAnimT > 0) next = 'attack';
    else if (this.mode === 'talk' || this.mode === 'trade') next = 'talk';
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

const tmpVel: Vec3 = [0, 0, 0];
const targetOut: { kind: number; id: EntityId | null } = { kind: 0, id: null };
