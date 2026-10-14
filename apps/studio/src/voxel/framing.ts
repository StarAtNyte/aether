/**
 * Camera framing over block terrain: choose the side to look from so hills
 * and mountains do not hide the subject.
 *
 * The terrain generator's heightfield is deterministic and cheap, so the
 * check needs no loaded chunks (framing happens before streaming starts).
 */

/** Ground height (top free y) at a world column. */
export type HeightAt = (x: number, z: number) => number;

/** Azimuth candidates, in order of preference (radians from the preferred side). */
const TURNS: readonly number[] = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI];
/** Samples along each sight line. */
const SAMPLES = 20;
/** Sight lines start this far out (fraction of the distance): the subject itself is not an obstacle. */
const NEAR = 0.18;
/** Blocks of clearance the sight line keeps above the ground before it counts as blocked. */
const CLEARANCE = 1.5;
/** Edge sight lines aim this far out from the centre (fraction of the subject radius). */
const EDGE = 0.75;
/** Steeper fallback when every side is blocked (multiplies the elevation). */
const STEEP = 1.8;

/**
 * Terrain blocking the sight line from point `p` to the camera at `cam`:
 * the sum of how far the ground rises above the line at each sample
 * (0 = clear view).
 */
export function occlusion(height: HeightAt, p: readonly [number, number, number], cam: readonly [number, number, number]): number {
  let blocked = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = NEAR + ((1 - NEAR) * (i + 1)) / SAMPLES;
    const x = p[0] + (cam[0] - p[0]) * t;
    const y = p[1] + (cam[1] - p[1]) * t;
    const z = p[2] + (cam[2] - p[2]) * t;
    const g = height(Math.floor(x), Math.floor(z));
    if (Number.isFinite(g)) blocked += Math.max(0, g + CLEARANCE - y);
  }
  return blocked;
}

/** Terrain hiding a subject of `radius` around `center` from a camera `distance` away along unit `dir`: sight lines to its centre and its left and right edges. */
function subjectOcclusion(height: HeightAt, center: readonly [number, number, number], radius: number, dir: readonly [number, number, number], distance: number): number {
  const cam: [number, number, number] = [center[0] + dir[0] * distance, center[1] + dir[1] * distance, center[2] + dir[2] * distance];
  // Horizontal right vector of the view.
  const h = Math.hypot(dir[0], dir[2]) || 1;
  const rx = dir[2] / h;
  const rz = -dir[0] / h;
  const side = radius * EDGE;
  let blocked = occlusion(height, center, cam);
  blocked += occlusion(height, [center[0] + rx * side, center[1], center[2] + rz * side], cam);
  blocked += occlusion(height, [center[0] - rx * side, center[1], center[2] - rz * side], cam);
  return blocked;
}

/**
 * Camera offset direction (from the subject to the camera, same length as
 * `preferred`) with the clearest view of a subject of `radius` blocks
 * around `center` from `distance` blocks: `preferred` rotated about the
 * vertical axis by the first of eight azimuths whose sight lines clear the
 * terrain, else the least blocked one; when every side is blocked the view
 * is also made steeper.
 */
export function clearViewOffset(height: HeightAt, center: readonly [number, number, number], radius: number, distance: number, preferred: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(preferred[0], preferred[1], preferred[2]);
  if (!(len > 0) || !(distance > 0) || !(radius >= 0) || !center.every(Number.isFinite)) return [preferred[0], preferred[1], preferred[2]];
  const flat = Math.hypot(preferred[0], preferred[2]);
  const baseYaw = Math.atan2(preferred[0], preferred[2]);
  let best: [number, number, number] = [preferred[0], preferred[1], preferred[2]];
  let bestScore = Infinity;
  for (const steep of [1, STEEP]) {
    const rise = preferred[1] * steep;
    const n = Math.hypot(flat, rise);
    for (const turn of TURNS) {
      const yaw = baseYaw + turn;
      const dir: [number, number, number] = [(Math.sin(yaw) * flat) / n, rise / n, (Math.cos(yaw) * flat) / n];
      const score = subjectOcclusion(height, center, radius, dir, distance);
      if (score < bestScore) {
        bestScore = score;
        best = steep === 1 && turn === 0 ? [preferred[0], preferred[1], preferred[2]] : [dir[0] * len, dir[1] * len, dir[2] * len];
      }
      if (score === 0) return best;
    }
  }
  return best;
}
