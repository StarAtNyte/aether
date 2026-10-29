import { describe, expect, it } from 'vitest';
import { positionLine, positionSigma, restoreToAnchor, sigmaText, summarisePositions } from '../src/photo/position-track';

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
