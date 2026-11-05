/**
 * The opening view of a built world (`world.opening`): the editor opens close in, at eye height or a little above,
 * not on the far aerial overview. After a build the agent renders a few eye-level candidates (the street at eye
 * height from the hero shots, the visitor's arrival at the spawn, the same a little raised), judges the pictures
 * (never a camera in a wall, in the dark or in the sky) and stores the best one. Without a renderer nothing is stored
 * and the studio computes an opening view from the scene itself.
 */
import type { Patch, Vec3, WorldDoc } from '@aether/core';
import { heroShots, landmark } from './hardcore';
import type { ReviewViewRequest } from './types';

/** Field of view (vertical degrees) of the opening candidates. */
const OPENING_FOV = 55;
/** Image aspect of the candidates (the editor viewport). */
const OPENING_ASPECT = 16 / 9;

/** Downward pitch (radians) that puts a level horizon at the upper third of a frame of vertical field `fovDeg`. */
function horizonPitch(fovDeg: number): number {
  return -Math.atan(Math.tan((fovDeg * Math.PI) / 360) / 3);
}

function eyeView(name: string, label: string, eye: Vec3, at: Vec3): ReviewViewRequest | null {
  const dx = at[0] - eye[0];
  const dz = at[2] - eye[2];
  const flat = Math.hypot(dx, dz);
  if (!(flat > 4) || ![...eye, ...at].every(Number.isFinite)) return null;
  // Facing the landmark, the horizon in the upper third; bent up toward a landmark high above the eye.
  const toMark = Math.atan2(at[1] - eye[1], flat);
  // Never level or upward: the editor's orbit keeps the camera above the point it turns round.
  const pitch = Math.min(-0.035, Math.max(horizonPitch(OPENING_FOV), toMark));
  const target: Vec3 = [eye[0] + dx, eye[1] + Math.tan(pitch) * flat, eye[2] + dz];
  return { name, label, kind: 'exterior', pose: { position: eye, target, up: [0, 1, 0], fov: OPENING_FOV }, hideTops: false, aspect: OPENING_ASPECT, marks: [] };
}

/**
 * Eye-level candidates for the opening view (exact poses: `clear` is off, so the picture judged is the view stored).
 * Empty for a world with nothing built or with block terrain (its land is grown from a seed).
 */
export function openingCandidates(world: WorldDoc): ReviewViewRequest[] {
  if (world.voxel) return [];
  const shots = heroShots(world);
  if (shots.length === 0) return [];
  const mark = landmark(world);
  if (!mark) return [];
  const out: ReviewViewRequest[] = [];
  const street = shots.find((s) => s.name === 'hero-street');
  if (street) {
    const v = eyeView('opening-street', 'eye height in the street, toward the landmark', street.pose.position as Vec3, mark);
    if (v) out.push(v);
  }
  const s = world.player.spawn;
  // The spawn is where the player stands (about a metre over the ground): the eye, then a little raised.
  const arrive = eyeView('opening-arrival', 'where the visitor arrives, at eye height, toward the landmark', [s[0], s[1] + 0.7, s[2]], mark);
  if (arrive) out.push(arrive);
  const raised = eyeView('opening-raised', 'where the visitor arrives, a few metres up, toward the landmark', [s[0], s[1] + 4, s[2]], mark);
  if (raised) out.push(raised);
  // Part way from the arrival to the landmark, over the spawn's height (a square or a terrace on the way).
  const mid: Vec3 = [s[0] + (mark[0] - s[0]) * 0.4, s[1] + 2.5, s[2] + (mark[2] - s[2]) * 0.4];
  const way = eyeView('opening-approach', 'on the way to the landmark, a little raised', mid, mark);
  if (way) out.push(way);
  return out;
}

/**
 * How good a candidate picture is as a first view (higher is better), or null when it must not be used: blank, mostly
 * black (a camera in a wall or under the ground), washed out (in the sky or the sun), or a flat wall filling the middle.
 * `data` is RGBA at `width` × `height`.
 */
export function openingPictureScore(px: { width: number; height: number; data: ArrayLike<number> }): number | null {
  const { width: w, height: h, data } = px;
  if (w < 8 || h < 8 || data.length < w * h * 4) return null;
  const luma = new Float32Array(w * h);
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < w * h; i++) {
    const l = 0.2126 * (data[i * 4] as number) + 0.7152 * (data[i * 4 + 1] as number) + 0.0722 * (data[i * 4 + 2] as number);
    luma[i] = l;
    if (l < 10) dark++;
    if (l > 245) bright++;
  }
  if (dark / (w * h) > 0.25 || bright / (w * h) > 0.3) return null;
  // Detail below the horizon (the lower two thirds): mean gradient and spread of the luminance.
  let grad = 0;
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = Math.floor(h / 3); y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const l = luma[y * w + x] as number;
      grad += Math.abs(l - (luma[y * w + x + 1] as number)) + Math.abs(l - (luma[(y + 1) * w + x] as number));
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  if (n === 0) return null;
  const mean = sum / n;
  const spread = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  // The middle of the frame: a flat wall a metre ahead is one even tone there.
  let cs = 0;
  let cs2 = 0;
  let cn = 0;
  for (let y = Math.floor(h * 0.3); y < Math.ceil(h * 0.7); y++) {
    for (let x = Math.floor(w * 0.3); x < Math.ceil(w * 0.7); x++) {
      const l = luma[y * w + x] as number;
      cs += l;
      cs2 += l * l;
      cn++;
    }
  }
  const cm = cs / Math.max(1, cn);
  const centre = Math.sqrt(Math.max(0, cs2 / Math.max(1, cn) - cm * cm));
  if (centre < 5) return null;
  return grad / n + spread * 0.3 + Math.min(centre, 40) * 0.2;
}

/** The patch storing a candidate as the opening view. */
export function openingPatch(view: ReviewViewRequest): Patch {
  const p = view.pose;
  return { op: 'setMeta', opening: { position: [...p.position], target: [...p.target], fov: p.fov } };
}

/** Whether a run built a world new enough to choose its opening view: nothing was there, or most of it is new. */
export function wantsOpening(start: WorldDoc, world: WorldDoc): boolean {
  if (world.opening || world.voxel) return false;
  const now = Object.keys(world.entities);
  if (now.length === 0) return false;
  const before = new Set(Object.keys(start.entities));
  if (before.size === 0) return true;
  let fresh = 0;
  for (const id of now) if (!before.has(id)) fresh++;
  return fresh >= now.length * 0.5;
}
