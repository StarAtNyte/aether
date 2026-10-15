/**
 * Plan reveal: the floor plan is drawn in ink on paper, then the walls rise
 * out of it while the camera comes down from overhead to the three-quarter
 * view. This module is the pure part (unit-tested): the timeline, the ink
 * strokes of a plan with their lengths (so the drawing can be animated with
 * `stroke-dashoffset`), the section height of the rising walls and the camera
 * path. `engine/arch.ts` runs it against the renderer and `RevealOverlay`
 * draws the paper.
 */
import type { FloorPlan2d, P2 } from '@aether/arch';

/** Default length of the reveal in seconds. */
export const REVEAL_SECONDS = 7.5;

/** What each part of the reveal is doing at progress `t` in 0..1. */
export interface RevealPhase {
  /** Share of the ink lines drawn (0..1). */
  ink: number;
  /** Opacity of the paper overlay (1 while drawing, 0 once the 3D view takes over). */
  paper: number;
  /** Share of the full wall height reached (0..1). */
  rise: number;
  /** Share of the camera path travelled (0..1). */
  cam: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(x: number): number {
  const t = clamp01(x);
  return 1 - (1 - t) ** 3;
}

/** The reveal timeline: ink first, the paper dissolves into the rising walls, the camera settles last. */
export function revealPhase(t: number): RevealPhase {
  const p = Number.isFinite(t) ? clamp01(t) : 1;
  return {
    ink: smooth(p / 0.3),
    paper: 1 - smooth((p - 0.3) / 0.14),
    rise: easeOutCubic((p - 0.34) / 0.42),
    cam: smooth((p - 0.2) / 0.72),
  };
}

/** Section height (metres above the ground floor) of the rising walls, or null once they stand at full height. */
export function sectionHeightFor(rise: number, totalHeight: number): number | null {
  if (!Number.isFinite(rise) || !Number.isFinite(totalHeight) || totalHeight <= 0) return null;
  if (rise >= 0.999) return null;
  // Quantised so the walls are rebuilt about 24 times over the rise instead of every frame.
  const steps = 24;
  const q = Math.floor(clamp01(rise) * steps) / steps;
  return Math.max(0.12, q * (totalHeight + 0.6));
}

/** One ink stroke of the plan. */
export interface InkStroke {
  /** Points in plan metres. */
  pts: P2[];
  closed: boolean;
  /** Pen: heavy wall outline, medium opening line, fine furniture / room line. */
  weight: 'wall' | 'opening' | 'fine';
  /** When the stroke starts and ends within the ink phase (0..1). */
  from: number;
  to: number;
  /** Filled with ink (wall poché). */
  fill: boolean;
  /** Total length in plan metres (the dash length). */
  length: number;
}

/** A label of the plan. */
export interface InkLabel {
  at: P2;
  text: string;
  detail: string;
}

/** The ink drawing of one storey. */
export interface InkPlan {
  strokes: InkStroke[];
  labels: InkLabel[];
  /** [x0, z0, x1, z1] of the drawing in plan metres. */
  bounds: [number, number, number, number];
}

/** Hard cap on strokes (hostile or huge plans stay cheap to animate). */
export const MAX_INK_STROKES = 1500;

function pathLength(pts: readonly P2[], closed: boolean): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot((pts[i + 1] as P2)[0] - (pts[i] as P2)[0], (pts[i + 1] as P2)[1] - (pts[i] as P2)[1]);
  if (closed && pts.length > 2) len += Math.hypot((pts[0] as P2)[0] - (pts[pts.length - 1] as P2)[0], (pts[0] as P2)[1] - (pts[pts.length - 1] as P2)[1]);
  return len;
}

/** A text that is safe to draw (control characters removed, length capped). */
function clean(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Turn a floor plan into ink strokes: walls first (the architect's heavy
 * line), then the openings, then the furniture, with labels fading in last.
 * Strokes of one group start staggered so the pen seems to travel.
 */
export function inkPlan(plan: FloorPlan2d): InkPlan {
  const strokes: InkStroke[] = [];
  const add = (pts: P2[], closed: boolean, weight: InkStroke['weight'], from: number, to: number, fill = false): void => {
    if (strokes.length >= MAX_INK_STROKES || pts.length < 2) return;
    strokes.push({ pts, closed, weight, from, to, fill, length: pathLength(pts, closed) });
  };
  const stagger = (i: number, n: number, a: number, b: number, span: number): [number, number] => {
    const start = a + ((b - a - span) * i) / Math.max(1, n - 1);
    return [start, start + span];
  };
  let wallPieces = 0;
  for (const w of plan.walls) wallPieces += w.pieces.length;
  let k = 0;
  for (const w of plan.walls) {
    for (const piece of w.pieces) {
      const [from, to] = stagger(k++, wallPieces, 0, 0.62, 0.3);
      add(piece, true, 'wall', from, to, true);
    }
  }
  const openings = plan.doors.length + plan.windows.length;
  k = 0;
  for (const d of plan.doors) {
    const [from, to] = stagger(k++, openings, 0.5, 0.82, 0.18);
    if (d.kind === 'swing' && d.hinge && d.open) {
      add([d.hinge, d.open], false, 'opening', from, to);
      if (d.closed) {
        // Quarter-circle swing arc from the open leaf end to the closed end.
        const arc: P2[] = [];
        const steps = 10;
        const a0 = Math.atan2(d.open[1] - d.hinge[1], d.open[0] - d.hinge[0]);
        let a1 = Math.atan2(d.closed[1] - d.hinge[1], d.closed[0] - d.hinge[0]);
        let da = a1 - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        a1 = a0 + da;
        const r = Math.hypot(d.open[0] - d.hinge[0], d.open[1] - d.hinge[1]);
        for (let s = 0; s <= steps; s++) {
          const a = a0 + (da * s) / steps;
          arc.push([d.hinge[0] + Math.cos(a) * r, d.hinge[1] + Math.sin(a) * r]);
        }
        add(arc, false, 'fine', from, to);
      }
    } else add([d.a, d.b], false, 'opening', from, to);
  }
  for (const w of plan.windows) {
    const [from, to] = stagger(k++, openings, 0.5, 0.82, 0.18);
    const dx = w.b[0] - w.a[0];
    const dz = w.b[1] - w.a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (w.thickness / 4);
    const nz = (dx / l) * (w.thickness / 4);
    add([[w.a[0] + nx, w.a[1] + nz], [w.b[0] + nx, w.b[1] + nz]], false, 'opening', from, to);
    add([[w.a[0] - nx, w.a[1] - nz], [w.b[0] - nx, w.b[1] - nz]], false, 'opening', from, to);
  }
  k = 0;
  for (const item of plan.items) {
    const [from, to] = stagger(k++, plan.items.length, 0.6, 0.95, 0.16);
    add(item.polygon, true, 'fine', from, to);
  }
  for (const s of plan.stairs) {
    add(s.outline, true, 'wall', 0.55, 0.85);
    for (const [a, b] of s.treads) add([a, b], false, 'fine', 0.6, 0.9);
  }
  return {
    strokes,
    labels: plan.rooms.map((r) => ({ at: r.label, text: clean(r.name, 40), detail: `${r.area.toFixed(r.area >= 100 ? 0 : 1)} m²` })),
    bounds: [plan.bounds[0], plan.bounds[1], plan.bounds[2], plan.bounds[3]],
  };
}

/** Dash offset of a stroke at ink progress `ink` (0 = nothing drawn, 0 = fully drawn at `to`). */
export function strokeProgress(s: Pick<InkStroke, 'from' | 'to'>, ink: number): number {
  if (s.to <= s.from) return ink >= s.to ? 1 : 0;
  return clamp01((ink - s.from) / (s.to - s.from));
}

/** Camera path of the reveal around the building: spherical coordinates (elevation and azimuth in radians, distance in metres). */
export interface CameraArc {
  centre: [number, number, number];
  from: { elevation: number; azimuth: number; distance: number };
  to: { elevation: number; azimuth: number; distance: number };
}

/** The arc from an overhead view to the camera the editor had (`position` looking at `centre`). */
export function cameraArc(centre: readonly [number, number, number], position: readonly [number, number, number]): CameraArc {
  const dx = position[0] - centre[0];
  const dy = position[1] - centre[1];
  const dz = position[2] - centre[2];
  const distance = Math.max(2, Math.hypot(dx, dy, dz));
  const elevation = Math.max(0.2, Math.min(1.3, Math.asin(dy / distance)));
  const azimuth = Math.atan2(dx, dz);
  return {
    centre: [centre[0], centre[1], centre[2]],
    from: { elevation: 1.5, azimuth: azimuth + 0.55, distance: distance * 1.12 },
    to: { elevation, azimuth, distance },
  };
}

/** Eye position and look angles (yaw, pitch in radians; yaw 0 looks along −Z) at path fraction `f`. */
export function cameraAt(arc: CameraArc, f: number): { position: [number, number, number]; yaw: number; pitch: number } {
  const t = clamp01(f);
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  const e = lerp(arc.from.elevation, arc.to.elevation);
  const a = lerp(arc.from.azimuth, arc.to.azimuth);
  const d = lerp(arc.from.distance, arc.to.distance);
  const x = arc.centre[0] + Math.cos(e) * Math.sin(a) * d;
  const y = arc.centre[1] + Math.sin(e) * d;
  const z = arc.centre[2] + Math.cos(e) * Math.cos(a) * d;
  const dx = arc.centre[0] - x;
  const dy = arc.centre[1] - y;
  const dz = arc.centre[2] - z;
  return { position: [x, y, z], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
