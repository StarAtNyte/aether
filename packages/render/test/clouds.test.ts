import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { CLOUD_TEXTURE_SIZE, CloudLayer, cloudPixels, cloudUv, COVER_STEP, quantiseCover } from '../src/environment/clouds';
import { computeSkyState } from '../src/environment/sky-state';
import { SkyDome, SKY_RADIUS } from '../src/environment/sky-dome';

/** Fractal noise stand-in: a deterministic ramp, enough to test the threshold logic. */
function ramp(size: number): Float32Array {
  const f = new Float32Array(size * size);
  for (let i = 0; i < f.length; i++) f[i] = (i % size) / size;
  return f;
}

describe('cloud pixels', () => {
  it('cover moves the threshold: more cover, more opaque pixels', () => {
    const noise = ramp(64);
    const opaque = (cover: number): number => {
      const px = cloudPixels(64, cover, noise);
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if ((px[i] as number) > 127) n++;
      return n;
    };
    expect(opaque(0)).toBe(0);
    expect(opaque(0.3)).toBeGreaterThan(0);
    expect(opaque(0.9)).toBeGreaterThan(opaque(0.3));
  });
  it('thick cores are darker than thin edges and the colour channels agree', () => {
    const px = cloudPixels(64, 0.6, ramp(64));
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(px[i + 1]);
      expect(px[i]).toBe(px[i + 2]);
    }
    const row = (x: number): number => px[x * 4] as number;
    expect(row(63)).toBeLessThan(row(20));
  });
  it('quantises cover and survives bad values', () => {
    expect(quantiseCover(0.52)).toBeCloseTo(0.5);
    expect(quantiseCover(Number.NaN)).toBe(0);
    expect(quantiseCover(-2)).toBe(0);
    expect(quantiseCover(7)).toBe(1);
    expect(COVER_STEP).toBeGreaterThan(0);
  });
});

describe('cloud plane projection', () => {
  it('converges towards the horizon and stays finite below it', () => {
    const o: [number, number] = [0, 0];
    cloudUv(0.6, 0.1, 0.8, o);
    const low = Math.hypot(o[0], o[1]);
    cloudUv(0.2, 0.97, 0.1, o);
    const high = Math.hypot(o[0], o[1]);
    expect(low).toBeGreaterThan(high);
    cloudUv(1, -0.5, 0, o);
    expect(Number.isFinite(o[0]) && Number.isFinite(o[1])).toBe(true);
  });
});

describe('CloudLayer', () => {
  it('rebuilds the texture only when the quantised cover changes, and hides in clear skies', () => {
    const layer = new CloudLayer(SKY_RADIUS * 0.98);
    const haze = new Color('#cccccc');
    layer.apply(computeSkyState({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 }), haze);
    expect(layer.mesh.visible).toBe(true);
    const first = layer.coverage;
    expect(first).toBeGreaterThan(0.3);
    layer.apply(computeSkyState({ sky: 'sunset', sunIntensity: 2.5, ambientIntensity: 0.4 }), haze);
    expect(layer.coverage).toBeCloseTo(0.5);
    layer.apply(computeSkyState({ sky: 'overcast', sunIntensity: 2.5, ambientIntensity: 0.4 }), haze);
    expect(layer.coverage).toBeGreaterThan(0.8);
    layer.apply(computeSkyState({ sky: 'space', sunIntensity: 2.5, ambientIntensity: 0.4 }), haze);
    expect(layer.mesh.visible).toBe(false);
    layer.dispose();
  });
  it('lights the dome per vertex and fades into the haze at the horizon', () => {
    const layer = new CloudLayer(SKY_RADIUS * 0.98);
    const haze = new Color('#ff00ff');
    layer.apply(computeSkyState({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 }), haze);
    const pos = layer.mesh.geometry.getAttribute('position');
    const col = layer.mesh.geometry.getAttribute('color');
    let horizonSeen = false;
    let zenithSeen = false;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / SKY_RADIUS;
      if (y < 0.005) {
        expect(col.getX(i)).toBeCloseTo(haze.r, 3);
        expect(col.getY(i)).toBeCloseTo(haze.g, 3);
        horizonSeen = true;
      }
      if (y > 0.9) {
        expect(col.getY(i)).toBeGreaterThan(0.1);
        zenithSeen = true;
      }
    }
    expect(horizonSeen && zenithSeen).toBe(true);
    layer.dispose();
  });
  it('is part of the sky dome and disposes with it', () => {
    const dome = new SkyDome();
    expect(dome.group.children).toContain(dome.clouds.mesh);
    dome.apply(computeSkyState({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 }));
    expect(dome.clouds.mesh.visible).toBe(true);
    dome.dispose();
    expect(CLOUD_TEXTURE_SIZE & (CLOUD_TEXTURE_SIZE - 1)).toBe(0);
  });
});
