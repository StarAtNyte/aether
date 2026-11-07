/**
 * Plays a world's story (`world.story`) in the player: each animation frame it evaluates the timeline (`story.ts`) and
 * applies it — the camera pose, the moved entities' poses (one packed `applyTransforms`, as physics does), the shot's
 * colour script (`setShotGrade`: post-pass values, never a program change) and, at a shot change, its hour. The overlay
 * (letterbox, captions, titles, fades) is the caller's, fed through {@link StoryRunnerOptions.onFrame}; the fade's opacity
 * changes every frame, so it goes straight to a DOM element instead of through React state.
 */
import type { Environment, Story, StoryGrade, StoryMove, WorldDoc } from '@aether/core';
import type { WorldRenderer } from '@aether/render';
import { actorPoses, pathLengths, shotStarts, storyFrame, type ActorPose, type StoryFrame } from './story';

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
}

/** The renderer methods a story uses (the post-pass grade is optional: older builds have none). */
type StoryRenderer = Pick<WorldRenderer, 'lookAt' | 'applyTransforms' | 'raycastWorld' | 'setEnvironmentOverride' | 'restoreEnvironment' | 'stopTour'> & {
  setShotGrade?: (g: StoryGrade | null) => void;
};

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
    const ground = (x: number, y: number, z: number): number | null => {
      const hit = this.renderer.raycastWorld([x, y + 2.5, z], [0, -1, 0], 8, exclude);
      return hit ? hit.point[1] : null;
    };
    const ids = new Set<string>();
    this.laid = {
      ...this.story,
      shots: this.story.shots.map((s) => ({
        ...s,
        moves: s.moves.map((m) => {
          ids.add(m.entity);
          const laid = people.has(m.entity) && solid.size > 0 ? { ...m, path: groundPath(m.path as V3[], ground) } : m;
          this.lengths.set(laid, pathLengths(laid.path));
          return laid;
        }),
      })),
    };
    this.order = [...ids].filter((id) => Object.hasOwn(this.world.entities, id));
    this.packed = new Float32Array(this.order.length * 7);
  }

  /**
   * Draw every shot's first and last view once, under the black fade (the film opens on a fade from black): textures and
   * geometry a view first shows go to the GPU here, not on the cut to it. The programs are linked at load already.
   */
  async prewarm(frames = 2): Promise<void> {
    const fade = this.opts.fadeEl?.();
    if (fade) {
      fade.style.background = '#000';
      fade.style.opacity = '1';
    }
    const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    for (const s of this.laid.shots) {
      for (const c of s.cameraTo ? [s.camera, s.cameraTo] : [s.camera]) {
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
    if (!this.ended || this.time < this.duration + 0.5) this.raf = requestAnimationFrame(this.loop);
  };

  /** Apply the frame at the current time (exposed for recordings and tests). */
  step(): StoryFrame {
    const t = this.time;
    const poses = actorPoses(this.laid, this.starts, t, this.lengths);
    const frame = storyFrame(this.laid, this.starts, t, poses);
    const cut = frame.index !== this.lastIndex;
    this.applyActors(poses, cut, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (!frame.done) {
      let { position } = frame.camera;
      if (this.opts.reduceMotion) position = this.shakeless(frame);
      this.renderer.lookAt(position, frame.camera.target, frame.camera.fov);
    }
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
    if (this.lastHour !== null) this.renderer.restoreEnvironment();
    const fade = this.opts.fadeEl?.();
    if (fade) fade.style.opacity = '0';
  }
}
