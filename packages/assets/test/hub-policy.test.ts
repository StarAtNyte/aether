import { describe, expect, it } from 'vitest';
import { HUB_FIRST, hubConfidence, isStructuralQuery, pickHubFirst, plausibleRange, withHubTimeout, type HubFirstHit } from '../src/hub-policy';

const desk = (o: Partial<HubFirstHit> = {}): HubFirstHit => ({ id: 'hub-desk', name: 'Desk', category: 'furniture', size: [1.4, 0.75, 0.7], score: 30, ...o });

describe('hub-first policy', () => {
  it('accepts a confident, right-sized prop', () => {
    const v = pickHubFirst('desk', [desk()], []);
    expect(v.use).toBe(true);
    if (v.use) expect(v.confidence).toBe(1);
  });

  it('falls back below the threshold (prefix match only)', () => {
    const v = pickHubFirst('desk', [desk({ score: 10 })], []);
    expect(hubConfidence('desk', 10)).toBeLessThan(HUB_FIRST.minConfidence);
    expect(v).toEqual({ use: false, reason: 'below-threshold' });
    expect(pickHubFirst('desk', [desk({ score: undefined })], []).use).toBe(false);
  });

  it('rejects an implausible size (a 0.1 m desk) and checks catalog sizes when the word is not known', () => {
    expect(pickHubFirst('desk', [desk({ size: [0.1, 0.05, 0.08] })], [])).toEqual({ use: false, reason: 'implausible-size' });
    const [lo, hi] = plausibleRange('espresso machine', [[0.3, 0.4, 0.3], [0.35, 0.4, 0.3]]);
    expect(lo).toBeCloseTo(0.16);
    expect(hi).toBeCloseTo(1);
    expect(pickHubFirst('espresso machine', [desk({ id: 'x', size: [3, 3, 3] })], [[0.3, 0.4, 0.3]]).use).toBe(false);
  });

  it('never takes structural parts from the hub', () => {
    for (const q of ['wall', 'oak door', 'bay window', 'spiral staircase', 'roof', 'floor tile', 'ceiling']) {
      expect(isStructuralQuery(q)).toBe(true);
      expect(pickHubFirst(q, [desk()], [])).toEqual({ use: false, reason: 'structural' });
    }
    expect(isStructuralQuery('desk')).toBe(false);
  });

  it('skips a missing or non-prop hub silently', () => {
    expect(pickHubFirst('desk', null, [])).toEqual({ use: false, reason: 'hub-unavailable' });
    expect(pickHubFirst('desk', [desk({ category: 'rocks' })], [])).toEqual({ use: false, reason: 'not-a-prop' });
  });

  it('withHubTimeout returns null when late or throwing', async () => {
    expect(await withHubTimeout(() => new Promise((r) => setTimeout(() => r(1), 200)), 10)).toBeNull();
    expect(await withHubTimeout(async () => { throw new Error('x'); }, 50)).toBeNull();
    expect(await withHubTimeout(async () => 7, 50)).toBe(7);
  });
});
