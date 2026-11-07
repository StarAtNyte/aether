/**
 * Plays a world's story (`world.story`) in the player: each animation frame it evaluates the timeline (`story.ts`) and
 * applies it — the camera pose, the moved entities' poses (one packed `applyTransforms`, as physics does), the shot's
 * colour script (`setShotGrade`: post-pass values, never a program change) and, at a shot change, its hour. The overlay
 * (letterbox, captions, titles, fades) is the caller's, fed through {@link StoryRunnerOptions.onFrame}; the fade's opacity
 * changes every frame, so it goes straight to a DOM element instead of through React state.
 */
import type { Environment, Story, StoryGrade, StoryMove, WorldDoc } from '@aether/core';
import type { WorldRenderer } from '@aether/render';
import { actorPoses, END_HANDOVER_SECONDS, END_HOLD_SECONDS, pathLengths, shotStarts, storyFrame, type ActorPose, type StoryFrame } from './story';
import type { StorySoundSink } from './story-audio';

type V3 = [number, number, number];

/** What the overlay shows (changes a few times per shot). */
export interface StoryOverlay {
  index: number;
  caption: string | null;
  title: string | null;
  subtitle: string | null;
  done: boolean;
}

export interface StoryRunnerOptions {
  /** The overlay changed (a new caption, a title, the end). */
  onOverlay: (o: StoryOverlay) => void;
  /** The fade layer (opacity and colour are set on it every frame). */
  fadeEl?: () => HTMLElement | null;
  /** Called once when the last shot ends. */
  onEnd?: () => void;
  /** Reduced motion: no hand-held shake. */
  reduceMotion?: boolean;
  /** The clock (ms); tests and recordings pass a fixed-step one. */
  now?: () => number;
  /** The film's sound (score cues, ambience, one-shot sounds); absent: silent. */
  audio?: StorySoundSink | null;
}

/** The renderer methods a story uses (the post-pass grade is optional: older builds have none). */
type StoryRenderer = Pick<WorldRenderer, 'lookAt' | 'applyTransforms' | 'raycastWorld' | 'setEnvironmentOverride' | 'restoreEnvironment' | 'stopTour'> & {
  modelColliders?: WorldRenderer['modelColliders'];
  setShotGrade?: (g: StoryGrade | null) => void;
  characterRig?: (id: string) => StoryRig | null | undefined;
};

/** Seconds the loop keeps drawing after the last shot: the end card's hold and the hand-over to the live world. */
const END_TAIL = END_HOLD_SECONDS + END_HANDOVER_SECONDS + 0.3;

/** The parts of a person's rig a story drives: clips by name, and the ground its feet are placed on. */
interface StoryRig {
  playClip(name: string, opts?: { loop?: boolean }): unknown;
  stopClip(): void;
  ground?: ((x: number, z: number, y: number) => number | null) | null;
}

/** Spacing (m) of the fine ground samples on stairs and slopes (the feet are placed on them; a tread is 0.32 m). */
const FEET_STEP = 0.06;
/** Cell size (m) of the feet's ground lookup. */
const FEET_CELL = 1;

/**
 * The ground under people's paths for their feet: fine samples where a laid path climbs or falls (stairs, slopes),
 * looked up by the nearest sample within a short reach of a point. Built once from rays at prepare time; looking up is a
 * few array reads, so the feet cost nothing per frame.
 */
export class FeetGround {
  private readonly cells = new Map<string, number[]>();
  private readonly pts: number[] = [];

  add(x: number, y: number, z: number): void {
    const i = this.pts.length / 3;
    this.pts.push(x, y, z);
    const key = `${Math.floor(x / FEET_CELL)},${Math.floor(z / FEET_CELL)}`;
    const list = this.cells.get(key);
    if (list) list.push(i);
    else this.cells.set(key, [i]);
  }

  get size(): number {
    return this.pts.length / 3;
  }

  /** Height of the nearest sample within `reach` m of (x, z) and within 0.6 m of `y`, or null. */
  at(x: number, z: number, y: number, reach = 0.35): number | null {
    const cx = Math.floor(x / FEET_CELL);
    const cz = Math.floor(z / FEET_CELL);
    let best = reach * reach;
    let out: number | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const py = this.pts[i * 3 + 1] as number;
          if (Math.abs(py - y) > 0.6) continue;
          const d = ((this.pts[i * 3] as number) - x) ** 2 + ((this.pts[i * 3 + 2] as number) - z) ** 2;
          if (d < best) {
            best = d;
            out = py;
          }
        }
      }
    }
    return out;
  }
}

/**
 * Vertical rays against triangles: the solid pieces' collider triangles near the people's paths, bucketed on a grid in
 * plan. A ray is a few dozen triangle tests (the renderer's scene ray tests every mesh), so thousands of samples cost a
 * few milliseconds.
 */
export class TriangleGround {
  private readonly cells = new Map<string, number[]>();
  private readonly tri: number[] = [];
  private readonly walls: number[] = [];
  private static readonly CELL = 2;

  /**
   * The closest a body standing at each point comes to a wall (plan distance from the body's axis, metres, between 0.3 m
   * and 1.5 m above its feet): points are sampled on each wall triangle (corners, edge middles, centre). For the film's
   * interpenetration check (`StoryRunner.clearance`).
   */
  clearance(points: ReadonlyArray<readonly number[]>): { min: number; at: number[] | null } {
    let min = Infinity;
    let at: number[] | null = null;
    const w = this.walls;
    const probe = (px: number, py: number, pz: number): void => {
      for (const p of points) {
        const dy = py - (p[1] as number);
        if (dy < 0.3 || dy > 1.5) continue;
        const d = Math.hypot(px - (p[0] as number), pz - (p[2] as number));
        if (d < min) {
          min = d;
          at = [p[0] as number, p[1] as number, p[2] as number];
        }
      }
    };
    for (let o = 0; o < w.length; o += 9) {
      const ax = w[o] as number, ay = w[o + 1] as number, az = w[o + 2] as number;
      const bx = w[o + 3] as number, by = w[o + 4] as number, bz = w[o + 5] as number;
      const cx = w[o + 6] as number, cy = w[o + 7] as number, cz = w[o + 8] as number;
      probe(ax, ay, az);
      probe(bx, by, bz);
      probe(cx, cy, cz);
      probe((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      probe((bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2);
      probe((ax + cx) / 2, (ay + cy) / 2, (az + cz) / 2);
      probe((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    }
    return { min, at };
  }

  /** Add the triangles of a mesh (positions in its frame, moved by `offset`) whose plan bounds touch `keep`. */
  addMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, offset: readonly number[], keep: (x0: number, z0: number, x1: number, z1: number) => boolean): void {
    const C = TriangleGround.CELL;
    const [ox, oy, oz] = [offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0];
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = (indices[t] as number) * 3;
      const b = (indices[t + 1] as number) * 3;
      const c = (indices[t + 2] as number) * 3;
      const ax = (positions[a] as number) + ox, ay = (positions[a + 1] as number) + oy, az = (positions[a + 2] as number) + oz;
      const bx = (positions[b] as number) + ox, by = (positions[b + 1] as number) + oy, bz = (positions[b + 2] as number) + oz;
      const cx = (positions[c] as number) + ox, cy = (positions[c + 1] as number) + oy, cz = (positions[c + 2] as number) + oz;
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
      if (!keep(x0, z0, x1, z1)) continue;
      // Walls (vertical in plan) carry no ground; they are kept for the clearance check.
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(area) < 1e-6 || Math.abs(area) < 0.02 * Math.hypot(bx - ax, by - ay, bz - az) * Math.hypot(cx - ax, cy - ay, cz - az)) {
        this.walls.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        continue;
      }
      const i = this.tri.length / 9;
      this.tri.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) {
        for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) {
          const key = `${gx},${gz}`;
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  get size(): number {
    return this.tri.length / 9;
  }

  /** The highest surface at (x, z) below `top`, or null. */
  at(x: number, top: number, z: number): number | null {
    const C = TriangleGround.CELL;
    const list = this.cells.get(`${Math.floor(x / C)},${Math.floor(z / C)}`);
    if (!list) return null;
    let best: number | null = null;
    const t = this.tri;
    for (const i of list) {
      const o = i * 9;
      const ax = t[o] as number, ay = t[o + 1] as number, az = t[o + 2] as number;
      const bx = t[o + 3] as number, by = t[o + 4] as number, bz = t[o + 5] as number;
      const cx = t[o + 6] as number, cy = t[o + 7] as number, cz = t[o + 8] as number;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-5 || v < -1e-5 || w < -1e-5) continue;
      const y = u * ay + v * by + w * cy;
      if (y <= top && (best === null || y > best)) best = y;
    }
    return best;
  }
}

/** Spacing (m) of ground samples along a person's path. */
const GROUND_STEP = 0.5;
/** A person's yaw turns at most this fast (rad/s), except across a cut. */
const TURN_RATE = 7;

/**
 * A person's path laid on the walkable surfaces under it: resampled every {@link GROUND_STEP} m and dropped onto the
 * nearest surface a ray finds below each point (within a few metres), so an authored stair climb follows every step.
 */
export function groundPath(path: readonly V3[], ground: (x: number, y: number, z: number) => number | null): V3[] {
  if (path.length === 0) return [];
  const out: V3[] = [];
  const push = (p: V3): void => {
    const y = ground(p[0], p[1], p[2]);
    out.push([p[0], y ?? p[1], p[2]]);
  };
  push(path[0] as V3);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as V3;
    const b = path[i] as V3;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / GROUND_STEP));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
    }
  }
  return out;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class StoryRunner {
  readonly story: Story;
  private readonly starts: number[];
  private readonly lengths = new Map<StoryMove, number[]>();
  /** The story with person paths laid on the ground (moves replaced, same order). */
  private laid: Story;
  private raf = 0;
  private t0 = 0;
  private pausedAt: number | null = null;
  private lastIndex = -2;
  private lastOverlay = '';
  private lastHour: number | null = null;
  private ended = false;
  private readonly yaw = new Map<string, number>();
  private readonly last = new Map<string, V3>();
  private lastT = 0;
  private order: string[] = [];
  private packed = new Float32Array(0);
  private disposed = false;
  /** The camera's aim as drawn (a tracked shot's aim lags its subject by the shot's `trackLag`). */
  private aim: V3 | null = null;
  /** Seconds into the current shot at the last frame (one-shot sounds and clips fire as it passes them). */
  private lastLocal = 0;
  /** Clips playing on people (stopped when the film ends or a later clip replaces them). */
  private readonly clipped = new Set<string>();
  /** The ground for the people's feet (stairs and slopes their paths cross). */
  private readonly feet = new FeetGround();
  private readonly feetFn = (x: number, z: number, y: number): number | null => this.feet.at(x, z, y);
  private readonly people = new Set<string>();
  private tris: TriangleGround | null = null;

  /**
   * The interpenetration check of the people's paths: for each shot that moves a person, the closest a wall of the solid
   * pieces comes to the body's axis along the laid path (under 0.18 m, a shoulder or a hand is in the wall).
   */
  clearance(): Array<{ shot: number; entity: string; min: number; at: number[] | null }> {
    const out: Array<{ shot: number; entity: string; min: number; at: number[] | null }> = [];
    if (!this.tris) return out;
    this.laid.shots.forEach((s, i) => {
      for (const m of s.moves) {
        if (!this.people.has(m.entity)) continue;
        const c = this.tris!.clearance(m.path);
        out.push({ shot: i, entity: m.entity, min: Math.round(c.min * 100) / 100, at: c.at });
      }
    });
    return out;
  }

  constructor(
    private readonly renderer: StoryRenderer,
    private readonly world: WorldDoc,
    story: Story,
    private readonly opts: StoryRunnerOptions,
  ) {
    this.story = story;
    this.laid = story;
    this.starts = shotStarts(story);
  }

  /** Running time (s), without the end card. */
  get duration(): number {
    return this.starts[this.starts.length - 1] as number;
  }

  /** Seconds since the start. */
  get time(): number {
    const now = this.pausedAt ?? this.now();
    return Math.max(0, (now - this.t0) / 1000);
  }

  get playing(): boolean {
    return this.raf !== 0;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  /**
   * Lay the people's paths on the ground (rays against the world's solid pieces). Call once the world is loaded; cheap
   * (a few hundred rays).
   */
  prepare(): void {
    const solid = new Set<string>();
    const people = new Set<string>();
    for (const [id, e] of Object.entries(this.world.entities)) {
      if (e.physics) solid.add(id);
      if (e.character) people.add(id);
    }
    const exclude = new Set(Object.keys(this.world.entities).filter((id) => !solid.has(id)));
    // The solid pieces' triangles near the people's paths (fast vertical rays); the scene ray where they are not loaded.
    const tris = new TriangleGround();
    this.tris = tris;
    const boxes: Array<[number, number, number, number]> = [];
    for (const s of this.story.shots) {
      for (const m of s.moves) {
        if (!people.has(m.entity)) continue;
        for (let i = 0; i < m.path.length; i++) {
          const a = m.path[i] as V3;
          const b = (m.path[i + 1] ?? a) as V3;
          boxes.push([Math.min(a[0], b[0]) - 1.5, Math.min(a[2], b[2]) - 1.5, Math.max(a[0], b[0]) + 1.5, Math.max(a[2], b[2]) + 1.5]);
        }
      }
    }
    const keep = (x0: number, z0: number, x1: number, z1: number): boolean => boxes.some((b) => x1 >= b[0] && x0 <= b[2] && z1 >= b[1] && z0 <= b[3]);
    let loaded = boxes.length > 0 && !!this.renderer.modelColliders;
    for (const id of solid) {
      if (!loaded) break;
      const descs = this.renderer.modelColliders?.(id);
      if (!descs) {
        loaded = false;
        break;
      }
      const at = this.world.entities[id]?.transform.position ?? [0, 0, 0];
      for (const d of descs) if (d.kind === 'trimesh') tris.addMesh(d.positions, d.indices, at, keep);
    }
    const ground = (x: number, y: number, z: number): number | null => {
      if (loaded) return tris.at(x, y + 2.5, z);
      const hit = this.renderer.raycastWorld([x, y + 2.5, z], [0, -1, 0], 8, exclude);
      return hit ? hit.point[1] : null;
    };
    const ids = new Set<string>();
    for (const id of people) this.people.add(id);
    const seen = new Set<string>();
    const fine = (path: readonly V3[]): void => {
      // Fine samples only where the laid path climbs or falls (a stair run): level ground needs no foot placement.
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1] as V3;
        const b = path[i] as V3;
        if (!loaded || Math.abs(b[1] - a[1]) < 0.06) continue;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / FEET_STEP));
        for (let k = 0; k <= n; k++) {
          const u = k / n;
          const x = a[0] + (b[0] - a[0]) * u;
          const z = a[2] + (b[2] - a[2]) * u;
          const key = `${Math.round(x / FEET_STEP)},${Math.round(z / FEET_STEP)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const y = ground(x, a[1] + (b[1] - a[1]) * u + 0.3, z);
          if (y !== null) this.feet.add(x, y, z);
        }
      }
    };
    this.laid = {
      ...this.story,
      shots: this.story.shots.map((s) => ({
        ...s,
        moves: s.moves.map((m) => {
          ids.add(m.entity);
          const laid = people.has(m.entity) && solid.size > 0 ? { ...m, path: groundPath(m.path as V3[], ground) } : m;
          if (laid !== m) fine(laid.path as V3[]);
          this.lengths.set(laid, pathLengths(laid.path));
          return laid;
        }),
      })),
    };
    this.order = [...ids].filter((id) => Object.hasOwn(this.world.entities, id));
    this.packed = new Float32Array(this.order.length * 7);
  }

  /**
   * Draw every shot's first and last view (and a crane's poses between) once, under the black fade (the film opens on a
   * fade from black): textures and geometry a view first shows go to the GPU here, not on the cut to it. The programs are
   * linked at load already.
   */
  async prewarm(frames = 2): Promise<void> {
    const fade = this.opts.fadeEl?.();
    if (fade) {
      fade.style.background = '#000';
      fade.style.opacity = '1';
    }
    const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    for (const s of this.laid.shots) {
      for (const c of s.cameraTo ? [s.camera, ...(s.via ?? []), s.cameraTo] : [s.camera]) {
        if (this.disposed) return;
        this.renderer.lookAt(c.position, c.target, c.fov);
        for (let i = 0; i < frames; i++) await raf();
      }
    }
  }

  /** Play from `at` seconds. */
  start(at = 0): void {
    if (this.disposed) return;
    this.renderer.stopTour();
    this.t0 = this.now() - at * 1000;
    this.pausedAt = null;
    this.ended = false;
    this.lastIndex = -2;
    this.lastT = at;
    if (this.raf === 0) this.loop();
  }

  /** Jump to the end card. */
  skip(): void {
    this.t0 = this.now() - (this.duration + 0.01) * 1000;
    if (this.pausedAt !== null) this.pausedAt = this.now();
    if (this.raf === 0) this.step();
  }

  pause(on: boolean): void {
    if (on && this.pausedAt === null) this.pausedAt = this.now();
    else if (!on && this.pausedAt !== null) {
      this.t0 += this.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  private readonly loop = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    this.step();
    if (!this.ended || this.time < this.duration + END_TAIL) this.raf = requestAnimationFrame(this.loop);
  };

  /** Apply the frame at the current time (exposed for recordings and tests). */
  step(): StoryFrame {
    const t = this.time;
    const poses = actorPoses(this.laid, this.starts, t, this.lengths);
    const frame = storyFrame(this.laid, this.starts, t, poses);
    const cut = frame.index !== this.lastIndex;
    const dt = Math.max(0, t - this.lastT);
    this.applyActors(poses, cut, dt);
    this.lastT = t;
    // The camera, also after the last shot (a skip lands on the last shot's view, which the end card hands over to).
    let { position } = frame.camera;
    if (this.opts.reduceMotion && !frame.done) position = this.shakeless(frame);
    const shot = frame.done ? undefined : this.laid.shots[frame.index];
    let target = frame.camera.target;
    if (shot?.track && shot.trackLag && shot.trackLag > 0 && this.aim && !cut) {
      // A camera operator's weight: the aim follows the subject through a critically damped lag.
      const k = 1 - Math.exp(-dt / shot.trackLag);
      target = [this.aim[0] + (target[0] - this.aim[0]) * k, this.aim[1] + (target[1] - this.aim[1]) * k, this.aim[2] + (target[2] - this.aim[2]) * k];
    }
    this.aim = target;
    if (!frame.done || cut || frame.fade.alpha > 0) this.renderer.lookAt(position, target, frame.camera.fov, frame.camera.roll);
    this.sound(frame, cut);
    this.renderer.setShotGrade?.(frame.grade);
    if (cut && frame.hour !== null && frame.hour !== this.lastHour) {
      this.lastHour = frame.hour;
      const env: Environment = { ...this.world.environment, timeOfDay: frame.hour };
      this.renderer.setEnvironmentOverride(env, { live: true });
    }
    const fade = this.opts.fadeEl?.();
    if (fade) {
      fade.style.opacity = frame.fade.alpha.toFixed(3);
      fade.style.background = frame.fade.color === 'white' ? '#fff8ec' : '#000';
    }
    const overlay: StoryOverlay = { index: frame.index, caption: frame.caption, title: frame.title, subtitle: frame.subtitle, done: frame.done };
    const key = JSON.stringify(overlay);
    if (key !== this.lastOverlay) {
      this.lastOverlay = key;
      this.opts.onOverlay(overlay);
    }
    this.lastIndex = frame.index;
    if (frame.done && !this.ended) {
      this.ended = true;
      this.opts.onEnd?.();
    }
    return frame;
  }

  /** The shot's sound and clips: the cue, the ambience, one-shot sounds and people's clips as the clock passes them. */
  private sound(frame: StoryFrame, cut: boolean): void {
    const audio = this.opts.audio;
    const from = cut ? -1 : this.lastLocal;
    this.lastLocal = frame.local;
    if (frame.done) {
      if (cut) for (const id of this.clipped) this.renderer.characterRig?.(id)?.stopClip();
      if (cut) this.clipped.clear();
      return;
    }
    if (audio) {
      audio.cue(frame.music);
      audio.ambience(frame.ambience);
    }
    const shot = this.laid.shots[frame.index];
    if (!shot) return;
    // Entering a shot mid-way (a seek) fires only what is still ahead of it, except at its very start.
    const lo = cut ? Math.min(frame.local, 0.25) - 1e-6 : from;
    for (const s of shot.sounds ?? []) if (s.at > lo && s.at <= frame.local) audio?.sound(s.sound, s.gain, s.seconds);
    for (const a of shot.actions ?? []) {
      if (!(a.at > lo && a.at <= frame.local)) continue;
      const rig = this.renderer.characterRig?.(a.entity);
      if (!rig) continue;
      rig.playClip(a.clip, { loop: a.loop });
      this.clipped.add(a.entity);
    }
  }

  private shakeless(frame: StoryFrame): V3 {
    const shot = this.laid.shots[frame.index];
    if (!shot || shot.shake <= 0) return frame.camera.position;
    const noShake = storyFrame({ ...this.laid, shots: this.laid.shots.map((s, i) => (i === frame.index ? { ...s, shake: 0 } : s)) }, this.starts, this.time);
    return noShake.camera.position;
  }

  private applyActors(poses: Map<string, ActorPose>, cut: boolean, dt: number): void {
    if (this.order.length === 0) return;
    const p = this.packed;
    let n = 0;
    const order: string[] = [];
    for (const id of this.order) {
      const pose = poses.get(id);
      if (!pose) continue;
      const prev = this.last.get(id);
      const jumped = !prev || Math.hypot(pose.position[0] - prev[0], pose.position[2] - prev[2]) > 2.5;
      let yaw = this.yaw.get(id) ?? pose.yaw ?? 0;
      if (pose.yaw !== null) {
        if (jumped || cut) yaw = pose.yaw;
        else {
          const d = wrapAngle(pose.yaw - yaw);
          const max = TURN_RATE * dt;
          yaw = wrapAngle(yaw + Math.max(-max, Math.min(max, d)));
        }
      }
      this.yaw.set(id, yaw);
      this.last.set(id, pose.position);
      if (this.people.has(id) && this.feet.size > 0) {
        const rig = this.renderer.characterRig?.(id);
        if (rig && 'ground' in rig && rig.ground !== this.feetFn) rig.ground = this.feetFn;
      }
      const o = n * 7;
      p[o] = pose.position[0];
      p[o + 1] = pose.position[1];
      p[o + 2] = pose.position[2];
      p[o + 3] = 0;
      p[o + 4] = Math.sin(yaw / 2);
      p[o + 5] = 0;
      p[o + 6] = Math.cos(yaw / 2);
      order.push(id);
      n++;
    }
    if (n > 0) this.renderer.applyTransforms(n === this.order.length ? p : p.subarray(0, n * 7), order);
  }

  /** Stop and hand the picture back (the grade and the hour return to the world's). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderer.setShotGrade?.(null);
    for (const id of this.clipped) this.renderer.characterRig?.(id)?.stopClip();
    this.clipped.clear();
    for (const id of this.people) {
      const rig = this.renderer.characterRig?.(id);
      if (rig && rig.ground === this.feetFn) rig.ground = null;
    }
    if (this.lastHour !== null) this.renderer.restoreEnvironment();
    const fade = this.opts.fadeEl?.();
    if (fade) fade.style.opacity = '0';
  }
}
