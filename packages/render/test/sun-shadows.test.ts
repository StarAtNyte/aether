import { describe, expect, it } from 'vitest';
import { CASCADES, CASCADE_MIN_RADIUS, focusHalf, footprintMisses, pcfRadius, planSunShadows, quantizeHalf, snapToTexel, viewFocus } from '../src/environment/sun-shadow-plan';
import { BLOCKER_LEVELS, MAX_BLOCKER_TAPS, MAX_FILTER_TAPS, meanBlockerDistance } from '../src/gpu/sun-shadow-nodes';
import { effectsOf, needsPrePass } from '../src/gpu/finishing';

const big = { shadowMapCap: 2048, contentRadius: 120, voxel: false };

describe('sun shadow plan', () => {
  it('keeps the single fitted map on the low tier, for small content, block worlds and software rasterisers', () => {
    expect(planSunShadows({ ...big, tier: 'low', still: false }).cascades).toBe(1);
    expect(planSunShadows({ ...big, tier: 'ultra', still: false, contentRadius: CASCADE_MIN_RADIUS - 1 }).cascades).toBe(1);
    expect(planSunShadows({ ...big, tier: 'ultra', still: false, voxel: true }).cascades).toBe(1);
    expect(planSunShadows({ ...big, tier: 'ultra', still: false, software: true }).cascades).toBe(1);
  });

  it('gives every tier above low the same cascades (two focus boxes and the content fit)', () => {
    for (const tier of ['medium', 'high', 'ultra'] as const) expect(planSunShadows({ ...big, tier, still: false }).cascades).toBe(CASCADES);
    expect(planSunShadows({ ...big, tier: 'medium', still: true }).cascades).toBe(CASCADES);
    expect(CASCADES).toBe(3);
  });

  it('compiles the same shaders on medium, high, ultra and stills (no material rebuild when the tier changes)', () => {
    const keys = new Set([...(['medium', 'high', 'ultra'] as const).map((tier) => planSunShadows({ ...big, tier, still: false }).key), planSunShadows({ ...big, tier: 'high', still: true }).key]);
    expect(keys.size).toBe(1);
    const small = new Set((['medium', 'high', 'ultra'] as const).map((tier) => planSunShadows({ ...big, contentRadius: 8, tier, still: false }).key));
    expect(small.size).toBe(1);
    // Only the low tier (and software) differ.
    expect(planSunShadows({ ...big, tier: 'low', still: false }).key).not.toBe([...keys][0]);
  });

  it('scales the soft filter taps with the tier as uniforms: fewest on medium, most for stills', () => {
    const medium = planSunShadows({ ...big, tier: 'medium', still: false });
    expect(medium.blockerSamples).toBeGreaterThan(0);
    expect(medium.blockerSamples).toBeLessThan(planSunShadows({ ...big, tier: 'high', still: false }).blockerSamples);
    const high = planSunShadows({ ...big, tier: 'high', still: false });
    const still = planSunShadows({ ...big, tier: 'high', still: true });
    expect(high.blockerSamples).toBeGreaterThan(0);
    expect(still.filterSamples).toBeGreaterThan(high.filterSamples);
    expect(still.filterSamples).toBeLessThanOrEqual(MAX_FILTER_TAPS);
    expect(still.blockerSamples).toBeLessThanOrEqual(MAX_BLOCKER_TAPS);
  });

  it('keeps maps within the budget, with smaller near maps on the medium tier', () => {
    const medium = planSunShadows({ ...big, tier: 'medium', still: false });
    expect(medium.nearMapSize).toBe(1024);
    expect(medium.outerMapSize).toBe(2048);
    const soft = planSunShadows({ ...big, tier: 'high', still: false, shadowMapCap: 1024 });
    expect(soft.nearMapSize).toBeLessThanOrEqual(1024);
    expect(soft.outerMapSize).toBe(1024);
    const still = planSunShadows({ ...big, tier: 'high', still: true, shadowMapCap: 4096 });
    expect(still.nearMapSize).toBe(2048);
    expect(still.outerMapSize).toBe(4096);
    expect(planSunShadows({ ...big, tier: 'high', still: false, shadowMapCap: Number.NaN }).outerMapSize).toBe(1024);
  });

  it('uses the soft filter above the low tier, three\'s PCF on low and software rasterisers', () => {
    expect(planSunShadows({ ...big, tier: 'low', still: false }).filter).toBe('pcf');
    expect(planSunShadows({ ...big, tier: 'medium', still: false }).filter).toBe('soft');
    expect(planSunShadows({ ...big, tier: 'high', still: false }).filter).toBe('soft');
    expect(planSunShadows({ ...big, tier: 'low', still: true }).filter).toBe('soft');
    expect(planSunShadows({ ...big, tier: 'high', still: false, contentRadius: 5 }).filter).toBe('soft');
    expect(planSunShadows({ ...big, tier: 'high', still: false, software: true }).filter).toBe('pcf');
  });

  it('changes its shader key only with what is compiled into materials', () => {
    const a = planSunShadows({ ...big, tier: 'high', still: false });
    expect(planSunShadows({ ...big, tier: 'high', still: false, contentRadius: 300 }).key).toBe(a.key);
    expect(planSunShadows({ ...big, tier: 'high', still: false, shadowMapCap: 1024 }).key).toBe(a.key);
    expect(planSunShadows({ ...big, tier: 'high', still: false, contentRadius: 5 }).key).not.toBe(a.key);
  });

  it('lets the outermost map cover larger worlds when cascades hold the near detail', () => {
    expect(planSunShadows({ ...big, tier: 'high', still: false }).outerMaxHalf).toBeGreaterThan(planSunShadows({ ...big, tier: 'low', still: false }).outerMaxHalf);
  });
});

describe('focus cascades', () => {
  it('quantises box sizes to steps of the square root of two', () => {
    expect(quantizeHalf(8)).toBeCloseTo(8);
    expect(quantizeHalf(9)).toBeCloseTo(8);
    expect(quantizeHalf(10.5)).toBeCloseTo(11.3137, 3);
    expect(quantizeHalf(Number.NaN)).toBe(1);
  });

  it('holds a box size until the wanted size leaves its step (no flicker at a boundary)', () => {
    const plan = { focusMin: 5, focusMax: 40 };
    const h = focusHalf(30, 0, plan);
    expect(h).toBeCloseTo(quantizeHalf(15));
    // Small changes of the view distance keep the size.
    for (const d of [24, 28, 34, 38]) expect(focusHalf(d, h, plan)).toBe(h);
    // A real change moves it.
    expect(focusHalf(80, h, plan)).toBeGreaterThan(h);
    expect(focusHalf(2, h, plan)).toBeLessThan(h);
    expect(focusHalf(1000, 0, plan)).toBeLessThanOrEqual(quantizeHalf(40));
    expect(focusHalf(0.1, 0, plan)).toBeGreaterThanOrEqual(quantizeHalf(5) - 1e-9);
  });

  it('snaps box centres to whole texels, so a moving box leaves shadow edges in place', () => {
    const texel = 0.04;
    for (const v of [0.013, 1.234, -7.77]) {
      const s = snapToTexel(v, texel);
      expect(Math.abs(s - v)).toBeLessThanOrEqual(texel / 2 + 1e-12);
      expect(Math.abs(s / texel - Math.round(s / texel))).toBeLessThan(1e-9);
    }
    expect(snapToTexel(Number.NaN, texel)).toBe(0);
    expect(snapToTexel(2.5, 0)).toBe(2.5);
  });

  it('gives the same penumbra in metres whatever the cascade texel size', () => {
    expect(pcfRadius(0.06, 0.02)).toBeCloseTo(3);
    expect(pcfRadius(0.06, 0.2)).toBe(1);
    expect(pcfRadius(1, 0.01)).toBe(6);
  });

  it('focuses on the orbit target when it is in view, else where the view ray meets the ground', () => {
    const out: [number, number, number] = [0, 0, 0];
    const d = viewFocus([0, 10, 20], [0, -0.5, -1], [0, 0, 0], 0, 0.5, 200, 20, out);
    expect(out).toEqual([0, 0, 0]);
    expect(d).toBeCloseTo(Math.hypot(10, 20));
    // A stale target behind the eye is ignored: the ray from y = 10 down to the ground.
    const d2 = viewFocus([0, 10, 20], [0, -0.5, -1], [0, 0, 100], 0, 0.5, 200, 20, out);
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(0);
    expect(d2).toBeCloseTo(Math.hypot(10, 20));
    // Looking at the horizon: a point a fixed distance ahead.
    const d3 = viewFocus([0, 2, 0], [0, 0, -1], null, 0, 0.5, 200, 20, out);
    expect(d3).toBe(20);
    expect(out).toEqual([0, 2, -20]);
    // Far ground hits are clamped to the content's reach.
    expect(viewFocus([0, 5, 0], [0, -0.01 - 0.03, -1], null, 0, 0.5, 60, 20, out)).toBeLessThanOrEqual(60);
  });
});

describe('near cascade casters', () => {
  it('skips a caster only when its light-space footprint misses the box (depth along the light does not matter)', () => {
    // Box centred at (10, 0), half size 5.
    expect(footprintMisses(10, 0, 5, 10, 0, 1, 0)).toBe(false);
    expect(footprintMisses(10, 0, 5, 16.5, 0, 1, 0)).toBe(true);
    // The sphere's radius and the wind margin reach into the box.
    expect(footprintMisses(10, 0, 5, 16.5, 0, 1, 1)).toBe(false);
    expect(footprintMisses(10, 0, 5, 10, -7, 2.5, 0)).toBe(false);
    expect(footprintMisses(10, 0, 5, 10, -7, 1, 0)).toBe(true);
    // Corners use the box (Chebyshev), never a smaller disc.
    expect(footprintMisses(0, 0, 5, 5.5, 5.5, 1, 0)).toBe(false);
    expect(footprintMisses(0, 0, 5, 5, 5, -3, -1)).toBe(false);
  });
});

describe('contact-hardening filter', () => {
  it('estimates the blocker distance from exceedance fractions (E[D] = integral of P(D > x))', () => {
    const [d1, d2, d3] = BLOCKER_LEVELS;
    // Every blocker right at the receiver: half the first level.
    expect(meanBlockerDistance(0, 0, 0)).toBeCloseTo(d1 / 2);
    // Every blocker far beyond the last level: grows with the levels.
    expect(meanBlockerDistance(1, 1, 1)).toBeCloseTo(d3 * 1.5);
    // Monotone: farther blockers give wider penumbrae.
    expect(meanBlockerDistance(1, 0.5, 0)).toBeGreaterThan(meanBlockerDistance(0.5, 0, 0));
    expect(meanBlockerDistance(1, 0, 0)).toBeCloseTo(d1 + (d2 - d1) / 2);
  });
});

describe('contact shadows effect', () => {
  it('runs on the tiers with a depth pre-pass and temporal AA, never on low or medium', () => {
    expect(effectsOf('low').contact).toBe(false);
    expect(effectsOf('medium').contact).toBe(false);
    expect(effectsOf('high').contact).toBe(true);
    expect(effectsOf('ultra').contact).toBe(true);
    expect(needsPrePass({ ...effectsOf('medium'), contact: true })).toBe(true);
  });
});
