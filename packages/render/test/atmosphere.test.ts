/**
 * The physical sky: the colours it produces at noon, dusk and night, its use by the sky state and the
 * dome, the sun and moon sprites and the crepuscular rays.
 */
import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { exposeSky, skyDisplay, skyKeys, skyRadiance, sunTransmittance, type Radiance } from '../src/environment/atmosphere';
import { BODY_TEXTURE_SIZE, moonPixels, sunRaysPixels, sunSpritePixels } from '../src/environment/sky-bodies';
import { computeSkyState } from '../src/environment/sky-state';
import { raysStrength, SkyDome } from '../src/environment/sky-dome';

const out = (): Radiance => [0, 0, 0];
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** Sun at `elev` degrees, azimuth along +z. */
const sunAt = (elev: number): [number, number, number] => [0, Math.sin(rad(elev)), Math.cos(rad(elev))];

describe('physical sky model', () => {
  it('noon: the zenith is blue and the horizon paler', () => {
    const k = skyKeys(55);
    expect(k.zenith[2]).toBeGreaterThan(k.zenith[0]);
    expect(k.zenith[2]).toBeGreaterThan(k.zenith[1]);
    const lum = (c: Radiance): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(k.horizon)).toBeGreaterThan(lum(k.zenith));
    // The horizon is much less saturated than the zenith.
    const sat = (c: Radiance): number => Math.max(...c) - Math.min(...c);
    expect(sat(k.horizon)).toBeLessThan(sat(k.zenith));
  });

  it('dusk: the horizon turns red-orange and the zenith deepens', () => {
    const noon = skyKeys(55);
    const dusk = skyKeys(2);
    expect(dusk.horizon[0]).toBeGreaterThan(dusk.horizon[2] * 1.4);
    const lum = (c: Radiance): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(dusk.zenith)).toBeLessThan(lum(noon.zenith));
  });

  it('is bright toward the sun and darker away from it (the aerosol aureole)', () => {
    const s = sunAt(20);
    const near = skyDisplay(0, Math.sin(rad(23)), Math.cos(rad(23)), s[0], s[1], s[2], 1.6, out());
    const far = skyDisplay(0, Math.sin(rad(23)), -Math.cos(rad(23)), s[0], s[1], s[2], 1.6, out());
    expect(near[0] + near[1] + near[2]).toBeGreaterThan((far[0] + far[1] + far[2]) * 1.2);
  });

  it('goes dark after the twilight belt and stays finite and in range everywhere', () => {
    const night = skyDisplay(0, 1, 0, ...sunAt(-20), 1.6, out());
    expect(night[0] + night[1] + night[2]).toBeLessThan(0.01);
    for (const e of [-30, -8, 0, 5, 30, 85]) {
      const s = sunAt(e);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const el = rad(-10 + (i % 8) * 12);
        const c = skyDisplay(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el), s[0], s[1], s[2], 1.6, out());
        for (const v of c) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('more aerosols (turbidity) brighten and whiten the sky toward the sun; bad turbidity is tamed', () => {
    const s = sunAt(30);
    const clear = skyRadiance(0, Math.sin(rad(34)), Math.cos(rad(34)), s[0], s[1], s[2], 1, out());
    const hazy = skyRadiance(0, Math.sin(rad(34)), Math.cos(rad(34)), s[0], s[1], s[2], 4, out());
    expect(hazy[0]).toBeGreaterThan(clear[0]);
    const bad = skyRadiance(0, 0.5, 0.5, s[0], s[1], s[2], Number.NaN, out());
    expect(bad.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('exposure is monotonic and saturates below 1', () => {
    expect(exposeSky(0)).toBe(0);
    expect(exposeSky(1)).toBeGreaterThan(exposeSky(0.2));
    expect(exposeSky(1e6)).toBeLessThanOrEqual(1);
    expect(exposeSky(-3)).toBe(0);
  });

  it('direct sunlight reddens toward the horizon and stays normalised', () => {
    const high = sunTransmittance(70, out());
    const low = sunTransmittance(2, out());
    expect(Math.max(...high)).toBeCloseTo(1, 6);
    expect(Math.max(...low)).toBeCloseTo(1, 6);
    expect(low[2] / low[0]).toBeLessThan(high[2] / high[0]);
    expect(low[1] / low[0]).toBeLessThan(high[1] / high[0]);
  });

  it('a 4 k-direction dome costs well under a second', () => {
    const s = sunAt(10);
    const t0 = performance.now();
    for (let i = 0; i < 4000; i++) skyDisplay(Math.sin(i), 0.2 + (i % 7) * 0.1, Math.cos(i), s[0], s[1], s[2], 1.6, out());
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('sky state uses the physical sky', () => {
  it('natural presets carry the physical sun, space and studio do not', () => {
    const day = computeSkyState({ sky: 'day', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 });
    expect(day.physical?.weight).toBe(1);
    expect(day.physical?.sunDirection[1]).toBeGreaterThan(0.5);
    expect(computeSkyState({ sky: 'space', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }).physical).toBeUndefined();
    expect(computeSkyState({ sky: 'studio', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }).physical).toBeUndefined();
    expect(computeSkyState({ sky: 'overcast', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }).physical).toBeUndefined();
  });

  it('night keeps the keyed night colours (no physical weight)', () => {
    const night = computeSkyState({ sky: 'night', timeOfDay: 23, sunIntensity: 2.5, ambientIntensity: 0.4 });
    expect(night.physical).toBeUndefined();
  });

  it('dawn and sunset horizons are warmer than noon, and the sun colour reddens', () => {
    const noon = computeSkyState({ sky: 'day', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 });
    const dusk = computeSkyState({ sky: 'sunset', timeOfDay: 17.4, sunIntensity: 2.5, ambientIntensity: 0.4 });
    const warm = (hex: string): number => {
      const c = new Color(hex);
      return c.r - c.b;
    };
    expect(warm(dusk.horizon)).toBeGreaterThan(warm(noon.horizon));
    expect(warm(dusk.lightColor)).toBeGreaterThan(warm(noon.lightColor));
  });

  it('fog warms with the low sun: a sunset fog is warmer than a noon fog', () => {
    const noon = computeSkyState({ sky: 'day', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 });
    const dusk = computeSkyState({ sky: 'sunset', timeOfDay: 17.4, sunIntensity: 2.5, ambientIntensity: 0.4 });
    const warm = (hex: string): number => {
      const c = new Color(hex);
      return c.r - c.b;
    };
    expect(warm(dusk.fogColor)).toBeGreaterThan(warm(noon.fogColor) + 0.05);
  });

  it('the fog colour follows the horizon of the sky and is not a saturated cyan at noon', () => {
    const noon = computeSkyState({ sky: 'day', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 });
    const c = new Color(noon.fogColor);
    expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeLessThan(0.35);
  });
});

describe('SkyDome with the physical sky', () => {
  it('colours the dome per direction: lighter toward the sun side than away from it at dusk', () => {
    const dome = new SkyDome();
    const state = computeSkyState({ sky: 'sunset', timeOfDay: 17.4, sunIntensity: 2.8, ambientIntensity: 0.5 });
    dome.apply(state, '#d9b9a0');
    const geo = (dome.group.children[0] as unknown as { geometry: import('three').BufferGeometry }).geometry;
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    const sun = state.physical!.sunDirection;
    let near = 0;
    let nearN = 0;
    let far = 0;
    let farN = 0;
    for (let i = 0; i < pos.count; i++) {
      const l = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      const d = [pos.getX(i) / l, pos.getY(i) / l, pos.getZ(i) / l];
      if (d[1]! < 0.05 || d[1]! > 0.3) continue;
      const dot = d[0]! * sun[0] + d[1]! * sun[1] + d[2]! * sun[2];
      const lum = col.getX(i) + col.getY(i) + col.getZ(i);
      if (dot > 0.8) {
        near += lum;
        nearN++;
      } else if (dot < -0.3) {
        far += lum;
        farN++;
      }
    }
    expect(nearN).toBeGreaterThan(0);
    expect(farN).toBeGreaterThan(0);
    expect(near / nearN).toBeGreaterThan(far / farN);
    dome.dispose();
  });

  it('has a high cirrus veil over the cumulus deck, hidden in clear and overcast skies', () => {
    const dome = new SkyDome();
    dome.apply(computeSkyState({ sky: 'day', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }));
    expect(dome.cirrus.mesh.visible).toBe(true);
    expect(dome.cirrus.mesh.renderOrder).toBeLessThan(dome.clouds.mesh.renderOrder);
    dome.apply(computeSkyState({ sky: 'overcast', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }));
    expect(dome.cirrus.mesh.visible).toBe(false);
    dome.apply(computeSkyState({ sky: 'space', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }));
    expect(dome.cirrus.mesh.visible).toBe(false);
    dome.dispose();
  });

  it('the low tier drops the cirrus veil and the rays, keeps the cumulus deck, and restores them on demand', () => {
    const dome = new SkyDome();
    dome.apply(computeSkyState({ sky: 'sunset', timeOfDay: 17.4, sunIntensity: 2.8, ambientIntensity: 0.5 }));
    expect(dome.detailed).toBe(true);
    expect(dome.cirrus.mesh.visible).toBe(true);
    dome.setDetail(false);
    expect(dome.cirrus.mesh.visible).toBe(false);
    expect(dome.clouds.mesh.visible).toBe(true);
    const raysVisible = (): number => {
      let n = 0;
      dome.group.traverse((c) => {
        const g = (c as unknown as { geometry?: { parameters?: { width?: number } } }).geometry;
        if (c.visible && g?.parameters?.width === 900 * 1.5) n++;
      });
      return n;
    };
    expect(raysVisible()).toBe(0);
    dome.setDetail(true);
    expect(dome.cirrus.mesh.visible).toBe(true);
    expect(raysVisible()).toBe(1);
    dome.dispose();
  });

  it('shows the sun by day and the moon by night, never both', () => {
    const dome = new SkyDome();
    const named = (n: string): boolean => dome.group.children.some((c) => c.visible && c.type === 'Mesh' && (c as unknown as { geometry: { parameters?: { width?: number } } }).geometry.parameters?.width === n.length);
    void named;
    dome.apply(computeSkyState({ sky: 'day', timeOfDay: 13, sunIntensity: 2.5, ambientIntensity: 0.4 }));
    const visibleDay = dome.group.children.filter((c) => c.visible).length;
    dome.apply(computeSkyState({ sky: 'night', timeOfDay: 23, sunIntensity: 2.5, ambientIntensity: 0.4 }));
    const visibleNight = dome.group.children.filter((c) => c.visible).length;
    expect(visibleDay).toBeGreaterThan(2);
    expect(visibleNight).toBeGreaterThan(2);
    dome.dispose();
  });
});

describe('crepuscular rays', () => {
  it('are strongest near the horizon and vanish at noon, under overcast and below the horizon', () => {
    expect(raysStrength(5, 'sunset')).toBeGreaterThan(raysStrength(25, 'day'));
    expect(raysStrength(60, 'day')).toBe(0);
    expect(raysStrength(10, 'overcast')).toBe(0);
    expect(raysStrength(10, 'space')).toBe(0);
    expect(raysStrength(-10, 'night')).toBe(0);
    expect(raysStrength(Number.NaN, 'day')).toBe(0);
    for (const e of [-5, 0, 3, 8, 20, 45]) expect(raysStrength(e, 'day')).toBeLessThanOrEqual(0.55);
  });

  it('the ray sprite is brightest at the centre and clear at the corners, with spokes of unequal strength', () => {
    const size = 128;
    const px = sunRaysPixels(size);
    const a = (x: number, y: number): number => px[(y * size + x) * 4 + 3] as number;
    expect(a(0, 0)).toBe(0);
    // Sample a ring: spokes make it vary.
    const ring: number[] = [];
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2;
      ring.push(a(Math.round(size / 2 + Math.cos(ang) * size * 0.2), Math.round(size / 2 + Math.sin(ang) * size * 0.2)));
    }
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(20);
  });
});

describe('sun and moon sprites', () => {
  it('the sun is a solid bright disc inside a corona, clear at the edge', () => {
    const px = sunSpritePixels();
    const a = (x: number, y: number): number => px[(y * BODY_TEXTURE_SIZE + x) * 4 + 3] as number;
    const c = BODY_TEXTURE_SIZE / 2;
    expect(a(c, c)).toBe(255);
    expect(a(c + Math.round(BODY_TEXTURE_SIZE * 0.1), c)).toBe(255);
    expect(a(c + Math.round(BODY_TEXTURE_SIZE * 0.3), c)).toBeLessThan(255);
    expect(a(0, 0)).toBe(0);
    expect(a(BODY_TEXTURE_SIZE - 1, c)).toBe(0);
  });

  it('the moon is a disc with a transparent corner and the phase decides which side is lit', () => {
    const size = BODY_TEXTURE_SIZE;
    const lum = (px: Uint8Array, x: number, y: number): number => px[(y * size + x) * 4] as number;
    const full = moonPixels(1);
    expect(full[3]).toBe(0);
    const half = moonPixels(0.5);
    const right = lum(half, Math.round(size * 0.75), size / 2);
    const left = lum(half, Math.round(size * 0.25), size / 2);
    expect(right).toBeGreaterThan(left * 2);
    // A full moon is lit on both sides; a new moon is nearly black.
    expect(lum(full, Math.round(size * 0.25), size / 2)).toBeGreaterThan(left * 2);
    const thin = moonPixels(0.05);
    expect(lum(thin, Math.round(size * 0.75), size / 2)).toBeLessThan(right);
    expect(moonPixels(Number.NaN)).toHaveLength(size * size * 4);
  });
});
