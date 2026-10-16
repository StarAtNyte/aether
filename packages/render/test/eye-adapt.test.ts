import { describe, expect, it } from 'vitest';
import { adaptStep, adaptedLook, interiorFactor, INTERIOR_ENV_KEEP, INTERIOR_EV, type CeilingBox } from '../src/view/eye-adapt';

const room: CeilingBox = { minX: 0, maxX: 6, minZ: 0, maxZ: 5, y: 2.6 };

describe('eye adaptation', () => {
  it('is fully interior under a ceiling, away from its edge', () => {
    expect(interiorFactor(3, 1.6, 2.5, [room])).toBe(1);
  });
  it('is outdoors outside the footprint, above the ceiling or with nothing overhead', () => {
    expect(interiorFactor(9, 1.6, 2.5, [room])).toBe(0);
    expect(interiorFactor(3, 3.4, 2.5, [room])).toBe(0);
    expect(interiorFactor(3, 1.6, 2.5, [])).toBe(0);
  });
  it('ramps over the doorway instead of popping', () => {
    const a = interiorFactor(0.2, 1.6, 2.5, [room]);
    const b = interiorFactor(0.6, 1.6, 2.5, [room]);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(1);
  });
  it('ignores a ceiling far above (a hangar or a storey up)', () => {
    expect(interiorFactor(3, 1.6, 2.5, [{ ...room, y: 12 }])).toBe(0);
  });
  it('survives bad input', () => {
    expect(interiorFactor(Number.NaN, 1, 1, [room])).toBe(0);
    expect(adaptedLook(Number.NaN)).toEqual({ exposure: 1, envScale: 1 });
  });
  it('opens the exposure and eases the sky light in a room', () => {
    const l = adaptedLook(1);
    expect(l.exposure).toBeCloseTo(2 ** INTERIOR_EV);
    expect(l.envScale).toBeCloseTo(INTERIOR_ENV_KEEP);
    expect(adaptedLook(0)).toEqual({ exposure: 1, envScale: 1 });
  });
  it('approaches the target smoothly and never overshoots', () => {
    let v = 0;
    for (let i = 0; i < 20; i++) {
      const next = adaptStep(v, 1, 0.1);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBeGreaterThan(0.9);
  });
});
