import { describe, expect, it } from 'vitest';
import { nextTrim, TRIM_MAX_EV, TRIM_MIN_EV, type TrimSample } from '../src/view/exposure-trim';

const s = (mean: number, high = 0, low = 0): TrimSample => ({ mean, high, low });

describe('exposure trim', () => {
  it('leaves a well exposed picture alone', () => {
    expect(nextTrim(0, s(120))).toBe(0);
    expect(nextTrim(0.4, s(140, 0.05))).toBe(0.4);
  });
  it('takes light away from a washed room and adds to a crushed one', () => {
    expect(nextTrim(0, s(220))).toBeLessThan(-0.1);
    expect(nextTrim(0, s(40))).toBeGreaterThan(0.1);
  });
  it('moves a limited step at a time and stays inside its range', () => {
    expect(nextTrim(0, s(250))).toBeGreaterThanOrEqual(-0.4);
    let t = 0;
    for (let i = 0; i < 40; i++) t = nextTrim(t, s(250));
    expect(t).toBe(TRIM_MIN_EV);
    for (let i = 0; i < 40; i++) t = nextTrim(t, s(10));
    expect(t).toBe(TRIM_MAX_EV);
  });
  it('does not brighten a dark picture whose windows are already white', () => {
    expect(nextTrim(0, s(50, 0.2))).toBe(0);
  });
  it('converges: a picture whose mean follows the trim settles without hunting', () => {
    let t = 0;
    const mean = (trim: number): number => 215 * 2 ** (0.45 * trim);
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) {
      t = nextTrim(t, s(mean(t)));
      seen.push(t);
    }
    expect(seen.slice(-5).every((v) => v === seen[seen.length - 1])).toBe(true);
    expect(mean(t) / 255).toBeLessThan(0.66);
  });
  it('ignores a read-back that is not a number', () => {
    expect(nextTrim(0.2, s(Number.NaN))).toBe(0.2);
  });
  it('steers toward the stated intent: a dim venue is left darker than a bright cafe', () => {
    const picture = s(0.3 * 255);
    expect(nextTrim(0, picture, { key: 'dim' })).toBe(0);
    expect(nextTrim(0, picture, { key: 'bright' })).toBeGreaterThan(0.1);
    const lit = s(0.5 * 255);
    expect(nextTrim(0, lit, { key: 'dim' })).toBeLessThan(-0.1);
    expect(nextTrim(0, lit, { key: 'bright' })).toBe(0);
  });
  it('treats the exposure the author set as a bias on the band, not the target', () => {
    const lit = s(0.62 * 255);
    expect(nextTrim(0, lit)).toBeLessThan(0);
    expect(nextTrim(0, lit, { biasEv: 1.5 })).toBe(0);
    expect(nextTrim(0, lit, { biasEv: 1.5 })).toBe(nextTrim(0, lit, { biasEv: 1.5 }));
  });
  it('converges to the intent band from a washed and from a crushed start, then stays still', () => {
    for (const [key, start] of [['dim', 230], ['bright', 25], ['moderate', 240]] as const) {
      let t = 0;
      const mean = (trim: number): number => Math.min(255, start * 2 ** (0.5 * trim));
      for (let i = 0; i < 40; i++) t = nextTrim(t, s(mean(t)), { key });
      const settled = t;
      for (let i = 0; i < 10; i++) t = nextTrim(t, s(mean(t)), { key });
      expect(t).toBe(settled);
    }
  });
});
