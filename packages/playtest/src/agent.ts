/**
 * The autonomous playtest agent.
 *
 * Given a World IR it derives the goals (see `goals.ts`), samples a
 * navigation graph from an isolated physics world, then plays the game the
 * way a person would — by pressing movement keys and jump on the real
 * character controller, with the real gameplay logic running — until the
 * game is won, lost, or provably cannot be won:
 *
 * 1. pick the nearest reachable pending objective (Dijkstra over walk,
 *    jump and drop edges; jumps are validated by simulation),
 * 2. walk the path; open doors by proximity or key press; replan when the
 *    path is blocked and remember the bad edge,
 * 3. touch the objective (stand, then jump) and let the logic react,
 * 4. repeat; objectives behind a door that does not open are deferred and
 *    retried after something changes (a key picked up),
 * 5. win objectives (goal, winning zones) come last.
 *
 * It then explains what it found: unreachable objectives with the gap to
 * the nearest standable spot, doors that cannot open, an unwinnable
 * condition, pits the player can fall into and never leave (soft-locks),
 * places it got stuck, and the falls. Everything runs headless at the
 * fixed 60 Hz step, far faster than real time, with a sim-time cap, a
 * wall-clock budget and cooperative yielding (so it can live in a worker).
 */
import { validateWorld, type Entity, type EntityId, type Vec3, type WorldDoc } from '@aether/core';
import { PhysicsWorld, ensureAssetCatalog, entityBounds, yieldToHost, type Aabb } from '@aether/physics';
import { deriveGoals, inRegion, needsHold, touches, winThresholds, type DoorInfo, type GoalModel, type GoalObjective } from './goals';
import { driveRace } from './drive';
import { PLAYER_CAPSULE } from './host';
import { EdgeKind, NavGraph, airThrust, type RideInfo, doorFitRadius, doorSlack, jumpHeight, targetDiscs, type NavParams, type NavPortal } from './nav';
import { hashWorld } from './proof';
import { deriveWalkGoals } from './rooms';
import { withDoorsOpen } from './doorpose';
import { checkBuildings } from '@aether/arch';
import { Session, STEP } from './session';
import { BODY_SLACK, LineFollower, onStair, stairGuides, stairStretches, type StairGuide } from './stairs';
import { ThreatWatch, CORE_MARGIN, type ThreatSource } from './threats';
import {
  PLAYTEST_LIMITS,
  type Finding,
  type ObjectiveResult,
  type PlaytestOptions,
  type PlaytestKind,
  type PlaytestProgress,
  type PlaytestReport,
} from './types';

/** Error thrown when the run is cancelled through its signal. */
export class PlaytestAbortedError extends Error {
  override name = 'AbortError';
  constructor() {
    super('playtest cancelled');
  }
}

type TravelResult = 'arrived' | 'stuck' | 'fell' | 'lost' | 'ended' | 'stopped' | 'teleported' | 'threat';

/** Step away from a hostile character when the player is this close to its reach (m). */
const EVADE_CLEARANCE = 1.3;
/** Re-route round hunting characters this often (simulated s) while one is within {@link THREAT_RANGE}. */
const THREAT_REPLAN_S = 0.5;
const THREAT_RANGE = 12;
/** Longest wait (simulated s) per objective for a calm character to move off something it guards. */
const GAP_WAIT_S = 10;
/** Re-routes round enemies per objective before an enemy in the way counts as a plain blocker. */
const MAX_THREAT_TURNS = 400;
/**
 * Simulated seconds per objective the bot keeps stepping out of enemies' way. A pack that is after the player
 * but cannot get at it (stuck below a bank, behind a fence) pins a bot that always steps aside; a person
 * hesitates for a while and then runs for it, taking a bite if need be, and so does the bot.
 */
const EVADE_PATIENCE_S = 2 * GAP_WAIT_S;
/** Feet this far above the surface of the path (m) while standing: the player walked onto another level (a bridge deck over a path that runs under it). */
const OFF_LEVEL_M = 1;
/** Walking a path may take this many times its length at full speed, plus {@link LEG_SLACK_S}, before it counts as stuck. */
const LEG_SLOW_FACTOR = 4;
const LEG_SLACK_S = 10;
/** Simulated seconds an objective may take beyond its walk at full speed (times {@link LEG_SLOW_FACTOR}) before it is given up. */
const OBJECTIVE_SLACK_S = 60;

interface StuckInfo {
  position: Vec3;
  blocker: EntityId | null;
}

function clamp(v: number | undefined, def: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const r1 = (v: number): number => Math.round(v * 10) / 10;
/** Searches per game plan before giving up: every invalid jump or drop found on the best path is excluded and the search repeats (a raised walkway has hundreds of side drops). A walkthrough keeps 14: it must not find its way through a door that is too narrow. */
const PLAN_ATTEMPTS = 160;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The key code a rule's key name stands for ("e" → KeyE, "1" → Digit1, "space" → Space). */
function keyCode(name: string): string {
  const k = name.trim();
  if (/^[a-zA-Z]$/.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return k.length > 0 ? k[0]?.toUpperCase() + k.slice(1) : 'KeyE';
}

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== 'closed' && v !== 'off' && v !== '0';
  return false;
}

function fmtPos(p: Readonly<Vec3>): string {
  return `${r1(p[0])},${r1(p[2])}`;
}

/** Copy of `world` without the given entities and their descendants. */
export function withoutEntities(world: WorldDoc, ids: ReadonlySet<EntityId>): WorldDoc {
  const doc = structuredClone(world);
  const drop = new Set<EntityId>(ids);
  for (let changed = true; changed; ) {
    changed = false;
    for (const id in doc.entities) {
      const e = doc.entities[id] as Entity;
      if (e.parent !== null && drop.has(e.parent) && !drop.has(id)) {
        drop.add(id);
        changed = true;
      }
    }
  }
  for (const id of drop) delete doc.entities[id];
  for (const id in doc.entities) {
    const e = doc.entities[id] as Entity;
    if (e.joint && e.joint.target !== 'world' && drop.has(e.joint.target)) delete e.joint;
  }
  return doc;
}

/** Why a world cannot be driven by the bot, or null. */
export function unsupportedReason(world: WorldDoc): string | null {
  if (world.voxel !== undefined) return 'block worlds are played with their own controls, which the bot cannot drive yet';
  const mode = world.player.mode;
  if (mode === 'orbit') return 'the player view is an orbit camera, so there is no character to play';
  if (mode === 'vehicle') return 'the player drives a vehicle, which the bot cannot drive yet';
  const c = world.player.controls;
  if (c && Object.prototype.hasOwnProperty.call(world.entities, c) && !(world.entities[c] as Entity).template) return 'the player is an avatar entity, which the bot cannot drive yet';
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (!e.template && e.behaviors.some((b) => b.type === 'playerController' && b.enabled)) return 'the player is an avatar entity, which the bot cannot drive yet';
  }
  if (Object.prototype.hasOwnProperty.call(world.entities, 'player') && !(world.entities['player'] as Entity).template) return 'the player is an avatar entity, which the bot cannot drive yet';
  return null;
}

/**
 * The area the bot maps: the box around the spawn point and everything it
 * has to reach, grown by a margin for detours, and clipped to the solid
 * geometry's extent (a 400 m ground does not make a 400 m grid). Heights
 * come from the geometry inside that box.
 */
function navBounds(doc: WorldDoc, points: readonly Vec3[], roomToRun = 0): { minX: number; maxX: number; minZ: number; maxZ: number; topY: number; bottomY: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  // With enemies about, the player needs room to step round them, not just the box round the objectives.
  const margin = Math.min(40, Math.max(7, span * 0.35) + roomToRun);
  minX -= margin;
  maxX += margin;
  minZ -= margin;
  maxZ += margin;
  let minY = 0, maxY = 0;
  for (const p of points) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  // Structures that touch the area (a spiral of platforms, a building) are mapped whole.
  const solids: Aabb[] = [];
  for (const id in doc.entities) {
    const e = doc.entities[id] as Entity;
    if (e.template || !e.physics || e.physics.collider === 'none' || e.physics.sensor || e.shape.kind === 'none' || e.shape.kind === 'scatter') continue;
    const bb = entityBounds(doc, id);
    if (bb) solids.push(bb);
  }
  const used = new Array<boolean>(solids.length).fill(false);
  for (let round = 0; round < 6; round++) {
    let grew = false;
    for (let i = 0; i < solids.length; i++) {
      const bb = solids[i] as Aabb;
      if (used[i]) continue;
      if (bb.max[0] < minX - 1.5 || bb.min[0] > maxX + 1.5 || bb.max[2] < minZ - 1.5 || bb.min[2] > maxZ + 1.5) continue;
      used[i] = true;
      minY = Math.min(minY, bb.min[1]);
      maxY = Math.max(maxY, bb.max[1]);
      // Very wide slabs (a 400 m ground) do not stretch the area.
      if (bb.max[0] - bb.min[0] <= 80 && bb.max[2] - bb.min[2] <= 80) {
        const nx0 = Math.min(minX, bb.min[0]), nx1 = Math.max(maxX, bb.max[0]), nz0 = Math.min(minZ, bb.min[2]), nz1 = Math.max(maxZ, bb.max[2]);
        if (nx0 !== minX || nx1 !== maxX || nz0 !== minZ || nz1 !== maxZ) grew = true;
        minX = nx0;
        maxX = nx1;
        minZ = nz0;
        maxZ = nz1;
      }
    }
    if (!grew) break;
  }
  const reach = 330;
  const spawn = doc.player.spawn;
  return {
    minX: Math.max(minX, spawn[0] - reach),
    maxX: Math.min(maxX, spawn[0] + reach),
    minZ: Math.max(minZ, spawn[2] - reach),
    maxZ: Math.min(maxZ, spawn[2] + reach),
    topY: Math.min(maxY, minY + 80) + 1.5,
    bottomY: Math.min(minY, 0) - 2,
  };
}

/** Run the autonomous playtest of a game. Never throws except for cancellation. */
export async function playtest(input: WorldDoc, opts: PlaytestOptions = {}): Promise<PlaytestReport> {
  const bot = new Bot(input, opts, 'game');
  return bot.run();
}

/**
 * Walk through a building: the bot enters at the player spawn and must reach
 * every room through its doors (pressing the door key where doors need it)
 * and up its stairs, while the document checks for furniture in the way of
 * doors and floating or overlapping pieces run alongside. Never throws except
 * for cancellation.
 */
export async function walkthrough(input: WorldDoc, opts: PlaytestOptions = {}): Promise<PlaytestReport> {
  const bot = new Bot(input, opts, 'walkthrough');
  return bot.run();
}

/** Longest stretch (simulated seconds) the bot lets a world with nothing left to do run on, to see whether it wins by itself. */
const PASSIVE_RUN_SECONDS = 120;

class Bot {
  private readonly t0 = nowMs();
  private readonly budgetMs: number;
  private readonly maxSim: number;
  private readonly world: WorldDoc;
  private goals!: GoalModel;
  private session!: Session;
  private probe: PhysicsWorld | null = null;
  private graph!: NavGraph;
  /** The world's stairs with their walking lines (walked along the line, not the grid's shortest route). */
  private readonly stairs: StairGuide[];
  private params!: NavParams;
  private stopReason: 'budget' | 'time' | null = null;
  private lastYield = nowMs();
  private lastProgress = 0;
  private note = 'preparing';
  private phase: PlaytestProgress['phase'] = 'prepare';
  private readonly results = new Map<string, ObjectiveResult>();
  private readonly pending = new Map<string, GoalObjective>();
  private readonly failedReason = new Map<string, string>();
  private readonly replans = new Map<string, number>();
  private readonly targetsCache = new Map<string, Array<{ node: number; jump: boolean }>>();
  private readonly stuckPoints: Vec3[] = [];
  private readonly stuckBlockers = new Map<EntityId, number>();
  private readonly findings: Finding[] = [];
  private readonly doorFailures = new Map<EntityId, string>();
  private readonly doorWas = new Map<EntityId, boolean>();
  /** Doors too narrow for the player: clear width and the width needed (m). */
  /** Room to spare per side at each doorway (m). */
  private readonly doorSlack = new Map<EntityId, number>();
  private readonly narrowDoors = new Map<EntityId, { clear: number; need: number }>();
  private fellCount = 0;
  /** `talk` objectives whose conversation delivered what the game needs. */
  private readonly talkDone = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly lifts = new Map<string, RideInfo>();
  /** Why a conversation did not deliver (plain words), per objective. */
  private readonly talkWhy = new Map<string, string>();
  private startNode = -1;
  private reachableFromStart: Float64Array | null = null;
  private doneCount = 0;
  private navMs = 0;
  private planMs = 0;
  private totalObjectives = 0;
  /** Hostile characters (null when the world has none, or in a walkthrough). */
  private threats: ThreatWatch | null = null;
  private threatSource: ThreatSource | null = null;
  private threatSensedAt = -1;
  private readonly threatTurns = new Map<string, number>();
  private readonly gapWaited = new Map<string, number>();
  /** When the bot first set out for each objective (simulated s) and the time it may take. */
  private readonly objectiveStart = new Map<string, { t: number; limit: number }>();
  /** Zones walked back to once everything else was done. */
  private readonly revisited = new Set<string>();
  /** Objective the bot is walking to (threat bookkeeping). */
  private current: GoalObjective | null = null;
  /** Times the bot stepped out of an enemy's reach (informational). */
  private evasions = 0;

  constructor(world: WorldDoc, private readonly opts: PlaytestOptions, private readonly kind: PlaytestKind) {
    this.world = world;
    this.stairs = stairGuides(world);
    this.budgetMs = clamp(opts.budgetMs, PLAYTEST_LIMITS.DEFAULT_BUDGET_MS, 500, PLAYTEST_LIMITS.MAX_BUDGET_MS);
    this.maxSim = clamp(opts.maxSimSeconds, PLAYTEST_LIMITS.DEFAULT_MAX_SIM_SECONDS, 5, PLAYTEST_LIMITS.MAX_SIM_SECONDS);
  }

  // -------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------

  private emit(force = false): void {
    const cb = this.opts.onProgress;
    if (!cb) return;
    const t = nowMs();
    if (!force && t - this.lastProgress < 90) return;
    this.lastProgress = t;
    const total = Math.max(1, this.totalObjectives);
    const frac = this.phase === 'prepare' ? 0.05 : this.phase === 'analyse' ? 0.95 : this.phase === 'done' ? 1 : 0.1 + 0.8 * Math.min(1, this.doneCount / total);
    try {
      cb({ phase: this.phase, fraction: frac, seconds: this.session ? r2(this.session.time) : 0, note: this.note, ...(this.session ? { position: this.session.position } : {}) });
    } catch {
      /* a failing observer must not stop the run */
    }
  }

  private async checkpoint(): Promise<void> {
    if (this.opts.signal?.aborted) throw new PlaytestAbortedError();
    if (nowMs() - this.t0 > this.budgetMs) this.stopReason = 'budget';
    if (this.session && this.session.time > this.maxSim) this.stopReason = this.stopReason ?? 'time';
    if (nowMs() - this.lastYield > 8) {
      this.emit();
      await yieldToHost();
      this.lastYield = nowMs();
      if (this.opts.signal?.aborted) throw new PlaytestAbortedError();
    }
  }

  private get stopped(): boolean {
    return this.stopReason !== null || this.session.over;
  }

  /** One tick with bookkeeping; false when the run must stop. */
  private async step(forward: number, right: number, jump: boolean, yawDeg: number, keys?: readonly string[]): Promise<boolean> {
    if (this.stopped) return false;
    this.session.tick({ forward, right, jump, yawDeg, ...(keys ? { keys } : {}) });
    this.scanObjectives();
    if ((this.session.steps & 7) === 0) this.watchDoors();
    if ((this.session.steps & 31) === 0) await this.checkpoint();
    return !this.stopped;
  }

  private async idle(seconds: number): Promise<boolean> {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) if (!(await this.step(0, 0, false, this.session.yawDeg))) return false;
    return true;
  }

  /** Replay events for doors that swing open. */
  private watchDoors(): void {
    for (const d of this.goals.doors) {
      const open = this.doorOpen(d);
      if (open !== (this.doorWas.get(d.id) ?? d.startOpen)) {
        this.doorWas.set(d.id, open);
        if (open) this.session.note('door', `${d.id} opens`, d.center);
      }
    }
  }

  private scanObjectives(): void {
    if (this.pending.size === 0) return;
    const s = this.session;
    const feet = s.character.position;
    const won = s.host.seen.outcome === 'win';
    for (const o of this.pending.values()) {
      let done = false;
      switch (o.kind) {
        case 'collect':
          done = o.entity !== undefined && (s.host.seen.destroyed.has(o.entity) || s.host.seen.hidden.has(o.entity));
          break;
        case 'goal':
          done = won || (o.gated !== true && touches(o.touch, feet));
          break;
        case 'press':
          done = this.pressed.has(o.id) || won;
          break;
        case 'zone':
          // A zone walked back to for the win (see `revisitZones`) is what won it.
          done = ((o.completes === 'game-over' || this.revisited.has(o.id)) && won) || touches(o.touch, feet);
          break;
        case 'room':
          done = o.region !== undefined && inRegion(o.region, feet, 0.12);
          break;
        case 'talk':
          done = this.talkDone.has(o.id) || (o.talk?.wins === true && won);
          break;
        default:
          done = touches(o.touch, feet);
      }
      if (done) this.complete(o);
    }
  }

  private complete(o: GoalObjective): void {
    this.pending.delete(o.id);
    const r = this.results.get(o.id);
    if (r) {
      r.status = 'done';
      r.at = r2(this.session.time);
      delete r.reason;
    }
    this.doneCount++;
    this.note = `${o.kind === 'collect' ? 'collected' : 'reached'} ${o.label} (${this.doneCount}/${this.totalObjectives})`;
    this.session.note(o.kind === 'collect' ? 'pickup' : 'goal', o.label, o.position);
    this.emit(true);
  }

  // -------------------------------------------------------------------
  // Preparation
  // -------------------------------------------------------------------

  private base(status: PlaytestReport['status'], summary: string, extra: Partial<PlaytestReport> = {}): PlaytestReport {
    return {
      v: 1,
      kind: this.kind,
      status,
      won: false,
      outcome: null,
      seconds: 0,
      steps: 0,
      wallMs: Math.round(nowMs() - this.t0),
      objectives: [],
      findings: [],
      falls: 0,
      stuckPoints: [],
      path: [],
      summary,
      worldHash: hashWorld(this.world),
      ...extra,
    };
  }

  /** Run the playtest. */
  async run(): Promise<PlaytestReport> {
    const verdict = validateWorld(this.world);
    if (!verdict.ok) return this.base('inconclusive', 'The world is not valid, so it cannot be played yet.', { findings: [{ code: 'budget', severity: 'error', message: 'the world document is invalid', entities: [], hint: 'fix the validation errors first' }] });
    // Sizes of library models (pickups' touch volumes, enemies' bodies) come from the asset catalog: load it before the
    // goals are read, so a run sees the same world whether or not anything loaded the catalog before it (a fresh worker,
    // a proof check in another process). Without this the first run in a process measured a lantern as a unit cube.
    await ensureAssetCatalog(this.world);
    if (this.kind === 'game' && this.world.player.mode === 'vehicle') {
      // A circuit: drive the racing line the world draws for its pace cars, if it draws one.
      const drove = await driveRace(this.world, this.opts, this.t0);
      if (drove) return drove;
    }
    const why = unsupportedReason(this.world);
    if (why) {
      return this.base('unsupported', `The bot cannot play this world: ${why}.`, { findings: [{ code: 'unsupported', severity: 'info', message: why, entities: [], hint: 'none' }] });
    }
    this.goals = this.kind === 'walkthrough' ? deriveWalkGoals(this.world) : deriveGoals(this.world);
    if (this.kind === 'walkthrough' && this.goals.objectives.length === 0) {
      return this.base('inconclusive', 'Nothing to walk through: this world has no building with rooms.', { findings: [{ code: 'no_entrance', severity: 'warning', message: 'no rooms were found in this world', entities: [], hint: 'build a house or an apartment first' }] });
    }
    if (this.goals.objectives.length === 0 && !this.goals.winDefined) {
      return this.base('inconclusive', 'Nothing to play yet: the world has no pickups, goal or win condition for a player to reach.', {
        findings: [{ code: 'no_win_condition', severity: 'warning', message: 'there is no goal, pickup or winning rule in this world', entities: [], hint: 'add a goal or a win rule' }],
      });
    }
    if (this.goals.hasScripts && !this.opts.scripts) {
      // Scripts can steer the game in ways the document does not show; say so instead of guessing.
      this.findings.push({ code: 'unsupported', severity: 'info', message: 'custom scripts are part of this game; the bot plays the document rules only', entities: [], hint: 'none' });
    }
    this.totalObjectives = this.goals.objectives.length;
    this.emit(true);
    let session: Session | null = null;
    let runner: ReturnType<NonNullable<PlaytestOptions['scripts']>> | undefined;
    try {
      runner = this.goals.hasScripts ? this.opts.scripts?.() : undefined;
      session = await Session.create(this.world, { trace: this.opts.trace ?? true, traceHz: this.opts.traceHz ?? 12, ...(runner ? { scripts: runner } : {}) });
      this.session = session;
      await this.prepare();
      if (this.startNode >= 0 || this.findings.every((f) => f.code !== 'spawn_blocked')) await this.play();
      return await this.finish();
    } finally {
      this.graph?.dispose();
      this.probe?.dispose();
      session?.dispose();
      try {
        runner?.dispose();
      } catch {
        /* already disposed */
      }
    }
  }

  private async prepare(): Promise<void> {
    const w = this.world;
    const doorIds = new Set<EntityId>(this.goals.doors.map((d) => d.id));
    const probeDoc = doorIds.size > 0 ? withDoorsOpen(w, this.goals.doors) : w;
    this.probe = await PhysicsWorld.create(probeDoc, { fixedDt: STEP });
    const gravity = Math.abs(w.environment.gravity[1]) || 9.81;
    this.params = {
      radius: PLAYER_CAPSULE.radius,
      height: PLAYER_CAPSULE.height,
      stepHeight: 0.35,
      maxSlopeDeg: 50,
      speed: w.player.moveSpeed,
      jumpSpeed: w.player.jumpSpeed,
      gravity,
    };
    if (this.kind === 'game') {
      this.threats = ThreatWatch.of(w, this.params.radius);
      if (this.threats) {
        const s = this.session;
        this.threatSource = { info: (id) => s.runtime.npcs.info(id), y: (id) => s.host.getTransform(id)?.position[1] };
      }
    }
    // Let the player land first: the spawn point is usually a little above the floor.
    this.phase = 'prepare';
    this.note = 'landing at the spawn point';
    const spawn = w.player.spawn;
    const buried = this.solidAt(spawn, this.session.pw);
    if (buried) {
      this.findings.push({
        code: 'spawn_blocked',
        severity: 'error',
        message: `the player spawns inside ${buried} at ${fmtPos(spawn)}`,
        entities: [buried],
        position: [spawn[0], spawn[1], spawn[2]],
        hint: 'move player.spawn to open floor',
        data: { x: spawn[0], y: spawn[1], z: spawn[2], inside: buried },
      });
      return;
    }
    for (let i = 0; i < 90 && !this.session.over; i++) this.session.tick({ forward: 0, right: 0, jump: false, yawDeg: 0 });
    const landed = this.session.position;
    const objectivePoints = this.goals.objectives.map((o) => o.position);
    const doorPoints = this.goals.doors.map((d) => d.center);
    this.note = 'mapping the level';
    const threatPoints: Vec3[] = this.threats ? this.threats.list.map((t) => [t.x, t.y, t.z] as Vec3) : [];
    const b = navBounds(probeDoc, [...objectivePoints, ...doorPoints, ...threatPoints, landed, [spawn[0], spawn[1], spawn[2]]], this.threats ? 8 : 0);
    const navT0 = nowMs();
    const portals: Array<NavPortal & { door: DoorInfo }> = this.goals.doors
      .filter((d) => d.bounds !== null)
      .map((d) => {
        const bb = d.bounds as Aabb;
        const thick = Math.abs(d.normal[0]) * (bb.max[0] - bb.min[0]) + Math.abs(d.normal[1]) * (bb.max[2] - bb.min[2]);
        return { door: d, center: [d.center[0], bb.min[1], d.center[2]] as Vec3, normal: d.normal, halfThickness: Math.min(0.4, thick / 2 + 0.06) };
      });
    // Doorways the player's body cannot get through at all, however carefully it is steered.
    for (const portal of portals) {
      const fit = doorFitRadius(this.probe, portal, this.params);
      const need = this.params.radius + 0.025;
      this.doorSlack.set(portal.door.id, doorSlack(this.probe, portal, this.params));
      if (fit < need - 1e-6) this.narrowDoors.set(portal.door.id, { clear: Math.round(fit * 2 * 100) / 100, need: Math.round(need * 2 * 100) / 100 });
    }
    this.graph = await NavGraph.build({
      pw: this.probe,
      ...b,
      params: this.params,
      hazards: this.goals.hazards,
      portals,
      tick: async () => {
        await this.checkpoint();
      },
    });
    this.navMs = Math.round(nowMs() - navT0);
    this.registerLifts();
    this.startNode = this.graph.nearest(landed, 2.5, 3);
    if (this.startNode < 0 || landed[1] < -20) {
      const inside = this.solidAt(spawn);
      const message = landed[1] < -20
        ? `the player spawns at ${fmtPos(spawn)} with no floor underneath and falls out of the world`
        : inside
          ? `the player spawns inside ${inside} at ${fmtPos(spawn)}`
          : `the player spawns at ${fmtPos(spawn)} where there is nowhere to stand`;
      this.findings.push({
        code: 'spawn_blocked',
        severity: 'error',
        message,
        entities: inside ? [inside] : [],
        position: [spawn[0], spawn[1], spawn[2]],
        hint: 'move player.spawn to open floor',
        data: { x: spawn[0], y: spawn[1], z: spawn[2], landedY: landed[1] },
      });
      return;
    }
    // Everything reachable from the start with all doors open: used to tell "behind a door" from "impossible".
    this.graph.blocked.fill(0);
    const full = this.graph.search(this.startNode);
    this.reachableFromStart = Float64Array.from(full.dist);
    for (const o of this.goals.objectives) {
      this.pending.set(o.id, o);
      this.results.set(o.id, { id: o.id, kind: o.kind, label: o.label, ...(o.entity ? { entity: o.entity } : {}), position: [o.position[0], o.position[1], o.position[2]], required: o.required, status: 'pending' });
    }
    this.session.note('start', 'start', landed);
  }

  /** Id of the solid entity at a point (spawn inside geometry), or null. */
  private solidAt(p: Readonly<Vec3>, pw: PhysicsWorld | null = this.probe): EntityId | null {
    if (!pw) return null;
    for (const id of pw.overlapsSphere([p[0], p[1] + 0.9, p[2]], 0.3)) {
      const e = this.world.entities[id];
      if (e?.physics && !e.physics.sensor && e.physics.body !== 'dynamic') return id;
    }
    return null;
  }

  // -------------------------------------------------------------------
  // Doors
  // -------------------------------------------------------------------

  private doorOpen(d: DoorInfo): boolean {
    return this.session.entityState(d.id)['open'] === true;
  }

  private doorPassable(d: DoorInfo): boolean {
    if (this.doorOpen(d)) return true;
    if (this.doorFailures.has(d.id)) return false;
    switch (d.trigger) {
      case 'state':
        return d.stateKey !== '' && truthy(this.session.runtime.readState(d.stateKey));
      default:
        return true;
    }
  }

  private doorBox(d: DoorInfo): { min: Vec3; max: Vec3 } | null {
    if (!d.bounds) return null;
    const m = this.params.radius + 0.25;
    return { min: [d.bounds.min[0] - m, d.bounds.min[1] - 0.6, d.bounds.min[2] - m], max: [d.bounds.max[0] + m, d.bounds.max[1] + 0.1, d.bounds.max[2] + m] };
  }

  private refreshDoors(): void {
    this.graph.blocked.fill(0);
    for (const d of this.goals.doors) {
      if (this.doorPassable(d)) continue;
      const box = this.doorBox(d);
      if (box) this.graph.setBlocked(box.min, box.max, true);
    }
  }

  private doorNear(p: Readonly<Vec3>, slack = 0.9): DoorInfo | null {
    for (const d of this.goals.doors) {
      const b = d.bounds;
      if (!b) continue;
      if (p[0] >= b.min[0] - slack && p[0] <= b.max[0] + slack && p[2] >= b.min[2] - slack && p[2] <= b.max[2] + slack && p[1] >= b.min[1] - 0.6 && p[1] <= b.max[1] + 0.2) return d;
    }
    return null;
  }

  /** Make a door open (wait near it, press its key) and let the leaf swing. False when it never opens. */
  private async openDoor(d: DoorInfo, yaw: number): Promise<boolean> {
    if (this.doorOpen(d)) {
      return this.idle(0.05);
    }
    const t0 = this.session.time;
    let pressed = false;
    while (this.session.time - t0 < 4.5) {
      if (d.trigger === 'key' && !pressed) {
        pressed = true;
        if (!(await this.step(0, 0, false, yaw, [d.key]))) return false;
      } else if (!(await this.step(0, 0, false, yaw))) return false;
      if (this.doorOpen(d)) {
        return this.idle(d.duration * 0.95 + 0.1);
      }
    }
    return false;
  }

  // -------------------------------------------------------------------
  // Planning and travel
  // -------------------------------------------------------------------

  /** A character walks about: aim at where it stands now (never cached). */
  private refreshTalk(o: GoalObjective): void {
    const t = o.talk;
    if (!t) return;
    const info = this.session.runtime.npcs.info(t.npc);
    const tr = this.session.host.getTransform(t.npc);
    if (!info || !tr) return;
    o.touch.center = [info.x, tr.position[1], info.z];
    o.position = o.touch.center;
  }

  /** The conversation can be had now: the options it needs are available (enough gold …). */
  private talkReady(o: GoalObjective): boolean {
    const t = o.talk;
    if (!t) return true;
    const info = this.session.runtime.npcs.info(t.npc);
    if (!info || info.dead) return false;
    return needsHold(t.needs, (k) => this.session.runtime.readState(k));
  }

  private targetsFor(o: GoalObjective): Array<{ node: number; jump: boolean }> {
    if (o.kind === 'talk') {
      this.refreshTalk(o);
      return this.scanTargets(o.touch, 0);
    }
    const hit = this.targetsCache.get(o.id);
    if (hit) return hit;
    let out: Array<{ node: number; jump: boolean }>;
    if (o.kind === 'room' && o.region) {
      out = this.scanRegion(o.region, 0.45);
      if (out.length === 0) out = this.scanRegion(o.region, 0.2);
    } else {
      out = this.scanTargets(o.touch, Math.max(0, jumpHeight(this.params) * 0.9));
    }
    if (this.targetsCache.size < 400) this.targetsCache.set(o.id, out);
    return out;
  }

  /** Nodes standing in a room region, at least `inset` metres inside its outline. */
  private scanRegion(region: NonNullable<GoalObjective['region']>, inset: number): Array<{ node: number; jump: boolean }> {
    const g = this.graph;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of region.poly) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    const cx0 = Math.max(0, Math.floor((minX - g.x0) / g.cell));
    const cx1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.cell));
    const cz0 = Math.max(0, Math.floor((minZ - g.z0) / g.cell));
    const cz1 = Math.min(g.nz - 1, Math.floor((maxZ - g.z0) / g.cell));
    const feet: Vec3 = [0, 0, 0];
    const out: Array<{ node: number; jump: boolean }> = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * g.nx + cx;
        for (let n = g.cellFirst[c] as number; n < (g.cellFirst[c + 1] as number); n++) {
          feet[0] = g.px[n] as number;
          feet[1] = g.py[n] as number;
          feet[2] = g.pz[n] as number;
          if (inRegion(region, feet, inset)) out.push({ node: n, jump: false });
        }
      }
    }
    return out;
  }

  /** Nodes whose feet (raised by up to `apex` while jumping) are inside a trigger volume. */
  private scanTargets(v: GoalObjective['touch'], apex: number): Array<{ node: number; jump: boolean }> {
    const g = this.graph;
    const hr = Math.max(v.shape.half[0], v.shape.half[2], v.shape.half[1]) + v.margin + 0.6;
    const out: Array<{ node: number; jump: boolean }> = [];
    const cx0 = Math.max(0, Math.floor((v.center[0] - hr - g.x0) / g.cell));
    const cx1 = Math.min(g.nx - 1, Math.floor((v.center[0] + hr - g.x0) / g.cell));
    const cz0 = Math.max(0, Math.floor((v.center[2] - hr - g.z0) / g.cell));
    const cz1 = Math.min(g.nz - 1, Math.floor((v.center[2] + hr - g.z0) / g.cell));
    const feet: Vec3 = [0, 0, 0];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * g.nx + cx;
        for (let n = g.cellFirst[c] as number; n < (g.cellFirst[c + 1] as number); n++) {
          feet[0] = g.px[n] as number;
          feet[2] = g.pz[n] as number;
          const y = g.py[n] as number;
          for (let h = 0; h <= apex + 1e-6; h += 0.3) {
            feet[1] = y + h;
            if (touches(v, feet)) {
              out.push({ node: n, jump: h > 0 });
              break;
            }
          }
        }
      }
    }
    return out;
  }

  private isWinObjective(o: GoalObjective): boolean {
    return o.kind === 'goal' || (o.kind === 'zone' && o.completes === 'game-over');
  }

  /** Objectives done last: the ones that end the game and the key presses that set it off. */
  private isFinale(o: GoalObjective): boolean {
    return this.isWinObjective(o) || o.kind === 'press';
  }

  /** Nearest reachable pending objective and the path to it, or null. */
  private plan(from: number): { objective: GoalObjective; path: number[]; jumpAt: boolean } | null {
    const planT0 = nowMs();
    try {
      return this.planInner(from);
    } finally {
      this.planMs += nowMs() - planT0;
    }
  }

  private planInner(from: number): { objective: GoalObjective; path: number[]; jumpAt: boolean } | null {
    const g = this.graph;
    this.refreshDoors();
    // Enemies where they are now: routes bend round their reach and their beat.
    if (this.threats) {
      this.senseThreats();
      this.threats.paint(g);
      const p = this.session.position;
      g.linkScale = this.threats.huntedWithin(p[0], p[1], p[2], THREAT_RANGE) ? 6 : 1;
    }
    for (const phase of [0, 1]) {
      const owner = new Map<number, { o: GoalObjective; jump: boolean }>();
      for (const o of this.pending.values()) {
        if (this.failedReason.has(o.id)) continue;
        if (o.kind === 'talk' && !this.talkReady(o)) continue;
        if ((phase === 0) === this.isFinale(o)) continue;
        for (const t of this.targetsFor(o)) {
          const prev = owner.get(t.node);
          if (!prev || (prev.jump && !t.jump)) owner.set(t.node, { o, jump: t.jump });
        }
      }
      if (owner.size === 0) continue;
      // Head for the targets (A*): the frontier grows towards them instead of evenly over the whole map for every leg.
      const groups = new Map<string, number[]>();
      for (const [n, t] of owner) {
        const list = groups.get(t.o.id);
        if (list) list.push(n);
        else groups.set(t.o.id, [n]);
      }
      const toward = targetDiscs(g, [...groups.values()]);
      for (let attempt = 0; attempt < (this.kind === 'walkthrough' ? 14 : PLAN_ATTEMPTS); attempt++) {
        const res = g.search(from, (n) => owner.has(n), Infinity, toward);
        if (res.hit < 0) break;
        const path = g.pathTo(res.parent, res.hit);
        // Try every jump and drop of the route (each is simulated once and remembered): marking all the bad ones
        // at once spares a search per bad link, and the next search avoids them all.
        let bad = false;
        for (let i = 0; i + 1 < path.length; i++) {
          const a = path[i] as number;
          const b = path[i + 1] as number;
          if (g.edgeKind(a, b) !== EdgeKind.Walk && !g.validateLink(a, b, this.params.speed, this.params.jumpSpeed)) bad = true;
        }
        if (bad) continue;
        const t = owner.get(res.hit) as { o: GoalObjective; jump: boolean };
        return { objective: t.o, path, jumpAt: t.jump };
      }
    }
    return null;
  }

  private yawTo(from: Readonly<Vec3>, x: number, z: number): number {
    return (Math.atan2(-(x - from[0]), -(z - from[2])) * 180) / Math.PI;
  }

  /** Walk a node path. Returns how it ended. */
  private async travel(path: number[]): Promise<TravelResult> {
    const g = this.graph;
    const s = this.session;
    const tele0 = s.host.seen.playerTeleports;
    let idx = 1;
    let stalls = 0;
    let watchT = s.time;
    let watchPos = s.position;
    let nudgeUntil = 0;
    let strafeUntil = 0;
    let strafeDir = 1;
    let threatCheckT = s.time;
    let evading = false;
    let commitT = -1;
    let committed = false;
    let offLevelT = 0;
    const waypoint: Vec3 = [0, 0, 0];
    // Stretches of the route that climb or descend a stair are walked along the stair's walking line: up the middle
    // of the flight to the landing's centre, then the next flight (the grid's route cuts the turn, under the slab).
    const stretches = stairStretches(this.stairs, path.map((n) => g.pos(n))).filter((st) => path.slice(Math.max(1, st.from), st.to + 2).every((n, k, arr) => k === 0 || g.edgeKind(arr[k - 1] as number, n) === EdgeKind.Walk));
    let guide: LineFollower | null = null;
    let guideEnd = 0;
    const goal = g.pos(path[path.length - 1] as number);
    // Time on foot the path may take (lifts, jumps and doors are timed on their own): a loop the watchdog does not
    // catch (a hop that looks like progress, a corner it keeps sliding along) ends as stuck instead of running out the clock.
    const legLimit = (pathLength(g, path) / Math.max(0.5, this.params.speed)) * LEG_SLOW_FACTOR + LEG_SLACK_S;
    let footT = 0;
    const objective = this.current;
    const resetWatch = (): void => {
      stalls = 0;
      watchT = s.time;
      watchPos = s.position;
    };
    while (idx < path.length) {
      if (this.stopped) return s.over ? 'ended' : 'stopped';
      if (s.host.seen.playerTeleports !== tele0) return 'teleported';
      let pos = s.position;
      // Enemies: step out of a reach that is closing in, and re-route round the pack as it moves.
      if (this.threats && g.edgeKind(path[idx - 1] as number, path[idx] as number) === EdgeKind.Walk) {
        this.senseThreats();
        // The rest of the way is shorter for the player than for any enemy to cut it off: run for it.
        if (s.time - commitT >= 0.25) {
          commitT = s.time;
          committed = this.outruns(path, idx, pos);
        }
        const clear = committed ? Infinity : this.threats.clearance(pos[0], pos[1], pos[2]);
        if (clear < EVADE_CLEARANCE && !this.guardsGoal(goal)) {
          const yaw = this.threats.escape(g, pos, goal[0], goal[2], 1.1, this.openWay);
          if (yaw !== null) {
            if (!evading) this.evasions++;
            evading = true;
            if (!(await this.step(1, 0, false, yaw))) return s.over ? 'ended' : 'stopped';
            // Time spent stepping aside counts as waiting for a gap: past its patience the bot runs for it.
            if (objective) this.gapWaited.set(objective.id, (this.gapWaited.get(objective.id) ?? 0) + STEP);
            resetWatch();
            continue;
          }
        }
        // Clear again after stepping aside: plan afresh from here.
        if (evading) return 'threat';
        if (!committed && s.time - threatCheckT >= THREAT_REPLAN_S) {
          threatCheckT = s.time;
          if (this.threats.huntedWithin(pos[0], pos[1], pos[2], THREAT_RANGE) && this.threatTurn()) return 'threat';
        }
      }
      // Skip the walk nodes we are already standing on.
      while (idx < path.length - 1 && (!guide || idx < guideEnd) && g.edgeKind(path[idx - 1] as number, path[idx] as number) === EdgeKind.Walk) {
        const n = g.pos(path[idx] as number);
        if (Math.hypot(n[0] - pos[0], n[2] - pos[2]) < 0.3 && Math.abs(n[1] - pos[1]) < 0.8) idx++;
        else break;
      }
      const a = path[idx - 1] as number;
      const b = path[idx] as number;
      const kind = g.edgeKind(a, b);
      if (kind !== EdgeKind.Walk) {
        // Arrive exactly at the take-off node, then jump or drop.
        const takeoff = g.pos(a);
        const dTake = Math.hypot(takeoff[0] - pos[0], takeoff[2] - pos[2]);
        if (dTake > 0.18 && Math.abs(takeoff[1] - pos[1]) < 1.2) {
          const yaw = this.yawTo(pos, takeoff[0], takeoff[2]);
          if (!(await this.step(Math.min(1, dTake / 0.4 + 0.25), 0, false, yaw))) return s.over ? 'ended' : 'stopped';
          footT += STEP;
          if (s.time - watchT > 0.6) {
            if (Math.hypot(s.position[0] - watchPos[0], s.position[2] - watchPos[2]) < 0.12) {
              this.recordStuck(s.position, this.blockerAhead(s.position, yaw));
              g.markBad(a, b);
              return 'stuck';
            }
            resetWatch();
          }
          continue;
        }
        const res = kind === EdgeKind.Ride ? await this.doRide(a, b) : await this.doLink(a, b, kind);
        if (res !== 'arrived') return res;
        idx++;
        resetWatch();
        continue;
      }
      // On a stair the route is the stair's walking line, picked up once the player stands on the stair (the route
      // may step onto a flight from its side, where its first treads are low enough: the grid's way gets it there).
      if (!guide) {
        const k = stretches.findIndex((st) => idx >= st.from && idx <= st.to + 1 && onStair(st.stair, pos, BODY_SLACK));
        const st = stretches[k];
        if (st) {
          stretches.splice(k, 1);
          guide = new LineFollower(st.line, pos);
          guideEnd = st.to;
        }
      }
      const along = guide?.target(pos) ?? null;
      if (guide && along === null) {
        // Off the stair at its other end: back on the route after the stair.
        guide = null;
        idx = guideEnd + 1;
        resetWatch();
        continue;
      }
      // Look ahead along walk edges for a smoother line.
      // Doorways are narrow: follow their nodes one by one, slowly, so the capsule does not clip a jamb.
      const strict = !along && (this.doorNear(pos, 1.1) !== null || this.doorNear(g.pos(b), 1.1) !== null);
      let t = idx;
      // Never look further onto a stair the route climbs than its first point: the walking line takes over there.
      const stairAt = stretches.reduce((m, st) => (st.from >= idx ? Math.min(m, st.from) : m), Infinity);
      while (!along && !strict && t + 1 < path.length && t + 1 <= stairAt && g.edgeKind(path[t] as number, path[t + 1] as number) === EdgeKind.Walk) {
        const nxt = g.pos(path[t + 1] as number);
        if (Math.hypot(nxt[0] - pos[0], nxt[2] - pos[2]) > 0.9 || Math.abs(nxt[1] - pos[1]) > 0.5) break;
        t++;
      }
      if (along) {
        waypoint[0] = along[0];
        waypoint[1] = along[1];
        waypoint[2] = along[2];
      } else g.pos(path[t] as number, waypoint);
      // A door in the next steps: make sure it is open before walking into it.
      const door = this.doorNear(waypoint) ?? this.doorNear(g.pos(b));
      // Press a door's key from just inside its reach, so the leaf can swing without sweeping the player.
      const dOrigin = door ? Math.hypot(door.origin[0] - pos[0], door.origin[2] - pos[2]) : Infinity;
      if (door && !this.doorOpen(door) && door.trigger !== 'state' && dOrigin <= Math.max(0.6, door.radius - (door.trigger === 'key' ? 0.15 : 0.2))) {
        const ok = await this.openDoor(door, this.yawTo(pos, waypoint[0], waypoint[2]));
        if (this.stopped) return s.over ? 'ended' : 'stopped';
        if (!ok) {
          this.doorFailures.set(door.id, `${door.id} did not open when the player stood at it`);
          this.recordStuck(pos, door.id);
          return 'stuck';
        }
        resetWatch();
        pos = s.position;
      }
      const dx = waypoint[0] - pos[0];
      const dz = waypoint[2] - pos[2];
      const dist = Math.hypot(dx, dz);
      if (!along && dist < (strict ? 0.07 : t === path.length - 1 ? 0.12 : 0.3) && Math.abs(waypoint[1] - pos[1]) < 0.8) {
        idx = t + 1;
        resetWatch();
        continue;
      }
      const yaw = this.yawTo(pos, waypoint[0], waypoint[2]);
      const lastLeg = !along && t === path.length - 1;
      // A doorway with a hair of slack is crossed at a crawl; steering at walking speed overshoots a 2 cm window.
      const tight = strict && [...this.doorSlack].some(([id, sl]) => sl < 0.04 && this.doorNear(pos, 1.1)?.id === id);
      const forward = strict ? (tight ? Math.min(0.14, dist / 0.25 + 0.05) : Math.min(0.6, dist / 0.25 + 0.12)) : lastLeg ? Math.min(1, dist / 0.5 + 0.2) : 1;
      const jumpNudge = s.time < nudgeUntil;
      const strafing = s.time < strafeUntil;
      if (!(await this.step(strafing ? Math.min(forward, 0.45) : forward, strafing ? strafeDir * 0.4 : 0, jumpNudge, yaw))) return s.over ? 'ended' : 'stopped';
      footT += STEP;
      // Fell off the path?
      const here = s.position;
      // (On a stair's walking line the route's nodes are where the line was picked up: heights are the line's.)
      if (here[1] < (along ? along[1] : Math.min(g.py[a] as number, g.py[b] as number)) - 2.2) {
        this.fellCount++;
        s.note('fall', 'fell off the path', here);
        return 'fell';
      }
      // Standing well above the path: the feet found another level on the way (stepped onto a ramp beside a path
      // that runs under a bridge). Plan again from where the player really is.
      if (s.character.grounded && here[1] > (along ? along[1] : Math.max(g.py[a] as number, g.py[b] as number)) + OFF_LEVEL_M) {
        offLevelT += STEP;
        if (offLevelT >= 0.25) {
          g.markBad(a, b);
          return 'lost';
        }
      } else offLevelT = 0;
      if (footT > legLimit) {
        this.recordStuck(here, this.blockerAhead(here, yaw));
        g.markBad(a, b);
        return 'stuck';
      }
      // Progress watchdog: the player must actually move along the ground (a hop on the spot is not progress).
      if (s.time - watchT >= 0.5) {
        const moved = Math.hypot(here[0] - watchPos[0], here[2] - watchPos[2]);
        if (moved < 0.15) {
          stalls++;
          // First a hop (steps, thresholds), then a sidestep each way (a snug doorway, a corner).
          if (stalls === 1) nudgeUntil = s.time + 0.4;
          else if (stalls <= 3) {
            strafeDir = stalls === 2 ? -1 : 1;
            strafeUntil = s.time + 0.45;
          } else {
            const blocker = this.blockerAhead(here, yaw);
            // An enemy standing in the way moves on: route round it rather than writing the way off.
            if (blocker !== null && this.threats?.list.some((t) => t.id === blocker) && this.threatTurn()) return 'threat';
            this.recordStuck(here, blocker);
            g.markBad(a, b);
            return 'stuck';
          }
        } else stalls = 0;
        watchT = s.time;
        watchPos = here;
      }
    }
    return 'arrived';
  }

  /** Read the enemies' positions once per simulated tick. */
  private senseThreats(): void {
    if (!this.threats || !this.threatSource || this.threatSensedAt === this.session.steps) return;
    this.threatSensedAt = this.session.steps;
    this.threats.update(this.threatSource);
  }

  /**
   * Whether the player gets along the rest of the path (from `idx`) before any enemy can reach a point of it:
   * for every few nodes, the time to run there beats every enemy's time to close to its reach, with a margin.
   */
  private outruns(path: readonly number[], idx: number, pos: Readonly<Vec3>): boolean {
    const t = this.threats;
    if (!t) return true;
    const g = this.graph;
    const speed = Math.max(0.5, this.params.speed);
    let len = 0;
    let px = pos[0];
    let pz = pos[2];
    for (let i = idx; i < path.length; i++) {
      const n = path[i] as number;
      const x = g.px[n] as number;
      const y = g.py[n] as number;
      const z = g.pz[n] as number;
      len += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      if ((i - idx) % 3 !== 0 && i !== path.length - 1) continue;
      const ours = len / speed + 0.4;
      for (const th of t.list) {
        if (!th.live || Math.abs(th.y - y) > 3) continue;
        const gap = Math.hypot(th.x - x, th.z - z) - th.reach - 0.3;
        if (gap <= 0) return false;
        if (th.runSpeed > 0 && gap / th.runSpeed <= ours) return false;
      }
    }
    return true;
  }

  /** Nothing solid within `dist` of the player's body in the direction (dx, dz): rays at knee and chest height, centre and both sides. */
  private readonly openWay = (dx: number, dz: number, dist: number): boolean => {
    const pos = this.session.position;
    const r = this.params.radius;
    const dir = this.rayDir;
    dir[0] = dx;
    dir[1] = 0;
    dir[2] = dz;
    const o = this.rayOrigin;
    for (const h of [0.4, 1.1]) {
      for (const side of [-0.8, 0, 0.8]) {
        o[0] = pos[0] + dx * (r + 0.05) + dz * r * side;
        o[1] = pos[1] + h;
        o[2] = pos[2] + dz * (r + 0.05) - dx * r * side;
        if (this.session.pw.raycast(o, dir, dist)) return false;
      }
    }
    return true;
  };
  private readonly rayDir: Vec3 = [0, 0, 0];
  private readonly rayOrigin: Vec3 = [0, 0, 0];

  /** Count a re-route round enemies for the current objective; false once there were too many. */
  private threatTurn(): boolean {
    const id = this.current?.id ?? '';
    const n = (this.threatTurns.get(id) ?? 0) + 1;
    this.threatTurns.set(id, n);
    return n <= MAX_THREAT_TURNS;
  }

  /** The bot waited its fill for a gap and the objective is right ahead: go for it rather than step away. */
  private guardsGoal(goal: Readonly<Vec3>): boolean {
    const o = this.current;
    const waited = o ? (this.gapWaited.get(o.id) ?? 0) : 0;
    if (!o || waited < GAP_WAIT_S) return false;
    if (waited >= EVADE_PATIENCE_S) return true;
    const p = this.session.position;
    return Math.hypot(goal[0] - p[0], goal[2] - p[2]) < 3;
  }

  /**
   * A calm enemy stands over the spot the bot is heading for: hang back out of its reach for a moment
   * (stepping away if it comes closer) so it can wander off. True while the bot should keep waiting.
   */
  private async waitForGap(o: GoalObjective, end: Readonly<Vec3>): Promise<boolean> {
    const t = this.threats;
    if (!t) return false;
    this.senseThreats();
    const waited = this.gapWaited.get(o.id) ?? 0;
    if (waited >= GAP_WAIT_S || !t.guarded(end[0], end[1], end[2], CORE_MARGIN + 0.6)) return false;
    const s = this.session;
    const t0 = s.time;
    this.note = `waiting for a gap to reach ${o.label}`;
    while (s.time - t0 < 0.5) {
      this.senseThreats();
      const pos = s.position;
      const clear = t.clearance(pos[0], pos[1], pos[2]);
      const yaw = clear < EVADE_CLEARANCE + 1 ? t.escape(this.graph, pos, end[0], end[2], 1.1, this.openWay) : null;
      if (!(await this.step(yaw === null ? 0 : 1, 0, false, yaw ?? s.yawDeg))) break;
    }
    this.gapWaited.set(o.id, waited + (s.time - t0));
    return true;
  }

  private blockerAhead(pos: Readonly<Vec3>, yawDeg: number): EntityId | null {
    const yaw = (yawDeg * Math.PI) / 180;
    const dir: Vec3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    for (const h of [0.5, 1.2]) {
      const hit = this.session.pw.raycast([pos[0] + dir[0] * 0.45, pos[1] + h, pos[2] + dir[2] * 0.45], dir, 1.0);
      if (hit?.id) return hit.id;
    }
    return null;
  }

  /** What the capsule overlaps at a stuck spot: furniture first, then doors, then other solids (never the floor, walls or itself). */
  private culpritAt(p: Readonly<Vec3>): EntityId | null {
    const ids = new Set<EntityId>();
    for (const dy of [0.2, 0.6, 1.0, 1.4]) for (const id of this.session.pw.overlapsSphere([p[0], p[1] + dy, p[2]], 0.45)) ids.add(id);
    let door: EntityId | null = null;
    let other: EntityId | null = null;
    // What the player stands on is the floor, not a culprit (a terrain slope overlaps the low probes).
    const floorId = this.session.pw.raycastAll([p[0], p[1] + 0.4, p[2]], [0, -1, 0], 1.2, 6).filter((h) => h.id !== 'player' && h.id !== 'nav-probe').sort((a, b) => a.distance - b.distance)[0]?.id ?? null;
    for (const id of ids) {
      if (id === 'player' || id === floorId) continue;
      const e = this.world.entities[id];
      const role = e?.arch?.role;
      if (role === 'furniture' || role === 'fixture') return id;
      if (this.goals.doors.some((d) => d.id === id)) door = door ?? id;
      else if (role !== 'room' && role !== 'wall' && role !== 'level' && role !== 'site' && role !== 'ceiling' && role !== 'roof' && role !== 'building') other = other ?? id;
    }
    return door ?? other;
  }

  private recordStuck(p: Readonly<Vec3>, blocker: EntityId | null): void {
    const here = this.culpritAt(p);
    // What is physically touching the player says more than a ray ahead.
    if (here !== null && (blocker === null || this.world.entities[here]?.arch?.role === 'furniture')) blocker = here;
    if (!blocker) {
      // Stuck right at a doorway: the door (or its frame) is the culprit.
      for (const d of this.goals.doors) {
        if (Math.hypot(d.origin[0] - p[0], d.origin[2] - p[2]) < 1.3 && Math.abs(d.origin[1] - p[1]) < 1.5) {
          blocker = d.id;
          break;
        }
      }
    }
    if (this.stuckPoints.length < 12) this.stuckPoints.push([r2(p[0]), r2(p[1]), r2(p[2])]);
    if (blocker) this.stuckBlockers.set(blocker, (this.stuckBlockers.get(blocker) ?? 0) + 1);
    this.session.note('stuck', blocker ? `blocked by ${blocker}` : 'stuck', [p[0], p[1], p[2]]);
  }

  /**
   * Vertical lifts (a kinematic platform that patrols straight up and down) become one-way ride edges
   * from a node beside the platform at its lowest pose to a node level with it at its highest.
   */
  private registerLifts(): void {
    const g = this.graph;
    for (const id in this.world.entities) {
      const e = this.world.entities[id] as Entity;
      if (e.template || e.physics?.body !== 'kinematic') continue;
      const patrol = e.behaviors.find((b) => b.type === 'patrol' && b.enabled);
      const wps = patrol?.params['waypoints'];
      if (!Array.isArray(wps) || wps.length < 2 || wps.length > 16) continue;
      const pts: Vec3[] = [];
      for (const w of wps) {
        if (!Array.isArray(w) || w.length !== 3 || !w.every((n) => typeof n === 'number' && Number.isFinite(n))) break;
        pts.push([w[0] as number, w[1] as number, w[2] as number]);
      }
      if (pts.length !== wps.length) continue;
      const first = pts[0] as Vec3;
      const relative = patrol?.params['relative'] === true;
      const offs = pts.map((p) => [p[0] - (relative ? 0 : first[0]), p[1] - (relative ? 0 : first[1]), p[2] - (relative ? 0 : first[2])] as Vec3);
      const lateral = Math.max(...offs.map((o) => Math.hypot(o[0] - (offs[0] as Vec3)[0], o[2] - (offs[0] as Vec3)[2])));
      const rise = Math.max(...offs.map((o) => o[1] - (offs[0] as Vec3)[1]));
      if (lateral > 0.3 || rise < 1) continue;
      const bounds = entityBounds(this.world, id);
      const st = this.session.pw.getState(id);
      if (!bounds || !st) continue;
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cz = (bounds.min[2] + bounds.max[2]) / 2;
      const topY = bounds.max[1];
      const dist = (x: number, z: number, b: Aabb): number => {
        const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
        const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
        return Math.hypot(dx, dz);
      };
      let from = -1, to = -1, bestFrom = Infinity, bestTo = Infinity;
      for (let n = 0; n < g.count; n++) {
        const x = g.px[n] as number, y = g.py[n] as number, z = g.pz[n] as number;
        const d = dist(x, z, bounds);
        if (Math.abs(y - topY) < 0.6 && d >= 0.2 && d <= 2.8 && d < bestFrom) {
          bestFrom = d;
          from = n;
        }
        // Landings beside the platform at its highest pose.
        if (Math.abs(y - (topY + rise)) < 0.6 && d >= 0.2 && d <= 3.2) {
          const dd = Math.hypot(x - cx, z - cz);
          if (dd < bestTo) {
            bestTo = dd;
            to = n;
          }
        }
      }
      if (from < 0 || to < 0 || from === to) continue;
      const info: RideInfo = { entity: id, centre: [cx, cz], startY: st.position[1], dyUp: rise };
      g.addRide(from, to, info);
      this.lifts.set(id, info);
    }
  }

  /** Board a lift when it is down, ride it up and step off at the landing. */
  private async doRide(a: number, b: number): Promise<TravelResult> {
    const g = this.graph;
    const s = this.session;
    const info = g.linkOf(a, b)?.ride;
    if (!info) return 'stuck';
    const liftY = (): number => s.pw.getState(info.entity)?.position[1] ?? info.startY;
    const target = g.pos(b);
    // Wait at the edge until the platform is down.
    for (let i = 0; i < 60 * 40 && liftY() - info.startY > 0.1; i++) if (!(await this.step(0, 0, false, s.yawDeg))) return s.over ? 'ended' : 'stopped';
    // Step onto its middle.
    const t0 = s.time;
    while (s.time - t0 < 5) {
      const pos = s.position;
      const d = Math.hypot(info.centre[0] - pos[0], info.centre[1] - pos[2]);
      if (d < 0.3) break;
      if (!(await this.step(Math.min(1, d / 0.6 + 0.2), 0, false, this.yawTo(pos, info.centre[0], info.centre[1])))) return s.over ? 'ended' : 'stopped';
    }
    // Ride up.
    const r0 = s.time;
    while (s.time - r0 < 60 && s.position[1] < target[1] - 0.35) {
      if (!(await this.step(0, 0, false, s.yawDeg))) return s.over ? 'ended' : 'stopped';
    }
    // Step off towards the landing.
    const w0 = s.time;
    while (s.time - w0 < 4) {
      const pos = s.position;
      const d = Math.hypot(target[0] - pos[0], target[2] - pos[2]);
      if (d < 0.3 && Math.abs(target[1] - pos[1]) < 0.7 && s.character.grounded) return 'arrived';
      if (!(await this.step(d < 0.08 ? 0 : Math.min(1, d / 0.5 + 0.3), 0, false, this.yawTo(pos, target[0], target[2])))) return s.over ? 'ended' : 'stopped';
    }
    g.markBad(a, b);
    return 'stuck';
  }

  private async doLink(a: number, b: number, kind: EdgeKind): Promise<TravelResult> {
    const g = this.graph;
    const s = this.session;
    const target = g.pos(b);
    const t0 = s.time;
    let first = true;
    let airborne = false;
    while (s.time - t0 < (this.params.gravity < 6 ? 10 : 4)) {
      const pos = s.position;
      const dx = target[0] - pos[0];
      const dz = target[2] - pos[2];
      const near = Math.hypot(dx, dz);
      const yaw = this.yawTo(pos, target[0], target[2]);
      const wantJump = kind === EdgeKind.Jump && first;
      first = false;
      if (!(await this.step(near < 0.08 ? 0 : airThrust(near, this.params.speed, this.params.gravity, !s.character.grounded), 0, wantJump, yaw))) return s.over ? 'ended' : 'stopped';
      const q = s.position;
      if (!s.character.grounded) airborne = true;
      if (s.character.grounded && s.character.verticalSpeed <= 0.01 && (airborne || s.time - t0 > 0.25)) {
        if (Math.hypot(target[0] - q[0], target[2] - q[2]) <= Math.max(g.cell * 1.7, 0.4) + 0.1 && Math.abs(target[1] - q[1]) <= 0.6) return 'arrived';
        if (airborne || s.time - t0 > 0.5) break;
      }
      if (q[1] < Math.min(g.py[a] as number, target[1]) - 6 && kind === EdgeKind.Jump) {
        this.fellCount++;
        s.note('fall', 'missed a jump', q);
        g.markBad(a, b);
        return 'fell';
      }
    }
    g.markBad(a, b);
    const here = s.position;
    if (here[1] < Math.min(g.py[a] as number, target[1]) - 1.5) {
      this.fellCount++;
      s.note('fall', 'fell after a jump', here);
      return 'fell';
    }
    this.recordStuck(here, null);
    return 'stuck';
  }

  /** Stand at the objective and, if it did not trigger, jump and sweep around it. */
  private async touch(o: GoalObjective, needsJump: boolean, endNode: number): Promise<boolean> {
    const s = this.session;
    // First stand exactly on the node the plan ended at (inside the trigger volume by construction).
    const end = this.graph.pos(endNode);
    for (let i = 0; i < 40 && this.pending.has(o.id); i++) {
      const pos = s.position;
      const d = Math.hypot(end[0] - pos[0], end[2] - pos[2]);
      if (d < 0.06 || Math.abs(end[1] - pos[1]) > 1.2) break;
      if (!(await this.step(Math.min(1, d / 0.3 + 0.1), 0, false, this.yawTo(pos, end[0], end[2])))) return !this.pending.has(o.id);
    }
    if (o.kind === 'room') {
      // Rooms are entered, not jumped on: wait a moment for the trigger.
      if (this.pending.has(o.id)) await this.idle(0.15);
      return !this.pending.has(o.id);
    }
    for (let attempt = 0; attempt < 5 && this.pending.has(o.id); attempt++) {
      const t0 = s.time;
      const jumpHere = needsJump || attempt > 0;
      while (s.time - t0 < (jumpHere ? 1.1 : 0.25) && this.pending.has(o.id)) {
        const pos = s.position;
        const dx = o.touch.center[0] - pos[0];
        const dz = o.touch.center[2] - pos[2];
        const near = Math.hypot(dx, dz);
        // Aim a little off-centre on later attempts so a thin trigger is crossed from another side.
        const wobble = attempt * 0.35;
        const yaw = this.yawTo(pos, o.touch.center[0] + Math.cos(attempt * 2.4) * wobble, o.touch.center[2] + Math.sin(attempt * 2.4) * wobble);
        if (!(await this.step(near < 0.12 ? 0 : Math.min(1, near / 0.6 + 0.2), 0, jumpHere && s.character.grounded, yaw))) return !this.pending.has(o.id);
      }
    }
    return !this.pending.has(o.id);
  }

  /**
   * Stand on the spot a rule needs (a pressure plate) and press its key the way a person does; done once
   * the key was pressed with the player standing there and the logic had a moment to react.
   */
  private async pressKey(o: GoalObjective, endNode: number): Promise<boolean> {
    const s = this.session;
    const end = this.graph.pos(endNode);
    for (let i = 0; i < 60; i++) {
      const pos = s.position;
      const d = Math.hypot(end[0] - pos[0], end[2] - pos[2]);
      if (d < 0.06 || Math.abs(end[1] - pos[1]) > 1.2) break;
      if (!(await this.step(Math.min(1, d / 0.3 + 0.1), 0, false, this.yawTo(pos, end[0], end[2])))) return false;
    }
    // Let the plate register, then press and release a few times (the rule's conditions may take a tick).
    if (!(await this.idle(0.3))) return false;
    const key = keyCode(o.pressKey ?? 'e');
    for (let n = 0; n < 4 && !s.over; n++) {
      if (!(await this.step(0, 0, false, s.yawDeg, [key]))) return false;
      if (!(await this.idle(0.35))) return false;
    }
    this.pressed.add(o.id);
    this.scanObjectives();
    return !this.pending.has(o.id);
  }

  /**
   * Talk to a character the way a person does: stand within reach, press E
   * when the hint shows, and pick the options that get what the game needs
   * (a key bought, a door unlocked). Done when the conversation delivered it.
   */
  private async converse(o: GoalObjective): Promise<boolean> {
    const t = o.talk;
    if (!t) return false;
    const s = this.session;
    const npcs = s.runtime.npcs;
    const fail = (why: string): boolean => {
      this.talkWhy.set(o.id, why);
      return false;
    };
    // Face the character and wait for the "press E" hint (it appears only when it is willing to talk).
    for (let i = 0; i < 90 && !npcs.dialogue; i++) {
      this.refreshTalk(o);
      const pos = s.position;
      const info = npcs.info(t.npc);
      if (!info) return fail('the character is gone');
      const d = Math.hypot(info.x - pos[0], info.z - pos[2]);
      const yaw = this.yawTo(pos, info.x, info.z);
      const press = npcs.prompt?.npc === t.npc && i % 6 === 0;
      if (!(await this.step(d > t.range * 0.6 ? 0.5 : 0, 0, false, yaw, press ? ['KeyE'] : undefined))) return this.talkDone.has(o.id);
    }
    if (!npcs.dialogue || npcs.dialogue.npc !== t.npc) return fail(`${t.name} would not talk`);
    let stepNo = 0;
    for (let guard = 0; guard < 40 && npcs.dialogue; guard++) {
      const view = npcs.dialogue;
      let key: string | undefined;
      if (view.choices.length === 0) {
        key = 'KeyE';
      } else {
        const want = t.steps[stepNo];
        const idx = want === undefined ? -1 : view.choices.indexOf(want);
        if (idx < 0) {
          // The planned option is not on offer (a condition changed): leave rather than guess.
          npcs.endDialogue();
          return fail(`${t.name} did not offer "${want ?? 'the right option'}"`);
        }
        key = `Digit${idx + 1}`;
        stepNo++;
      }
      if (!(await this.step(0, 0, false, s.yawDeg, [key]))) break;
      if (!(await this.idle(0.1))) break;
    }
    if (npcs.dialogue) npcs.endDialogue();
    const got = t.writes.every((k) => truthy(s.runtime.readState(k)));
    if (!got && !(t.wins && s.host.seen.outcome === 'win')) return fail(`the conversation with ${t.name} did not give what the game needs (${t.writes.join(', ') || 'a win'})`);
    this.talkDone.add(o.id);
    this.scanObjectives();
    return !this.pending.has(o.id);
  }

  // -------------------------------------------------------------------
  // The play loop
  // -------------------------------------------------------------------

  private markFailed(o: GoalObjective, reason: string): void {
    this.failedReason.set(o.id, reason);
  }

  private async play(): Promise<void> {
    if (this.startNode < 0) return;
    const s = this.session;
    this.phase = 'play';
    await this.pursue();
    // Everything done and the game still on: a zone that only counts while the player stands in it (its key is
    // reset on the way out) may have been crossed on the way to something else. Go back and stand in it, once.
    if (!this.stopped && this.pending.size === 0 && !s.over && this.goals.winDefined && this.revisitZones() > 0) await this.pursue();
    // Survive-style wins: nothing left to do, the game ends by itself.
    if (!this.stopped && this.goals.timerSeconds > 0 && !s.over) {
      this.note = 'waiting for the timer';
      const until = Math.min(this.maxSim, this.goals.timerSeconds + 3);
      while (!this.stopped && s.time < until) if (!(await this.idle(0.5))) break;
    }
    // A game that only needs time to pass (a countdown to a win) is also given a chance.
    if (!this.stopped && this.pending.size === 0 && !s.over && this.goals.winDefined) {
      this.note = 'waiting for the game to end';
      await this.idle(2);
      // A machine that runs itself (a chain of physics machines, a countdown nobody can speed up) has nothing for the player to
      // collect or reach: the player only starts it, so let the world run on, up to a bounded stretch of simulated time, and see whether it wins by itself.
      if (this.totalObjectives === 0) {
        const until = Math.min(this.maxSim, s.time + PASSIVE_RUN_SECONDS);
        while (!this.stopped && !s.over && s.time < until) if (!(await this.idle(0.5))) break;
      }
    }
  }

  /** Plan and walk to the pending objectives, nearest first, until none is left or none can be reached. */
  private async pursue(): Promise<void> {
    const s = this.session;
    let stalls = 0;
    while (!this.stopped && this.pending.size > 0) {
      const here = s.position;
      // The surface the feet are on first (same height), then anything near.
      let from = this.graph.nearest(here, 1.2, 0.45);
      if (from < 0) from = this.graph.nearest(here, 2.5, 0.8);
      if (from < 0) from = this.graph.nearest(here, 1.5, 2.5);
      if (from < 0) from = this.graph.nearest(here, 4, 8);
      if (from < 0) {
        this.findings.push({ code: 'stuck', severity: 'error', message: `the player ended up at ${fmtPos(here)} where the bot found no way to continue`, entities: [], position: [here[0], here[1], here[2]], hint: 'check the floor around this spot' });
        break;
      }
      const plan = this.plan(from);
      if (!plan) {
        // Nothing reachable right now. A door that opens by proximity may only reveal itself on approach; give a state change one idle second.
        if (stalls++ < 1 && this.goals.doors.some((d) => d.trigger === 'state')) {
          if (!(await this.idle(1))) break;
          continue;
        }
        break;
      }
      const o = plan.objective;
      this.current = o;
      // Each objective gets simulated time in proportion to its walk: one that eats far more (re-routes, enemies,
      // a corner it keeps sliding along) is written off with the reason, so the rest are still tried and the
      // verdict says what went wrong instead of "ran too long".
      const started = this.objectiveStart.get(o.id);
      if (started === undefined) this.objectiveStart.set(o.id, { t: s.time, limit: (pathLength(this.graph, plan.path) / Math.max(0.5, this.params.speed)) * LEG_SLOW_FACTOR + OBJECTIVE_SLACK_S });
      else if (s.time - started.t > started.limit) {
        this.markFailed(o, (this.gapWaited.get(o.id) ?? 0) >= GAP_WAIT_S ? 'enemies kept the player from getting to it' : 'the player kept getting stuck on the way');
        const r = this.results.get(o.id);
        if (r) r.status = 'untouched';
        continue;
      }
      if (this.threats && (await this.waitForGap(o, this.graph.pos(plan.path[plan.path.length - 1] as number)))) continue;
      this.note = `walking to ${o.label} (${this.doneCount + 1}/${this.totalObjectives})`;
      this.emit();
      const res = await this.travel(plan.path);
      if (res === 'ended' || res === 'stopped') break;
      // Stepped out of an enemy's way or the pack moved: plan again from here (not a failed attempt).
      if (res === 'threat') continue;
      if (res === 'arrived') {
        const ok = o.kind === 'talk' ? await this.converse(o) : o.kind === 'press' ? await this.pressKey(o, plan.path[plan.path.length - 1] as number) : await this.touch(o, plan.jumpAt, plan.path[plan.path.length - 1] as number);
        if (!ok && !this.stopped) {
          this.markFailed(o, 'the player reached it but it did not trigger');
          const r = this.results.get(o.id);
          if (r) r.status = 'untouched';
        }
        stalls = 0;
        continue;
      }
      // fell / stuck / teleported: replan, up to a cap per objective.
      const n = (this.replans.get(o.id) ?? 0) + 1;
      this.replans.set(o.id, n);
      if (res === 'fell') {
        // Wait to land.
        await this.idle(0.3);
      }
      // 'lost' (walked onto another level) is re-planned from where the player stands, counted like a stuck.
      if (n > PLAYTEST_LIMITS.MAX_REPLANS) {
        this.markFailed(o, 'the player kept getting stuck on the way');
        const r = this.results.get(o.id);
        if (r) r.status = 'untouched';
      }
    }
  }

  /** Put the zones that set state back on the list (see {@link play}); returns how many. */
  private revisitZones(): number {
    let n = 0;
    for (const o of this.goals.objectives) {
      if (o.kind !== 'zone' || o.completes !== 'state' || !o.required || this.failedReason.has(o.id) || this.revisited.has(o.id)) continue;
      const r = this.results.get(o.id);
      if (r?.status !== 'done') continue;
      this.revisited.add(o.id);
      this.pending.set(o.id, o);
      this.objectiveStart.delete(o.id);
      this.replans.delete(o.id);
      r.status = 'pending';
      delete r.at;
      this.doneCount--;
      n++;
    }
    return n;
  }

  // -------------------------------------------------------------------
  // Analysis and report
  // -------------------------------------------------------------------

  private nearestReachable(p: Readonly<Vec3>): { node: number; h: number; v: number } | null {
    const d = this.reachableFromStart;
    if (!d) return null;
    const g = this.graph;
    let best = -1;
    let bestScore = Infinity;
    let bh = 0;
    let bv = 0;
    for (let i = 0; i < g.count; i++) {
      if (!Number.isFinite(d[i] as number)) continue;
      const h = Math.hypot((g.px[i] as number) - p[0], (g.pz[i] as number) - p[2]);
      const v = p[1] - (g.py[i] as number);
      const score = h + Math.abs(v - 0.5) * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = i;
        bh = h;
        bv = v;
      }
    }
    return best < 0 ? null : { node: best, h: bh, v: bv };
  }

  private async finish(): Promise<PlaytestReport> {
    const s = this.session;
    this.phase = 'analyse';
    this.note = 'analysing the run';
    this.emit(true);
    const outcome = s.host.seen.outcome;
    const jumpH = jumpHeight(this.params);

    // Objectives that were not completed: why.
    const unresolved = [...this.pending.values()];
    // The analysis below measures the level itself: no enemy costs on the map.
    if (this.graph) {
      this.graph.danger.fill(0);
      this.graph.linkScale = 1;
    }
    if (this.startNode >= 0) this.graph.clearBad();
    for (const o of unresolved) {
      const r = this.results.get(o.id);
      if (!r) continue;
      if (o.kind === 'talk' && o.talk && this.stopReason === null && !(s.over && outcome === 'win')) {
        const ready = this.talkReady(o);
        const why = this.talkWhy.get(o.id) ?? (ready ? null : `the options it needs never became available (${o.talk.needs.map((c) => `${c.key} ${c.op} ${c.value}`).join(', ')})`);
        if (why) {
          r.status = 'untouched';
          r.reason = why;
          this.findings.push({
            code: 'talk_failed',
            severity: 'error',
            message: `${o.talk.name} cannot give the game what it needs: ${why}`,
            entities: [o.talk.npc],
            position: o.position,
            hint: ready ? `check ${o.talk.name}'s dialogue and where they stand` : `make the options in ${o.talk.name}'s dialogue reachable (enough pickups to pay with)`,
            data: { npc: o.talk.npc },
          });
          continue;
        }
      }
      if (r.status === 'untouched') {
        r.reason = this.failedReason.get(o.id) ?? 'it did not trigger';
        continue;
      }
      if (this.stopReason !== null) {
        r.status = 'pending';
        r.reason = this.stopReason === 'budget' ? 'the check ran out of time' : 'the game ran too long';
        continue;
      }
      if (s.over && outcome === 'win') {
        // The game was won before this (optional) objective: not a defect.
        r.status = 'pending';
        r.reason = 'the game was won first';
        continue;
      }
      const targets = this.targetsFor(o);
      const reach = this.reachableFromStart;
      const ideal = reach !== null && targets.some((t) => Number.isFinite(reach[t.node] as number));
      if (ideal) {
        // Reachable when every door is open: something in the way did not open.
        r.status = 'blocked';
        const blockedBy = this.blockingDoors(o);
        r.reason = blockedBy.length > 0 ? `${blockedBy.map((d) => d.id).join(', ')} stayed shut` : 'a path exists but the bot could not follow it';
        const door = blockedBy[0];
        // A door is only blamed when it is locked by state, or the player really tried it and it did not open.
        if (door && (door.trigger === 'state' || this.doorFailures.has(door.id) || this.narrowDoors.has(door.id))) {
          this.pushDoorFinding(door, o);
        } else if (!outcome) {
          this.findings.push({ code: 'stuck', severity: o.required ? 'error' : 'warning', message: `the bot could not find a walkable route to ${o.label} at ${fmtPos(o.position)}${door ? ` (the way passes ${door.id})` : ''}`, entities: o.entity ? [o.entity] : [], position: o.position, hint: 'check the route for thin gaps or steep steps' });
        }
      } else {
        r.status = 'unreachable';
        if (this.kind === 'walkthrough') {
          const near = this.nearestReachable(o.position);
          r.reason = 'no walkable way in from the entrance';
          this.findings.push({ code: 'room_unreachable', severity: 'error', message: `${o.label} cannot be reached on foot from the entrance`, entities: o.entity ? [o.entity] : [], position: o.position, hint: 'add a door, or clear the doorway and the walkway in front of it', ...(near ? { data: { nearX: this.graph.px[near.node] as number, nearZ: this.graph.pz[near.node] as number, gap: near.h } } : {}) });
          continue;
        }
        // Lifts and moving platforms are planned on their starting pose only: a gap they may bridge is not a verdict.
        const maybeLift = this.goals.movers.length > 0;
        const near = this.nearestReachable(o.position);
        const gapH = near ? r1(near.h) : 0;
        const gapV = near ? r1(near.v) : 0;
        const tooHigh = gapV > jumpH * 0.9;
        const why = near
          ? `${gapH} m from the nearest place the player can stand${tooHigh ? ` and ${r1(gapV)} m too high` : gapV < -2 ? ` and ${r1(-gapV)} m below it` : ''}`
          : 'there is no floor near it';
        r.reason = why;
        this.findings.push({
          code: 'unreachable_objective',
          severity: o.required && !maybeLift ? 'error' : 'warning',
          message: `${maybeLift ? 'could not check: ' : ''}${o.kind === 'collect' ? 'the pickup' : o.label} ${o.kind === 'collect' ? `${o.label} ` : ''}at ${fmtPos(o.position)} cannot be reached: ${why}`.replace(/\s+/g, ' '),
          entities: o.entity ? [o.entity] : [],
          position: o.position,
          hint: near ? `bring it within reach: nearest standable spot is ${fmtPos(g3(this.graph, near.node))}` : 'give it some floor',
          data: near ? { gapH: near.h, gapV: near.v, nodeX: this.graph.px[near.node] as number, nodeY: this.graph.py[near.node] as number, nodeZ: this.graph.pz[near.node] as number, required: o.required } : { required: o.required },
        });
      }
    }
    // Doors the player's body cannot pass: always a defect in a building, and in a game when something stayed out of reach.
    if (this.kind === 'walkthrough' || this.pending.size > 0) {
      for (const [id, n] of this.narrowDoors) {
        if (this.kind === 'game' && !unresolved.some((o) => this.blockingDoors(o).some((d) => d.id === id))) continue;
        const door = this.goals.doors.find((d) => d.id === id);
        const mattered = unresolved.length > 0 && unresolved.some((o) => this.blockingDoors(o).some((d) => d.id === id) || this.kind === 'walkthrough');
        this.findings.push({
          code: 'door_blocked',
          severity: mattered ? 'error' : 'warning',
          message: `the door ${id} is ${mattered ? 'too narrow for the player' : 'a tight squeeze for the player'}: about ${n.clear} m of room, the player needs ${n.need} m`,
          entities: [id],
          ...(door ? { position: door.center } : {}),
          hint: `make ${id} at least 0.9 m wide`,
          data: { door: id, clear: n.clear, need: n.need },
        });
      }
    }
    // Stuck blockers that are doors or other things.
    for (const [id, n] of this.stuckBlockers) {
      const door = this.goals.doors.find((d) => d.id === id);
      if (door) {
        // A door the player struggled with only matters when something stayed unreachable.
        if (n >= 3 && this.pending.size > 0) this.pushDoorFinding(door, null);
      } else if (n >= 2 && !this.findings.some((f) => f.code === 'stuck' && f.entities.includes(id))) {
        const furniture = this.world.entities[id]?.arch?.role === 'furniture';
        this.findings.push({ code: furniture ? 'clipping' : 'stuck', severity: this.pending.size > 0 ? 'error' : 'warning', message: furniture ? `${this.world.entities[id]?.name || id} (${id}) leaves too little room to walk past it` : `the player got stuck on ${id}`, entities: [id], hint: furniture ? `move ${id} away from the walkway` : `check the collider of ${id}` });
      }
    }
    if (s.falls + this.fellCount > 0) {
      this.findings.push({ code: 'fell', severity: 'info', message: `the bot fell ${s.falls + this.fellCount} time${s.falls + this.fellCount === 1 ? '' : 's'} on its way`, entities: [], hint: 'none' });
    }

    // The ending of the run.
    const required = [...this.results.values()].filter((r) => r.required);
    const requiredDone = required.every((r) => r.status === 'done');
    if (this.kind === 'walkthrough') {
      this.documentChecks();
    } else if (outcome === 'lose') {
      this.findings.push({ code: 'lost', severity: 'error', message: `the game was lost: "${s.host.seen.endText || 'game over'}"`, entities: [], hint: s.host.seen.endText || 'check what ends the game', data: { text: s.host.seen.endText, seconds: s.time } });
    } else if (outcome === null && this.stopReason === null && this.startNode >= 0) {
      if (!this.goals.winDefined && this.goals.objectives.length > 0) {
        this.findings.push({ code: 'no_win_condition', severity: 'error', message: requiredDone ? 'every pickup can be collected, but nothing ever ends the game' : 'nothing in this world ends the game', entities: [], hint: 'add a win rule', data: { done: requiredDone } });
      } else if (requiredDone && this.goals.winDefined) {
        const thr = this.thresholdFinding();
        this.findings.push(thr ?? { code: 'unwinnable', severity: 'error', message: 'everything was done but the win never triggered', entities: [], hint: 'check the winning rule conditions' });
      } else if (!requiredDone && !this.findings.some((f) => f.severity === 'error')) {
        this.findings.push({ code: 'unwinnable', severity: 'error', message: 'the bot ran out of things it could do without winning', entities: [], hint: 'check what is needed to win' });
      }
    }
    if (this.stopReason !== null && outcome === null && this.pending.size > 0) {
      this.findings.push({ code: 'budget', severity: 'warning', message: this.stopReason === 'budget' ? 'the check ran out of time before the game was decided' : 'the game ran for too long without finishing', entities: [], hint: 'make the course shorter or the goal closer' });
    }
    if (this.kind === 'game' && this.startNode >= 0 && this.goals.winDefined && this.reachableFromStart) {
      await this.softLocks();
    }

    return this.buildReport();
  }

  /** Furniture in the way of doors, overlapping and floating pieces, from the building checks. */
  private documentChecks(): void {
    let reports;
    try {
      reports = checkBuildings(this.world);
    } catch {
      return;
    }
    for (const rep of reports) {
      for (const issue of rep.issues) {
        if (issue.code === 'unreachable_room' || issue.code === 'no_entrance') continue;
        const code = issue.code === 'door_blocked' ? 'door_blocked' : 'clipping';
        this.findings.push({ code, severity: issue.code === 'door_blocked' ? 'error' : 'warning', message: issue.message, entities: issue.entities, hint: issue.hint });
      }
    }
  }

  private blockingDoors(o: GoalObjective): DoorInfo[] {
    const g = this.graph;
    const targets = new Set(this.targetsFor(o).map((t) => t.node));
    g.blocked.fill(0);
    const start = g.nearest(this.session.position, 3, 6);
    if (start < 0) return [];
    const res = g.search(start, (n) => targets.has(n));
    if (res.hit < 0) return [];
    const path = g.pathTo(res.parent, res.hit);
    const out: DoorInfo[] = [];
    const p: Vec3 = [0, 0, 0];
    for (const n of path) {
      g.pos(n, p);
      const d = this.doorNear(p, 0.5);
      if (d && !out.includes(d) && !this.doorPassable(d)) out.push(d);
    }
    if (out.length === 0) {
      for (const n of path) {
        g.pos(n, p);
        const d = this.doorNear(p, 0.5);
        if (d && !out.includes(d) && !this.doorOpen(d)) out.push(d);
      }
    }
    return out;
  }

  private pushDoorFinding(d: DoorInfo, o: GoalObjective | null): void {
    if (this.doorOpen(d) && d.trigger !== 'state') {
      if (this.narrowDoors.has(d.id) || this.findings.some((f) => f.code === 'door_blocked' && f.entities.includes(d.id))) return;
      const width = d.bounds ? Math.min(d.bounds.max[0] - d.bounds.min[0], d.bounds.max[2] - d.bounds.min[2]) : 0;
      const wide = d.bounds ? Math.max(d.bounds.max[0] - d.bounds.min[0], d.bounds.max[2] - d.bounds.min[2]) : 0;
      this.findings.push({
        code: 'door_blocked',
        severity: 'error',
        message: `the player cannot squeeze through the door ${d.id}: even open it leaves too little room for the player's body (about 0.7 m wide)${wide > 0 ? `, the leaf is ${r2(Math.max(width, wide))} m` : ''}${o ? ` (it leads to ${o.label})` : ''}`,
        entities: [d.id],
        position: d.center,
        hint: `make ${d.id} wider (0.9 m or more) or clear the frame around it`,
        data: { door: d.id },
      });
      return;
    }
    const code = this.findings.some((f) => (f.code === 'door_locked' || f.code === 'door_stuck') && f.entities.includes(d.id));
    if (code) return;
    if (d.trigger === 'state') {
      const producers = d.stateKey ? this.producersOf(d.stateKey) : 0;
      const hasKey = d.stateKey !== '';
      this.findings.push({
        code: 'door_locked',
        severity: 'error',
        message: !hasKey
          ? `the door ${d.id} is set to open from a state key but none is named, so it never opens${o ? ` (it blocks ${o.label})` : ''}`
          : producers === 0
            ? `the door ${d.id} opens when "${d.stateKey}" is set, but nothing in the game ever sets it${o ? ` (it blocks ${o.label})` : ''}`
            : `the door ${d.id} stayed locked: "${d.stateKey}" was never set${o ? ` (it blocks ${o.label})` : ''}`,
        entities: [d.id],
        position: d.center,
        hint: producers === 0 ? `make ${d.id} open by proximity, or add a pickup or rule that sets "${d.stateKey}"` : `make sure the pickup that sets "${d.stateKey}" can be reached`,
        data: { door: d.id, stateKey: d.stateKey, producers },
      });
    } else {
      this.findings.push({
        code: 'door_stuck',
        severity: 'error',
        message: `the door ${d.id} did not open when the player walked up to it${d.trigger === 'key' ? ` and pressed "${d.key}"` : ''}`,
        entities: [d.id],
        position: d.center,
        hint: d.trigger === 'key' ? `check the key and radius of ${d.id}` : `check the radius of ${d.id}`,
        data: { door: d.id, trigger: d.trigger, radius: d.radius },
      });
    }
  }

  /** Count of things that can raise a state key: pickups and rules. */
  private producersOf(key: string): number {
    const base = key.split('.')[0] as string;
    let n = 0;
    for (const o of this.goals.objectives) if (o.key === base && o.kind !== 'goal') n++;
    for (const r of this.world.rules) if (r.enabled && r.then.some((a) => (a.do === 'set' || a.do === 'add') && a.key.split('.')[0] === base)) n++;
    for (const id in this.world.entities) {
      const e = this.world.entities[id] as Entity;
      if (e.behaviors.some((b) => b.enabled && b.type === 'pressurePlate' && b.params['stateKey'] === key)) n++;
      if (this.goals.objectives.some((o) => o.kind === 'talk' && o.entity === id && o.talk?.writes.some((k) => k === base))) n++;
    }
    return n;
  }

  /** "The win needs score ≥ 10 but only 8 can be collected." */
  private thresholdFinding(): Finding | null {
    for (const t of winThresholds(this.world)) {
      const available = (this.goals.producible.get(t.key) ?? 0) + (typeof this.world.state[t.key] === 'number' ? (this.world.state[t.key] as number) : 0);
      const needsMore = (t.op === '>=' || t.op === '==') && available < t.value;
      const needsMoreStrict = t.op === '>' && available <= t.value;
      if (needsMore || needsMoreStrict) {
        return {
          code: 'unwinnable',
          severity: 'error',
          message: `winning needs ${t.key} ${t.op} ${t.value}, but only ${available} can ever be collected`,
          entities: [],
          hint: `lower the target to ${available} or add more pickups`,
          data: { ruleId: t.ruleId, key: t.key, op: t.op, needed: t.value, available },
        };
      }
    }
    return null;
  }

  /** Places the player can fall into and never leave. */
  private async softLocks(): Promise<void> {
    const g = this.graph;
    const reach = this.reachableFromStart as Float64Array;
    if (g.count > 90_000) return;
    g.blocked.fill(0);
    // Forward edges over the reachable set, then reverse reachability of the winning spots.
    const winTargets = new Set<number>();
    for (const o of this.goals.objectives) if (o.required && (this.isWinObjective(o) || o.kind === 'collect')) for (const t of this.targetsFor(o)) if (Number.isFinite(reach[t.node] as number)) winTargets.add(t.node);
    if (winTargets.size === 0) return;
    const n = g.count;
    const deg = new Int32Array(n + 1);
    const from: number[] = [];
    const to: number[] = [];
    let work = 0;
    for (let u = 0; u < n; u++) {
      if (!Number.isFinite(reach[u] as number)) continue;
      g.forEachEdge(u, (v) => {
        from.push(u);
        to.push(v);
        deg[v + 1] = (deg[v + 1] as number) + 1;
      });
      if (++work % 3000 === 0) await this.checkpoint();
      if (this.stopReason === 'budget') return;
    }
    for (let i = 0; i < n; i++) deg[i + 1] = (deg[i + 1] as number) + (deg[i] as number);
    const rev = new Int32Array(from.length);
    const fill = deg.slice(0, n);
    for (let e = 0; e < from.length; e++) {
      const v = to[e] as number;
      rev[fill[v] as number] = from[e] as number;
      fill[v] = (fill[v] as number) + 1;
    }
    const can = new Uint8Array(n);
    const queue: number[] = [];
    for (const t of winTargets) {
      can[t] = 1;
      queue.push(t);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi] as number;
      for (let k = deg[v] as number; k < (deg[v + 1] as number); k++) {
        const u = rev[k] as number;
        if (!can[u]) {
          can[u] = 1;
          queue.push(u);
        }
      }
    }
    // Trapped = reachable but cannot reach a winning spot. Cluster them.
    const seen = new Uint8Array(n);
    const clusters: Array<{ size: number; sum: Vec3; minY: number; edge: boolean }> = [];
    const edge = g.cell * 4;
    const x1 = g.x0 + g.nx * g.cell;
    const z1 = g.z0 + g.nz * g.cell;
    for (let u = 0; u < n; u++) {
      if (!Number.isFinite(reach[u] as number) || can[u] || seen[u]) continue;
      const stack = [u];
      seen[u] = 1;
      const c = { size: 0, sum: [0, 0, 0] as Vec3, minY: Infinity, edge: false };
      while (stack.length > 0) {
        const x = stack.pop() as number;
        c.size++;
        c.sum[0] += g.px[x] as number;
        c.sum[1] += g.py[x] as number;
        c.sum[2] += g.pz[x] as number;
        c.minY = Math.min(c.minY, g.py[x] as number);
        // A pocket against the edge of the mapped area may continue outside it: no verdict there.
        const gx = g.px[x] as number;
        const gz = g.pz[x] as number;
        if (gx < g.x0 + edge || gx > x1 - edge || gz < g.z0 + edge || gz > z1 - edge) c.edge = true;
        g.forEachEdge(x, (v) => {
          if (!can[v] && !seen[v] && Number.isFinite(reach[v] as number)) {
            seen[v] = 1;
            stack.push(v);
          }
        });
      }
      clusters.push(c);
    }
    clusters.sort((a, b) => b.size - a.size);
    // Ignore specks (a few nodes) and report the biggest few.
    const minSize = Math.max(6, Math.round(1.2 / (g.cell * g.cell)));
    for (const c of clusters.slice(0, 3)) {
      if (c.size < minSize || c.edge) continue;
      const centre: Vec3 = [c.sum[0] / c.size, c.sum[1] / c.size, c.sum[2] / c.size];
      this.findings.push({
        code: 'soft_lock',
        severity: 'warning',
        message: `a player can drop into the area around ${fmtPos(centre)} (height ${r1(centre[1])}) and never get out again`,
        entities: [],
        position: centre,
        hint: 'add a way back up (a ramp or steps) or a respawn',
        data: { x: centre[0], y: centre[1], z: centre[2], cells: c.size },
      });
    }
  }

  private buildReport(): PlaytestReport {
    const s = this.session;
    const outcome = s.host.seen.outcome;
    const trace = this.opts.trace === false ? undefined : s.finishTrace();
    if (outcome) s.note(outcome === 'win' ? 'win' : 'lose', s.host.seen.endText || outcome);
    const objectives = [...this.results.values()];
    const errors = this.findings.filter((f) => f.severity === 'error');
    let status: PlaytestReport['status'];
    const everyRoom = this.kind === 'walkthrough' && objectives.length > 0 && objectives.every((o) => o.status === 'done');
    if (this.startNode < 0 && this.findings.some((f) => f.code === 'spawn_blocked')) status = 'failed';
    else if (this.kind === 'walkthrough') status = errors.length > 0 ? 'failed' : everyRoom ? 'passed' : 'inconclusive';
    else if (outcome === 'win') status = errors.length === 0 ? 'passed' : 'failed';
    else if (errors.length > 0) status = 'failed';
    else status = 'inconclusive';
    // A win with unreachable *required* objectives cannot happen; with optional ones it is still a pass.
    const won = this.kind === 'walkthrough' ? status === 'passed' : outcome === 'win';
    const doneOpt = objectives.filter((o) => o.status === 'done').length;
    const seconds = r1(s.time);
    const findings = this.findings.slice(0, PLAYTEST_LIMITS.MAX_FINDINGS);
    let summary: string;
    if (status === 'passed' && this.kind === 'walkthrough') {
      const doors = this.goals.doors.filter((d) => this.doorWas.get(d.id) === true).length;
      summary = `Verified walkable: the bot reached all ${objectives.length} room${objectives.length === 1 ? '' : 's'} in ${seconds} s${doors > 0 ? `, opening ${doors} door${doors === 1 ? '' : 's'}` : ''}, with nothing in the way.`;
    } else if (status === 'passed') {
      const pick = objectives.filter((o) => o.kind === 'collect');
      const got = pick.filter((o) => o.status === 'done').length;
      const talks = objectives.filter((o) => o.kind === 'talk' && o.status === 'done');
      const extra = (pick.length > 0 ? `, collecting ${got} of ${pick.length} pickup${pick.length === 1 ? '' : 's'}` : '') + (talks.length > 0 ? `${pick.length > 0 ? ' and' : ','} talking to ${talks.map((o) => o.label.replace(/^talk to /, '')).slice(0, 3).join(' and ')}` : '');
      summary = `Verified playable: the bot won in ${seconds} s${extra}${s.falls + this.fellCount > 0 ? ` (it fell ${s.falls + this.fellCount}x on the way)` : ''}.`;
    } else if (status === 'failed') {
      const first = errors[0];
      summary = `Could not verify: ${first ? first.message : this.kind === 'walkthrough' ? 'a room could not be reached' : 'the game could not be won'}.`;
    } else {
      const note = findings.find((f) => f.severity === 'warning');
      summary = `Not verified yet${note ? `: ${note.message}` : ` (${doneOpt} of ${objectives.length} objectives done in ${seconds} s)`}.`;
    }
    this.phase = 'done';
    this.note = summary;
    this.emit(true);
    const path = downsample(s.sampledPath(), PLAYTEST_LIMITS.MAX_PATH_POINTS);
    return {
      v: 1,
      kind: this.kind,
      status,
      won,
      outcome,
      seconds: r2(s.time),
      steps: s.steps,
      wallMs: Math.round(nowMs() - this.t0),
      objectives,
      findings,
      falls: s.falls + this.fellCount,
      stuckPoints: this.stuckPoints,
      path,
      ...(trace ? { trace } : {}),
      summary,
      worldHash: hashWorld(this.world),
      ...(s.host.seen.endText ? { endText: s.host.seen.endText } : {}),
      stats: { searches: this.graph ? this.graph.searches : 0, expanded: this.graph ? this.graph.expandedTotal : 0, navNodes: this.graph ? this.graph.count : 0, navCell: this.graph ? this.graph.cell : 0, navMs: this.navMs, planMs: Math.round(this.planMs), ...(this.threats ? { evasions: this.evasions } : {}) },
    };
  }

  /**
   * Build the walking map of the world and answer reach questions about it without playing: the level
   * tools use this to tell the assistant, while it places things, what the player can get to.
   */
  async openProbe(): Promise<LevelProbe> {
    const none = (problem: string): LevelProbe => ({ ok: false, problem, objectives: () => [], reachFrom: () => null, spawnOk: false, dispose: () => undefined });
    const verdict = validateWorld(this.world);
    if (!verdict.ok) return none('the world document is invalid');
    const why = unsupportedReason(this.world);
    if (why) return none(`reach cannot be measured here: ${why}`);
    await ensureAssetCatalog(this.world);
    this.goals = deriveGoals(this.world);
    const session = await Session.create(this.world, { trace: false });
    this.session = session;
    const dispose = (): void => {
      this.graph?.dispose();
      this.probe?.dispose();
      session.dispose();
    };
    try {
      await this.prepare();
    } catch (e) {
      dispose();
      throw e;
    }
    const spawnOk = this.startNode >= 0 && this.findings.every((f) => f.code !== 'spawn_blocked');
    const problem = spawnOk ? '' : (this.findings.find((f) => f.code === 'spawn_blocked')?.message ?? 'the player has nowhere to stand at the spawn point');
    const explain = (pos: Readonly<Vec3>): LevelReachAnswer => {
      const jumpH = jumpHeight(this.params);
      const reach = this.reachableFromStart;
      if (!spawnOk || !reach) return { reachable: false, reason: problem, gapH: 0, gapV: 0, nearest: null };
      const touch: GoalObjective['touch'] = { shape: { kind: 'cylinder', half: [0.5, 0.9, 0.5] }, center: [pos[0], pos[1], pos[2]], rot: [0, 0, 0, 1], margin: 0.3 };
      const targets = this.scanTargets(touch, Math.max(0, jumpH * 0.9));
      if (targets.some((t) => Number.isFinite(reach[t.node] as number))) return { reachable: true, reason: '', gapH: 0, gapV: 0, nearest: null };
      const near = this.nearestReachable(pos);
      if (!near) return { reachable: false, reason: 'there is no floor near it', gapH: 0, gapV: 0, nearest: null };
      const tooHigh = near.v > jumpH * 0.9;
      const reason = `${r1(near.h)} m from the nearest place the player can stand${tooHigh ? ` and ${r1(near.v)} m too high (a jump reaches ${r1(jumpH * 0.85)} m)` : near.v < -2 ? ` and ${r1(-near.v)} m below it` : ''}`;
      return { reachable: false, reason, gapH: near.h, gapV: near.v, nearest: g3(this.graph, near.node) };
    };
    const objectives = (): LevelObjectiveReach[] =>
      this.goals.objectives.map((o) => {
        const e = explain(o.position);
        return { id: o.id, kind: o.kind, label: o.label, position: [o.position[0], o.position[1], o.position[2]], required: o.required, reachable: e.reachable, reason: e.reason, nearest: e.nearest };
      });
    return { ok: spawnOk, problem, objectives, reachFrom: (pos) => explain(pos), spawnOk, dispose };
  }
}

/** One objective of a game and whether the player can get to it on foot (jumps, drops and lifts included). */
export interface LevelObjectiveReach {
  id: string;
  kind: GoalObjective['kind'];
  label: string;
  position: Vec3;
  required: boolean;
  reachable: boolean;
  /** Why not: distance to the nearest standable place and how much too high or low. */
  reason: string;
  nearest: Vec3 | null;
}

/** The answer to "can the player stand within reach of this point?". */
export interface LevelReachAnswer {
  reachable: boolean;
  reason: string;
  gapH: number;
  gapV: number;
  nearest: Vec3 | null;
}

/** Reach questions about a game's walking map (see {@link probeLevel}). */
export interface LevelProbe {
  ok: boolean;
  /** What is wrong when `ok` is false (spawn buried, world invalid, a view the bot cannot walk). */
  problem: string;
  spawnOk: boolean;
  objectives: () => LevelObjectiveReach[];
  /** Whether the player can stand within reach of a point, and if not why not. */
  reachFrom: (pos: Readonly<Vec3>) => LevelReachAnswer | null;
  dispose: () => void;
}

/** Build the walking map of a game for reach questions. The caller disposes it. */
export async function probeLevel(input: WorldDoc): Promise<LevelProbe> {
  return new Bot(input, {}, 'game').openProbe();
}

/** Length of a node path on the ground (m). */
function pathLength(g: NavGraph, path: readonly number[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as number;
    const b = path[i] as number;
    len += Math.hypot((g.px[b] as number) - (g.px[a] as number), (g.pz[b] as number) - (g.pz[a] as number));
  }
  return len;
}

function g3(g: NavGraph, node: number): Vec3 {
  return g.pos(node);
}

/** Keep at most `max` evenly spaced points (the last one always). */
export function downsample<T>(list: readonly T[], max: number): T[] {
  if (list.length <= max) return list.slice();
  const out: T[] = [];
  const step = (list.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)] as T);
  return out;
}
