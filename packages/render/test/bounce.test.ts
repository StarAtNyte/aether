import { describe, expect, it } from 'vitest';
import { BOUNCE_BASE, interiorBounce } from '../src/environment/bounce';
import { computeSkyState } from '../src/environment/sky-state';

describe('interior bounce', () => {
  it('is warm and stronger in daylight than at night', () => {
    const noon = interiorBounce(computeSkyState({ sky: 'day', timeOfDay: 12, sunIntensity: 3, ambientIntensity: 0.4 }));
    const night = interiorBounce(computeSkyState({ sky: 'night', timeOfDay: 1, sunIntensity: 3, ambientIntensity: 0.4 }));
    expect(noon.intensity).toBeGreaterThan(BOUNCE_BASE);
    expect(night.intensity).toBeLessThan(noon.intensity * 0.5);
    const r = parseInt(noon.color.slice(1, 3), 16);
    const b = parseInt(noon.color.slice(5, 7), 16);
    expect(r).toBeGreaterThanOrEqual(b);
  });
  it('a low sunset sun still bounces and stays finite for bad input', () => {
    const dusk = interiorBounce(computeSkyState({ sky: 'sunset', timeOfDay: 17.5, sunIntensity: 3.4, ambientIntensity: 0.4 }));
    expect(dusk.intensity).toBeGreaterThan(BOUNCE_BASE);
    const bad = interiorBounce({ lightColor: 'nope', lightIntensity: Number.NaN, elevation: Number.NaN, moon: false, preset: 'day' });
    expect(Number.isFinite(bad.intensity)).toBe(true);
    expect(bad.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
