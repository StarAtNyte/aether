/**
 * The pre-publish shot review: the frames a visitor meets (the opening view, a few frames of the film or the tour, the
 * play spawn), each rendered, measured and judged against a checklist, and the fixes the review may apply through the
 * world's own fields (a re-picked opening view, a moved, re-aimed or dropped shot, a shot's hour, the spawn's heading).
 *
 * Pure parts here (frames, the checklist, the judge's tool, measured evidence, applying a fix to a world); the loop that
 * renders, asks the model and re-checks is `director.ts`.
 */
import type { Patch, Story, Vec3, WorldDoc } from '@aether/core';
import { landmark } from '../hardcore';
import type { ToolDef } from '../types';
import type { PoseLike, PresentationViews } from './poi';

/** Kinds of frames the review looks at. */
export type FrameKind = 'opening' | 'story' | 'tour' | 'spawn' | 'detail';

/** One frame of the review. */
export interface ReviewFrame {
  name: string;
  label: string;
  kind: FrameKind;
  pose: PoseLike;
  /** Story frames: the shot; tour frames: the stop. */
  index?: number;
  /** Image aspect (width / height). */
  aspect: number;
}

export const CHECKS = ['framing', 'occluder', 'exposure', 'missing-geometry', 'spawn', 'lighting', 'sky', 'interpenetration', 'characters', 'scale', 'aerial', 'other'] as const;
export type ShotCheck = (typeof CHECKS)[number];
export const FIXES = ['none', 'repick-opening', 'pull-back', 'push-in', 'raise', 'lower', 'retarget', 'time-of-day', 'drop-shot', 'face-landmark'] as const;
export type ShotFix = (typeof FIXES)[number];

/** A problem the judge (or the measurements) found in a frame. */
export interface FrameIssue {
  frame: string;
  check: ShotCheck;
  note: string;
  fix: ShotFix;
  /** For `time-of-day`: the hour wanted. */
  hour?: number;
  /** For `retarget`: what to aim at, a point in the world. */
  at?: Vec3;
  /** Where the finding came from. */
  by: 'model' | 'measured' | 'probe';
}

/** The checklist the judge applies to every frame. */
export const SHOT_CHECKLIST = `Checklist for each frame (a visitor's first impressions of a published world):
1. framing: the subject (the place, the landmark, the person, the room) is clearly in frame and composed (not cut off at an edge, not a sliver of sky or floor, horizon not badly tilted, not aimed at nothing).
2. occluder: nothing near the lens blocks the view (a branch, a wall edge, a post, a railing, foliage filling a corner), and the camera is not inside a wall, a tree or the ground.
3. exposure: the frame is neither too dark to read nor blown out; for night, the subject is still lit.
4. missing-geometry: no holes, untextured grey blocks, floating or half-built pieces, the void past the world's edge, or obviously missing parts (a roof, a floor, ground under things).
5. spawn (the play spawn frame only): the character stands on the ground, in the open, facing somewhere worth going, not in a wall, not floating, not facing a wall.
6. lighting: the key light gives shape (not flat, not washed out), the subject is not a dark silhouette against a low sun, the shot is not a grey haze.
7. sky: clouds read as clouds of the world's style (no repeated "fish scale" lobes, no hard tiling, no band seams); a stylised (anime) world has painted cloud heads, a realistic one soft volumes.
8. interpenetration: no prop through a wall, no object floating or sunk into the ground, no clothes through a body.
9. characters (any person in frame): a rigged human of natural proportions (about 1.5 to 1.9 m), never a block, a capsule or a mannequin.
10. scale: doors about 2 m, stair risers 15 to 19 cm, handrails about 0.9 m: anything that looks the wrong size for a person.
11. aerial frames: the horizon is in frame, never straight down, and the edge of the terrain (land ending against the void) is never seen.
A "detail" frame is a close view of the landmark: look hardest there for missing geometry (pieces of a kit that vanished, holes, untextured parts).
For each problem pick the fix that would cure it: repick-opening (the opening frame only: choose another opening view), pull-back / push-in / raise / lower (move the camera), retarget (aim at "at", a world point you give), time-of-day (set "hour"), drop-shot (a film frame that cannot be saved), face-landmark (the spawn: turn the character toward the landmark), or none (report it; it needs the user).`;

export const REPORT_SHOTS_TOOL: ToolDef = {
  name: 'report_shots',
  description: 'Report the review of every frame: what is wrong by the checklist, and the fix for each problem. Frames with no problems get an empty issues list.',
  inputSchema: {
    type: 'object',
    properties: {
      frames: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            ok: { type: 'boolean' },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  check: { type: 'string', enum: [...CHECKS] },
                  note: { type: 'string' },
                  fix: { type: 'string', enum: [...FIXES] },
                  hour: { type: 'number' },
                  at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                },
                required: ['check', 'note', 'fix'],
              },
            },
          },
          required: ['name', 'ok', 'issues'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['frames', 'summary'],
    additionalProperties: false,
  },
};

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The pose of a story shot at fraction `t` of it. */
export function shotPose(shot: Story['shots'][number], t: number): PoseLike {
  const to = shot.cameraTo;
  if (!to) return { position: [...shot.camera.position], target: [...shot.camera.target], fov: shot.camera.fov ?? 50 };
  return { position: lerp3(shot.camera.position, to.position, t), target: lerp3(shot.camera.target, to.target, t), fov: (shot.camera.fov ?? 50) + ((to.fov ?? shot.camera.fov ?? 50) - (shot.camera.fov ?? 50)) * t };
}

/** The spawn's heading (degrees, 0 faces -Z, counter-clockwise from above) toward `at`. */
export function yawToward(from: Vec3, at: Vec3): number {
  const dx = at[0] - from[0];
  const dz = at[2] - from[2];
  return Math.round((Math.atan2(-dx, -dz) * 180) / Math.PI) || 0;
}

/** The forward direction of a heading (see {@link yawToward}). */
function forwardOf(yawDeg: number): Vec3 {
  const a = (yawDeg * Math.PI) / 180;
  return [-Math.sin(a), 0, -Math.cos(a)];
}

/** The follow camera at the play spawn (behind and above the character, looking where it faces). */
export function spawnPose(world: WorldDoc): PoseLike {
  const s = world.player.spawn;
  const mark = landmark(world);
  const yaw = world.player.yaw ?? (mark && Math.hypot(mark[0] - s[0], mark[2] - s[2]) > 2 ? yawToward(s, mark) : 0);
  const f = forwardOf(yaw);
  return { position: [s[0] - f[0] * 4.5, s[1] + 2.2, s[2] - f[2] * 4.5], target: [s[0] + f[0] * 8, s[1] + 0.9, s[2] + f[2] * 8], fov: 60 };
}

/** Story shots the review looks at: the opening shot, the subject or a middle one, the closing one (at most `max`). */
export function storyFrameIndices(story: Story, max = 3): number[] {
  const n = story.shots.length;
  const picks = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  return picks.slice(0, max);
}

/** The frames of the review of `world`. */
export function reviewFrames(world: WorldDoc, views: PresentationViews | null, opts: { maxStory?: number; maxTour?: number; detail?: boolean; walkLens?: number } = {}): ReviewFrame[] {
  const out: ReviewFrame[] = [];
  const opening = world.opening ?? views?.opening ?? null;
  // A building's opening is judged at the walk lens the visitor tours it with, not the load lens.
  if (opening) out.push({ name: 'opening', label: `the opening view (the first thing a visitor sees)${opts.walkLens ? `, at the ${opts.walkLens} degree walk lens` : ''}`, kind: 'opening', pose: { position: [...opening.position], target: [...opening.target], fov: opts.walkLens ?? opening.fov ?? 55 }, aspect: 16 / 9 });
  if (world.story) {
    for (const i of storyFrameIndices(world.story, opts.maxStory ?? 3)) {
      const shot = world.story.shots[i];
      if (!shot) continue;
      out.push({ name: `story-${i + 1}`, label: `film shot ${i + 1}${shot.name ? ` "${shot.name}"` : ''}, half way through its move`, kind: 'story', pose: shotPose(shot, 0.5), index: i, aspect: 2.39 });
    }
  } else {
    const stops = world.views ?? views?.stops ?? [];
    // The stop that is the opening view itself is not looked at twice.
    const same = (v: PoseLike): boolean => !!opening && Math.hypot(v.position[0] - opening.position[0], v.position[1] - opening.position[1], v.position[2] - opening.position[2]) < 0.5;
    stops
      .map((v, i) => ({ v, i }))
      .filter((x) => !same(x.v))
      .slice(0, opts.maxTour ?? 3)
      .forEach(({ v, i }) => out.push({ name: `tour-${i + 1}`, label: `tour stop ${i + 1}${v.name ? ` "${v.name}"` : ''}`, kind: 'tour', pose: { position: [...v.position], target: [...v.target], fov: v.fov ?? 55 }, index: i, aspect: 16 / 9 }),
      );
  }
  if (opts.detail !== false) {
    const mark = landmark(world);
    const from = opening?.position ?? world.player.spawn;
    if (mark) {
      const dx = from[0] - mark[0];
      const dz = from[2] - mark[2];
      const l = Math.hypot(dx, dz) || 1;
      const d = Math.min(9, Math.max(5, l * 0.3));
      out.push({ name: 'detail', label: 'a close view of the landmark (look for missing pieces and holes)', kind: 'detail', pose: { position: [mark[0] + (dx / l) * d, mark[1] + 1.2, mark[2] + (dz / l) * d], target: [...mark], fov: 45 }, aspect: 16 / 9 });
    }
  }
  out.push({ name: 'spawn', label: 'the play spawn: the follow camera behind the character as play starts', kind: 'spawn', pose: spawnPose(world), aspect: 16 / 9 });
  return out;
}

/** Luminance statistics of a frame. */
export interface FrameStats {
  dark: number;
  bright: number;
  mean: number;
  /** Luminance spread in the middle of the frame (a flat wall: near 0). */
  centre: number;
}

/** Statistics of RGBA pixels. */
export function frameStats(px: { width: number; height: number; data: ArrayLike<number> }): FrameStats | null {
  const { width: w, height: h, data } = px;
  if (w < 4 || h < 4 || data.length < w * h * 4) return null;
  let dark = 0;
  let bright = 0;
  let sum = 0;
  let cs = 0;
  let cs2 = 0;
  let cn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126 * (data[i] as number) + 0.7152 * (data[i + 1] as number) + 0.0722 * (data[i + 2] as number);
      sum += l;
      if (l < 12) dark++;
      if (l > 245) bright++;
      if (x >= w * 0.3 && x < w * 0.7 && y >= h * 0.3 && y < h * 0.7) {
        cs += l;
        cs2 += l * l;
        cn++;
      }
    }
  }
  const n = w * h;
  const cm = cs / Math.max(1, cn);
  return { dark: dark / n, bright: bright / n, mean: sum / n, centre: Math.sqrt(Math.max(0, cs2 / Math.max(1, cn) - cm * cm)) };
}

/** Problems the measurements alone show (evidence for the judge; the fixes without a model). */
export function measuredIssues(frame: ReviewFrame, st: FrameStats | null, probe: { near: number; underWater: boolean } | null): FrameIssue[] {
  const out: FrameIssue[] = [];
  const move: ShotFix = frame.kind === 'opening' ? 'repick-opening' : frame.kind === 'spawn' ? 'face-landmark' : frame.kind === 'detail' ? 'none' : 'pull-back';
  if (probe?.underWater) out.push({ frame: frame.name, check: 'occluder', note: 'the camera is under water', fix: frame.kind === 'spawn' ? 'none' : frame.kind === 'opening' ? move : 'raise', by: 'probe' });
  else if (probe && probe.near < 0.6) out.push({ frame: frame.name, check: 'occluder', note: `the camera is in or against geometry (${probe.near.toFixed(2)} m)`, fix: move, by: 'probe' });
  else if (probe && probe.near < 1.5 && frame.kind !== 'spawn') out.push({ frame: frame.name, check: 'occluder', note: `something ${probe.near.toFixed(1)} m from the lens`, fix: move, by: 'probe' });
  if (st) {
    if (st.dark > 0.45) out.push({ frame: frame.name, check: 'exposure', note: `${Math.round(st.dark * 100)}% of the frame is black`, fix: frame.kind === 'opening' ? 'repick-opening' : 'none', by: 'measured' });
    else if (st.bright > 0.35) out.push({ frame: frame.name, check: 'exposure', note: `${Math.round(st.bright * 100)}% of the frame is blown out`, fix: frame.kind === 'opening' ? 'repick-opening' : 'none', by: 'measured' });
    if (st.centre < 4 && st.dark <= 0.45) out.push({ frame: frame.name, check: 'framing', note: 'the middle of the frame is one flat tone (a wall, the sky or the ground fills it)', fix: move, by: 'measured' });
  }
  return out;
}

/** Valid issues from the judge's untrusted tool input. */
export function parseReport(input: unknown, frames: readonly ReviewFrame[]): { issues: FrameIssue[]; ok: string[]; summary: string } {
  const issues: FrameIssue[] = [];
  const ok: string[] = [];
  if (typeof input !== 'object' || input === null) return { issues, ok, summary: '' };
  const r = input as { frames?: unknown; summary?: unknown };
  const names = new Set(frames.map((f) => f.name));
  for (const f of Array.isArray(r.frames) ? r.frames.slice(0, 16) : []) {
    if (typeof f !== 'object' || f === null) continue;
    const fr = f as { name?: unknown; ok?: unknown; issues?: unknown };
    if (typeof fr.name !== 'string' || !names.has(fr.name)) continue;
    const list = Array.isArray(fr.issues) ? fr.issues.slice(0, 6) : [];
    if (list.length === 0) ok.push(fr.name);
    for (const x of list) {
      if (typeof x !== 'object' || x === null) continue;
      const it = x as Record<string, unknown>;
      const check = CHECKS.find((c) => c === it['check']) ?? 'other';
      const fix = FIXES.find((c) => c === it['fix']) ?? 'none';
      const note = typeof it['note'] === 'string' ? it['note'].slice(0, 240) : '';
      const hour = typeof it['hour'] === 'number' && it['hour'] >= 0 && it['hour'] <= 24 ? it['hour'] : undefined;
      const at = Array.isArray(it['at']) && it['at'].length === 3 && it['at'].every((v) => typeof v === 'number' && Number.isFinite(v)) ? (it['at'] as Vec3) : undefined;
      issues.push({ frame: fr.name, check, note, fix, by: 'model', ...(hour !== undefined ? { hour } : {}), ...(at ? { at } : {}) });
    }
  }
  return { issues, ok, summary: typeof r.summary === 'string' ? r.summary.slice(0, 600) : '' };
}

/** A camera moved by a fix (null: the fix does not move a camera). */
export function movedPose(pose: PoseLike, fix: ShotFix, at?: Vec3): PoseLike | null {
  const f: Vec3 = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
  const d = Math.hypot(f[0], f[1], f[2]) || 1;
  const u: Vec3 = [f[0] / d, f[1] / d, f[2] / d];
  const shift = (v: Vec3): PoseLike => ({ position: [pose.position[0] + v[0], pose.position[1] + v[1], pose.position[2] + v[2]], target: [...pose.target], ...(pose.fov !== undefined ? { fov: pose.fov } : {}) });
  const step = Math.max(2, Math.min(12, d * 0.25));
  switch (fix) {
    case 'pull-back':
      return shift([-u[0] * step, step * 0.25, -u[2] * step]);
    case 'push-in':
      return d > step + 2 ? shift([u[0] * step, 0, u[2] * step]) : null;
    case 'raise':
      return shift([0, Math.max(1.5, step * 0.5), 0]);
    case 'lower':
      return shift([0, -Math.max(1, step * 0.3), 0]);
    case 'retarget':
      return at ? { position: [...pose.position], target: [...at], ...(pose.fov !== undefined ? { fov: pose.fov } : {}) } : null;
    default:
      return null;
  }
}

/**
 * The patches applying `issue`'s fix to `world` (the frames as reviewed), or a reason it cannot be applied here. The
 * opening view's re-pick is the director's (it renders candidates), so it is not handled here.
 */
export function fixPatches(world: WorldDoc, frame: ReviewFrame, issue: FrameIssue, views: PresentationViews | null): { patches: Patch[]; done: string } | { reason: string } {
  const fix = issue.fix;
  if (fix === 'none') return { reason: 'needs the user' };
  if (frame.kind === 'story' && world.story && frame.index !== undefined) {
    const story: Story = structuredClone(world.story);
    const shot = story.shots[frame.index];
    if (!shot) return { reason: 'the shot is gone' };
    if (fix === 'drop-shot') {
      if (story.shots.length <= 2) return { reason: 'the film keeps at least two shots' };
      story.shots.splice(frame.index, 1);
      return { patches: [{ op: 'setMeta', story }], done: `dropped film shot ${frame.index + 1}` };
    }
    if (fix === 'time-of-day') {
      if (issue.hour === undefined) return { reason: 'no hour given' };
      shot.hour = Math.round(issue.hour * 10) / 10;
      return { patches: [{ op: 'setMeta', story }], done: `film shot ${frame.index + 1} at ${shot.hour} h` };
    }
    const a = movedPose(shot.camera, fix, issue.at);
    if (!a) return { reason: `${fix} does not apply to a film shot` };
    const dp: Vec3 = [a.position[0] - shot.camera.position[0], a.position[1] - shot.camera.position[1], a.position[2] - shot.camera.position[2]];
    shot.camera = { ...shot.camera, position: a.position, target: a.target };
    if (shot.cameraTo) {
      const to = shot.cameraTo;
      shot.cameraTo = fix === 'retarget' ? { ...to, target: a.target } : { ...to, position: [to.position[0] + dp[0], to.position[1] + dp[1], to.position[2] + dp[2]] };
    }
    return { patches: [{ op: 'setMeta', story }], done: `film shot ${frame.index + 1}: ${fix}` };
  }
  if (frame.kind === 'tour' && frame.index !== undefined) {
    const stops = (world.views ?? views?.stops ?? []).map((v) => ({ position: [...v.position] as Vec3, target: [...v.target] as Vec3, ...(v.fov !== undefined ? { fov: v.fov } : {}), ...(v.name !== undefined ? { name: v.name } : {}) }));
    const stop = stops[frame.index];
    if (!stop) return { reason: 'the stop is gone' };
    if (fix === 'drop-shot') {
      stops.splice(frame.index, 1);
      return { patches: [{ op: 'setMeta', views: stops.slice(0, 12) }], done: `dropped tour stop ${frame.index + 1}` };
    }
    if (fix === 'time-of-day') return issue.hour === undefined ? { reason: 'no hour given' } : { patches: [{ op: 'setEnvironment', set: { timeOfDay: Math.round(issue.hour * 10) / 10 } }], done: `time of day ${issue.hour} h` };
    const a = movedPose(stop, fix, issue.at);
    if (!a) return { reason: `${fix} does not apply to a tour stop` };
    stops[frame.index] = { ...stop, position: a.position, target: a.target };
    return { patches: [{ op: 'setMeta', views: stops.slice(0, 12) }], done: `tour stop ${frame.index + 1}: ${fix}` };
  }
  if (frame.kind === 'spawn') {
    if (fix === 'face-landmark') {
      const mark = landmark(world);
      if (!mark) return { reason: 'no landmark to face' };
      const yaw = yawToward(world.player.spawn, mark);
      if (yaw === world.player.yaw) return { reason: 'already faces the landmark' };
      return { patches: [{ op: 'setPlayer', set: { yaw } }], done: `the character starts facing the landmark (${yaw} degrees)` };
    }
    return { reason: 'the spawn itself needs the user (move it in the editor)' };
  }
  if (frame.kind === 'opening') {
    if (fix === 'time-of-day') return issue.hour === undefined ? { reason: 'no hour given' } : { patches: [{ op: 'setEnvironment', set: { timeOfDay: Math.round(issue.hour * 10) / 10 } }], done: `time of day ${issue.hour} h` };
    if (fix === 'repick-opening') return { reason: 'repick' };
    const a = movedPose(frame.pose, fix, issue.at);
    return a ? { patches: [{ op: 'setMeta', opening: { position: a.position, target: a.target, ...(a.fov !== undefined ? { fov: a.fov } : {}) } }], done: `opening view: ${fix}` } : { reason: 'repick' };
  }
  return { reason: 'not a fix for this frame' };
}
