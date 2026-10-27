/**
 * The room box from several INDEPENDENT estimators, fused by agreement. A single depth network cannot say how big a room is: its
 * scale is off by 15 to 25 percent on some photos, the field of view is only loosely fixed by depth alone, and furniture can stand in
 * for a wall. So the box is read several ways and the median is taken; the spread between the estimators is the confidence:
 *   - metric depth, camera and axes from VANISHING POINTS (image line segments, manhattan.ts), floor offset and walls from the
 *     cloud, with detected-object pixels left out of the wall fit;
 *   - the same geometry with the scale set by a ceiling of the usual height (2.4 to 2.7 m);
 *   - relative depth with the same vanishing-point camera and a door or ceiling anchor (depth.ts);
 *   - the older swept-field-of-view metric fit (roomgeometry.ts);
 *   - the older relative-depth estimate with a door anchor (the cross-check).
 * An estimator whose camera height or room height is not plausible (a person's eye is 0.9 to 2.1 m up, rooms are 2.2 to 3.8 m tall)
 * is dropped and named. Width is reported as a lower bound when the side walls are not both in the frame. Pure arithmetic.
 */
import { estimateRoomFromDepth, type DisparityMap, type DepthAnchor } from './depth';
import type { ManhattanCamera } from './manhattan';
import { cloudOf, makeCam, roomBoxOf, type Cloud, type DepthGrid, type Dim, type RoomBox, type RoomFrame } from './roomgeometry';

export interface EstimatorResult {
  name: string;
  /** One vote per family: estimators that read the same depth the same way are not independent. */
  family: 'metric' | 'vp-relative' | 'relative';
  width: number;
  depth: number;
  height: number;
  /** The width is only the visible span (a side wall is out of frame). */
  widthLowerBound: boolean;
  cameraHeight: number | null;
  /** Why it was dropped, or null when it counts. */
  rejected: string | null;
}

export interface EnsembleRoom {
  width: Dim;
  depth: Dim;
  height: Dim;
  estimators: EstimatorResult[];
  /** The vanishing-point camera that the vp estimators used. */
  vp: ManhattanCamera | null;
  /** The metric box of the vanishing-point estimator (walls as lines, for placing objects), or null. */
  vpBox: { box: RoomBox; frame: RoomFrame; cloud: Cloud; grid: DepthGrid; cam: ReturnType<typeof makeCam> } | null;
  notes: string[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const pct = (v: number[], p: number): number => {
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] as number;
};
/** Floor-to-ceiling guesses (metres) when no door anchors the scale: the middle of ordinary rooms, 2.5 to 2.7 m. */
export const ENSEMBLE_CEILINGS = [2.5, 2.6, 2.7];
export const PLAUSIBLE = { cameraHeight: [0.7, 2.2], height: [2.2, 3.8] } as const;

function scaleDepth(g: DepthGrid, k: number): DepthGrid {
  const out = new Float32Array(g.width * g.height);
  for (let i = 0; i < out.length; i++) out[i] = (g.data[i] as number) * k;
  return { width: g.width, height: g.height, data: out };
}

/** Height of the floor below the camera along `up`: the strongest peak of the lower picture's heights (4 cm bins). */
function floorOffset(cloud: Cloud, up: [number, number, number], vMin: number, notFloor?: boolean[]): number | null {
  const hs: number[] = [];
  cloud.p.forEach((p, i) => {
    if ((cloud.v[i] as number) < vMin || notFloor?.[i]) return;
    hs.push(p[0] * up[0] + p[1] * up[1] + p[2] * up[2]);
  });
  if (hs.length < 40) return null;
  const lo = pct(hs, 0.02);
  const hi = pct(hs, 0.9);
  const bin = 0.04;
  const nb = Math.max(2, Math.ceil((hi - lo) / bin) + 1);
  const h = new Array(nb).fill(0) as number[];
  for (const x of hs) if (x >= lo && x <= hi) { const k = Math.min(nb - 1, Math.floor((x - lo) / bin)); h[k] = (h[k] as number) + 1; }
  const sm = h.map((_, i) => (h[i - 1] ?? 0) + (h[i] as number) + (h[i + 1] ?? 0));
  // the floor is the lowest strong peak (a bed top is a peak above it)
  const mx = Math.max(...sm);
  const i = sm.findIndex((v, k) => v >= mx * 0.2 && v >= (sm[k - 1] ?? 0) && v >= (sm[k + 1] ?? 0));
  return lo + (i + 0.5) * bin;
}

/** How far a typical hand-held eye height pulls the metric scale: `heightM` is the usual eye height, `weight` the share of the log correction applied (0 off, 1 full). */
export interface EyePrior { heightM: number; weight: number; maxScale: number }
export const EYE_PRIOR: EyePrior = { heightM: 1.5, weight: 0.6, maxScale: 1.4 };

/** One metric box from a vanishing-point camera: axes fixed, floor offset and walls read from the cloud. */
export function boxFromVP(grid: DepthGrid, vp: ManhattanCamera, opt: { notWall?: ArrayLike<number>; trainedFovDeg?: number | null; standoff?: number; eyePrior?: EyePrior | null } = {}): { box: RoomBox; frame: RoomFrame; cloud: Cloud; grid: DepthGrid; cam: ReturnType<typeof makeCam> } | null {
  const cam = makeCam(grid, vp.fovDeg, 'z');
  let g = opt.trainedFovDeg ? scaleDepth(grid, Math.tan((opt.trainedFovDeg * Math.PI) / 360) / Math.tan((vp.fovDeg * Math.PI) / 360)) : grid;
  let cloud = cloudOf(g, cam);
  const notWall = opt.notWall ? cloud.p.map((_, i) => !!opt.notWall![(cloud.v[i] as number) * grid.width + (cloud.u[i] as number)]) : undefined;
  const up = vp.axes.up;
  let off = floorOffset(cloud, up, grid.height * 0.45, notWall);
  if (off === null) return null;
  // Metric depth reads 10 to 20 percent short on many photos while a hand-held eye is 1.4 to 1.7 m up: pull the scale toward
  // that (a geometric blend, weight `eyePrior.weight`, bounded) so every length follows the same correction.
  const prior = opt.eyePrior === undefined ? EYE_PRIOR : opt.eyePrior;
  if (prior && Math.abs(off) > 0.3) {
    const k = Math.min(prior.maxScale, Math.max(1 / prior.maxScale, (prior.heightM / Math.abs(off)) ** prior.weight));
    g = scaleDepth(g, k);
    cloud = cloudOf(g, cam);
    off *= k;
  }
  const frame: RoomFrame = {
    up,
    right: vp.axes.across,
    forward: vp.axes.depth,
    cameraHeight: Math.abs(off),
    floor: { n: up, d: off, inliers: 0, support: 0 },
  };
  const box = roomBoxOf(cloud, frame, { fixedPhi: 0, ...(notWall ? { notWall } : {}), ...(opt.standoff !== undefined ? { standoff: opt.standoff } : {}) });
  return { box, frame, cloud, grid: g, cam };
}

function fuse(values: number[], pick: (v: number) => boolean = () => true): { value: number; spread: number; n: number } | null {
  const v = values.filter((x) => Number.isFinite(x) && pick(x));
  if (v.length === 0) return null;
  const m = pct(v, 0.5);
  return { value: m, spread: v.length > 1 ? (Math.max(...v) - Math.min(...v)) / Math.max(0.1, m) : 1, n: v.length };
}

export interface EnsembleInput {
  /** Metric depth (metres) at a working resolution. */
  metric: DepthGrid | null;
  /** Relative inverse depth map (larger = nearer). */
  relative: DisparityMap | null;
  vp: ManhattanCamera | null;
  /** 1 where an object (not wall) is. Same grid as `metric`. */
  notWall?: ArrayLike<number>;
  /** A door or other thing of known size, for the relative-depth scale. */
  anchor?: DepthAnchor | undefined;
  /** The older swept estimators, already run by the caller. */
  legacyMetric?: { box: RoomBox } | null;
  trainedFovDeg?: number | null;
}

export function estimateRoomEnsemble(inp: EnsembleInput): EnsembleRoom | null {
  const out: EstimatorResult[] = [];
  const notes: string[] = [];
  let vpBox: EnsembleRoom['vpBox'] = null;
  const check = (e: Omit<EstimatorResult, 'rejected' | 'family'>): void => {
    const family: EstimatorResult['family'] = /^vp-relative/.test(e.name) ? 'vp-relative' : /relative/.test(e.name) ? 'relative' : 'metric';
    let rejected: string | null = null;
    if (e.cameraHeight !== null && (e.cameraHeight < PLAUSIBLE.cameraHeight[0] || e.cameraHeight > PLAUSIBLE.cameraHeight[1])) rejected = `camera height ${r2(e.cameraHeight)} m is not plausible`;
    else if (e.height < PLAUSIBLE.height[0] || e.height > PLAUSIBLE.height[1]) rejected = `room height ${r2(e.height)} m is not plausible`;
    else if (e.width < 1.2 || e.depth < 1.2) rejected = 'a dimension under 1.2 m';
    out.push({ ...e, family, rejected });
  };
  if (inp.metric && inp.vp) {
    const b = boxFromVP(inp.metric, inp.vp, { ...(inp.notWall ? { notWall: inp.notWall } : {}), ...(inp.trainedFovDeg === undefined ? { trainedFovDeg: 60 } : { trainedFovDeg: inp.trainedFovDeg }) });
    if (b) {
      vpBox = b;
      const bx = b.box;
      const lb = !(bx.walls.left && bx.walls.right);
      check({ name: 'vp-metric', width: bx.width.value, depth: bx.depth.value, height: bx.height.value, widthLowerBound: lb, cameraHeight: bx.cameraHeight });
      // The same geometry with the scale set by an ordinary ceiling: every length scales together.
      if (bx.walls.ceiling && bx.height.value > 0.5) {
        const s = 2.55 / bx.height.value;
        check({ name: 'vp-metric-ceiling-scaled', width: bx.width.value * s, depth: bx.depth.value * s, height: 2.55, widthLowerBound: lb, cameraHeight: bx.cameraHeight * s });
      }
    }
  }
  if (inp.relative && inp.vp) {
    const e = estimateRoomFromDepth(inp.relative, { fovs: [inp.vp.fovDeg], ceilings: ENSEMBLE_CEILINGS, ...(inp.anchor ? { anchor: inp.anchor } : {}) });
    if (e) check({ name: inp.anchor ? 'vp-relative-door' : 'vp-relative-ceiling', width: e.width.value, depth: e.depth.value, height: e.height.value, widthLowerBound: true, cameraHeight: null });
  }
  if (inp.relative) {
    const e = estimateRoomFromDepth(inp.relative, inp.anchor ? { anchor: inp.anchor } : { ceilings: ENSEMBLE_CEILINGS });
    if (e) check({ name: inp.anchor ? 'relative-door' : 'relative-ceiling', width: e.width.value, depth: e.depth.value, height: e.height.value, widthLowerBound: true, cameraHeight: null });
  }
  if (inp.legacyMetric) {
    const bx = inp.legacyMetric.box;
    check({ name: 'metric-swept-fov', width: bx.width.value, depth: bx.depth.value, height: bx.height.value, widthLowerBound: !(bx.walls.left && bx.walls.right), cameraHeight: bx.cameraHeight });
  }
  const ok = out.filter((e) => !e.rejected);
  if (ok.length === 0) return null;
  for (const e of out) if (e.rejected) notes.push(`${e.name} dropped: ${e.rejected}`);
  // One vote per family (median of its members), then the median of the votes: the metric network, the relative network with the
  // vanishing-point camera and the relative network with swept cameras disagree when something is wrong, and the spread shows it.
  const families = [...new Set(ok.map((e) => e.family))];
  const vote = (key: 'width' | 'depth' | 'height'): number[] => families.map((f) => pct(ok.filter((e) => e.family === f).map((e) => e[key]), 0.5));
  // The metric estimator with the vanishing-point camera is the one the self-test benchmark found far the best (median relative error
  // 0.085 against 0.124 for the median of the families, 0.08 against 0.13 on two held-out worlds): the relative-depth families read
  // through windows and doors (12 m for a 7 m room), so a median that counts them as equal votes is pulled long. It leads when it is
  // accepted; the others only set the range and the confidence, and the median is the fallback when it was dropped.
  const lead = ok.find((e) => e.name === 'vp-metric');
  const dim = (key: 'width' | 'depth' | 'height'): Dim => {
    const vals = vote(key);
    const f = fuse(vals) as { value: number; spread: number; n: number };
    let confidence: Dim['confidence'] = families.length < 3 ? 'low' : f.spread < 0.16 ? 'high' : f.spread < 0.32 ? 'medium' : 'low';
    // Agreement on a ceiling PRIOR is not evidence: three reads scaled by the same 2.6 m agree by construction.
    const anchored = ok.some((e) => /door/.test(e.name));
    if (key === 'height' && !anchored && confidence === 'high') confidence = 'medium';
    const value = lead ? lead[key] : f.value;
    if (lead && confidence === 'high') confidence = 'medium';
    return { value: r2(value), low: r2(Math.min(...vals, value)), high: r2(Math.max(...vals, value)), confidence, basis: `${lead ? `metric depth with the vanishing-point camera ${r2(lead[key])}; the other families ` : 'median of '}${families.length} independent reads (${families.map((x, i) => `${x} ${r2(vals[i] as number)}`).join(', ')}), spread ${Math.round(f.spread * 100)}%` };
  };
  const width = dim('width');
  const lbShare = lead ? (lead.widthLowerBound ? 1 : 0) : ok.filter((e) => e.widthLowerBound).length / ok.length;
  const spreadW = width.high / Math.max(0.1, width.low);
  if (lbShare > 0.5) {
    width.basis += '; a side wall is out of frame, so this is a lower bound';
    if (width.confidence === 'high') width.confidence = 'medium';
    width.high = r2(Math.max(width.high, width.value * 1.35));
    void spreadW;
  }
  return { width, depth: dim('depth'), height: dim('height'), estimators: out, vp: inp.vp, vpBox, notes };
}
