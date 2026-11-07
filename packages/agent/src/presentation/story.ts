/**
 * Authoring a world's short film (`world.story`) from its points of interest, and checking its shots.
 *
 * A model writes a {@link StoryPlan}: shots that name a point of interest (or give a camera) and a camera move, with
 * captions, titles and hours; {@link planToStory} turns it into the IR's `Story`. {@link fallbackPlan} writes one with no
 * model, by film grammar: an establishing wide with the title, a second wide, details, the subject (a person, else the
 * landmark), a held beat and a closing pull-out into the end card, 45 to 90 seconds in all, the sun moving on a little.
 *
 * {@link checkStory} validates the shots (no camera inside geometry or under water, nothing pressed against the lens,
 * the subject in frame); {@link repairStory} moves a bad camera out (forward past a near occluder, back, up), aims it back
 * at its subject, falls back to the point's own camera, and as a last resort drops the shot.
 */
import { z } from 'zod';
import type { Story, StoryGrade, StoryShot, Vec3, WorldDoc } from '@aether/core';
import { Story as StorySchema, storyDuration } from '@aether/core';
import type { PointOfInterest, PoseLike } from './poi';

/** Shortest and longest film (s). */
export const STORY_SECONDS: readonly [number, number] = [45, 90];
/** Content closer than this to the lens (m) is an occluder pressed against it. */
export const STORY_NEAR_ZONE = 1.5;
/** Content closer than this (m) means the camera is in or touching geometry. */
export const STORY_INSIDE_ZONE = 0.6;
/** The film's frame (2.39:1 inside a 16:9 canvas). */
const FRAME_ASPECT = 2.39;

export const CAMERA_MOVES = ['hold', 'push-in', 'pull-out', 'orbit-left', 'orbit-right', 'crane-up', 'crane-down', 'pan-left', 'pan-right', 'truck-left', 'truck-right'] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];
export const STORY_LOOKS = ['natural', 'golden', 'dusk', 'cool', 'soft'] as const;
export type StoryLook = (typeof STORY_LOOKS)[number];

const V3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const PoseIn = z.object({ position: V3, target: V3, fov: z.number().min(8).max(100).optional() });

export const StoryPlanShot = z.object({
  /** A point of interest id (see `pointsOfInterest`). */
  poi: z.string().max(64).optional(),
  /** An explicit camera (overrides the point's own). */
  camera: PoseIn.optional(),
  move: z.enum(CAMERA_MOVES).default('hold'),
  /** How far the move goes, 0.2..2 (1: a moderate move). */
  amount: z.number().min(0.1).max(2).default(1),
  duration: z.number().min(2).max(30),
  name: z.string().min(1).max(60).optional(),
  caption: z.string().min(1).max(160).optional(),
  title: z.string().min(1).max(60).optional(),
  subtitle: z.string().min(1).max(80).optional(),
  hour: z.number().min(0).max(24).optional(),
  transition: z.enum(['cut', 'fade', 'flash']).optional(),
  fov: z.number().min(12).max(90).optional(),
  /** Keep this entity in frame (a person who moves). */
  track: z.string().max(64).optional(),
});
export type StoryPlanShot = z.infer<typeof StoryPlanShot>;

export const StoryPlan = z.object({
  title: z.string().min(1).max(60).optional(),
  look: z.enum(STORY_LOOKS).default('natural'),
  letterbox: z.number().min(0).max(1).default(1),
  shots: z.array(StoryPlanShot).min(2).max(24),
  endCard: z.object({ title: z.string().min(1).max(60), lines: z.array(z.string().min(1).max(100)).max(4).default([]) }).optional(),
});
export type StoryPlan = z.infer<typeof StoryPlan>;
export type StoryPlanInput = z.input<typeof StoryPlan>;

const LOOKS: Readonly<Record<StoryLook, StoryGrade>> = {
  natural: { vignette: 0.18, grain: 0.06 },
  golden: { temperature: 0.25, saturation: 1.04, bloom: 0.6, diffusion: 0.2, godRays: 0.3, vignette: 0.22, grain: 0.08 },
  dusk: { exposureEv: -0.15, temperature: 0.08, saturation: 1.06, gradientTop: '#3a3f7a', gradientBottom: '#f2a065', gradientAmount: 0.16, bloom: 0.8, vignette: 0.26, grain: 0.1, practicals: 0.7 },
  cool: { temperature: -0.2, saturation: 0.94, vignette: 0.22, grain: 0.08 },
  soft: { bloom: 0.7, diffusion: 0.35, saturation: 1.05, vignette: 0.15, grain: 0.05 },
};

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, -1];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (v: Vec3): Vec3 => [r2(v[0]), r2(v[1]), r2(v[2])];
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Rotate `p` round the vertical axis through `c` by `deg`. */
function yawAround(p: Vec3, c: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const dx = p[0] - c[0];
  const dz = p[2] - c[2];
  return [c[0] + dx * Math.cos(a) - dz * Math.sin(a), p[1], c[2] + dx * Math.sin(a) + dz * Math.cos(a)];
}

/**
 * Where `p` falls in the frame of `pose` (normalised: -1..1 across the visible 2.39:1 frame; `z` the distance along the
 * view), or null when it is behind the camera.
 */
export function projectInFrame(pose: PoseLike, p: Vec3, aspect = FRAME_ASPECT): { x: number; y: number; z: number } | null {
  const f = norm(sub(pose.target, pose.position));
  let r = cross(f, [0, 1, 0]);
  if (len(r) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  const d = sub(p, pose.position);
  const z = dot(d, f);
  if (z < 0.2) return null;
  // The film's frame: the canvas is 16:9, the bars leave a 2.39:1 band of the vertical field.
  const t = Math.tan((((pose.fov ?? 50) * Math.PI) / 180) / 2) * ((16 / 9) / aspect);
  return { x: dot(d, r) / (z * t * aspect), y: dot(d, u) / (z * t), z };
}

// ---------------------------------------------------------------------------
// Plan -> Story
// ---------------------------------------------------------------------------

/** The camera of a point of interest that has none (a person, the landmark, the spawn), looking from `from`'s side. */
export function framePoi(poi: PointOfInterest, from: Vec3 | null): PoseLike {
  if (poi.pose) return { position: [...poi.pose.position], target: [...poi.pose.target], ...(poi.pose.fov !== undefined ? { fov: poi.pose.fov } : {}) };
  const at = poi.at;
  const side = from ? sub(from, at) : ([0.6, 0, 0.8] as Vec3);
  const flat = norm([side[0], 0, side[2]]);
  if (poi.kind === 'character') {
    // A medium shot, a little off-axis, at eye height.
    const dir = norm(yawAround(flat, [0, 0, 0], 20));
    return { position: round(add(at, [dir[0] * 3.6, 0.55, dir[2] * 3.6])), target: round(add(at, [0, 0.35, 0])), fov: 32 };
  }
  if (poi.kind === 'spawn') {
    // Over the visitor's shoulder toward where they will go.
    const ahead = from ? norm(sub(at, from)) : ([0, 0, -1] as Vec3);
    return { position: round(add(at, [-ahead[0] * 4, 1.9, -ahead[2] * 4])), target: round(add(at, [ahead[0] * 10, 0.6, ahead[2] * 10])), fov: 50 };
  }
  const dist = Math.max(10, Math.min(90, poi.radius * 3));
  return { position: round(add(at, [flat[0] * dist, Math.max(2.5, poi.radius * 0.5), flat[2] * dist])), target: round([at[0], at[1] + poi.radius * 0.15, at[2]]), fov: 45 };
}

/** The end pose of `move` from `start` (null for a held shot). */
export function moveEnd(start: PoseLike, move: CameraMove, amount = 1): PoseLike | null {
  const p = start.position;
  const t = start.target;
  const d = len(sub(t, p));
  const f = norm(sub(t, p));
  const right = norm(cross(f, [0, 1, 0]));
  const k = Math.max(0.1, Math.min(2, amount));
  const out = (position: Vec3, target: Vec3): PoseLike => ({ position: round(position), target: round(target), ...(start.fov !== undefined ? { fov: start.fov } : {}) });
  switch (move) {
    case 'hold':
      return null;
    case 'push-in':
      return out(add(p, mul(f, Math.max(0, Math.min(d - 2.5, d * 0.28 * k)))), t);
    case 'pull-out':
      return out(sub(p, mul(f, d * 0.3 * k)), t);
    case 'orbit-left':
      return out(yawAround(p, t, -22 * k), t);
    case 'orbit-right':
      return out(yawAround(p, t, 22 * k), t);
    case 'crane-up':
      return out(add(p, [0, Math.max(1.5, d * 0.22 * k), 0]), add(t, [0, d * 0.04 * k, 0]));
    case 'crane-down':
      return out(add(p, [0, -Math.min(p[1] - t[1] + d * 0.05, d * 0.18 * k), 0]), t);
    case 'pan-left':
      return out(p, yawAround(t, p, -18 * k));
    case 'pan-right':
      return out(p, yawAround(t, p, 18 * k));
    case 'truck-left':
      return out(sub(p, mul(right, d * 0.18 * k)), sub(t, mul(right, d * 0.18 * k)));
    case 'truck-right':
      return out(add(p, mul(right, d * 0.18 * k)), add(t, mul(right, d * 0.18 * k)));
  }
}

/** A converted story and the subject each shot must keep in frame. */
export interface AuthoredStory {
  story: Story;
  /** Per shot: the point that must stay in frame (null: the camera's own target). */
  subjects: Array<Vec3 | null>;
  /** Per shot: the point of interest it came from. */
  pois: Array<string | null>;
  /** What could not be used ("shot 3: unknown point view-9"). */
  notes: string[];
}

/** Turn a plan into the IR's story. Shots naming an unknown point and giving no camera are dropped (and noted). */
export function planToStory(world: WorldDoc, plan: StoryPlan, pois: readonly PointOfInterest[]): AuthoredStory {
  const byId = new Map(pois.map((p) => [p.id, p]));
  const from = pois.find((p) => p.kind === 'opening')?.pose?.position ?? world.player.spawn;
  const look = LOOKS[plan.look];
  const shots: StoryShot[] = [];
  const subjects: Array<Vec3 | null> = [];
  const ids: Array<string | null> = [];
  const notes: string[] = [];
  plan.shots.forEach((s, i) => {
    const poi = s.poi ? byId.get(s.poi) : undefined;
    if (s.poi && !poi && !s.camera) {
      notes.push(`shot ${i + 1}: unknown point "${s.poi.slice(0, 40)}"`);
      return;
    }
    const base: PoseLike | null = s.camera ? { position: [...s.camera.position], target: [...s.camera.target], ...(s.camera.fov !== undefined ? { fov: s.camera.fov } : {}) } : poi ? framePoi(poi, from) : null;
    if (!base) {
      notes.push(`shot ${i + 1}: neither a point nor a camera`);
      return;
    }
    if (s.fov !== undefined) base.fov = s.fov;
    if (base.fov === undefined) base.fov = 50;
    // A push-in, a pull-out or a crane on a subject that has no camera of its own starts from the far end of the move.
    let start = base;
    let end = moveEnd(base, s.move, s.amount);
    if (s.move === 'pull-out' && end) {
      // A pull-out ends on the point's own camera (the place revealed), starting closer in.
      const d = len(sub(base.target, base.position));
      start = { ...base, position: round(add(base.position, mul(norm(sub(base.target, base.position)), Math.max(0, Math.min(d - 2.5, d * 0.25 * s.amount))))) };
      end = base;
    }
    const track = s.track && world.entities[s.track] ? s.track : poi?.kind === 'character' && poi.entity ? poi.entity : undefined;
    const shot: StoryShot = {
      ...(s.name ? { name: s.name } : poi ? { name: poi.label.slice(0, 60) } : {}),
      duration: s.duration,
      camera: { position: round(start.position), target: round(start.target), fov: r2(start.fov ?? 50) },
      ...(end ? { cameraTo: { position: round(end.position), target: round(end.target), fov: r2(end.fov ?? start.fov ?? 50) } } : {}),
      ease: 'inOut',
      shake: 0,
      transition: s.transition ?? (i === 0 ? 'fade' : 'cut'),
      transitionSeconds: (s.transition ?? (i === 0 ? 'fade' : 'cut')) === 'fade' ? 1.2 : 0.6,
      ...(s.caption ? { caption: s.caption } : {}),
      ...(s.title ? { title: s.title } : {}),
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      ...(s.hour !== undefined ? { hour: s.hour } : {}),
      ...(track ? { track, trackOffset: [0, 0.35, 0] as Vec3 } : {}),
      grade: { ...look },
      moves: [],
    };
    shots.push(shot);
    subjects.push(poi && poi.kind !== 'view' && poi.kind !== 'stop' && poi.kind !== 'opening' && poi.kind !== 'hero' ? [...poi.at] : null);
    ids.push(poi?.id ?? null);
  });
  // The last shot settles into the end card.
  const last = shots[shots.length - 1];
  if (last) last.gradeTo = { ...look, exposureEv: (look.exposureEv ?? 0) - 0.5, vignette: Math.min(1, (look.vignette ?? 0.2) + 0.15) };
  const story = StorySchema.parse({
    ...(plan.title ? { title: plan.title } : { title: world.name.slice(0, 60) || 'A short film' }),
    shots: shots.length > 0 ? shots : [{ duration: 6, camera: { position: [...from], target: [...(pois[0]?.at ?? [0, 0, 0])] } }],
    letterbox: plan.letterbox,
    endCard: plan.endCard ?? { title: (plan.title ?? world.name).slice(0, 60) || 'The end', lines: ['Press P to play', 'Tab to explore'] },
  });
  return { story, subjects, pois: ids, notes };
}

// ---------------------------------------------------------------------------
// The film without a model
// ---------------------------------------------------------------------------

/** Hours for `n` shots: the world's hour moving on toward evening outdoors, held indoors and at night. */
export function storyHours(world: WorldDoc, n: number, indoor: boolean): Array<number | undefined> {
  const base = world.environment.timeOfDay;
  if (base === undefined || indoor || base < 6.5 || base > 19) return Array.from({ length: n }, () => (base === undefined ? undefined : base));
  const end = Math.min(base + 1.4, 19.2);
  return Array.from({ length: n }, (_, i) => r2(base + ((end - base) * i) / Math.max(1, n - 1)));
}

/** The first sentence of `text`, at most `max` characters. */
function sentence(text: string, max: number): string | undefined {
  const s = text.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  if (!s) return undefined;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Spread on the ground between two poses' cameras (m). */
const apart = (a: PointOfInterest, b: PointOfInterest): number => Math.hypot((a.pose?.position[0] ?? a.at[0]) - (b.pose?.position[0] ?? b.at[0]), (a.pose?.position[2] ?? a.at[2]) - (b.pose?.position[2] ?? b.at[2]));

/** The deterministic film of `world` from its points of interest: film grammar, no model. */
export function fallbackPlan(world: WorldDoc, pois: readonly PointOfInterest[], opts: { indoor?: boolean } = {}): StoryPlan {
  const cams = pois.filter((p) => p.pose);
  const probed = cams.filter((p) => p.probed);
  const used = new Set<string>();
  const take = (p: PointOfInterest | undefined): PointOfInterest | undefined => {
    if (p) used.add(p.id);
    return p;
  };
  const fresh = (list: readonly PointOfInterest[]): PointOfInterest[] => list.filter((p) => !used.has(p.id));
  const establishing = take(pois.find((p) => p.id === 'hero-establishing') ?? probed[0] ?? cams[0]);
  const second = take(fresh(probed).find((p) => p.kind === 'opening') ?? fresh(probed)[0] ?? fresh(cams)[0]);
  const details: PointOfInterest[] = [];
  for (const p of fresh(probed.length >= 3 ? probed : cams)) {
    if (details.length >= 3) break;
    if ([...details, ...(second ? [second] : [])].every((d) => apart(d, p) > 6)) details.push(take(p) as PointOfInterest);
  }
  const subject = take(pois.find((p) => p.kind === 'character') ?? pois.find((p) => p.kind === 'landmark'));
  const held = take(fresh(probed)[0] ?? pois.find((p) => p.id === 'hero-landmark' && !used.has(p.id)) ?? second ?? establishing);
  const closing = establishing ?? second;
  const indoor = opts.indoor ?? false;
  const shots: StoryPlanShot[] = [];
  const push = (p: PointOfInterest | undefined, s: Omit<StoryPlanShot, 'poi' | 'amount'> & { amount?: number }): void => {
    if (p) shots.push({ poi: p.id, amount: 1, ...s });
  };
  const name = world.name.slice(0, 60) || 'Untitled';
  push(establishing, { move: indoor ? 'truck-right' : 'push-in', amount: 0.7, duration: 10, name: 'Establishing', title: name, ...(sentence(world.description, 80) ? { subtitle: sentence(world.description, 80) as string } : {}), transition: 'fade' });
  push(second, { move: 'orbit-right', amount: 0.6, duration: 7, name: 'Arrival' });
  const detailMoves: CameraMove[] = ['truck-left', 'pan-right', 'push-in'];
  details.forEach((d, i) => push(d, { move: detailMoves[i % detailMoves.length] as CameraMove, amount: 0.7, duration: 6, name: `Detail ${i + 1}`, ...(d.kind === 'stop' && /"(.+)"/.test(d.label) ? { caption: (/"(.+)"/.exec(d.label) as RegExpExecArray)[1] as string } : {}) }));
  if (subject) push(subject, { move: subject.kind === 'character' ? 'orbit-left' : 'push-in', amount: 0.6, duration: 8, name: subject.kind === 'character' ? 'The subject' : 'The landmark' });
  push(held, { move: 'hold', duration: 8, name: 'Held beat' });
  push(closing, { move: 'pull-out', amount: 0.8, duration: 9, name: 'Closing', transition: 'cut' });
  const hours = storyHours(world, shots.length, indoor);
  shots.forEach((s, i) => {
    const h = hours[i];
    if (h !== undefined) s.hour = h;
  });
  fitDurations(shots);
  const hour = world.environment.timeOfDay;
  const look: StoryLook = indoor ? 'soft' : hour !== undefined && hour >= 16.5 && hour <= 19.5 ? 'golden' : hour !== undefined && (hour > 19.5 || hour < 6) ? 'cool' : 'natural';
  return { title: name, look, letterbox: 1, shots, endCard: { title: name, lines: ['Press P to play', 'Tab to explore'] } };
}

/** Scale shot durations so the film runs 45 to 90 s (each shot 2.5 to 30 s). */
function fitDurations(shots: Array<{ duration: number }>): void {
  const total = shots.reduce((t, s) => t + s.duration, 0);
  if (total <= 0) return;
  const want = total < STORY_SECONDS[0] ? STORY_SECONDS[0] + 3 : total > STORY_SECONDS[1] ? STORY_SECONDS[1] - 3 : total;
  const k = want / total;
  for (const s of shots) s.duration = r2(Math.max(2.5, Math.min(30, s.duration * k)));
}

// ---------------------------------------------------------------------------
// Checking and repairing shots
// ---------------------------------------------------------------------------

/** Depth-samples a camera (see `AgentHost.probeView`); null when it cannot tell. */
export type StoryProbe = (pose: PoseLike) => Promise<{ near: number; underWater: boolean } | null>;

export type ShotIssueKind = 'inside' | 'occluder' | 'underwater' | 'subject' | 'length';

/** One problem of a shot. */
export interface ShotIssue {
  /** Shot index (-1: the whole film). */
  shot: number;
  end: 'start' | 'end' | 'film';
  kind: ShotIssueKind;
  note: string;
}

async function poseIssues(i: number, end: 'start' | 'end', pose: PoseLike, subject: Vec3 | null, probe: StoryProbe | null): Promise<ShotIssue[]> {
  const out: ShotIssue[] = [];
  const got = probe ? await probe(pose).catch(() => null) : null;
  if (got?.underWater) out.push({ shot: i, end, kind: 'underwater', note: 'the camera is under water' });
  else if (got && got.near < STORY_INSIDE_ZONE) out.push({ shot: i, end, kind: 'inside', note: `the camera is in or against geometry (content ${got.near.toFixed(2)} m from the lens)` });
  else if (got && got.near < STORY_NEAR_ZONE) out.push({ shot: i, end, kind: 'occluder', note: `something ${got.near.toFixed(1)} m from the lens fills part of the frame` });
  if (subject) {
    const at = projectInFrame(pose, subject);
    if (!at || Math.abs(at.x) > 0.85 || Math.abs(at.y) > 0.8) out.push({ shot: i, end, kind: 'subject', note: at ? `the subject is at the frame's edge or outside it (${at.x.toFixed(2)}, ${at.y.toFixed(2)})` : 'the subject is behind the camera' });
  }
  return out;
}

/** Problems of the shots of `story` (probe: the host's depth sampler; subjects: per shot, see {@link AuthoredStory}). */
export async function checkStory(story: Story, probe: StoryProbe | null, subjects: ReadonlyArray<Vec3 | null> = []): Promise<ShotIssue[]> {
  const out: ShotIssue[] = [];
  for (const [i, s] of story.shots.entries()) {
    const subject = subjects[i] ?? null;
    out.push(...(await poseIssues(i, 'start', s.camera, subject, probe)));
    if (s.cameraTo) out.push(...(await poseIssues(i, 'end', s.cameraTo, subject, probe)));
  }
  const total = storyDuration(story);
  if (total < STORY_SECONDS[0] || total > STORY_SECONDS[1]) out.push({ shot: -1, end: 'film', kind: 'length', note: `the film runs ${total.toFixed(0)} s (wanted ${STORY_SECONDS[0]} to ${STORY_SECONDS[1]} s)` });
  return out;
}

/** Text of issues for a model or the user. */
export function issuesText(issues: readonly ShotIssue[]): string {
  return issues.map((x) => (x.shot < 0 ? `film: ${x.note}` : `shot ${x.shot + 1} (${x.end}): ${x.note}`)).join('\n');
}

/** Candidate cameras near a bad one: forward past a near occluder, back, up. */
function nudges(pose: PoseLike): PoseLike[] {
  const f = norm(sub(pose.target, pose.position));
  const d = len(sub(pose.target, pose.position));
  const out: PoseLike[] = [];
  const at = (move: Vec3): PoseLike => ({ position: round(add(pose.position, move)), target: [...pose.target], ...(pose.fov !== undefined ? { fov: pose.fov } : {}) });
  if (d > 8) out.push(at(mul(f, 2.5)));
  out.push(at(mul(f, -2)), at(add(mul(f, -4), [0, 1, 0])), at([0, 2.5, 0]), at(add(mul(f, -7), [0, 2.5, 0])));
  if (d > 14) out.push(at(mul(f, 5)));
  return out;
}

async function poseOk(pose: PoseLike, probe: StoryProbe | null): Promise<boolean> {
  if (!probe) return true;
  const got = await probe(pose).catch(() => null);
  return !got || (!got.underWater && got.near >= STORY_NEAR_ZONE);
}

/** A repaired story and what was done. */
export interface RepairedStory {
  story: Story;
  subjects: Array<Vec3 | null>;
  fixed: string[];
  remaining: ShotIssue[];
}

/**
 * Repair the problems {@link checkStory} finds: a camera in geometry, under water or behind an occluder moves forward,
 * back or up; a subject out of frame is aimed at again; a shot whose start cannot be repaired takes its point's own
 * camera, else is dropped (a film keeps at least two shots). Then the film is fitted to 45 to 90 s.
 */
export async function repairStory(input: AuthoredStory | { story: Story; subjects?: Array<Vec3 | null>; pois?: Array<string | null> }, probe: StoryProbe | null, pois: readonly PointOfInterest[] = []): Promise<RepairedStory> {
  const story: Story = structuredClone(input.story);
  const subjects = [...(input.subjects ?? story.shots.map(() => null))];
  const ids = [...(input.pois ?? story.shots.map(() => null))];
  const fixed: string[] = [];
  const drop: number[] = [];
  const byId = new Map(pois.map((p) => [p.id, p]));
  for (const [i, s] of story.shots.entries()) {
    const subject = subjects[i] ?? null;
    for (const end of ['start', 'end'] as const) {
      const pose = end === 'start' ? s.camera : s.cameraTo;
      if (!pose) continue;
      const issues = await poseIssues(i, end, pose, subject, probe);
      if (issues.length === 0) continue;
      let next: PoseLike = { position: [...pose.position], target: [...pose.target], ...(pose.fov !== undefined ? { fov: pose.fov } : {}) };
      if (issues.some((x) => x.kind === 'subject') && subject) {
        next = { ...next, target: round(subject) };
        fixed.push(`shot ${i + 1} (${end}): aimed at its subject again`);
      }
      if (!(await poseOk(next, probe))) {
        let found: PoseLike | null = null;
        for (const c of nudges(next)) {
          if (await poseOk(c, probe)) {
            found = c;
            break;
          }
        }
        if (found) {
          next = found;
          fixed.push(`shot ${i + 1} (${end}): moved the camera clear of geometry`);
        } else if (end === 'end') {
          delete s.cameraTo;
          fixed.push(`shot ${i + 1}: held instead of moving into geometry`);
          continue;
        } else {
          const own = ids[i] ? byId.get(ids[i] as string)?.pose : undefined;
          if (own && (await poseOk(own, probe))) {
            next = { position: [...own.position], target: [...own.target], ...(own.fov !== undefined ? { fov: own.fov } : {}) };
            delete s.cameraTo;
            fixed.push(`shot ${i + 1}: took its point's own camera`);
          } else {
            drop.push(i);
            fixed.push(`shot ${i + 1}: dropped (no clear camera near it)`);
            break;
          }
        }
      }
      if (end === 'start') s.camera = { ...s.camera, position: next.position, target: next.target };
      else if (s.cameraTo) s.cameraTo = { ...s.cameraTo, position: next.position, target: next.target };
    }
  }
  const keep = (i: number): boolean => !drop.includes(i) || story.shots.length - drop.length < 2;
  const shots = story.shots.filter((_, i) => keep(i));
  const subs = subjects.filter((_, i) => keep(i));
  if (shots.length > 0 && shots[0] && shots.length !== story.shots.length) shots[0] = { ...shots[0], transition: 'fade' };
  // A dropped first shot takes its title with it: the new first shot carries it.
  const title = story.shots[0]?.title;
  if (title && shots[0] && !shots[0].title) shots[0] = { ...shots[0], title, ...(story.shots[0]?.subtitle ? { subtitle: story.shots[0].subtitle } : {}) };
  const before = storyDuration({ shots });
  fitDurations(shots);
  if (Math.abs(storyDuration({ shots }) - before) > 0.5) fixed.push(`film fitted to ${storyDuration({ shots }).toFixed(0)} s`);
  const out = StorySchema.parse({ ...story, shots });
  return { story: out, subjects: subs, fixed, remaining: await checkStory(out, probe, subs) };
}
