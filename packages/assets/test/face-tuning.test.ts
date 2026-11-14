import { describe, expect, it } from 'vitest';
import { CAST_FACES, castById, faceMorphWeights } from '../src/characters/library';

const FACES = ['smile', 'sad', 'surprised', 'teary', 'blink', 'mouth_open', 'determined'];
/** The caps the VRM bodies' faces must stay within (VRM presets at full weight are extreme anime poses). */
const LIMITS: Record<string, [number, number]> = {
  mouth_open: [0.25, 0.4],
  smile: [0.5, 0.6],
  blink: [1, 1],
  sad: [0.4, 0.55],
  surprised: [0.4, 0.55],
  determined: [0.4, 0.55],
};

describe('VRM face tuning (kaho-vrm, mio-vrm)', () => {
  for (const id of ['kaho-vrm', 'mio-vrm']) {
    const t = CAST_FACES[id]!;
    it(`${id}: caps within the limits`, () => {
      expect(t).toBeDefined();
      for (const [m, [lo, hi]] of Object.entries(LIMITS)) {
        expect(t.caps[m], m).toBeGreaterThanOrEqual(lo);
        expect(t.caps[m], m).toBeLessThanOrEqual(hi);
      }
    });
    it(`${id}: every asked expression, alone or all at once at full weight, shows within its morph's cap`, () => {
      for (const f of FACES) {
        for (const [m, w] of Object.entries(faceMorphWeights(t, { [f]: 1 }))) expect(w, `${f} -> ${m}`).toBeLessThanOrEqual(LIMITS[m]?.[1] ?? 0.55);
      }
      const all = faceMorphWeights(t, Object.fromEntries(FACES.map((f) => [f, 1])));
      for (const [m, w] of Object.entries(all)) expect(w, m).toBeLessThanOrEqual(LIMITS[m]?.[1] ?? 0.55);
      // A story weight scales the cap (0.8 of a smile is 0.8 of the capped smile), and over 1 is clamped.
      expect(faceMorphWeights(t, { smile: 0.8 })['smile']).toBeCloseTo(0.8 * t.caps['smile']!);
      expect(faceMorphWeights(t, { mouth_open: 5 })['mouth_open']).toBeCloseTo(t.caps['mouth_open']!);
      // teary (no VRM morph) is drawn as a light sad.
      expect(faceMorphWeights(t, { teary: 1 })['sad']).toBeGreaterThan(0);
    });
    it(`${id}: the emotions are exclusive and the body carries the tuning`, () => {
      expect(t.exclusive).toEqual(expect.arrayContaining(['smile', 'sad', 'surprised', 'determined']));
      expect(t.exclusive).not.toContain('blink');
      expect(castById(id)?.face).toBe(t);
    });
  }
  it('the other bodies are untuned', () => {
    for (const id of ['kaho', 'mio', 'harbour-fisherman', 'marcus']) expect(castById(id)?.face).toBeUndefined();
  });
});
