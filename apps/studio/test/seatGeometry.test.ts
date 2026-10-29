import { describe, expect, it } from 'vitest';
import { exitCandidates, nearestFree, pickExit, seatTopFromHits, StuckWatch } from '../src/engine/seat-geometry';

describe('seat top', () => {
  it('takes the first plausible hit above the floor, not the origin or the backrest', () => {
    expect(seatTopFromHits([0.53, 0.0], 0.1, 0.45)).toBeCloseTo(0.43, 5);
    expect(seatTopFromHits([1.4, 0.5], 0, 0.45)).toBeCloseTo(0.5, 5);
  });
  it('falls back when nothing plausible was hit', () => {
    expect(seatTopFromHits([], 0, 0.45)).toBe(0.45);
    expect(seatTopFromHits([0.05], 0, 0.45)).toBe(0.45);
  });
});

describe('exit selection', () => {
  const cands = exitCandidates([0, 0, 0], 0, 1, 0);
  it('prefers the front', () => {
    expect(pickExit(cands, () => true)).toEqual([0, 0.02, 0.85]);
  });
  it('goes to a side when the front is blocked (a table), then behind', () => {
    const side = pickExit(cands, (p) => p[2] < 0.5);
    expect(side).not.toBeNull();
    expect(Math.abs(side![0])).toBeGreaterThan(0.5);
    const back = pickExit(cands, (p) => p[2] < -0.5);
    expect(back![2]).toBeLessThan(-0.5);
  });
  it('returns null when boxed in', () => {
    expect(pickExit(cands, () => false)).toBeNull();
  });
});

describe('unstuck', () => {
  it('lifts out of an overlapping table first', () => {
    const p = nearestFree([0, 0, 0], (q) => q[1] >= 0.25);
    expect(p).toEqual([0, 0.25, 0]);
  });
  it('finds the nearest free ground sideways', () => {
    const p = nearestFree([0, 0, 0], (q) => Math.hypot(q[0], q[2]) > 0.8, 2, 0);
    expect(p).not.toBeNull();
    expect(Math.hypot(p![0], p![2])).toBeGreaterThan(0.8);
    expect(Math.hypot(p![0], p![2])).toBeLessThan(1.3);
  });
  it('trips after a second of pushing without progress, not when moving or idle', () => {
    const w = new StuckWatch();
    let tripped = false;
    for (let i = 0; i < 70; i++) tripped ||= w.update(0, 0, true, 1 / 60);
    expect(tripped).toBe(true);
    const m = new StuckWatch();
    let any = false;
    for (let i = 0; i < 200; i++) any ||= m.update(i * 0.05, 0, true, 1 / 60);
    for (let i = 0; i < 200; i++) any ||= m.update(0, 0, false, 1 / 60);
    expect(any).toBe(false);
  });
});
