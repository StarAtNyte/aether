import { describe, expect, it } from 'vitest';
import { animeEffects, degrade, effectsKey, effectsOf, resolveEffects } from '../src/gpu/finishing';
import { isPracticalMaterial, letterboxBar, parseHex, resolveSatsuei, SATSUEI_DEFAULTS } from '../src/gpu/satsuei';

describe('compositing layer (satsuei)', () => {
  it('is built into every anime chain that composites, never into a realistic one, and changes no realistic key', () => {
    for (const t of ['medium', 'high', 'ultra'] as const) {
      expect(animeEffects(effectsOf(t)).satsuei).toBe(true);
      expect(effectsOf(t).satsuei).toBeFalsy();
      expect(effectsKey(effectsOf(t))).toMatch(/^[01]+$/);
      expect(effectsKey(animeEffects(effectsOf(t)))).toBe(`${effectsKey({ ...animeEffects(effectsOf(t)), satsuei: false })}s`);
    }
    expect(animeEffects(effectsOf('low')).satsuei).toBe(false);
    // A chain that fails drops the layer before the shading passes.
    expect(degrade(animeEffects(effectsOf('medium')))?.dropped).toBe('satsuei');
    expect(resolveEffects(animeEffects(effectsOf('medium')), {}, new Set(['satsuei'])).satsuei).toBe(false);
  });

  it("takes the world's defaults, then the shot grade's fields over them", () => {
    const world = resolveSatsuei({ godRays: 0.6, gradientTop: '#ff8000', gradientAmount: 0.2 }, null);
    expect(world.godRays).toBe(0.6);
    expect(world.flare).toBe(SATSUEI_DEFAULTS.flare);
    expect(world.gradientTop).toEqual([1, 128 / 255, 0]);
    expect(world.gradientAmount).toBe(0.2);
    expect([world.exposureEv, world.saturation, world.contrast, world.temperature, world.bloom]).toEqual([0, 1, 1, 0, 1]);
    expect(world.vignette).toBeNull();
    expect(world.practicals).toBeNull();
    const shot = resolveSatsuei({ godRays: 0.6 }, { godRays: 0.1, exposureEv: -0.5, temperature: 0.3, vignette: 0.4, practicals: 1, letterbox: 1, gradientBottom: '#203060' });
    expect(shot.godRays).toBe(0.1);
    expect(shot.exposureEv).toBe(-0.5);
    expect(shot.temperature).toBe(0.3);
    expect(shot.vignette).toBe(0.4);
    expect(shot.practicals).toBe(1);
    expect(shot.letterbox).toBe(1);
    expect(shot.gradientBottom).toEqual([0x20 / 255, 0x30 / 255, 0x60 / 255]);
    // Null goes back to the world's defaults.
    expect(resolveSatsuei({ godRays: 0.6 }, null)).toEqual(resolveSatsuei({ godRays: 0.6 }, undefined));
  });

  it('clamps and ignores what is not a number or a colour', () => {
    const s = resolveSatsuei(null, { dust: 4, grain: -1, exposureEv: Number.NaN, saturation: 9, gradientTop: 'red', practicals: 3 });
    expect(s.dust).toBe(1);
    expect(s.grain).toBe(0);
    expect(s.exposureEv).toBe(0);
    expect(s.saturation).toBe(2);
    expect(s.gradientTop).toEqual(parseHex(SATSUEI_DEFAULTS.gradientTop));
    expect(s.practicals).toBe(1);
    expect(parseHex('#00ff00')).toEqual([0, 1, 0]);
    expect(parseHex('#0f0')).toBeNull();
  });

  it('the low tier drops the rays, flare and dust; a tiled capture what depends on the frame', () => {
    const look = { godRays: 0.5, flare: 0.5, dust: 0.5, chroma: 0.5, gradientAmount: 0.5, letterbox: 0.5 };
    const low = resolveSatsuei(look, null, { lowTier: true });
    expect([low.godRays, low.flare, low.dust]).toEqual([0, 0, 0]);
    expect(low.chroma).toBe(0.5);
    const tiled = resolveSatsuei(look, null, { tiled: true });
    expect([tiled.flare, tiled.chroma, tiled.gradientAmount, tiled.letterbox]).toEqual([0, 0, 0, 0]);
    expect(tiled.godRays).toBe(0.5);
  });

  it('letterbox bars reach 2.39:1 at full amount and nothing on a wider frame', () => {
    expect(letterboxBar(16 / 9, 1)).toBeCloseTo((1 - 16 / 9 / 2.39) / 2, 6);
    expect(letterboxBar(16 / 9, 0.5)).toBeCloseTo((1 - 16 / 9 / 2.39) / 4, 6);
    expect(letterboxBar(2.5, 1)).toBe(0);
    expect(letterboxBar(16 / 9, 0)).toBe(0);
  });

  it("practicals are the town's lights, not the sun or the sea's glitter", () => {
    for (const n of ['window_lit__emit', 'lantern_glow__emit', 'signal_red_on__emit', 'lighthouse_lamp__emit', 'vend_front__emit']) expect(isPracticalMaterial(n)).toBe(true);
    for (const n of ['sun_disc__emit', 'glitter__emit', 'glitter_hot__emit', 'moon', 'night_sky']) expect(isPracticalMaterial(n)).toBe(false);
    // A word inside another is not the word.
    expect(isPracticalMaterial('sunroom_lamp')).toBe(true);
  });
});
