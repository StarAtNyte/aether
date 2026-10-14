/**
 * Pure helpers of the 2D floor-plan view: fitting and zooming the plan
 * camera (metres ↔ pixels), room colours per type, label text, and the
 * drawing tool's preview geometry. No DOM.
 */
import type { P2 } from '@aether/arch';

/** Plan camera: the plan point at the view centre and the zoom in pixels per metre. */
export interface PlanCamera {
  cx: number;
  cz: number;
  /** Pixels per metre. */
  scale: number;
}

/** Zoom limits (pixels per metre). */
export const PLAN_ZOOM: readonly [number, number] = Object.freeze([6, 400]) as readonly [number, number];

/** Camera that fits plan bounds `[x0, z0, x1, z1]` into a `width`×`height` px view with `margin` px around. */
export function fitPlan(bounds: readonly [number, number, number, number], width: number, height: number, margin = 64): PlanCamera {
  const [x0, z0, x1, z1] = bounds;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, z1 - z0);
  const vw = Math.max(1, width - 2 * margin);
  const vh = Math.max(1, height - 2 * margin);
  const scale = clampZoom(Math.min(vw / w, vh / h));
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, scale };
}

/** Clamp a zoom to {@link PLAN_ZOOM}. */
export function clampZoom(scale: number): number {
  return Number.isFinite(scale) ? Math.max(PLAN_ZOOM[0], Math.min(PLAN_ZOOM[1], scale)) : PLAN_ZOOM[0];
}

/** The SVG viewBox `[x, y, w, h]` (plan metres) of a camera in a `width`×`height` px view. */
export function viewBox(cam: PlanCamera, width: number, height: number): [number, number, number, number] {
  const w = Math.max(1, width) / cam.scale;
  const h = Math.max(1, height) / cam.scale;
  return [cam.cx - w / 2, cam.cz - h / 2, w, h];
}

/** Zoom by `factor` keeping the plan point under the pixel (`px`, `py`) fixed. */
export function zoomAt(cam: PlanCamera, factor: number, px: number, py: number, width: number, height: number): PlanCamera {
  const scale = clampZoom(cam.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1));
  // Plan point under the cursor before the zoom.
  const mx = cam.cx + (px - width / 2) / cam.scale;
  const mz = cam.cz + (py - height / 2) / cam.scale;
  return { scale, cx: mx - (px - width / 2) / scale, cz: mz - (py - height / 2) / scale };
}

/** Pan by a pixel delta. */
export function panBy(cam: PlanCamera, dx: number, dy: number): PlanCamera {
  return { ...cam, cx: cam.cx - dx / cam.scale, cz: cam.cz - dy / cam.scale };
}

/** Room fill and label-dot colours per room type (muted fills, saturated dots). */
const ROOM_COLORS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  living: ['#f3ece0', '#d08a3c'],
  dining: ['#f3eadf', '#c9772f'],
  kitchen: ['#e9efe2', '#6f9a4b'],
  bedroom: ['#e6ecf4', '#5b7fb5'],
  kids: ['#efe8f4', '#9a6bbf'],
  bathroom: ['#e2eff1', '#3f9aa6'],
  office: ['#ece9f5', '#7465b8'],
  'open-office': ['#ece9f5', '#7465b8'],
  meeting: ['#f2e8ec', '#b45f7c'],
  cafe: ['#f4ebe2', '#b26b3c'],
  hall: ['#efeeec', '#8a8780'],
  entry: ['#efeeec', '#8a8780'],
  lobby: ['#efeeec', '#8a8780'],
  storage: ['#eceae6', '#7d786f'],
  laundry: ['#e7eef0', '#5f8d99'],
  terrace: ['#ebe7de', '#9c8c6d'],
  garage: ['#e9e9e9', '#6f6f6f'],
  studio: ['#f1ebe2', '#c27c3e'],
});

/** `[fill, dot]` colours of a room type. */
export function roomColors(kind: string): readonly [string, string] {
  return ROOM_COLORS[kind] ?? ['#eeedea', '#8a8780'];
}

/** Area label ("18.4 m²"). */
export function areaLabel(m2: number): string {
  return `${Number.isFinite(m2) ? (m2 >= 100 ? Math.round(m2) : Math.round(m2 * 10) / 10) : 0} m²`;
}

/** Length label of a drawn edge ("3.45 m"). */
export function lengthLabel(m: number): string {
  return `${(Number.isFinite(m) ? m : 0).toFixed(2)} m`;
}

/** Outline of a rectangle dragged from `a` to `b` (empty when thinner than 0.3 m). */
export function dragRect(a: P2, b: P2): P2[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]);
  const z1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 0.3 || z1 - z0 < 0.3) return [];
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/** Shoelace area of an outline (m², absolute). */
export function outlineArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as P2;
    const q = poly[(i + 1) % poly.length] as P2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** True when `p` closes a polygon being drawn (near its first point, three or more points placed). */
export function closesPolygon(points: readonly P2[], p: P2, reach = 0.25): boolean {
  const first = points[0];
  return points.length >= 3 && first !== undefined && Math.hypot(first[0] - p[0], first[1] - p[1]) <= reach;
}

/** SVG path data of a polyline / polygon. */
export function pathOf(points: readonly P2[], closed: boolean): string {
  if (points.length === 0) return '';
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p[0])} ${round(p[1])}`).join(' ');
  return closed ? `${d} Z` : d;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
