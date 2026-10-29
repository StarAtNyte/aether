/**
 * POSITION IN METRES, KEPT ON THE BOOKS. The per-object judges (is the render like the photo?) say "good enough" for a piece that
 * stands half a metre from where the photo puts it, so their pass rate did not follow position accuracy. These pure helpers give the
 * run a number in metres: how far every linked piece stands from the pose the measurements gave it (its anchor), the spread of
 * that, and a stated uncertainty for each measured position. Evidence for the model and the closing message, never a gate.
 *
 * The one automatic action is conservative and fully reported: a piece that has drifted far from its measured pose while the
 * measured mask overlap did not improve is put back (the model can move it again with a reason that cites the photo).
 */

export interface PositionStat {
  n: number;
  mean: number;
  median: number;
  within15: number;
  within25: number;
  worst: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Mean, median and shares of a list of distances in metres (null when empty). */
export function summarisePositions(metres: readonly number[]): PositionStat | null {
  const v = metres.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  const median = v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
  return {
    n: v.length,
    mean: r2(v.reduce((s, x) => s + x, 0) / v.length),
    median: r2(median),
    within15: v.filter((x) => x <= 0.15).length,
    within25: v.filter((x) => x <= 0.25).length,
    worst: r2(v[v.length - 1] as number),
  };
}

export function positionLine(label: string, s: PositionStat | null): string {
  if (!s) return '';
  return `${label}: mean ${s.mean} m, median ${s.median} m, worst ${s.worst} m over ${s.n} piece${s.n === 1 ? '' : 's'} (${s.within15} within 15 cm, ${s.within25} within 25 cm)`;
}

/**
 * One standard deviation of a measured floor position, metres. Metric depth is good to about 10 percent of the range (measured on
 * the self-test photos: 0.2 to 0.35 m at 3 to 5 m), the unseen half of a piece adds to it, and a position taken in the camera frame
 * (side walls not both found) or from a wide lens is less sure.
 */
export function positionSigma(rangeM: number, opt: { roomFrame?: boolean; weakFov?: boolean; fovRange?: readonly [number, number] } = {}): number {
  const base = 0.08 + 0.07 * Math.max(0, rangeM);
  const frame = opt.roomFrame === false ? 1.5 : 1;
  // A weak field of view moves a piece along the viewing direction only: it is added in quadrature (a lens that cannot be read from the
  // lines is the largest single error on the self-test photos), not multiplied into the sideways part.
  const lens = opt.weakFov ? fovDepthSigma(rangeM, opt.fovRange ?? [60, 90]) : 0;
  return r2(Math.hypot(base * frame, lens));
}

/**
 * Depth along the viewing direction depends on the assumed lens: the network's depth is divided by tan(fov/2) / tan(30 degrees), so
 * the distance of everything scales with 1 / tan(fov/2) while the sideways positions do not. Metres of one standard deviation
 * for a piece at `rangeM`, from the plausible field-of-view range (half of the relative spread of 1 / tan(fov/2), times 0.6).
 */
export function fovDepthSigma(rangeM: number, fovRange: readonly [number, number]): number {
  const lo = Math.min(fovRange[0], fovRange[1]);
  const hi = Math.max(fovRange[0], fovRange[1]);
  const t = (f: number): number => 1 / Math.tan((Math.min(150, Math.max(10, f)) * Math.PI) / 360);
  const a = t(hi);
  const b = t(lo);
  const half = (b - a) / (a + b);
  return Math.max(0, rangeM) * half * 0.6;
}

/** "about 0.4 m (one sigma)" style text for the plan table. */
export const sigmaText = (sigma: number): string => `+-${sigma.toFixed(2)} m`;

export interface RestoreInput {
  /** Distance of the piece from its measured pose now, metres. */
  driftM: number;
  /** Measured mask IoU now and at the measured pose (the first measured round), or null when not measured. */
  iouNow: number | null;
  iouAtAnchor: number | null;
  /** Times this piece was already put back. */
  restores: number;
}

export const RESTORE_DRIFT_M = 0.3;
export const RESTORE_MAX = 2;

/**
 * Put a piece back at its measured pose? Only when it stands at least 30 cm from it, the measured overlap with the photo's mask
 * is not clearly better than at the measured pose (a gain of 0.05 or less), and it was put back fewer than twice before.
 * Without a measured overlap at the measured pose nothing is decided (null).
 */
export function restoreToAnchor(i: RestoreInput): { restore: boolean; why: string } {
  if (i.iouAtAnchor === null || i.iouNow === null) return { restore: false, why: 'no measured overlap to compare' };
  if (i.driftM < RESTORE_DRIFT_M) return { restore: false, why: 'close to the measured pose' };
  if (i.restores >= RESTORE_MAX) return { restore: false, why: 'already put back twice; the model decides' };
  if (i.iouNow > i.iouAtAnchor + 0.05) return { restore: false, why: `overlap improved (${i.iouAtAnchor.toFixed(2)} to ${i.iouNow.toFixed(2)})` };
  return { restore: true, why: `${r2(i.driftM)} m from the measured pose and the mask overlap did not improve (${i.iouAtAnchor.toFixed(2)} to ${i.iouNow.toFixed(2)})` };
}
