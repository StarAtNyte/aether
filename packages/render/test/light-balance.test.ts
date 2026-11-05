import { describe, expect, it } from 'vitest';
import { GRADE_SATURATION_MAX, boundTint, chroma, limitChroma, TINT_MAX_CHROMA } from '../src/environment/light-balance';
import { gradeWithPreset, NEUTRAL_GRADE } from '../src/gpu/grade';
import { GRADE_PRESETS } from '../src/gpu/finishing';

describe('light balance', () => {
  it('limits chroma without changing the brightest channel', () => {
    const c = { r: 1, g: 0.5, b: 0.2 };
    limitChroma(c, 0.6);
    expect(c.r).toBe(1);
    expect(chroma(c)).toBeCloseTo(0.4, 6);
    const grey = { r: 0.5, g: 0.5, b: 0.5 };
    limitChroma(grey, 0.9);
    expect(grey).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it('keeps a tint a nudge', () => {
    const t = boundTint({ r: 1, g: 0.527, b: 0.246 });
    expect(chroma(t)).toBeLessThanOrEqual(TINT_MAX_CHROMA + 1e-9);
    const mild = boundTint({ r: 1, g: 0.9, b: 0.8 });
    expect(mild).toEqual({ r: 1, g: 0.9, b: 0.8 });
  });

  it('bounds the stacked grade saturation but keeps muted looks', () => {
    const g = gradeWithPreset({ ...NEUTRAL_GRADE, saturation: 1.1 }, { ...GRADE_PRESETS['golden-hour'], saturation: 1.3 });
    expect(g.saturation).toBe(GRADE_SATURATION_MAX);
    const night = gradeWithPreset({ ...NEUTRAL_GRADE, saturation: 0.86 }, GRADE_PRESETS.night);
    expect(night.saturation).toBeCloseTo(0.86 * 0.9, 6);
  });
});
