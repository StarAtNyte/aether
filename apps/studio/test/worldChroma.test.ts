import { describe, expect, it } from 'vitest';
import { Environment } from '@aether/core';
import { formatHour, hexToRgb, luminance, rgbToHex, worldChroma } from '../src/lib/worldChroma';

const PRESETS = ['day', 'dawn', 'sunset', 'night', 'overcast', 'space', 'studio'] as const;
const env = (sky: (typeof PRESETS)[number], timeOfDay?: number): Environment => Environment.parse(timeOfDay === undefined ? { sky } : { sky, timeOfDay });

function hue(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe('worldChroma', () => {
  it('returns valid hex colors for every preset', () => {
    for (const p of PRESETS) {
      const c = worldChroma(env(p));
      for (const v of [c.glow, c.sky, c.deep, c.ink]) expect(v).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.preset).toBe(p);
    }
  });

  it('keeps accents legible on a dark background and the backdrop dark', () => {
    for (const p of PRESETS) {
      const c = worldChroma(env(p));
      expect(luminance(c.glow)).toBeGreaterThan(0.18);
      expect(luminance(c.sky)).toBeGreaterThan(0.12);
      expect(luminance(c.deep)).toBeLessThan(0.02);
    }
  });

  it('gives a sunset a warm glow and night a cool one', () => {
    const sunset = hue(worldChroma(env('sunset')).glow);
    expect(sunset).toBeGreaterThan(10);
    expect(sunset).toBeLessThan(50);
    const night = hue(worldChroma(env('night')).glow);
    expect(night).toBeGreaterThan(200);
    expect(night).toBeLessThan(260);
  });

  it('makes presets visually distinct', () => {
    const glows = new Set(PRESETS.map((p) => worldChroma(env(p)).glow));
    expect(glows.size).toBe(PRESETS.length);
  });

  it('is deterministic', () => {
    expect(worldChroma(env('dawn', 6))).toEqual(worldChroma(env('dawn', 6)));
  });

  it('picks readable ink for the glow color', () => {
    for (const p of PRESETS) {
      const c = worldChroma(env(p));
      const lg = luminance(c.glow);
      const li = luminance(c.ink);
      const contrast = (Math.max(lg, li) + 0.05) / (Math.min(lg, li) + 0.05);
      expect(contrast).toBeGreaterThan(4.5);
    }
  });
});

describe('color helpers', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(...hexToRgb('#ff9c5d'))).toBe('#ff9c5d');
  });
  it('treats malformed hex as grey', () => {
    expect(hexToRgb('nope')).toEqual([0.5, 0.5, 0.5]);
  });
  it('formats hours', () => {
    expect(formatHour(17.5)).toBe('17:30');
    expect(formatHour(23.999)).toBe('00:00');
    expect(formatHour(6)).toBe('06:00');
  });
});
