/**
 * The story timeline (`world.story`, core `story-schema.ts`): what the camera, the grade, the captions and the moving
 * entities are at a time `t` of the film. Pure (unit-tested); the player's story runner (`story-runner.ts`) applies a frame
 * to the renderer and the overlay.
 */
import type { Story, StoryCamera, StoryGrade, StoryMove, StoryShot } from '@aether/core';

type V3 = [number, number, number];

/** Default field of view of a story camera (degrees). */
export const STORY_FOV = 50;
/** How long the end card holds before the player offers its buttons alone (s). */
export const END_CARD_SECONDS = 6;
/** After the last shot the picture stays black this long (s), under the end card's title… */
export const END_HOLD_SECONDS = 0.8;
/** …then the black lifts over this long (s), handing over to the live world in the last shot's view and grade. */
export const END_HANDOVER_SECONDS = 2.4;

/** The pose of a moved entity at a time. */
export interface ActorPose {
  position: V3;
  /** Heading in radians about +Y (0 faces −Z, as entity yaw does for people), or null to keep the current one. */
  yaw: number | null;
}

/** Everything a story shows at one time. */
export interface StoryFrame {
  /** Shot index, or −1 after the last shot (the end card). */
  index: number;
  /** Seconds into the shot. */
  local: number;
  camera: { position: V3; target: V3; fov: number; roll: number };
  /** The score's cue in force (the latest a shot at or before this one set), null for none. */
  music: string | null;
  /** The ambience bed in force (levels 0..1, keys absent when no shot set them). */
  ambience: Record<string, number>;
  grade: StoryGrade;
  /** Black or white over the picture (a fade or a flash entering a shot), 0..1. */
  fade: { color: 'black' | 'white'; alpha: number };
  caption: string | null;
  title: string | null;
  subtitle: string | null;
  hour: number | null;
  /** The film is over: the end card shows. */
  done: boolean;
}

/** Shot start times (s), one more than the shots: the last is the running time. */
export function shotStarts(story: Pick<Story, 'shots'>): number[] {
  const out = [0];
  for (const s of story.shots) out.push((out[out.length - 1] as number) + s.duration);
  return out;
}

/** The shot at time `t` (binary search over `starts`); −1 past the end. */
export function shotAt(starts: readonly number[], t: number): number {
  const n = starts.length - 1;
  if (t >= (starts[n] as number)) return -1;
  if (t <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Easing of a 0..1 parameter. */
export function ease(kind: 'linear' | 'inOut' | 'in' | 'out', u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (kind) {
    case 'linear':
      return x;
    case 'in':
      return x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x);
    default:
      return x * x * (3 - 2 * x);
  }
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerp3 = (a: readonly number[], b: readonly number[], u: number): V3 => [lerp(a[0] as number, b[0] as number, u), lerp(a[1] as number, b[1] as number, u), lerp(a[2] as number, b[2] as number, u)];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` blended toward `b` by `u` (keys only in one side are kept as they are). */
export function blendGrade(a: StoryGrade, b: StoryGrade | undefined, u: number): StoryGrade {
  if (!b || u <= 0) return { ...a };
  const out: Record<string, number | string> = { ...a };
  for (const [k, vb] of Object.entries(b) as Array<[keyof StoryGrade, number | string | undefined]>) {
    if (vb === undefined) continue;
    const va = a[k];
    if (va === undefined) out[k] = vb;
    else if (typeof va === 'number' && typeof vb === 'number') out[k] = lerp(va, vb, u);
    else if (typeof va === 'string' && typeof vb === 'string') out[k] = rgbToHex(lerp3(hexToRgb(va), hexToRgb(vb), u));
  }
  return out as StoryGrade;
}

/** Cumulative lengths of a polyline. */
export function pathLengths(path: readonly (readonly number[])[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as readonly number[];
    const b = path[i] as readonly number[];
    out.push((out[i - 1] as number) + Math.hypot((b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number), (b[2] as number) - (a[2] as number)));
  }
  return out;
}

/** The point at fraction `u` of a polyline's length, and the unit direction there (planar). */
export function alongPath(path: readonly (readonly number[])[], lengths: readonly number[], u: number): { point: V3; dir: [number, number] | null } {
  const first = path[0] as readonly number[];
  if (path.length < 2) return { point: [first[0] as number, first[1] as number, first[2] as number], dir: null };
  const total = lengths[lengths.length - 1] as number;
  const d = Math.min(1, Math.max(0, u)) * total;
  let i = 1;
  while (i < path.length - 1 && (lengths[i] as number) < d) i++;
  const a = path[i - 1] as readonly number[];
  const b = path[i] as readonly number[];
  const seg = (lengths[i] as number) - (lengths[i - 1] as number);
  const f = seg > 1e-9 ? (d - (lengths[i - 1] as number)) / seg : 0;
  const dx = (b[0] as number) - (a[0] as number);
  const dz = (b[2] as number) - (a[2] as number);
  const l = Math.hypot(dx, dz);
  return { point: lerp3(a, b, f), dir: l > 1e-6 ? [dx / l, dz / l] : null };
}

/** Progress (0..1) of a move at `local` seconds into a shot of `duration`. */
export function moveProgress(move: Pick<StoryMove, 'start' | 'end' | 'ease'>, local: number, duration: number): number {
  const s = move.start * duration;
  const e = Math.max(s + 1e-6, move.end * duration);
  return ease(move.ease, (local - s) / (e - s));
}

/** The pose of a move at progress `u` (yaw faces the way it goes; at rest it turns to `face`). */
export function movePose(move: Pick<StoryMove, 'path' | 'orient' | 'face' | 'yawOffset'>, lengths: readonly number[], u: number): ActorPose {
  const { point, dir } = alongPath(move.path, lengths, u);
  let yaw: number | null = null;
  // `face` turns it once it stops; a move that does not orient to its way (a rider) keeps facing it throughout.
  if (move.face && (u >= 1 || move.path.length < 2 || !move.orient)) {
    const dx = move.face[0] - point[0];
    const dz = move.face[2] - point[2];
    if (Math.hypot(dx, dz) > 1e-6) yaw = Math.atan2(-dx, -dz);
  } else if (move.orient && dir) yaw = Math.atan2(-dir[0], -dir[1]) + ((move.yawOffset ?? 0) * Math.PI) / 180;
  return { position: point, yaw };
}

/**
 * Where each moved entity is at time `t`: the pose of the latest shot at or before `t` that moves it (after its shot it
 * stays where the move ended). Entities no shot has moved yet are absent (they stand where the world puts them).
 */
export function actorPoses(story: Pick<Story, 'shots'>, starts: readonly number[], t: number, lengths?: Map<StoryMove, number[]>): Map<string, ActorPose> {
  const out = new Map<string, ActorPose>();
  const idx = shotAt(starts, t);
  const last = idx < 0 ? story.shots.length - 1 : idx;
  for (let i = 0; i <= last; i++) {
    const shot = story.shots[i] as StoryShot;
    const local = i === idx ? t - (starts[i] as number) : shot.duration;
    for (const m of shot.moves) {
      const l = lengths?.get(m) ?? pathLengths(m.path);
      const pose = movePose(m, l, moveProgress(m, local, shot.duration));
      const prev = out.get(m.entity);
      out.set(m.entity, pose.yaw === null && prev ? { position: pose.position, yaw: prev.yaw } : pose);
    }
  }
  return out;
}

function cameraOf(c: StoryCamera, fov: number, roll = 0): { position: V3; target: V3; fov: number; roll: number } {
  return { position: [...c.position] as V3, target: [...c.target] as V3, fov: c.fov ?? fov, roll: c.roll ?? roll };
}

/** Centripetal Catmull-Rom point between `p1` and `p2` at `u` (0..1), with neighbours `p0` and `p3`. */
function catmull(p0: readonly number[], p1: readonly number[], p2: readonly number[], p3: readonly number[], u: number): V3 {
  const knot = (a: readonly number[], b: readonly number[]): number => Math.max(1e-4, Math.sqrt(Math.hypot((b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number), (b[2] as number) - (a[2] as number))));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a1 = ((t1 - t) * (p0[k] as number) + t * (p1[k] as number)) / t1;
    const a2 = ((t2 - t) * (p1[k] as number) + (t - t1) * (p2[k] as number)) / (t2 - t1);
    const a3 = ((t3 - t) * (p2[k] as number) + (t - t2) * (p3[k] as number)) / (t3 - t2);
    const b1 = ((t2 - t) * a1 + t * a2) / t2;
    const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
    out[k] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
  }
  return out;
}

/** A point at `u` (0..1, evenly split between the keys) along a spline through `keys` (end tangents mirrored). */
export function splineAt(keys: readonly (readonly number[])[], u: number): V3 {
  const n = keys.length;
  if (n === 1) return [...(keys[0] as readonly number[])] as V3;
  if (n === 2) return lerp3(keys[0] as readonly number[], keys[1] as readonly number[], u);
  const x = Math.min(1, Math.max(0, u)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const p1 = keys[i] as readonly number[];
  const p2 = keys[i + 1] as readonly number[];
  const mirror = (a: readonly number[], b: readonly number[]): number[] => [2 * (a[0] as number) - (b[0] as number), 2 * (a[1] as number) - (b[1] as number), 2 * (a[2] as number) - (b[2] as number)];
  const p0 = i > 0 ? (keys[i - 1] as readonly number[]) : mirror(p1, p2);
  const p3 = i + 2 < n ? (keys[i + 2] as readonly number[]) : mirror(p2, p1);
  return catmull(p0, p1, p2, p3, f);
}

/** Deterministic hand-held breath (metres) at time `t` for `amount` 0..1. */
function shakeAt(t: number, amount: number): V3 {
  if (amount <= 0) return [0, 0, 0];
  const a = amount * 0.06;
  return [a * (Math.sin(t * 13.1) * 0.6 + Math.sin(t * 29.7) * 0.4), a * (Math.sin(t * 17.3 + 1) * 0.6 + Math.sin(t * 37.1) * 0.4), a * Math.sin(t * 11.9 + 2) * 0.5];
}

/**
 * The frame at time `t` (seconds from the start). `actors` (from {@link actorPoses}) feed a shot's `track`; `fovIn` is
 * the field of view carried from earlier shots.
 */
export function storyFrame(story: Story, starts: readonly number[], t: number, actors?: ReadonlyMap<string, ActorPose>): StoryFrame {
  const idx = shotAt(starts, t);
  const lastIdx = story.shots.length - 1;
  const i = idx < 0 ? lastIdx : idx;
  const shot = story.shots[i] as StoryShot;
  const local = idx < 0 ? shot.duration : t - (starts[i] as number);
  // The field of view carries over from the previous shot that set one.
  let fov = STORY_FOV;
  for (let k = 0; k <= i; k++) {
    const s = story.shots[k] as StoryShot;
    if (k < i && s.cameraTo?.fov !== undefined) fov = s.cameraTo.fov;
    else if (s.camera.fov !== undefined) fov = s.camera.fov;
  }
  const u = shot.cameraTo ? ease(shot.ease, local / shot.duration) : 0;
  const from = cameraOf(shot.camera, fov);
  const to = shot.cameraTo ? cameraOf(shot.cameraTo, from.fov, from.roll) : from;
  let camera: StoryFrame['camera'];
  if (shot.cameraTo && shot.via && shot.via.length > 0) {
    // A crane or a curved dolly: a spline through every key, the fov and roll eased key to key.
    const keys = [from, ...shot.via.map((v) => cameraOf(v, from.fov, from.roll)), to];
    const x = u * (keys.length - 1);
    const k = Math.min(keys.length - 2, Math.floor(x));
    const f = x - k;
    const a = keys[k] as ReturnType<typeof cameraOf>;
    const b = keys[k + 1] as ReturnType<typeof cameraOf>;
    camera = { position: splineAt(keys.map((c) => c.position), u), target: splineAt(keys.map((c) => c.target), u), fov: lerp(a.fov, b.fov, f), roll: lerp(a.roll, b.roll, f) };
  } else {
    camera = { position: lerp3(from.position, to.position, u), target: lerp3(from.target, to.target, u), fov: lerp(from.fov, to.fov, u), roll: lerp(from.roll, to.roll, u) };
  }
  if (shot.track) {
    const a = actors?.get(shot.track);
    if (a) {
      const o = shot.trackOffset ?? [0, 1.2, 0];
      camera.target = [a.position[0] + o[0], a.position[1] + o[1], a.position[2] + o[2]];
    }
  }
  if (shot.shake > 0) {
    const s = shakeAt(t, shot.shake);
    camera.position = [camera.position[0] + s[0], camera.position[1] + s[1], camera.position[2] + s[2]];
  }
  // The grade: the latest grade set at or before this shot, blended toward the shot's own `gradeTo`.
  let base: StoryGrade = {};
  for (let k = 0; k <= i; k++) {
    const s = story.shots[k] as StoryShot;
    if (s.grade) base = blendGrade(base, s.grade, 1);
    if (k < i && s.gradeTo) base = blendGrade(base, s.gradeTo, 1);
  }
  const grade = blendGrade(base, shot.gradeTo, shot.gradeTo ? ease('inOut', local / shot.duration) : 0);
  let hour: number | null = null;
  for (let k = 0; k <= i; k++) {
    const h = (story.shots[k] as StoryShot).hour;
    if (h !== undefined) hour = h;
  }
  let music: string | null = null;
  const ambience: Record<string, number> = {};
  for (let k = 0; k <= i; k++) {
    const s = story.shots[k] as StoryShot;
    if (s.music !== undefined) music = s.music === 'none' ? null : s.music;
    if (s.ambience) for (const [key, v] of Object.entries(s.ambience)) if (v !== undefined) ambience[key] = v;
  }
  // A fade or a flash entering the shot; the film fades to black over its last second into the end card.
  let fade: StoryFrame['fade'] = { color: 'black', alpha: 0 };
  if (shot.transition !== 'cut' && shot.transitionSeconds > 0 && local < shot.transitionSeconds) {
    fade = { color: shot.transition === 'flash' ? 'white' : 'black', alpha: 1 - ease('out', local / shot.transitionSeconds) };
  }
  const total = starts[starts.length - 1] as number;
  if (idx >= 0 && i === lastIdx && story.endCard && total - t < 1.2) fade = { color: 'black', alpha: Math.max(fade.alpha, ease('in', 1 - (total - t) / 1.2)) };
  const [c0, c1] = shot.captionAt ?? [Math.min(0.4, shot.duration * 0.1), shot.duration - Math.min(0.4, shot.duration * 0.1)];
  const caption = idx >= 0 && shot.caption && local >= c0 && local <= c1 ? shot.caption : null;
  // After the last shot: black under the end card's title, then the black lifts onto the live world in the last shot's
  // view and grade (the end card's buttons over the living scene; never a black screen).
  if (idx < 0) {
    const after = t - total;
    fade = { color: 'black', alpha: story.endCard ? 1 - ease('inOut', (after - END_HOLD_SECONDS) / END_HANDOVER_SECONDS) : 0 };
  }
  return {
    index: idx,
    local,
    camera,
    music,
    ambience,
    grade,
    fade,
    caption,
    title: idx >= 0 ? (shot.title ?? null) : null,
    subtitle: idx >= 0 ? (shot.subtitle ?? null) : null,
    hour,
    done: idx < 0,
  };
}

/**
 * The entities a shot walks: a move on the ground (not a rider's, `ground: false`) whose path goes somewhere (more than
 * 5 cm across). A clip held over from an earlier shot (a gesture, a look up) is let go for them at the cut: a held clip
 * takes the body from locomotion, so a person walked up a stair while holding it glides with still legs.
 */
export function walkersOf(shot: Pick<StoryShot, 'moves'>): Set<string> {
  const out = new Set<string>();
  for (const m of shot.moves) {
    if (m.ground === false || m.path.length < 2) continue;
    const a = m.path[0] as readonly number[];
    if (m.path.some((p) => Math.hypot((p[0] as number) - (a[0] as number), (p[2] as number) - (a[2] as number)) > 0.05)) out.add(m.entity);
  }
  return out;
}

/** The people a story moves (entities with a `character`): they step aside while the visitor plays. */
/**
 * Where the visitor stands when they play after the film: the story's own `playFrom`; else, when the last shot follows a
 * person of the film (who steps aside for the visitor), that person's last spot and heading; else null (the world's
 * play spawn).
 */
export function playStartAfterStory(world: { story?: Pick<Story, 'shots' | 'playFrom'> | undefined; entities: Record<string, { character?: unknown; transform: { position: [number, number, number]; rotation: [number, number, number] } }> }): { feet: [number, number, number]; yawDeg: number } | null {
  const story = world.story;
  if (!story) return null;
  if (story.playFrom) return { feet: [...story.playFrom.position], yawDeg: story.playFrom.yaw };
  const last = story.shots[story.shots.length - 1];
  if (!last) return null;
  const id = last.track ?? last.moves.find((m) => world.entities[m.entity]?.character)?.entity;
  const e = id ? world.entities[id] : undefined;
  if (!id || !e?.character) return null;
  const move = [...last.moves].reverse().find((m) => m.entity === id);
  const at = move?.path[move.path.length - 1] ?? e.transform.position;
  // Facing where the last shot looked, so the first frame of play continues the film's view.
  const cam = last.cameraTo ?? last.camera;
  const yaw = (Math.atan2(-(cam.target[0] - cam.position[0]), -(cam.target[2] - cam.position[2])) * 180) / Math.PI;
  return { feet: [at[0], at[1], at[2]], yawDeg: Math.round(yaw) || 0 };
}

export function storyCast(world: { story?: Pick<Story, 'shots'> | undefined; entities: Record<string, { character?: unknown }> }): string[] {
  const out = new Set<string>();
  for (const s of world.story?.shots ?? []) for (const m of s.moves) if (world.entities[m.entity]?.character) out.add(m.entity);
  return [...out];
}
