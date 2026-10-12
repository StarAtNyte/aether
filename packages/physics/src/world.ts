/**
 * PhysicsWorld — the World IR simulated with Rapier.
 *
 * - One rigid body per instantiated entity with a `physics` spec, posed by
 *   its world transform; physics-less shaped descendants become compound
 *   colliders of their nearest physics ancestor.
 * - Fixed-timestep stepping with an accumulator and a substep clamp.
 * - Incremental `sync` from World IR diffs (bodies are only rebuilt when
 *   their physical definition changed; pure moves teleport).
 * - Snapshots carry the handle ↔ entity maps so `restore`/`fork` are exact.
 */
import type { Collider, EventQueue, ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { BodyType, Entity, EntityId, Vec3, WorldDiff, WorldDoc } from '@aether/core';
import { diffWorlds, Entity as EntitySchema, eulerDegToQuat, inspectUntrusted, LIMITS } from '@aether/core';
import { EventCollector } from './events';
import { createJoint } from './joints';
import { bodyOwnerOf, childIndex, entityPose, hasBody, planBody, planWorld, type BodyPlan, type CompositePart, type Pose } from './plan';
import { initPhysics, rapier } from './rapier';
import { presetDensity, toRapierDesc } from './rapier-colliders';
import { scatterInstances } from './scatter';
import { placeCollider, scaleCollider, type LocalCollider } from './shapes';
import { decodeSnapshot, encodeSnapshot, type BodyMeta, type SnapshotMeta } from './snapshot';
import { resolveShapeColliders } from './source';
import { GROUND_ID, type BodyState, type ColliderProvider, type Diagnostic, type PhysicsEvent, type PhysicsStats, type PhysicsWorldOptions, type Quat, type RaycastHit } from './types';
import { isFiniteVec, normalizeQuat, quatMul, rotate } from './vec';

/** Engine limits (bounded work for untrusted worlds). */
export const PHYSICS_LIMITS = Object.freeze({
  /** Max substeps per `step(dt)` call (spiral-of-death guard). */
  MAX_SUBSTEPS: 5,
  /** Longest frame `step` accepts; longer frames are clamped. */
  MAX_FRAME_DT: 0.25,
  /** Scatter shapes with more instances get no colliders. */
  MAX_SCATTER_COLLIDERS: 2000,
  /** Total collider budget per world. */
  MAX_COLLIDERS: 60_000,
  /** Total body budget per world. */
  MAX_BODIES: LIMITS.MAX_ENTITIES,
  /** Ray lengths are clamped to this. */
  MAX_RAY_DISTANCE: 10_000,
  /** Impact force (in multiples of body weight) above which contact-force events fire. */
  IMPACT_WEIGHTS: 2,
  /**
   * Max edge length of one ground tile. Very large single boxes lose float
   * precision in shape casts (the character controller sinks through them),
   * so the ground is tiled.
   */
  GROUND_TILE: 100,
  /** Max tiles per ground side (huge grounds get larger tiles instead). */
  MAX_GROUND_TILES_PER_SIDE: 16,
});

const DEFAULT_DT = 1 / 60;
const GROUND_THICKNESS = 1;
const GROUND_FRICTION = 0.8;
const STEP_MS_SMOOTHING = 0.1;
/** Collision types for sensors so static/kinematic zones also detect kinematic players. */
const SENSOR_COLLISION_TYPES = 1 | 2 | 12 | 8704 | 52224;

/** Live body bookkeeping. */
export interface BodyRecord {
  id: EntityId;
  entity: Entity;
  body: RigidBody;
  colliders: Collider[];
  sensor: boolean;
  type: BodyType;
  scale: Vec3;
  /** Plan for World-IR bodies; null for runtime spawns. */
  plan: BodyPlan | null;
  joint: ImpulseJoint | null;
  anchorBody: RigidBody | null;
  jointTarget: EntityId | 'world' | null;
}

interface GroundRecord {
  body: RigidBody;
  /** Square tiles (see {@link PHYSICS_LIMITS.GROUND_TILE}). */
  colliders: Collider[];
  size: number;
}

function clampDt(dt: number | undefined): number {
  if (dt === undefined || !Number.isFinite(dt) || dt <= 0) return DEFAULT_DT;
  return Math.min(0.1, Math.max(0.001, dt));
}

function safeVec(v: Vec3 | undefined): v is Vec3 {
  return isFiniteVec(v);
}

/** A simulated World IR. Create with {@link PhysicsWorld.create}. */
export class PhysicsWorld {
  private world: World;
  private readonly queue: EventQueue;
  private doc: WorldDoc;
  private readonly provider: ColliderProvider | undefined;
  private readonly fixedDt: number;
  private accumulator = 0;
  private steps = 0;
  private stepMsAvg = 0;
  private disposed = false;
  private readonly records = new Map<EntityId, BodyRecord>();
  private readonly owner = new Map<number, EntityId>();
  private readonly sensors = new Set<number>();
  private readonly externals = new Map<number, EntityId>();
  private readonly partOwner = new Map<EntityId, EntityId>();
  private readonly events = new EventCollector();
  private readonly eventMaps = { owner: this.owner, sensors: this.sensors };
  private readonly pending: PhysicsEvent[] = [];
  private readonly jointIssues = new Map<EntityId, Diagnostic[]>();
  private readonly buildNotes = new Map<EntityId, string[]>();
  private ground: GroundRecord | null = null;
  private colliderCount = 0;

  private constructor(world: World, doc: WorldDoc, provider: ColliderProvider | undefined, fixedDt: number) {
    this.world = world;
    this.doc = doc;
    this.provider = provider;
    this.fixedDt = fixedDt;
    this.world.timestep = fixedDt;
    this.queue = new (rapier().EventQueue)(true);
  }

  /**
   * Build a physics world from a World IR document. Never throws for bad
   * content: invalid joints and unsupported geometry become diagnostics /
   * build notes (see {@link diagnostics} and {@link notes}).
   */
  static async create(world: WorldDoc, opts: PhysicsWorldOptions = {}): Promise<PhysicsWorld> {
    await initPhysics();
    const R = rapier();
    const g = world.environment.gravity;
    const raw = new R.World(safeVec(g) ? { x: g[0], y: g[1], z: g[2] } : { x: 0, y: -9.81, z: 0 });
    let pw: PhysicsWorld;
    try {
      pw = new PhysicsWorld(raw, world, opts.colliders, clampDt(opts.fixedDt));
    } catch (err) {
      raw.free();
      throw err;
    }
    // Rapier memory is never garbage-collected: free the WASM world if building fails.
    try {
      pw.buildGround();
      const plans = planWorld(world);
      // Scatter bodies last so `onSurface` terrain colliders already exist.
      plans.sort((a, b) => Number(a.entity.shape.kind === 'scatter') - Number(b.entity.shape.kind === 'scatter'));
      for (const plan of plans) pw.addPlanned(plan);
      for (const plan of plans) pw.rebuildJoint(plan.id);
      pw.prime();
    } catch (err) {
      pw.dispose();
      throw err;
    }
    return pw;
  }

  /** Recreate a world from {@link snapshot} bytes (validated; throws on malformed input). */
  static async restore(snapshot: Uint8Array, world: WorldDoc, opts: { colliders?: ColliderProvider } = {}): Promise<PhysicsWorld> {
    await initPhysics();
    const R = rapier();
    const { meta, rapierBytes } = decodeSnapshot(snapshot);
    let raw: World | null = null;
    try {
      raw = R.World.restoreSnapshot(rapierBytes);
    } catch {
      raw = null;
    }
    if (!raw) throw new Error('invalid physics snapshot: world data could not be restored');
    const pw = new PhysicsWorld(raw, world, opts.colliders, meta.fixedDt);
    try {
      pw.loadMeta(meta);
    } catch (err) {
      pw.dispose();
      throw err;
    }
    return pw;
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /** Simulated seconds since creation. */
  get time(): number {
    return this.steps * this.fixedDt;
  }

  /** Interpolation factor in [0, 1) between the last two fixed steps (for rendering). */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.fixedDt));
  }

  /** The fixed step length in seconds. */
  get dt(): number {
    return this.fixedDt;
  }

  /** The World IR this simulation currently mirrors. */
  get document(): WorldDoc {
    return this.doc;
  }

  /**
   * Advance by a frame delta using a fixed-timestep accumulator. At most
   * {@link PHYSICS_LIMITS.MAX_SUBSTEPS} steps run per call; the excess is
   * dropped (spiral-of-death guard). Non-finite/negative deltas count as 0.
   */
  step(dt: number): PhysicsEvent[] {
    this.live();
    const frame = Number.isFinite(dt) && dt > 0 ? Math.min(dt, PHYSICS_LIMITS.MAX_FRAME_DT) : 0;
    this.accumulator += frame;
    const out: PhysicsEvent[] = [];
    const eps = this.fixedDt * 1e-6;
    let n = 0;
    while (this.accumulator + eps >= this.fixedDt && n < PHYSICS_LIMITS.MAX_SUBSTEPS) {
      this.stepInto(out);
      this.accumulator = Math.max(0, this.accumulator - this.fixedDt);
      n++;
    }
    if (this.accumulator >= this.fixedDt) this.accumulator %= this.fixedDt;
    if (n === 0 && this.pending.length > 0) this.flushPending(out);
    return out;
  }

  /** Advance exactly one fixed step. */
  stepFixed(): PhysicsEvent[] {
    this.live();
    const out: PhysicsEvent[] = [];
    this.stepInto(out);
    return out;
  }

  private stepInto(out: PhysicsEvent[]): void {
    this.flushPending(out);
    const t0 = performance.now();
    this.world.step(this.queue);
    this.steps++;
    this.events.drain(this.queue, this.eventMaps, this.fixedDt, out);
    const ms = performance.now() - t0;
    this.stepMsAvg = this.stepMsAvg === 0 ? ms : this.stepMsAvg + (ms - this.stepMsAvg) * STEP_MS_SMOOTHING;
  }

  private flushPending(out: PhysicsEvent[]): void {
    if (this.pending.length === 0) return;
    for (const e of this.pending) out.push(e);
    this.pending.length = 0;
  }

  /**
   * Zero-length step: updates broad/narrow phase so queries and contact
   * tests work immediately. Initial resting contacts are recorded silently;
   * initial sensor overlaps are delivered with the next step.
   */
  private prime(): void {
    this.world.timestep = 0;
    this.world.step(this.queue);
    this.world.timestep = this.fixedDt;
    this.events.drain(this.queue, this.eventMaps, this.fixedDt, this.pending, false);
  }

  /** Refresh scene queries after edits without advancing time (no events emitted). */
  refreshQueries(): void {
    this.live();
    this.prime();
  }

  // -------------------------------------------------------------------------
  // State access
  // -------------------------------------------------------------------------

  /** Current state of an entity's body, or undefined when it has none. */
  getState(id: EntityId): BodyState | undefined {
    const rec = this.records.get(id);
    if (!rec || this.disposed) return undefined;
    return stateOf(rec.body);
  }

  /** States of every body (static ones included). */
  getAllStates(): Map<EntityId, BodyState> {
    const out = new Map<EntityId, BodyState>();
    if (this.disposed) return out;
    for (const [id, rec] of this.records) out.set(id, stateOf(rec.body));
    return out;
  }

  /** Ids of dynamic bodies (document order, then runtime spawns). */
  dynamicIds(): EntityId[] {
    const out: EntityId[] = [];
    for (const [id, rec] of this.records) if (rec.type === 'dynamic') out.push(id);
    return out;
  }

  /** True when the entity has a body in this world. */
  has(id: EntityId): boolean {
    return this.records.has(id);
  }

  /**
   * Write `[px, py, pz, qx, qy, qz, qw]` for each id of `order` into `into`
   * (stride 7). Ids without a body leave their slot untouched.
   * @throws RangeError when `into` is too small.
   */
  writeTransforms(into: Float32Array, order: readonly EntityId[]): void {
    if (into.length < order.length * 7) throw new RangeError(`writeTransforms: need ${order.length * 7} floats, got ${into.length}`);
    if (this.disposed) return;
    for (let i = 0; i < order.length; i++) {
      const rec = this.records.get(order[i] as EntityId);
      if (!rec) continue;
      const t = rec.body.translation();
      const r = rec.body.rotation();
      const o = i * 7;
      into[o] = t.x;
      into[o + 1] = t.y;
      into[o + 2] = t.z;
      into[o + 3] = r.x;
      into[o + 4] = r.y;
      into[o + 5] = r.z;
      into[o + 6] = r.w;
    }
  }

  // -------------------------------------------------------------------------
  // Control (all inputs untrusted: non-finite values are ignored)
  // -------------------------------------------------------------------------

  /** Apply a linear impulse (N·s) at the center of mass of a dynamic body. */
  applyImpulse(id: EntityId, v: Vec3): void {
    const rec = this.dynamic(id);
    if (rec && safeVec(v)) rec.body.applyImpulse({ x: v[0], y: v[1], z: v[2] }, true);
  }

  /** Set the linear velocity of a dynamic body. */
  setVelocity(id: EntityId, v: Vec3): void {
    const rec = this.dynamic(id);
    if (rec && safeVec(v)) rec.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
  }

  /** Set the angular velocity (rad/s) of a dynamic body. */
  setAngularVelocity(id: EntityId, v: Vec3): void {
    const rec = this.dynamic(id);
    if (rec && safeVec(v)) rec.body.setAngvel({ x: v[0], y: v[1], z: v[2] }, true);
  }

  /** Linear velocity of a body, or undefined. */
  getVelocity(id: EntityId): Vec3 | undefined {
    const rec = this.records.get(id);
    if (!rec || this.disposed) return undefined;
    const v = rec.body.linvel();
    return [v.x, v.y, v.z];
  }

  /**
   * Drive a kinematic body to a pose at the next step (velocity is inferred,
   * so riders are carried). Static bodies are promoted to kinematic on first
   * use; dynamic bodies are left to the solver.
   */
  setKinematicTarget(id: EntityId, position: Vec3, quaternion: Quat): void {
    const rec = this.records.get(id);
    if (!rec || this.disposed || !safeVec(position) || !isFiniteVec(quaternion, 4)) return;
    if (rec.type === 'dynamic') return;
    if (rec.type === 'static') {
      rec.body.setBodyType(rapier().RigidBodyType.KinematicPositionBased, true);
      rec.type = 'kinematic';
    }
    const q = normalizeQuat(quaternion);
    rec.body.setNextKinematicTranslation({ x: position[0], y: position[1], z: position[2] });
    rec.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
  }

  /** Move a body instantly (dynamic bodies also lose their velocity). */
  teleport(id: EntityId, position: Vec3, quaternion?: Quat): void {
    const rec = this.records.get(id);
    if (!rec || this.disposed || !safeVec(position)) return;
    const p = { x: position[0], y: position[1], z: position[2] };
    rec.body.setTranslation(p, true);
    let q: Quat | null = null;
    if (quaternion && isFiniteVec(quaternion, 4)) {
      q = normalizeQuat(quaternion);
      rec.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    }
    if (rec.type === 'dynamic') {
      rec.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rec.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else if (rec.type === 'kinematic') {
      rec.body.setNextKinematicTranslation(p);
      if (q) rec.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    }
  }

  /**
   * Radial blast: every dynamic body whose center is within `radius` gets a
   * velocity change of `force × (1 − d / radius)` m/s away from `center`
   * (mass-independent, so light and heavy props both react) and is woken up.
   */
  explode(center: Vec3, force: number, radius: number): void {
    if (this.disposed || !safeVec(center) || !Number.isFinite(force) || !Number.isFinite(radius) || radius <= 0) return;
    for (const rec of this.records.values()) {
      if (rec.type !== 'dynamic') continue;
      const c = rec.body.worldCom();
      const dx = c.x - center[0];
      const dy = c.y - center[1];
      const dz = c.z - center[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      const k = (force * falloff * rec.body.mass()) / (d > 1e-6 ? d : 1);
      const dir = d > 1e-6 ? { x: dx * k, y: dy * k, z: dz * k } : { x: 0, y: k, z: 0 };
      rec.body.applyImpulse(dir, true);
    }
  }

  /** Change gravity and wake every dynamic body so the change is felt. */
  setGravity(v: Vec3): void {
    if (this.disposed || !safeVec(v)) return;
    this.world.gravity = { x: v[0], y: v[1], z: v[2] };
    for (const rec of this.records.values()) if (rec.type === 'dynamic') rec.body.wakeUp();
  }

  /** Current gravity vector. */
  getGravity(): Vec3 {
    const g = this.world.gravity;
    return [g.x, g.y, g.z];
  }

  /**
   * Spawn an entity at runtime (not part of the World IR). Its transform is
   * relative to its parent when the parent exists in the document. Invalid
   * entities are ignored. Replaces an existing body with the same id.
   *
   * `trusted` skips the untrusted-input screen and schema parse; only pass it
   * for entities derived from an already validated document (e.g. a logic
   * spawn cloned from a template), never for external input.
   */
  addEntity(entity: Entity, opts: { trusted?: boolean } = {}): void {
    this.live();
    let e: Entity;
    if (opts.trusted === true) {
      e = entity;
    } else {
      const guard = inspectUntrusted(entity);
      if (!guard.ok) return;
      const parsed = EntitySchema.safeParse(entity);
      if (!parsed.success) return;
      e = parsed.data;
    }
    if (!e.physics || e.template) return;
    if (this.records.has(e.id)) this.removeRecord(e.id);
    const pose = this.runtimePose(e);
    this.addBody(e, pose, [], null);
    if (e.joint) this.rebuildJoint(e.id);
  }

  /** Remove an entity's body (runtime or document entity). */
  removeEntity(id: EntityId): void {
    if (this.disposed || !this.records.has(id)) return;
    this.removeRecord(id);
    this.rebuildJointsTargeting(id);
  }

  private runtimePose(e: Entity): Pose {
    const local: Pose = { position: [...e.transform.position], quaternion: eulerDegToQuat(e.transform.rotation), scale: [...e.transform.scale] };
    if (e.parent === null || !Object.hasOwn(this.doc.entities, e.parent)) return local;
    const parent = entityPose(this.doc, e.parent);
    const p = rotate(parent.quaternion, [local.position[0] * parent.scale[0], local.position[1] * parent.scale[1], local.position[2] * parent.scale[2]]);
    return {
      position: [p[0] + parent.position[0], p[1] + parent.position[1], p[2] + parent.position[2]],
      quaternion: quatMul(parent.quaternion, local.quaternion),
      scale: [local.scale[0] * parent.scale[0], local.scale[1] * parent.scale[1], local.scale[2] * parent.scale[2]],
    };
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Closest solid hit along a ray (sensors ignored). `id` is null for the
   * ground. `excludeId` skips that entity's body.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, excludeId?: EntityId): RaycastHit | null {
    if (this.disposed || !safeVec(origin) || !safeVec(dir) || !Number.isFinite(maxDist) || maxDist <= 0) return null;
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 1e-9) return null;
    const R = rapier();
    const d = { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len };
    const ray = new R.Ray({ x: origin[0], y: origin[1], z: origin[2] }, d);
    const exclude = excludeId !== undefined ? this.records.get(excludeId)?.body : undefined;
    const hit = this.world.castRayAndGetNormal(ray, Math.min(maxDist, PHYSICS_LIMITS.MAX_RAY_DISTANCE), true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude);
    if (!hit) return null;
    const id = this.owner.get(hit.collider.handle);
    const t = hit.timeOfImpact;
    return {
      id: id === undefined || id === GROUND_ID ? null : id,
      point: [origin[0] + d.x * t, origin[1] + d.y * t, origin[2] + d.z * t],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      distance: t,
    };
  }

  /** Entities (sensors included, ground excluded) overlapping a sphere. */
  overlapsSphere(center: Vec3, radius: number): EntityId[] {
    if (this.disposed || !safeVec(center) || !Number.isFinite(radius) || radius <= 0) return [];
    const R = rapier();
    const found = new Set<EntityId>();
    this.world.intersectionsWithShape({ x: center[0], y: center[1], z: center[2] }, { x: 0, y: 0, z: 0, w: 1 }, new R.Ball(radius), (c: Collider) => {
      const id = this.owner.get(c.handle);
      if (id !== undefined && id !== GROUND_ID) found.add(id);
      return true;
    });
    return [...found];
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  /** Serialize the complete simulation state (Rapier world + entity maps). */
  snapshot(): Uint8Array {
    this.live();
    const bodies: BodyMeta[] = [];
    for (const rec of this.records.values()) {
      bodies.push({
        id: rec.id,
        body: rec.body.handle,
        colliders: rec.colliders.map((c) => c.handle),
        sensors: rec.colliders.filter((c) => this.sensors.has(c.handle)).map((c) => c.handle),
        joint: rec.joint && rec.joint.isValid() ? rec.joint.handle : null,
        anchor: rec.anchorBody ? rec.anchorBody.handle : null,
        jointTarget: rec.jointTarget,
        type: rec.type,
        scale: rec.scale,
        ...(rec.plan ? {} : { entity: rec.entity }),
      });
    }
    const meta: SnapshotMeta = {
      v: 1,
      fixedDt: this.fixedDt,
      steps: this.steps,
      accumulator: Math.min(1, this.accumulator),
      ground: this.ground ? { body: this.ground.body.handle, colliders: this.ground.colliders.map((c) => c.handle), size: this.ground.size } : null,
      bodies,
      externals: [...this.externals].map(([handle, id]) => ({ handle, id })),
      contacts: this.events.entries(),
    };
    return encodeSnapshot(meta, this.world.takeSnapshot());
  }

  /** Independent copy of this simulation (same state, same future). */
  async fork(): Promise<PhysicsWorld> {
    return PhysicsWorld.restore(this.snapshot(), this.doc, this.provider ? { colliders: this.provider } : {});
  }

  private loadMeta(meta: SnapshotMeta): void {
    const w = this.world;
    const children = childIndex(this.doc);
    this.steps = meta.steps;
    this.accumulator = meta.accumulator;
    const body = (h: number): RigidBody => {
      const b = w.getRigidBody(h);
      if (!b) throw new Error('invalid physics snapshot: unknown body handle');
      return b;
    };
    const collider = (h: number): Collider => {
      const c = w.getCollider(h);
      if (!c) throw new Error('invalid physics snapshot: unknown collider handle');
      return c;
    };
    if (meta.ground) {
      this.ground = { body: body(meta.ground.body), colliders: meta.ground.colliders.map(collider), size: meta.ground.size };
      for (const h of meta.ground.colliders) this.owner.set(h, GROUND_ID);
      this.colliderCount += meta.ground.colliders.length;
    }
    for (const m of meta.bodies) {
      const docEntity = m.entity ? undefined : Object.hasOwn(this.doc.entities, m.id) ? this.doc.entities[m.id] : undefined;
      const entity = m.entity ?? docEntity;
      if (!entity) throw new Error(`invalid physics snapshot: entity '${m.id.slice(0, 64)}' missing from the world`);
      const plan = m.entity || !hasBody(this.doc, m.id) ? null : planBody(this.doc, m.id, children);
      const joint = m.joint !== null ? w.getImpulseJoint(m.joint) : null;
      const rec: BodyRecord = {
        id: m.id,
        entity,
        body: body(m.body),
        colliders: m.colliders.map(collider),
        sensor: m.sensors.length > 0,
        type: m.type,
        scale: m.scale,
        plan,
        joint: joint ?? null,
        anchorBody: m.anchor !== null ? body(m.anchor) : null,
        jointTarget: m.jointTarget,
      };
      this.records.set(m.id, rec);
      for (const c of rec.colliders) this.owner.set(c.handle, m.id);
      for (const h of m.sensors) this.sensors.add(h);
      this.colliderCount += rec.colliders.length;
      if (plan) for (const p of plan.parts) this.partOwner.set(p.entity.id, m.id);
    }
    for (const x of meta.externals) {
      this.externals.set(x.handle, x.id);
      this.owner.set(x.handle, x.id);
    }
    this.events.load(meta.contacts);
  }

  // -------------------------------------------------------------------------
  // Incremental sync
  // -------------------------------------------------------------------------

  /**
   * Mirror a new version of the World IR. Only bodies whose physical
   * definition changed are rebuilt; moved bodies are teleported; gravity and
   * ground follow the environment. Runtime spawns are kept.
   */
  sync(world: WorldDoc, diff?: WorldDiff): void {
    this.live();
    const prev = this.doc;
    const d = diff ?? diffWorlds(prev, world);
    this.doc = world;
    if (d.environmentChanged) this.syncEnvironment(prev, world);
    const children = childIndex(world);
    const affected = new Set<EntityId>();
    const markSubtree = (root: EntityId): void => {
      const stack = [root];
      let guard = 0;
      while (stack.length > 0 && guard++ < LIMITS.MAX_ENTITIES * 2) {
        const id = stack.pop() as EntityId;
        if (affected.has(id)) continue;
        affected.add(id);
        for (const c of children.get(id) ?? []) stack.push(c);
      }
    };
    for (const id of d.removed) {
      const rec = this.records.get(id);
      if (rec && rec.plan) affected.add(id);
      const owner = this.partOwner.get(id);
      if (owner) affected.add(owner);
    }
    for (const id of [...d.added, ...d.changed]) {
      markSubtree(id);
      const oldOwner = this.partOwner.get(id);
      if (oldOwner) affected.add(oldOwner);
      const newOwner = bodyOwnerOf(world, id);
      if (newOwner) affected.add(newOwner);
    }
    // Owners of affected composite parts (a moved child changes its owner's compound).
    for (const id of [...affected]) {
      const owner = this.partOwner.get(id) ?? bodyOwnerOf(world, id);
      if (owner) affected.add(owner);
    }
    // Scatters projected onto an affected terrain.
    for (const rec of this.records.values()) {
      const s = rec.entity.shape;
      if (s.kind === 'scatter' && s.onSurface && affected.has(s.onSurface)) affected.add(rec.id);
    }

    const rebuilt = new Set<EntityId>();
    const jointDirty = new Set<EntityId>();
    const order = [...affected].sort((a, b) => Number(isScatter(world, a)) - Number(isScatter(world, b)));
    for (const id of order) {
      const rec = this.records.get(id);
      if (!hasBody(world, id)) {
        if (rec && rec.plan) {
          this.removeRecord(id);
          rebuilt.add(id);
        }
        continue;
      }
      const plan = planBody(world, id, children);
      if (!rec || !rec.plan || rec.plan.bodyKey !== plan.bodyKey) {
        if (rec) this.removeRecord(id);
        this.addPlanned(plan);
        rebuilt.add(id);
        jointDirty.add(id);
        continue;
      }
      if (rec.plan.poseKey !== plan.poseKey) {
        this.teleport(id, plan.pose.position, plan.pose.quaternion);
      }
      if (rec.plan.jointKey !== plan.jointKey) jointDirty.add(id);
      rec.plan = plan;
      rec.entity = plan.entity;
      for (const p of plan.parts) this.partOwner.set(p.entity.id, id);
    }
    for (const rec of this.records.values()) {
      if (rec.jointTarget !== null && rec.jointTarget !== 'world' && rebuilt.has(rec.jointTarget)) jointDirty.add(rec.id);
    }
    for (const id of jointDirty) if (this.records.has(id)) this.rebuildJoint(id);
    for (const id of rebuilt) if (!this.records.has(id)) this.jointIssues.delete(id);
  }

  private syncEnvironment(prev: WorldDoc, next: WorldDoc): void {
    const g = next.environment.gravity;
    const pg = prev.environment.gravity;
    if (safeVec(g) && (g[0] !== pg[0] || g[1] !== pg[1] || g[2] !== pg[2])) this.setGravity(g);
    const size = next.environment.ground?.size ?? null;
    if ((this.ground?.size ?? null) !== size) {
      if (this.ground) {
        for (const c of this.ground.colliders) this.owner.delete(c.handle);
        this.world.removeRigidBody(this.ground.body);
        this.colliderCount -= this.ground.colliders.length;
        this.ground = null;
      }
      this.buildGround();
    }
  }

  // -------------------------------------------------------------------------
  // Building
  // -------------------------------------------------------------------------

  private buildGround(): void {
    const ground = this.doc.environment.ground;
    if (!ground) return;
    const R = rapier();
    const size = Number.isFinite(ground.size) && ground.size > 0 ? Math.min(ground.size, 1e5) : 400;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const tiles = Math.min(PHYSICS_LIMITS.MAX_GROUND_TILES_PER_SIDE, Math.ceil(size / PHYSICS_LIMITS.GROUND_TILE));
    const tile = size / tiles;
    const colliders: Collider[] = [];
    for (let i = 0; i < tiles; i++) {
      for (let j = 0; j < tiles; j++) {
        const cx = -size / 2 + (i + 0.5) * tile;
        const cz = -size / 2 + (j + 0.5) * tile;
        const desc = R.ColliderDesc.cuboid(tile / 2, GROUND_THICKNESS / 2, tile / 2).setTranslation(cx, -GROUND_THICKNESS / 2, cz).setFriction(GROUND_FRICTION).setRestitution(0.1);
        const collider = this.world.createCollider(desc, body);
        this.owner.set(collider.handle, GROUND_ID);
        colliders.push(collider);
      }
    }
    this.colliderCount += colliders.length;
    this.ground = { body, colliders, size };
  }

  private addPlanned(plan: BodyPlan): void {
    this.addBody(plan.entity, plan.pose, plan.parts, plan);
  }

  private note(id: EntityId, text: string): void {
    const list = this.buildNotes.get(id);
    if (list) {
      if (list.length < 20) list.push(text);
    } else {
      this.buildNotes.set(id, [text]);
    }
  }

  private addBody(entity: Entity, pose: Pose, parts: CompositePart[], plan: BodyPlan | null): void {
    const R = rapier();
    const spec = entity.physics;
    if (!spec) return;
    this.buildNotes.delete(entity.id);
    if (this.records.size >= PHYSICS_LIMITS.MAX_BODIES) {
      this.note(entity.id, `${entity.id}: body limit (${PHYSICS_LIMITS.MAX_BODIES}) reached; entity has no physics`);
      return;
    }
    const isScatter = entity.shape.kind === 'scatter';
    const type: BodyType = isScatter ? 'static' : spec.body;
    const local = this.collidersFor(entity, pose, parts);
    if (local === null) return;

    const q = normalizeQuat(pose.quaternion);
    const desc = type === 'dynamic' ? R.RigidBodyDesc.dynamic() : type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed();
    desc.setTranslation(pose.position[0], pose.position[1], pose.position[2]).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    if (type === 'dynamic') {
      desc.setLinearDamping(finiteMin0(spec.linearDamping, 0)).setAngularDamping(finiteMin0(spec.angularDamping, 0.05));
      desc.setGravityScale(Number.isFinite(spec.gravityScale) ? spec.gravityScale : 1).setCcdEnabled(spec.ccd);
      if (spec.lockRotation) desc.lockRotations();
      if (spec.initialVelocity && safeVec(spec.initialVelocity)) desc.setLinvel(spec.initialVelocity[0], spec.initialVelocity[1], spec.initialVelocity[2]);
      if (spec.initialAngularVelocity && safeVec(spec.initialAngularVelocity)) {
        desc.setAngvel({ x: spec.initialAngularVelocity[0], y: spec.initialAngularVelocity[1], z: spec.initialAngularVelocity[2] });
      }
    }
    const body = this.world.createRigidBody(desc);
    const density = spec.density ?? presetDensity(entity.material?.preset);
    const colliders: Collider[] = [];
    let volume = 0;
    for (const lc of local) {
      if (this.colliderCount >= PHYSICS_LIMITS.MAX_COLLIDERS) {
        this.note(entity.id, `${entity.id}: world collider budget (${PHYSICS_LIMITS.MAX_COLLIDERS}) exhausted; some colliders skipped`);
        break;
      }
      const cd = toRapierDesc(lc);
      if (!cd) {
        this.note(entity.id, `${entity.id}: a ${lc.shape.kind} collider was rejected by the physics engine`);
        continue;
      }
      cd.setFriction(spec.friction).setRestitution(spec.restitution).setDensity(density).setSensor(spec.sensor);
      if (spec.sensor) {
        cd.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(SENSOR_COLLISION_TYPES);
      } else if (type === 'dynamic') {
        cd.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS);
      } else if (type !== 'static') {
        // Kinematic colliders would keep Rapier's default force threshold of 0 and
        // report every resting contact each step; impacts on them are still
        // reported through the dynamic body's (thresholded) force events.
        cd.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      }
      const c = this.world.createCollider(cd, body);
      colliders.push(c);
      volume += Math.max(0, c.volume());
      this.colliderCount++;
    }
    if (type === 'dynamic') this.applyMass(entity, body, colliders, volume, density);
    const rec: BodyRecord = {
      id: entity.id,
      entity,
      body,
      colliders,
      sensor: spec.sensor,
      type,
      scale: [...pose.scale],
      plan,
      joint: null,
      anchorBody: null,
      jointTarget: null,
    };
    this.records.set(entity.id, rec);
    for (const c of colliders) {
      this.owner.set(c.handle, entity.id);
      if (spec.sensor) this.sensors.add(c.handle);
    }
    for (const p of parts) this.partOwner.set(p.entity.id, entity.id);
  }

  private applyMass(entity: Entity, body: RigidBody, colliders: Collider[], volume: number, density: number): void {
    const spec = entity.physics;
    if (!spec) return;
    const g = this.world.gravity;
    const weight = Math.hypot(g.x, g.y, g.z) || 9.81;
    if (colliders.length === 0) {
      body.setAdditionalMass(spec.mass ?? 1, false);
      return;
    }
    let mass = volume * density;
    if (spec.mass !== undefined && Number.isFinite(spec.mass)) {
      mass = spec.mass;
      for (const c of colliders) {
        const share = volume > 1e-12 ? Math.max(0, c.volume()) / volume : 1 / colliders.length;
        c.setMass(Math.max(1e-6, spec.mass * share));
      }
    }
    const threshold = Math.max(1e-3, mass * weight * PHYSICS_LIMITS.IMPACT_WEIGHTS);
    for (const c of colliders) c.setContactForceEventThreshold(threshold);
  }

  /** Body-local colliders of an entity (+ composite parts). `null` → skip the body. */
  private collidersFor(entity: Entity, pose: Pose, parts: CompositePart[]): LocalCollider[] | null {
    const spec = entity.physics;
    if (!spec) return null;
    const out: LocalCollider[] = [];
    if (entity.shape.kind === 'scatter') return this.scatterColliders(entity, pose);
    if (spec.collider !== 'none') {
      const resolved = resolveShapeColliders(entity, spec.collider, this.doc, this.provider);
      for (const w of resolved.warnings) this.note(entity.id, w);
      for (const c of resolved.colliders) out.push(scaleCollider(c, pose.scale));
      for (const part of parts) {
        const r = resolveShapeColliders(part.entity, 'auto', this.doc, this.provider);
        for (const w of r.warnings) this.note(entity.id, w);
        for (const c of r.colliders) out.push(placeCollider(scaleCollider(c, part.scale), part.position, part.quaternion));
      }
    }
    return out;
  }

  private scatterColliders(entity: Entity, pose: Pose): LocalCollider[] | null {
    const shape = entity.shape;
    if (shape.kind !== 'scatter') return null;
    if (shape.count > PHYSICS_LIMITS.MAX_SCATTER_COLLIDERS) {
      this.note(entity.id, `${entity.id}: scatter of ${shape.count} instances exceeds ${PHYSICS_LIMITS.MAX_SCATTER_COLLIDERS}; no colliders (instances are not solid)`);
      return null;
    }
    const proto: Entity = { ...entity, shape: shape.of };
    const base = resolveShapeColliders(proto, 'auto', this.doc, this.provider);
    for (const w of base.warnings) this.note(entity.id, w);
    // Primitives are centered; lift them so instances rest on the surface like procedural ones.
    const lift = shape.of.kind === 'primitive' ? primitiveHalfHeight(shape.of.size, shape.of.primitive) : 0;
    const surface = shape.onSurface ? this.records.get(shape.onSurface) : undefined;
    if (shape.onSurface && !surface) this.note(entity.id, `${entity.id}: onSurface '${shape.onSurface}' has no collider; instances placed at y=0`);
    const R = rapier();
    const out: LocalCollider[] = [];
    for (const inst of scatterInstances(shape)) {
      let y = 0;
      if (surface) {
        const wp = rotate(pose.quaternion, [inst.position[0] * pose.scale[0], 0, inst.position[2] * pose.scale[2]]);
        const ox = wp[0] + pose.position[0];
        const oz = wp[2] + pose.position[2];
        const ray = new R.Ray({ x: ox, y: 1e4, z: oz }, { x: 0, y: -1, z: 0 });
        let best = Infinity;
        for (const c of surface.colliders) {
          const t = c.castRay(ray, 2e4, true);
          if (t >= 0 && t < best) best = t;
        }
        if (Number.isFinite(best)) y = (1e4 - best - pose.position[1]) / (pose.scale[1] || 1);
      }
      const half = inst.yawDeg * (Math.PI / 360);
      const yaw: Quat = [0, Math.sin(half), 0, Math.cos(half)];
      for (const c of base.colliders) {
        const scaled = scaleCollider(c, [inst.scale, inst.scale, inst.scale]);
        const placed = placeCollider(scaled, [inst.position[0], y + lift * inst.scale, inst.position[2]], yaw);
        out.push(scaleCollider(placed, pose.scale));
      }
    }
    return out;
  }

  private removeRecord(id: EntityId): void {
    const rec = this.records.get(id);
    if (!rec) return;
    this.dropJoint(rec);
    for (const c of rec.colliders) {
      this.owner.delete(c.handle);
      this.sensors.delete(c.handle);
    }
    this.colliderCount -= rec.colliders.length;
    this.world.removeRigidBody(rec.body);
    this.records.delete(id);
    this.events.forget(id);
    this.buildNotes.delete(id);
    this.jointIssues.delete(id);
    for (const [part, owner] of this.partOwner) if (owner === id) this.partOwner.delete(part);
  }

  private dropJoint(rec: BodyRecord): void {
    if (rec.joint && rec.joint.isValid()) this.world.removeImpulseJoint(rec.joint, true);
    if (rec.anchorBody) this.world.removeRigidBody(rec.anchorBody);
    rec.joint = null;
    rec.anchorBody = null;
    rec.jointTarget = null;
  }

  private rebuildJointsTargeting(id: EntityId): void {
    for (const rec of this.records.values()) if (rec.jointTarget === id) this.rebuildJoint(rec.id);
  }

  /** (Re)create the joint of `id` from its entity spec; failures become diagnostics. */
  private rebuildJoint(id: EntityId): void {
    const rec = this.records.get(id);
    if (!rec) return;
    this.dropJoint(rec);
    this.jointIssues.delete(id);
    const spec = rec.entity.joint;
    if (!spec) return;
    const issue = (message: string, suggestion?: string): void => {
      this.jointIssues.set(id, [{ severity: 'error', code: 'jointInvalid', entities: [id], message, ...(suggestion ? { suggestion } : {}) }]);
    };
    let target: { id: EntityId; body: RigidBody; scale: Vec3 } | 'world';
    if (spec.target === 'world') {
      target = 'world';
    } else {
      const t = this.records.get(spec.target);
      if (!t) {
        const exists = Object.hasOwn(this.doc.entities, spec.target);
        issue(
          exists ? `${id}: joint target '${spec.target}' has no physics body` : `${id}: joint target '${spec.target}' does not exist`,
          exists ? `add a physics spec to '${spec.target}' or set joint.target to "world"` : 'set joint.target to an existing entity id or "world"',
        );
        return;
      }
      target = { id: t.id, body: t.body, scale: t.scale };
    }
    if (rec.type === 'static' && (target === 'world' || this.records.get(spec.target)?.type === 'static')) {
      issue(`${id}: joint connects two static bodies and does nothing`, 'make the jointed entity physics.body "dynamic"');
      return;
    }
    const built = createJoint(this.world, spec, { id, body: rec.body, scale: rec.scale }, target);
    if ('error' in built) {
      this.jointIssues.set(id, [built.error]);
      return;
    }
    rec.joint = built.joint;
    rec.anchorBody = built.anchorBody;
    rec.jointTarget = spec.target;
    if (built.warnings.length > 0) this.jointIssues.set(id, built.warnings);
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /** Joint problems found while building (`jointInvalid` diagnostics). */
  diagnostics(): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const list of this.jointIssues.values()) out.push(...list);
    return out;
  }

  /** Approximations/fallbacks taken while building colliders, per entity. */
  notes(): string[] {
    const out: string[] = [];
    for (const list of this.buildNotes.values()) out.push(...list);
    return out;
  }

  /** Counters and the smoothed duration of one fixed step. */
  stats(): PhysicsStats {
    if (this.disposed) return { bodies: 0, colliders: 0, joints: 0, stepMs: 0 };
    return {
      bodies: this.records.size,
      colliders: this.world.colliders.len(),
      joints: this.world.impulseJoints.len(),
      stepMs: this.stepMsAvg,
    };
  }

  /** Free all WASM memory. The instance is unusable afterwards (calls become no-ops or throw). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.free();
    this.world.free();
    this.records.clear();
    this.owner.clear();
    this.sensors.clear();
    this.externals.clear();
    this.partOwner.clear();
    this.pending.length = 0;
    this.ground = null;
  }

  /** True after {@link dispose}. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  // -------------------------------------------------------------------------
  // Package-internal API (character controller, diagnostics, verification)
  // -------------------------------------------------------------------------

  /** @internal Raw Rapier world. */
  _world(): World {
    return this.live();
  }

  /** @internal Body records (read-only use). */
  _records(): ReadonlyMap<EntityId, BodyRecord> {
    return this.records;
  }

  /** @internal Entity id owning a collider handle. */
  _ownerOf(handle: number): EntityId | undefined {
    return this.owner.get(handle);
  }

  /** @internal Ground collider record. */
  _ground(): { colliders: readonly Collider[]; size: number } | null {
    return this.ground;
  }

  /** @internal Map an externally created collider (e.g. a character capsule) to an id for events. */
  _registerExternal(collider: Collider, id: EntityId): void {
    this.externals.set(collider.handle, id);
    this.owner.set(collider.handle, id);
  }

  /** @internal Forget an external collider. */
  _unregisterExternal(collider: Collider): void {
    const id = this.externals.get(collider.handle);
    this.externals.delete(collider.handle);
    this.owner.delete(collider.handle);
    if (id !== undefined) this.events.forget(id);
  }

  private dynamic(id: EntityId): BodyRecord | undefined {
    if (this.disposed) return undefined;
    const rec = this.records.get(id);
    return rec && rec.type === 'dynamic' ? rec : undefined;
  }

  private live(): World {
    if (this.disposed) throw new Error('PhysicsWorld has been disposed');
    return this.world;
  }
}

function isScatter(world: WorldDoc, id: EntityId): boolean {
  return Object.hasOwn(world.entities, id) && (world.entities[id] as Entity).shape.kind === 'scatter';
}

function finiteMin0(v: number, fallback: number): number {
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function primitiveHalfHeight(size: Vec3, primitive: string): number {
  const sy = Number.isFinite(size[1]) ? size[1] : 1;
  const sx = Number.isFinite(size[0]) ? size[0] : 1;
  if (primitive === 'sphere' || primitive === 'torus') return sx / 2;
  if (primitive === 'plane') return 0.01;
  if (primitive === 'capsule') return Math.max(sy, sx) / 2;
  return sy / 2;
}

function stateOf(body: RigidBody): BodyState {
  const t = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  return {
    position: [t.x, t.y, t.z],
    quaternion: [r.x, r.y, r.z, r.w],
    linvel: [v.x, v.y, v.z],
    angvel: [w.x, w.y, w.z],
    sleeping: body.isSleeping(),
  };
}
