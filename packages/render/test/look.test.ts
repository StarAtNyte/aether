/**
 * Art-direction invariants of the environment: every sky preset is distinct
 * and correct, the key light rakes across the default view, fog keeps the
 * content crisp while backdrop scenery fades, and the nebula / environment
 * map behave.
 */
import { describe, expect, it } from 'vitest';
import { Environment } from '@aether/core';
import {
  bearingDirection,
  computeSkyState,
  GOLDEN_SKY_DROP,
  MOON_BEARING,
  sunBearing,
  VIEW_AZIMUTH,
  type SkyPreset,
  type SkyState,
} from '../src/environment/sky-state';
import {
  FOGGY_BOOST,
  FOGGY_THRESHOLD,
  fogAmount,
  FOG_HORIZON_PULL,
  hazeDensity,
  maxContentFogDensity,
  resolveFog,
  worldFogDensity,
} from '../src/environment/fog';
import { nebulaAt, valueNoise3 } from '../src/environment/nebula';
import { ENV_MAP_HEIGHT, ENV_MAP_WIDTH, skyEnvironmentPixels } from '../src/environment/env-map';

const env = (input: Record<string, unknown> = {}): Environment => Environment.parse(input);
const PRESETS: SkyPreset[] = ['day', 'dawn', 'sunset', 'night', 'overcast', 'space', 'studio'];

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Bearing (degrees) of the key light relative to the default camera, from its direction. */
function bearingOf(s: SkyState): number {
  const [x, , z] = s.lightDirection;
  const phi = (Math.atan2(x, z) * 180) / Math.PI;
  return ((phi - VIEW_AZIMUTH + 540) % 360) - 180;
}

describe('sky presets', () => {
  it('all seven presets are visually distinct (zenith, horizon and key light)', () => {
    const looks = PRESETS.map((sky) => {
      const s = computeSkyState(env({ sky }));
      return `${s.zenith}|${s.horizon}|${s.lightColor}`;
    });
    expect(new Set(looks).size).toBe(PRESETS.length);
  });

  it('sunset has a warm orange horizon and a warm low key light from the side', () => {
    const s = computeSkyState(env({ sky: 'sunset' }));
    const [r, g, b] = rgb(s.horizon);
    expect(r).toBeGreaterThan(b + 60);
    expect(r).toBeGreaterThan(g);
    const [lr, , lb] = rgb(s.lightColor);
    expect(lr).toBeGreaterThan(lb + 40);
    expect(s.elevation).toBeGreaterThan(5);
    expect(s.elevation).toBeLessThan(12);
    expect(s.moon).toBe(false);
    expect(s.stars).toBe(0);
    // From the camera's left, slightly behind the content — never straight into the lens.
    const bearing = bearingOf(s);
    expect(bearing).toBeLessThan(-80);
    expect(bearing).toBeGreaterThan(-115);
  });

  it('dawn comes from the opposite side to sunset and is pinker / softer', () => {
    const dawn = computeSkyState(env({ sky: 'dawn' }));
    const sunset = computeSkyState(env({ sky: 'sunset' }));
    expect(bearingOf(dawn)).toBeGreaterThan(60);
    expect(bearingOf(dawn)).toBeLessThan(100);
    expect(Math.sign(bearingOf(dawn))).not.toBe(Math.sign(bearingOf(sunset)));
    const [dr, , db] = rgb(dawn.horizon);
    expect(dr).toBeGreaterThan(db);
    expect(rgb(dawn.zenith)[2]).toBeGreaterThan(rgb(dawn.zenith)[0]);
  });

  it('golden-hour skies are sampled lower than the light (deeper color than the light elevation alone)', () => {
    const sunset = computeSkyState(env({ sky: 'sunset' }));
    // The same elevation on a day preset (hour outside the day window is clamped, so compare via drop).
    expect(GOLDEN_SKY_DROP).toBeGreaterThan(0);
    const day = computeSkyState(env({ sky: 'day' }));
    expect(rgb(sunset.horizon)[2]).toBeLessThan(rgb(day.horizon)[2]);
    expect(sunset.sunGlowStrength).toBeGreaterThan(day.sunGlowStrength);
  });

  it('day light comes from front-left and high, with a blue sky', () => {
    const s = computeSkyState(env({ sky: 'day' }));
    expect(s.elevation).toBeGreaterThan(40);
    const bearing = bearingOf(s);
    expect(bearing).toBeLessThan(-30);
    expect(bearing).toBeGreaterThan(-100);
    const [r, , b] = rgb(s.zenith);
    expect(b).toBeGreaterThan(r + 80);
  });

  it('night is moonlit from behind-right, readable, starry, with a faint galactic band', () => {
    const s = computeSkyState(env({ sky: 'night' }));
    expect(s.moon).toBe(true);
    expect(bearingOf(s)).toBeCloseTo(MOON_BEARING, 0);
    expect(s.lightDirection[1]).toBeGreaterThan(0.5);
    expect(s.lightIntensity).toBeGreaterThanOrEqual(0.5);
    expect(s.stars).toBeGreaterThan(0.9);
    expect(s.nebula).toBeGreaterThan(0);
    expect(s.nebula).toBeLessThan(0.5);
    expect(s.exposure).toBeGreaterThan(1.3);
  });

  it('overcast is a dim grey-blue, near-shadowless sky; studio a bright neutral one', () => {
    const overcast = computeSkyState(env({ sky: 'overcast' }));
    const studio = computeSkyState(env({ sky: 'studio' }));
    const day = computeSkyState(env({ sky: 'day' }));
    const lum = (hex: string): number => rgb(hex).reduce((a, b) => a + b, 0) / 3;
    expect(lum(studio.zenith) - lum(overcast.zenith)).toBeGreaterThan(50);
    expect(lum(studio.horizon) - lum(overcast.horizon)).toBeGreaterThan(40);
    const [r, , b] = rgb(overcast.zenith);
    expect(b).toBeGreaterThan(r);
    expect(overcast.lightIntensity).toBeLessThan(day.lightIntensity * 0.3);
    // Studio keeps a full-strength key light (crisp product-shot shadows).
    expect(studio.lightIntensity).toBeCloseTo(day.lightIntensity, 6);
  });

  it('space has a full nebula and no haze; overcast and studio have none', () => {
    expect(computeSkyState(env({ sky: 'space' })).nebula).toBe(1);
    expect(computeSkyState(env({ sky: 'overcast' })).nebula).toBe(0);
    expect(computeSkyState(env({ sky: 'studio' })).nebula).toBe(0);
    expect(computeSkyState(env({ sky: 'day' })).nebula).toBe(0);
  });

  it('the sun bearing never points the camera into the sun and moves right → left through the day', () => {
    let prev = Infinity;
    for (let h = 6; h <= 18; h += 0.25) {
      const b = sunBearing(h);
      expect(Math.abs(b)).toBeLessThanOrEqual(110);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
    const d = bearingDirection(0, 0);
    expect(d[0]).toBeCloseTo(Math.sin((VIEW_AZIMUTH * Math.PI) / 180), 6);
    expect(Math.hypot(...bearingDirection(37, 21))).toBeCloseTo(1, 6);
  });
});

describe('fog policy', () => {
  it('fogAmount follows FogExp2', () => {
    expect(fogAmount(0, 100)).toBe(0);
    expect(fogAmount(0.01, 100)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(fogAmount(-1, 100)).toBe(0);
  });

  it('content stays crisp at any size: its far edge from the framing distance is under 6 % fog', () => {
    for (const r of [6, 12, 25, 50, 100, 150]) {
      expect(fogAmount(maxContentFogDensity(r), 3.5 * r)).toBeLessThan(0.06);
    }
  });

  it('preset haze makes backdrop scenery atmospheric but visible', () => {
    for (const r of [10, 25, 50]) {
      const at = fogAmount(hazeDensity(1, r), 2.5 * r + 110);
      expect(at).toBeGreaterThan(0.15);
      expect(at).toBeLessThan(0.45);
    }
    expect(hazeDensity(0, 20)).toBe(0);
  });

  it('light world fog is capped; explicitly foggy worlds thicken up to the boost', () => {
    const r = 20;
    const cap = maxContentFogDensity(r);
    expect(worldFogDensity(0.001, r)).toBe(0.001);
    expect(worldFogDensity(FOGGY_THRESHOLD, r)).toBe(Math.min(FOGGY_THRESHOLD, cap));
    expect(worldFogDensity(0.04, r)).toBeGreaterThan(cap);
    expect(worldFogDensity(1, r)).toBeCloseTo(cap * FOGGY_BOOST, 10);
    let prev = 0;
    for (let w = 0; w <= 0.3; w += 0.005) {
      const d = worldFogDensity(w, r);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = d;
    }
  });

  it('fog color is pulled toward the sky horizon; space and ground-less worlds have no haze', () => {
    const sky = computeSkyState(env({ sky: 'day' }));
    const fog = resolveFog(env({ sky: 'day', fog: { color: '#00ff00', density: 0.01 } }), sky, 20);
    expect(fog).not.toBeNull();
    expect(FOG_HORIZON_PULL).toBeGreaterThan(0.5);
    const [r, g] = rgb(fog!.color);
    expect(g).toBeLessThan(255);
    expect(r).toBeGreaterThan(100);
    expect(resolveFog(env({ sky: 'space', ground: null }), computeSkyState(env({ sky: 'space' })), 20)).toBeNull();
    expect(resolveFog(env({ sky: 'day', ground: null }), sky, 20)).toBeNull();
    expect(resolveFog(env({ sky: 'day' }), sky, 20)?.color).toBe(sky.fogColor);
  });
});

describe('nebula', () => {
  it('is deterministic, bounded and off at strength 0', () => {
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    nebulaAt(0.3, 0.5, -0.81, 1, a);
    nebulaAt(0.3, 0.5, -0.81, 1, b);
    expect(a).toEqual(b);
    let max = 0;
    let lit = 0;
    for (let i = 0; i < 400; i++) {
      const t = i * 0.37;
      const d: [number, number, number] = [Math.cos(t) * Math.sin(i * 0.11), Math.cos(i * 0.11), Math.sin(t) * Math.sin(i * 0.11)];
      nebulaAt(d[0], d[1], d[2], 1, a);
      max = Math.max(max, ...a);
      if (a[0] + a[1] + a[2] > 0.05) lit++;
    }
    expect(max).toBeLessThan(0.9);
    expect(lit).toBeGreaterThan(20);
    nebulaAt(0.3, 0.5, -0.81, 0, a);
    expect(a).toEqual([0, 0, 0]);
    for (let i = 0; i < 50; i++) {
      const v = valueNoise3(i * 0.7, i * 1.3, i * 0.2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('sky environment map', () => {
  it('is sky-colored above the horizon and ground-colored below', () => {
    const s = computeSkyState(env({ sky: 'day' }));
    const px = skyEnvironmentPixels(s, '#3c8a2e');
    expect(px.length).toBe(ENV_MAP_WIDTH * ENV_MAP_HEIGHT * 4);
    const top = (ENV_MAP_HEIGHT - 1) * ENV_MAP_WIDTH * 4;
    // Zenith row: bluish. Bottom row: dark, greenish ground bounce.
    expect(px[top + 2]!).toBeGreaterThan(px[top]!);
    expect(px[1]!).toBeGreaterThan(px[2]!);
    expect(px[0]! + px[1]! + px[2]!).toBeLessThan(px[top]! + px[top + 1]! + px[top + 2]!);
  });
});

describe('post vignette and bloom', () => {
  it('leaves the center untouched and darkens the corners subtly', async () => {
    const { vignetteFactor, VIGNETTE_STRENGTH, bloomStrength, MAX_BLOOM_STRENGTH } = await import('../src/gpu/post');
    expect(vignetteFactor(0)).toBe(1);
    expect(vignetteFactor(0.3)).toBe(1);
    expect(vignetteFactor(Math.SQRT1_2)).toBeLessThan(1);
    expect(vignetteFactor(Math.SQRT1_2)).toBeGreaterThanOrEqual(1 - VIGNETTE_STRENGTH);
    expect(VIGNETTE_STRENGTH).toBeLessThan(0.35);
    expect(bloomStrength(100)).toBe(MAX_BLOOM_STRENGTH);
    expect(bloomStrength(Number.NaN)).toBe(0);
  });

  it('`visibility` gives aerial perspective on large worlds that the content policy would keep clear', () => {
    const sky = computeSkyState(env({ sky: 'day' }));
    const plain = resolveFog(env({ sky: 'day', fog: { color: '#cfdde8', density: 0.004 } }), sky, 400);
    const aerial = resolveFog(env({ sky: 'day', fog: { color: '#cfdde8', density: 0.004, visibility: 600 } }), sky, 400);
    expect(plain!.density).toBeLessThan(0.001);
    expect(aerial!.density).toBeCloseTo(1 / 600, 6);
    // A mountain 400 m away is clearly hazed (> 35 %), the foreground 20 m away is not (< 0.2 %).
    expect(fogAmount(aerial!.density, 400)).toBeGreaterThan(0.35);
    expect(fogAmount(aerial!.density, 20)).toBeLessThan(0.002);
  });
});
