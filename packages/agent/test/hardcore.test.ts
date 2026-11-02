import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { HARDCORE_PASSES, HARDCORE_SHADER_BUDGET_PATCH, bibleText, heroShots, lookCandidates, lookDistance, lumaPercentiles, meanTargets, passPrompt, pictureColour, referencePrompt, targetEvidenceText } from '../src/hardcore';

const lisbon = (): WorldDoc => createWorld((JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/studio/public/templates/worlds/lisbon-hills.json', import.meta.url)), 'utf8')) as { world: WorldDoc }).world);

describe('hardcore mode', () => {
  it('measures luminance percentiles and averages them', () => {
    const px = new Uint8Array(400 * 4);
    for (let i = 0; i < 400; i++) px.fill(i < 200 ? 20 : 220, i * 4, i * 4 + 3);
    const t = lumaPercentiles(px);
    expect(t?.p10).toBe(20);
    expect(t?.p90).toBe(220);
    expect(meanTargets([t!, { ...t!, p50: t!.p50 + 10 }])?.p50).toBe(t!.p50 + 5);
  });

  it('frames four hero shots of a real world, deterministically', () => {
    const shots = heroShots(lisbon());
    expect(shots.map((s) => s.name)).toEqual(['hero-establishing', 'hero-street', 'hero-landmark', 'hero-rooftops']);
    expect(heroShots(lisbon())).toEqual(shots);
    for (const s of shots) for (const v of [...s.pose.position, ...s.pose.target]) expect(Number.isFinite(v)).toBe(true);
    expect(heroShots(createWorld())).toEqual([]);
  });

  it('writes the reference prompt, the bible, the pass prompts and the target evidence', () => {
    const shots = heroShots(lisbon());
    expect(referencePrompt('a hillside town', shots[0]!)).toContain('establishing');
    const bible = bibleText('a hillside town', shots, { p02: 10, p10: 30, p50: 100, p90: 200, p98: 235 }, 'warm light');
    expect(bible).toContain('hero-street');
    expect(passPrompt(HARDCORE_PASSES[1]!, 1, bible)).toContain('PASS 2 of 6');
    const ev = targetEvidenceText([{ name: 'hero-street', luma: { p02: 60, p10: 90, p50: 160, p90: 200, p98: 240 } }], { p02: 10, p10: 30, p50: 100, p90: 200, p98: 235 });
    expect(ev).toContain('brighter overall');
    expect(ev).toContain('milky');
  });

  it('scores looks: a render like the references is closer than a washed-out one', () => {
    const img = (sky: number[], ground: number[]) => {
      const w = 6, h = 6, px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = y < 2 ? sky : ground; px.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4); }
      return pictureColour(px, w, h)!;
    };
    const ref = img([70, 130, 210], [170, 110, 80]);
    const close = img([80, 135, 200], [160, 105, 85]);
    const washed = img([235, 235, 240], [200, 190, 180]);
    expect(lookDistance([close], [ref])).toBeLessThan(lookDistance([washed], [ref]));
    expect(lookCandidates().length).toBeGreaterThan(9);
    // The analytic sky comes first and clears any picture sky.
    expect(lookCandidates()[0]).toMatchObject({ hdri: null, sky: 'day' });
  });
  it('gives the refined world the hero shader budget, keeping the rest of its look, and says so in the detail pass', () => {
    const w = applyPatches(createWorld({}), [{ op: 'setEnvironment', set: { look: { foliageTint: '#ddeecc' } } }]).world;
    const r = applyPatches(w, [HARDCORE_SHADER_BUDGET_PATCH]);
    expect(r.errors).toEqual([]);
    expect(r.world.environment.look).toMatchObject({ shaderBudget: 'hero', foliageTint: '#ddeecc' });
    const detail = HARDCORE_PASSES.find((p) => p.id === 'detail')!;
    expect(detail.brief).toContain('material.surface');
    expect(detail.brief).toContain('hero shader budget');
  });
});
