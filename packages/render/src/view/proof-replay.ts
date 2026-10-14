/**
 * Proof replay: after a verification run, translucent ghost copies of the
 * bodies that moved re-enact the simulated motion on top of the (still)
 * edited world, drawing a fading trail behind them — the physics proof made
 * visible. Driven by a recorded trace (`@aether/physics` `VerifyTrace`), so
 * nothing is simulated again.
 *
 * Phases: wait for the ghost geometry → play the trace at real time →
 * hold the final pose → dissolve (ghosts shrink, trails fade) → cleared.
 * With reduced motion the ghosts are not shown: the full trails appear at
 * once, hold, and fade.
 *
 * Per-frame work is allocation-free (scratch vectors, in-place draw-range
 * and opacity updates). The trail geometry is built once per replay and
 * disposed when it ends.
 */
import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, type Object3D } from 'three';
import { quatToEulerDeg, type Entity, type EntityId, type WorldDoc, worldTransform } from '@aether/core';
import type { SceneSync } from '../sync/scene-sync';

/** A recorded motion trace (structurally `@aether/physics` `VerifyTrace`). */
export interface ProofTrace {
  ids: readonly string[];
  /** Seconds between frames. */
  dt: number;
  frames: number;
  /** Frame-major poses: `(frame * ids.length + body) * 7` → position xyz, quaternion xyzw. */
  poses: Float32Array;
}

/** Options of {@link ProofReplay.start}. */
export interface ProofReplayOptions {
  /** Skip ghost motion: show the finished trails, hold, fade. */
  reducedMotion?: boolean;
  /** Playback speed (default 1 = real time). */
  speed?: number;
}

/** Floats per body per frame. */
const STRIDE = 7;
/** Seconds the final pose is held before dissolving. */
export const PROOF_HOLD_SECONDS = 1.1;
/** Seconds of the dissolve. */
export const PROOF_FADE_SECONDS = 0.6;
/** Seconds the trails stay up with reduced motion. */
export const PROOF_STATIC_SECONDS = 2.5;
/** Longest replay played (longer traces are sped up to fit). */
export const PROOF_MAX_SECONDS = 8;
/** Trail opacity while shown. */
const TRAIL_OPACITY = 1;
/** Trail colour at the start (old) and at the head (new) of the motion. */
const TAIL = new Color('#6b72ff');
const HEAD = new Color('#c2ecff');

type Phase = 'idle' | 'loading' | 'play' | 'hold' | 'fade';

/** Validate a trace's shape (lengths and finite values). Pure. */
export function validTrace(t: ProofTrace | null | undefined): t is ProofTrace {
  if (!t || !Array.isArray(t.ids) || t.ids.length === 0 || !(t.poses instanceof Float32Array)) return false;
  if (!Number.isInteger(t.frames) || t.frames < 2 || !(t.dt > 0) || !Number.isFinite(t.dt)) return false;
  return t.poses.length === t.frames * t.ids.length * STRIDE;
}

/**
 * The world the ghosts are built from: the traced entities only, re-parented
 * to the root (their poses come from the trace), without lights, physics,
 * behaviours or children. Unknown ids are skipped. Pure.
 */
export function replayWorld(world: WorldDoc, ids: readonly string[]): WorldDoc {
  const entities: Record<EntityId, Entity> = {};
  for (const id of ids) {
    const e = world.entities[id];
    if (!e || e.template || e.shape.kind === 'none' || e.shape.kind === 'scatter') continue;
    let transform = e.transform;
    if (e.parent !== null) {
      try {
        const wt = worldTransform(world, id);
        transform = { position: wt.position, rotation: quatToEulerDeg(wt.quaternion), scale: wt.scale };
      } catch {
        continue;
      }
    }
    const flat: Entity = { ...e, parent: null, transform, behaviors: [] };
    delete flat.light;
    delete flat.physics;
    entities[id] = flat;
  }
  return { ...world, entities, tests: [], rules: [] };
}

/**
 * Trail segments for a trace, frame-major so a draw range reveals every
 * body's path in step with the replay: segment (f-1 → f) of body b is at
 * index `(f - 1) * bodies + b`. Returns positions and colours (3 floats per
 * vertex, 2 vertices per segment). Pure.
 */
export function trailBuffers(trace: ProofTrace): { positions: Float32Array; colors: Float32Array } {
  const n = trace.ids.length;
  const segs = (trace.frames - 1) * n;
  const positions = new Float32Array(segs * 6);
  const colors = new Float32Array(segs * 6);
  const c = new Color();
  for (let f = 1; f < trace.frames; f++) {
    const k0 = (f - 1) / Math.max(1, trace.frames - 1);
    const k1 = f / Math.max(1, trace.frames - 1);
    for (let b = 0; b < n; b++) {
      const o = ((f - 1) * n + b) * 6;
      const a = ((f - 1) * n + b) * STRIDE;
      const z = (f * n + b) * STRIDE;
      positions[o] = trace.poses[a] as number;
      positions[o + 1] = trace.poses[a + 1] as number;
      positions[o + 2] = trace.poses[a + 2] as number;
      positions[o + 3] = trace.poses[z] as number;
      positions[o + 4] = trace.poses[z + 1] as number;
      positions[o + 5] = trace.poses[z + 2] as number;
      c.copy(TAIL).lerp(HEAD, k0);
      colors[o] = c.r;
      colors[o + 1] = c.g;
      colors[o + 2] = c.b;
      c.copy(TAIL).lerp(HEAD, k1);
      colors[o + 3] = c.r;
      colors[o + 4] = c.g;
      colors[o + 5] = c.b;
    }
  }
  return { positions, colors };
}

/** Plays proof replays. Owns its trail group; ghost copies live in the given scene sync. */
export class ProofReplay {
  /** Trails (add to the scene once). */
  readonly group = new Group();
  private readonly material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: TRAIL_OPACITY, depthWrite: false });
  private lines: LineSegments | null = null;
  private trace: ProofTrace | null = null;
  private targets: Array<Object3D | null> = [];
  private contents: Array<Object3D | null> = [];
  private phase: Phase = 'idle';
  /**
   * Typed slots (updating them never boxes a number): [0] the phase clock,
   * [1] the motion time shown, [2] the revealed fraction of the trails.
   */
  private readonly clockSlot = new Float64Array(3);
  private duration = 0;
  private speed = 1;
  private reduced = false;
  private token = 0;

  /** Live (non-ghost) objects hidden while their ghosts replay, with the visibility to restore. */
  private hidden: Array<{ object: Object3D; visible: boolean }> = [];

  /**
   * @param ghosts lazily created scene sync (ghost variant) the copies are built in
   * @param live the edited world's object of an entity (hidden while its ghost replays), if any
   */
  constructor(
    private readonly ghosts: () => SceneSync,
    private readonly live: (id: string) => Object3D | undefined = () => undefined,
  ) {
    this.group.name = 'aether:proof';
    this.group.renderOrder = 10;
  }

  /** True while a replay is loading or running (the renderer keeps drawing). */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Current phase (tests, UI). */
  get state(): Phase {
    return this.phase;
  }

  /**
   * Start a replay of `trace` over `world` (replaces a running one).
   * Resolves true once the replay is playing, false when there was nothing
   * to show or it was superseded/stopped meanwhile.
   */
  async start(world: WorldDoc, trace: ProofTrace, opts: ProofReplayOptions = {}): Promise<boolean> {
    this.stop();
    if (!validTrace(trace)) return false;
    const token = ++this.token;
    this.trace = trace;
    this.reduced = opts.reducedMotion === true;
    const real = (trace.frames - 1) * trace.dt;
    const speed = Number.isFinite(opts.speed) && (opts.speed as number) > 0 ? (opts.speed as number) : 1;
    this.speed = Math.max(speed, real / PROOF_MAX_SECONDS);
    this.duration = real;
    this.buildTrails(trace);
    if (!this.reduced) {
      this.phase = 'loading';
      const sync = this.ghosts();
      try {
        await sync.setWorld(replayWorld(world, trace.ids));
      } catch {
        if (token === this.token) this.stop();
        return false;
      }
      if (token !== this.token) return false;
      this.targets = trace.ids.map((id) => sync.object(id) ?? null);
      this.contents = trace.ids.map((id) => sync.node(id)?.content ?? null);
      this.clockSlot[1] = 0;
      this.applyFrame();
      // The ghosts take the stage: the originals step out until the replay dissolves.
      trace.ids.forEach((id, i) => {
        const o = this.live(id);
        if (o && this.targets[i]) {
          this.hidden.push({ object: o, visible: o.visible });
          o.visible = false;
        }
      });
    }
    this.phase = this.reduced ? 'hold' : 'play';
    this.clockSlot[0] = 0;
    this.clockSlot[2] = this.reduced ? 1 : 0;
    this.setReveal();
    return true;
  }

  /** Advance by `dt` seconds. Returns true while something changed (draw a frame). */
  update(dt: number): boolean {
    if (this.phase === 'idle' || this.phase === 'loading') return false;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    const clock = (this.clockSlot[0] as number) + step;
    this.clockSlot[0] = clock;
    if (this.phase === 'play') {
      const t = Math.min(this.duration, clock * this.speed);
      this.clockSlot[1] = t;
      this.clockSlot[2] = this.duration > 0 ? t / this.duration : 1;
      this.applyFrame();
      this.setReveal();
      if (t >= this.duration) this.next('hold');
    } else if (this.phase === 'hold') {
      if (clock >= (this.reduced ? PROOF_STATIC_SECONDS : PROOF_HOLD_SECONDS)) {
        this.restoreLive();
        this.next('fade');
      }
    } else {
      const k = Math.max(0, 1 - clock / PROOF_FADE_SECONDS);
      this.material.opacity = TRAIL_OPACITY * k;
      const s = Math.max(1e-3, k);
      for (const c of this.contents) {
        if (!c) continue;
        c.scale.setScalar(s);
        c.updateMatrix();
      }
      if (k <= 0) this.stop();
    }
    return true;
  }

  /** Stop and clear (ghosts removed, trail geometry disposed). */
  stop(): void {
    this.token++;
    this.restoreLive();
    const wasLoaded = this.phase !== 'idle' || this.targets.length > 0;
    this.phase = 'idle';
    this.trace = null;
    this.targets = [];
    for (const c of this.contents) {
      if (!c) continue;
      c.scale.setScalar(1);
      c.updateMatrix();
    }
    this.contents = [];
    if (this.lines) {
      this.group.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
    this.material.opacity = TRAIL_OPACITY;
    if (wasLoaded) this.ghostsIfCreated?.clear();
  }

  /** Release everything. */
  dispose(): void {
    this.stop();
    this.material.dispose();
    this.group.removeFromParent();
  }

  /** Set by the owner once the ghost sync exists, so `stop` never creates it. */
  ghostsIfCreated: SceneSync | null = null;

  private restoreLive(): void {
    for (const h of this.hidden) h.object.visible = h.visible;
    this.hidden = [];
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.clockSlot[0] = 0;
  }

  private buildTrails(trace: ProofTrace): void {
    const { positions, colors } = trailBuffers(trace);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    const lines = new LineSegments(geo, this.material);
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    this.lines = lines;
    this.group.add(lines);
  }

  /** Reveal the trails up to the fraction in slot 2 of the motion. */
  private setReveal(): void {
    const trace = this.trace;
    const lines = this.lines;
    if (!trace || !lines) return;
    const k = this.clockSlot[2] as number;
    const segs = Math.round(Math.max(0, Math.min(1, k)) * (trace.frames - 1)) * trace.ids.length;
    lines.geometry.setDrawRange(0, segs * 2);
  }

  /** Pose every ghost at the motion time in slot 1 (interpolated between frames). */
  private applyFrame(): void {
    const trace = this.trace;
    if (!trace) return;
    const t = this.clockSlot[1] as number;
    const n = trace.ids.length;
    const fx = Math.max(0, Math.min(trace.frames - 1, t / trace.dt));
    const f0 = Math.floor(fx);
    const f1 = Math.min(trace.frames - 1, f0 + 1);
    const a = fx - f0;
    const p = trace.poses;
    for (let b = 0; b < n; b++) {
      const obj = this.targets[b];
      if (!obj) continue;
      const i0 = (f0 * n + b) * STRIDE;
      const i1 = (f1 * n + b) * STRIDE;
      // Interpolated pose written straight into the (non-auto-updating) local matrix: plain arithmetic,
      // no calls taking numbers, so nothing is boxed per body per frame (see the allocation probe).
      const px = (p[i0] as number) + ((p[i1] as number) - (p[i0] as number)) * a;
      const py = (p[i0 + 1] as number) + ((p[i1 + 1] as number) - (p[i0 + 1] as number)) * a;
      const pz = (p[i0 + 2] as number) + ((p[i1 + 2] as number) - (p[i0 + 2] as number)) * a;
      // Normalised lerp along the shorter arc (frames are 1/12 s apart: indistinguishable from slerp).
      const ax = p[i0 + 3] as number;
      const ay = p[i0 + 4] as number;
      const az = p[i0 + 5] as number;
      const aw = p[i0 + 6] as number;
      const sgn = ax * (p[i1 + 3] as number) + ay * (p[i1 + 4] as number) + az * (p[i1 + 5] as number) + aw * (p[i1 + 6] as number) < 0 ? -1 : 1;
      let qx = ax + ((p[i1 + 3] as number) * sgn - ax) * a;
      let qy = ay + ((p[i1 + 4] as number) * sgn - ay) * a;
      let qz = az + ((p[i1 + 5] as number) * sgn - az) * a;
      let qw = aw + ((p[i1 + 6] as number) * sgn - aw) * a;
      const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
      qx /= len;
      qy /= len;
      qz /= len;
      qw /= len;
      const sx = obj.scale.x;
      const sy = obj.scale.y;
      const sz = obj.scale.z;
      const x2 = qx + qx;
      const y2 = qy + qy;
      const z2 = qz + qz;
      const xx = qx * x2;
      const xy = qx * y2;
      const xz = qx * z2;
      const yy = qy * y2;
      const yz = qy * z2;
      const zz = qz * z2;
      const wx = qw * x2;
      const wy = qw * y2;
      const wz = qw * z2;
      const e = obj.matrix.elements;
      e[0] = (1 - (yy + zz)) * sx;
      e[1] = (xy + wz) * sx;
      e[2] = (xz - wy) * sx;
      e[3] = 0;
      e[4] = (xy - wz) * sy;
      e[5] = (1 - (xx + zz)) * sy;
      e[6] = (yz + wx) * sy;
      e[7] = 0;
      e[8] = (xz + wy) * sz;
      e[9] = (yz - wx) * sz;
      e[10] = (1 - (xx + yy)) * sz;
      e[11] = 0;
      e[12] = px;
      e[13] = py;
      e[14] = pz;
      e[15] = 1;
      obj.matrixWorldNeedsUpdate = true;
    }
  }
}
