import { describe, expect, it } from 'vitest';
import { clearViewOffset, occlusion } from '../src/voxel/framing';

const flat = (): number => 64;
const PREFERRED: [number, number, number] = [1, 0.62, 1.25];
const CENTER: [number, number, number] = [0, 70, 0];
const N = Math.hypot(...PREFERRED);
const camAt = (dir: readonly number[], d: number): [number, number, number] => [CENTER[0] + ((dir[0] as number) / N) * d, CENTER[1] + ((dir[1] as number) / N) * d, CENTER[2] + ((dir[2] as number) / N) * d];

describe('voxel framing', () => {
  it('keeps the preferred side on open ground', () => {
    expect(clearViewOffset(flat, CENTER, 20, 80, PREFERRED)).toEqual(PREFERRED);
  });

  it('turns away from a mountain that hides the subject (regression: castle half hidden)', () => {
    // A tall ridge on the preferred side (+x / +z quadrant), open land elsewhere.
    const ridge = (x: number, z: number): number => (x > 10 && z > 10 ? 140 : 64);
    expect(occlusion(ridge, CENTER, camAt(PREFERRED, 80))).toBeGreaterThan(0);
    const out = clearViewOffset(ridge, CENTER, 20, 80, PREFERRED);
    expect(Math.hypot(...out)).toBeCloseTo(N, 6);
    expect(occlusion(ridge, CENTER, camAt(out, 80))).toBe(0);
    expect(out).not.toEqual(PREFERRED);
  });

  it('also avoids terrain that hides only one side of a wide subject', () => {
    // A peak right of the preferred sight line: the centre is visible, the right edge is not.
    const peak = (x: number, z: number): number => (Math.hypot(x - 30, z - 5) < 12 ? 150 : 64);
    expect(occlusion(peak, CENTER, camAt(PREFERRED, 90))).toBe(0);
    const out = clearViewOffset(peak, CENTER, 24, 90, PREFERRED);
    expect(out).not.toEqual(PREFERRED);
  });

  it('looks down more steeply when every side is walled in', () => {
    // A crater: high ground all around a low centre.
    const crater = (x: number, z: number): number => (Math.hypot(x, z) > 30 ? 100 : 60);
    const out = clearViewOffset(crater, CENTER, 10, 120, PREFERRED);
    const elevation = out[1] / Math.hypot(out[0], out[2]);
    expect(elevation).toBeGreaterThan(PREFERRED[1] / Math.hypot(PREFERRED[0], PREFERRED[2]));
  });

  it('ignores bad input', () => {
    expect(clearViewOffset(flat, [Number.NaN, 0, 0], 10, 80, PREFERRED)).toEqual(PREFERRED);
    expect(clearViewOffset(flat, CENTER, 10, 0, PREFERRED)).toEqual(PREFERRED);
    expect(clearViewOffset(flat, CENTER, Number.NaN, 80, PREFERRED)).toEqual(PREFERRED);
    expect(occlusion(() => Number.NaN, CENTER, [0, 70, 50])).toBe(0);
  });
});
