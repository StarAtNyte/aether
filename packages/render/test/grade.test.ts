import { describe, expect, it } from 'vitest';
import { gradeFor, hexLinear, NEUTRAL_GRADE } from '../src/gpu/grade';
import { computeSkyState } from '../src/environment/sky-state';

describe('colour grade', () => {
  it('warms highlights at sunset, cools and mutes at night, stays subtle by day', () => {
    const day = gradeFor(computeSkyState({ sky: 'day', sunIntensity: 3, ambientIntensity: 0.4 }));
    const sunset = gradeFor(computeSkyState({ sky: 'sunset', sunIntensity: 3, ambientIntensity: 0.4 }));
    const night = gradeFor(computeSkyState({ sky: 'night', sunIntensity: 3, ambientIntensity: 0.4 }));
    expect(sunset.highlightTint[0]).toBeGreaterThan(sunset.highlightTint[2]);
    expect(sunset.saturation).toBeGreaterThanOrEqual(day.saturation);
    expect(night.saturation).toBeLessThan(1);
    expect(night.shadowTint[2]).toBeGreaterThanOrEqual(night.shadowTint[0]);
    for (const g of [day, sunset, night]) {
      for (const t of [...g.shadowTint, ...g.highlightTint]) {
        expect(t).toBeGreaterThanOrEqual(0.8);
        expect(t).toBeLessThanOrEqual(1.25);
      }
      expect(g.contrast).toBeGreaterThan(0.95);
      expect(g.contrast).toBeLessThan(1.1);
    }
  });

  it('parses colours defensively', () => {
    expect(hexLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexLinear('nope')).toEqual([1, 1, 1]);
    expect(hexLinear('#000000')).toEqual([0, 0, 0]);
    expect(NEUTRAL_GRADE.saturation).toBe(1);
  });
});
