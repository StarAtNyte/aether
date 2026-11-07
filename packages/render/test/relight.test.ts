import { describe, expect, it } from 'vitest';
import {
  PART_LAMP,
  PART_SKY0,
  PART_SKY1,
  PART_SUN0,
  SUN_KEYS,
  SUN_KEY_ANCHORS,
  groundFactors,
  partCount,
  relightCoefficients,
  sunKeyDirections,
  sunKeyHours,
  sunKeyWeights,
  type RelightLighting,
} from '../src/environment/relight';

type V3 = readonly [number, number, number];

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const KEYS: V3[] = [norm([1, 0.2, 0]), norm([0.5, 1, 0]), norm([-0.5, 1, 0]), norm([-1, 0.2, 0])];

describe('relight: sun keys', () => {
  it('hours increase within the arc and the directions end with the moon', () => {
    expect(SUN_KEYS).toBe(14);
    expect(sunKeyHours(SUN_KEYS)).toEqual(sunKeyHours());
    // The anchors are always keys; the count clamps to the anchors..15.
    expect(sunKeyHours(1).length).toBe(SUN_KEY_ANCHORS.length);
    expect(sunKeyHours(99).length).toBe(15);
    for (const n of [SUN_KEY_ANCHORS.length, 10, SUN_KEYS, 15]) {
      const h = sunKeyHours(n);
      expect(h.length).toBe(n);
      for (const a of SUN_KEY_ANCHORS) expect(h).toContain(a);
      expect(h[0]).toBeGreaterThanOrEqual(6.1 - 1e-3);
      expect(h[n - 1]).toBeLessThanOrEqual(17.9 + 1e-3);
      for (let i = 1; i < n; i++) expect(h[i]!).toBeGreaterThan(h[i - 1]!);
    }
    const dirs = sunKeyDirections();
    expect(dirs.length).toBe(SUN_KEYS + 1);
    expect(dirs.length).toBe(15);
    for (const d of dirs) expect(Math.hypot(...d)).toBeCloseTo(1, 5);
    expect(partCount(dirs.length)).toBe(PART_SUN0 + dirs.length);
  });

  it('weights 1 on a key and interpolates between neighbours', () => {
    for (let k = 0; k < KEYS.length; k++) {
      const w = sunKeyWeights(KEYS, KEYS[k]!);
      expect(w.i).toBe(k);
      expect(w.wi).toBe(1);
      expect(w.wj).toBe(0);
    }
    // Halfway (by angle) between keys 1 and 2: both 0.5.
    const a = Math.atan2(KEYS[1]![1], KEYS[1]![0]), b = Math.atan2(KEYS[2]![1], KEYS[2]![0]);
    const mid: V3 = [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0];
    const w = sunKeyWeights(KEYS, mid);
    expect([w.i, w.j].sort()).toEqual([1, 2]);
    expect(w.wi).toBeCloseTo(0.5, 5);
    expect(w.wj).toBeCloseTo(0.5, 5);
    // A quarter of the way from key 1 to key 2: 0.75 on key 1.
    const q = (a * 3 + b) / 4;
    const w2 = sunKeyWeights(KEYS, [Math.cos(q), Math.sin(q), 0]);
    expect(w2.i).toBe(1);
    expect(w2.wi).toBeCloseTo(0.75, 5);
    expect(w2.wi + w2.wj).toBeCloseTo(1, 6);
    // One key only: all of it.
    expect(sunKeyWeights([KEYS[0]!], KEYS[2]!)).toMatchObject({ i: 0, wi: 1, wj: 0 });
  });
});

describe('relight: coefficients', () => {
  const light: RelightLighting = {
    sun: { direction: KEYS[2]!, irradiance: [3, 2, 1] },
    ambient: { a: [0.1, 0.2, 0.3], b: [-0.4, 0.5, -0.6] },
    lampScale: 0.7,
  };

  it('puts the sky, the lamp scale and the sun irradiance in their slots', () => {
    const c = relightCoefficients(KEYS, light);
    expect(c.length).toBe(partCount(KEYS.length) * 3);
    const at = (p: number): number[] => [c[p * 3]!, c[p * 3 + 1]!, c[p * 3 + 2]!];
    expect(at(PART_SKY0)).toEqual([0.1, 0.2, 0.3].map(Math.fround));
    expect(at(PART_SKY1)).toEqual([-0.4, 0.5, -0.6].map(Math.fround));
    expect(at(PART_LAMP)).toEqual([0.7, 0.7, 0.7].map(Math.fround));
    expect(at(PART_SUN0 + 2)).toEqual([3, 2, 1]);
    for (const k of [0, 1, 3]) expect(at(PART_SUN0 + k)).toEqual([0, 0, 0]);
  });

  it('an in-between sun splits its irradiance, no sun and a bad lamp scale give zeros', () => {
    const a = Math.atan2(KEYS[1]![1], KEYS[1]![0]), b = Math.atan2(KEYS[2]![1], KEYS[2]![0]);
    const q = (a * 3 + b) / 4;
    const c = relightCoefficients(KEYS, { ...light, sun: { direction: [Math.cos(q), Math.sin(q), 0], irradiance: [4, 4, 4] } });
    expect(c[(PART_SUN0 + 1) * 3]).toBeCloseTo(3, 4);
    expect(c[(PART_SUN0 + 2) * 3]).toBeCloseTo(1, 4);
    const none = relightCoefficients(KEYS, { ...light, sun: null, lampScale: Number.NaN });
    for (let k = 0; k < KEYS.length; k++) expect(none[(PART_SUN0 + k) * 3]).toBe(0);
    expect(none[PART_LAMP * 3]).toBe(0);
    // Writes into a given buffer.
    const out = new Float32Array(partCount(KEYS.length) * 3).fill(9);
    expect(relightCoefficients(KEYS, light, out)).toBe(out);
    expect(out[(PART_SUN0 + 0) * 3]).toBe(0);
  });

  it('ground factors: the sky parts see the whole ground, a key its sine of elevation, the lamps none', () => {
    const g = groundFactors(KEYS);
    expect(g[PART_SKY0]).toBe(1);
    expect(g[PART_SKY1]).toBe(1);
    expect(g[PART_LAMP]).toBe(0);
    KEYS.forEach((k, i) => expect(g[PART_SUN0 + i]).toBeCloseTo(Math.max(0, k[1]), 6));
  });
});

describe('baked light version', () => {
  it('names the versions of every part of the format (bump it with any of them)', async () => {
    const { BAKED_LIGHT_VERSION, RELIGHT_VERSION } = await import('../src/environment/relight');
    const { LIGHTMAP_VERSION } = await import('../src/environment/lightmap');
    const { VOLUME_BAKE_VERSION } = await import('../src/environment/light-volume-cache');
    const { VOLUME_ASSET_VERSION } = await import('../src/environment/light-volume-asset');
    expect(BAKED_LIGHT_VERSION).toBe(`r${RELIGHT_VERSION}.lm${LIGHTMAP_VERSION}.lv${VOLUME_BAKE_VERSION}.a${VOLUME_ASSET_VERSION}`);
  });
});
