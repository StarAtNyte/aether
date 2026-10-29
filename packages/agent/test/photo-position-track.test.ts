import { describe, expect, it } from 'vitest';
import { fovDepthSigma, positionLine, positionSigma, restoreToAnchor, sigmaText, summarisePositions } from '../src/photo/position-track';

describe('position bookkeeping in metres', () => {
  it('summarises distances', () => {
    const s = summarisePositions([0.1, 0.2, 0.3, 0.9])!;
    expect(s).toMatchObject({ n: 4, mean: 0.38, median: 0.25, within15: 1, within25: 2, worst: 0.9 });
    expect(summarisePositions([])).toBeNull();
    expect(summarisePositions([Number.NaN])).toBeNull();
    expect(positionLine('x', s)).toContain('median 0.25 m');
  });
  it('uncertainty grows with range, camera frame and weak field of view', () => {
    expect(positionSigma(4)).toBeCloseTo(0.36, 2);
    expect(positionSigma(2)).toBeLessThan(positionSigma(4));
    expect(positionSigma(4, { roomFrame: false })).toBeGreaterThan(positionSigma(4));
    expect(positionSigma(4, { weakFov: true })).toBeGreaterThan(positionSigma(4));
    expect(sigmaText(0.36)).toBe('+-0.36 m');
  });
  it('restores only when far from the measured pose and the overlap did not improve', () => {
    expect(restoreToAnchor({ driftM: 0.6, iouNow: 0.3, iouAtAnchor: 0.35, restores: 0 }).restore).toBe(true);
    expect(restoreToAnchor({ driftM: 0.2, iouNow: 0.3, iouAtAnchor: 0.35, restores: 0 }).restore).toBe(false);
    expect(restoreToAnchor({ driftM: 0.6, iouNow: 0.6, iouAtAnchor: 0.35, restores: 0 }).restore).toBe(false);
    expect(restoreToAnchor({ driftM: 0.6, iouNow: 0.3, iouAtAnchor: 0.35, restores: 2 }).restore).toBe(false);
    expect(restoreToAnchor({ driftM: 0.6, iouNow: null, iouAtAnchor: 0.35, restores: 0 }).restore).toBe(false);
  });
});

describe('depth uncertainty from the lens', () => {
  it('is zero for a pinned lens, grows with range and with the width of the field-of-view range', () => {
    expect(fovDepthSigma(4, [70, 70])).toBe(0);
    expect(fovDepthSigma(4, [60, 90])).toBeGreaterThan(fovDepthSigma(2, [60, 90]));
    expect(fovDepthSigma(4, [55, 95])).toBeGreaterThan(fovDepthSigma(4, [65, 75]));
    // 60..90 degrees: 1/tan(fov/2) is 1.73 and 1.0, relative half-spread 0.27, times 0.6, at 4 m
    expect(fovDepthSigma(4, [90, 60])).toBeCloseTo(4 * 0.2679 * 0.6, 2);
  });
  it('is added in quadrature to the sideways part only when the lens is weak', () => {
    const plain = positionSigma(4);
    const weak = positionSigma(4, { weakFov: true, fovRange: [55, 95] });
    expect(weak).toBeGreaterThan(plain);
    expect(weak).toBeCloseTo(Math.hypot(plain, fovDepthSigma(4, [55, 95])), 1);
    expect(positionSigma(4, { weakFov: false, fovRange: [55, 95] })).toBe(plain);
  });
});
