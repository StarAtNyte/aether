/**
 * Framing: does the built room put things where the photograph does?
 *
 * The vision model says where each piece and opening APPEARS in the photo (a box in image coordinates). The built
 * room projects its own pieces through a camera; the difference between the two boxes is measurable without any
 * model. Two uses:
 * - calibration: the camera the model reported is only an estimate, so it is refined (position, heading, pitch,
 *   field of view, height) to minimise the boxes' disagreement. A room with the right layout then frames like the
 *   photo; one with a wrong layout keeps large residuals, which say exactly which pieces are off.
 * - an objective score for the compare loop that, unlike a pixel similarity, does not care about lighting.
 */
import type { EntityId } from '@aether/core';
import { customPose, entityGeometry, projectGeometry, type EntityGeometry, type ImageBox, type ReviewPose } from '../scene/views';
import { verticalFov } from './camera';
import type { PhotoCamera, RoomDescription } from './description';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID } from './derive';

/** Something the photo shows at a known place in the image. */
export interface FramingTarget {
  /** Handle shown to the model (item or opening id). */
  label: string;
  /** Entity ids whose boxes are united (curtains: both panels). */
  ids: EntityId[];
  box: ImageBox;
}

/** Targets of a description: every visible piece and opening that has a box. `built` maps plan opening ids to built ids. */
export function framingTargets(d: RoomDescription, built: Readonly<Record<string, string>>): FramingTarget[] {
  const out: FramingTarget[] = [];
  for (const o of d.openings) {
    const id = built[o.id];
    if (o.visible && o.box && id) out.push({ label: o.id, ids: [id], box: o.box });
  }
  for (const it of d.items) {
    if (!it.visible || !it.box) continue;
    const base = `${PHOTO_BUILDING_ID}-${it.id}`;
    out.push({ label: it.id, ids: it.kind === 'curtain' ? [`${base}-l`, `${base}-r`] : [base], box: it.box });
  }
  return out;
}

/** How one target compares. */
export interface FramingRow {
  label: string;
  /** 0 (same box) .. 1 (nothing alike, or not visible at all). */
  error: number;
  want: ImageBox;
  got: ImageBox | null;
}

/** The framing of a room against its photo. */
export interface FramingReport {
  /** 1 - mean error (1: every box matches). */
  score: number;
  rows: FramingRow[];
  /** What the fit itself saw (the camera against a limit): evidence for the model, never a verdict. */
  notes?: string[];
}

function union(boxes: readonly ImageBox[]): ImageBox | null {
  if (boxes.length === 0) return null;
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}

/** Error of one box against the wanted one: mean absolute edge offset, doubled and capped at 1. */
export function boxError(want: ImageBox, got: ImageBox | null): number {
  if (!got) return 1;
  const e = (Math.abs(want[0] - got[0]) + Math.abs(want[1] - got[1]) + Math.abs(want[2] - got[2]) + Math.abs(want[3] - got[3])) / 4;
  return Math.min(1, e * 2);
}

/** Framing of precomputed geometry seen through `pose`. */
export function framingOf(geometry: readonly EntityGeometry[], targets: readonly FramingTarget[], pose: ReviewPose, aspect: number): FramingReport {
  const boxes = projectGeometry(geometry, pose, aspect);
  const rows: FramingRow[] = targets.map((t) => {
    const got = union(t.ids.map((id) => boxes.get(id)).filter((b): b is ImageBox => b !== undefined));
    return { label: t.label, error: boxError(t.box, got), want: t.box, got };
  });
  return { score: rows.length === 0 ? 1 : 1 - rows.reduce((s, r) => s + r.error, 0) / rows.length, rows };
}

/** Result of {@link calibrateCamera}. */
export interface Calibration {
  camera: PhotoCamera;
  before: FramingReport;
  after: FramingReport;
  /** The refined camera is clearly better than the reported one and replaces it. */
  improved: boolean;
}

/** Fewest targets that make a fit meaningful (a camera has six degrees of freedom). */
export const MIN_FRAMING_TARGETS = 4;

/** Deterministic pseudo-random numbers (the fit must give the same answer for the same room). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Params = [number, number, number, number, number, number];

/**
 * Refine the photo's camera so the built room frames like the photo. A pattern search from the reported camera and
 * from perturbations of it (deterministic), bounded to plausible cameras inside the room, with a small pull toward
 * the reported values so a few targets cannot send the camera anywhere odd. Returns null when there are too few
 * targets or the room cannot be read.
 */
export function calibrateCamera(world: Parameters<typeof entityGeometry>[0], d: RoomDescription, aspect: number, targets: readonly FramingTarget[]): Calibration | null {
  if (targets.length < MIN_FRAMING_TARGETS) return null;
  const geometry = entityGeometry(world, PHOTO_BUILDING_ID);
  if (geometry.length === 0) return null;
  const W = d.footprint.width;
  const D = d.footprint.depth;
  const c0 = d.camera;
  const start: Params = [c0.x, c0.z, c0.heading, c0.pitch, c0.fov, c0.height];
  const lo: Params = [0.15, 0.15, c0.heading - 50, -14, Math.max(45, c0.fov - 30), 0.9];
  const hi: Params = [W - 0.15, D - 0.15, c0.heading + 50, 14, Math.min(115, c0.fov + 30), Math.min(2.1, d.footprint.ceiling - 0.3)];
  const scale: Params = [W, D, 60, 14, 40, 1];
  const poseOf = (p: Params): ReviewPose | null =>
    customPose(world, PHOTO_BUILDING_ID, { name: 'fit', label: 'fit', room: PHOTO_ROOM_ID, at: [p[0], p[1]], height: p[5], heading: p[2], pitch: p[3], fov: verticalFov(p[4], aspect) });
  const cost = (p: Params): number => {
    const pose = poseOf(p);
    if (!pose) return 9;
    const r = framingOf(geometry, targets, pose, aspect);
    let pull = 0;
    for (let i = 0; i < 6; i++) pull += (((p[i] as number) - (start[i] as number)) / (scale[i] as number)) ** 2;
    return 1 - r.score + 0.02 * pull;
  };
  const clamp = (p: Params): Params => p.map((v, i) => Math.max(lo[i] as number, Math.min(hi[i] as number, v))) as Params;
  const refine = (from: Params): { p: Params; c: number } => {
    let p = clamp(from);
    let c = cost(p);
    const step: Params = [0.4, 0.4, 8, 3, 6, 0.15];
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < 6; i++) {
        for (const dir of [1, -1]) {
          const q = [...p] as Params;
          q[i] = (q[i] as number) + dir * (step[i] as number);
          const cq = clamp(q);
          const cc = cost(cq);
          if (cc < c - 1e-6) {
            p = cq;
            c = cc;
            moved = true;
          }
        }
      }
      if (!moved) {
        for (let i = 0; i < 6; i++) step[i] = (step[i] as number) / 2;
        if ((step[0] as number) < 0.01) break;
      }
    }
    return { p, c };
  };
  const rand = rng(1234567);
  let best = refine(start);
  for (let k = 0; k < 24; k++) {
    const jitter = start.map((v, i) => v + (rand() - 0.5) * 2 * (scale[i] as number) * 0.25) as Params;
    const r = refine(jitter);
    if (r.c < best.c) best = r;
  }
  const poseBefore = poseOf(start);
  const poseAfter = poseOf(best.p);
  if (!poseBefore || !poseAfter) return null;
  const before = framingOf(geometry, targets, poseBefore, aspect);
  const after = framingOf(geometry, targets, poseAfter, aspect);
  const pinned: string[] = [];
  const near = (v: number, b: number): boolean => Math.abs(v - b) < 0.03;
  if (near(best.p[0], lo[0]) || near(best.p[0], hi[0]) || near(best.p[1], lo[1]) || near(best.p[1], hi[1])) {
    pinned.push('The fitted camera stands against a wall of the room (it cannot go further back inside it): the photo was probably taken from further back, from a doorway or past the room, or the room is deeper or wider than described. Check the room size before moving single pieces.');
  }
  if (near(best.p[4], lo[4]) || near(best.p[4], hi[4])) pinned.push(`The fitted field of view hit its limit (${round(best.p[4], 0)} degrees): the camera or the room size is off.`);
  if (pinned.length > 0) {
    after.notes = pinned;
    before.notes = pinned;
  }
  const camera: PhotoCamera = { x: round(best.p[0], 2), z: round(best.p[1], 2), heading: round(best.p[2], 1), pitch: round(best.p[3], 1), fov: round(best.p[4], 1), height: round(best.p[5], 2) };
  return { camera, before, after, improved: after.score > before.score + 0.03 };
}

function round(v: number, n: number): number {
  const m = 10 ** n;
  return Math.round(v * m) / m;
}

/**
 * How the boxes of the photo differ in scale from the render's, as words for the model (null when they agree). Taller in the
 * photo than in the render while no wider means the room is probably taller (or narrower) than described: the vertical
 * proportions of a room (ceiling, window and door heights) are what a model reads worst from a flat picture.
 */
export function scaleAdvice(r: FramingReport): string | null {
  const hs: number[] = [];
  const ws: number[] = [];
  for (const x of r.rows) {
    if (!x.got) continue;
    const wh = x.want[3] - x.want[1];
    const gh = x.got[3] - x.got[1];
    const ww = x.want[2] - x.want[0];
    const gw = x.got[2] - x.got[0];
    // Boxes cut by the picture's frame say little about size.
    if (x.want[0] <= 0.005 || x.want[1] <= 0.005 || x.want[2] >= 0.995 || x.want[3] >= 0.995) continue;
    if (wh > 0.04 && gh > 0.02) hs.push(wh / gh);
    if (ww > 0.04 && gw > 0.02) ws.push(ww / gw);
  }
  if (hs.length < 3 || ws.length < 3) return null;
  const med = (a: number[]): number => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] as number;
  const h = med(hs);
  const w = med(ws);
  const rel = h / w;
  if (rel > 1.25) return `Scale: the pieces are about ${rel.toFixed(1)}x taller in the photo than in the render compared with their width (median over ${hs.length} pieces). The room is probably taller than described, or narrower: check the ceiling height and the heights of windows, doors and tall pieces, and say what you change.`;
  if (rel < 0.8) return `Scale: the pieces are about ${(1 / rel).toFixed(1)}x wider in the photo than in the render compared with their height (median over ${hs.length} pieces). The room is probably lower or wider than described: check the ceiling height and the widths.`;
  return null;
}

/** Plain-text lines for the model: the worst boxes, where the photo has them and where the render does. */
export function framingText(r: FramingReport, limit = 8): string {
  const pct = (b: ImageBox): string => `x ${Math.round(b[0] * 100)}–${Math.round(b[2] * 100)}%, y ${Math.round(b[1] * 100)}–${Math.round(b[3] * 100)}%`;
  const extra = [...(scaleAdvice(r) ? [scaleAdvice(r) as string] : []), ...(r.notes ?? [])];
  const worst = r.rows.filter((x) => x.error > 0.12).sort((a, b) => b.error - a.error).slice(0, limit);
  if (worst.length === 0) return [`Framing: everything the photo shows is where the photo has it (score ${Math.round(r.score * 100)}%).`, ...extra].join('\n');
  return [
    `Framing score ${Math.round(r.score * 100)}% (the camera is fitted as well as it can be to where the photo shows things; what is left is a piece in the wrong place or of the wrong size, or the room itself). Worst, as image boxes (% of the picture width and height):`,
    ...worst.map((x) => `- ${x.label}: photo ${pct(x.want)}; render ${x.got ? pct(x.got) : 'not in the picture'}`),
    ...extra,
  ].join('\n');
}
