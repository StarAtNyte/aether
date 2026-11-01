import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorld, type WorldDoc } from '@aether/core';
import { HARDCORE_PASSES, bibleText, heroShots, lumaPercentiles, meanTargets, passPrompt, referencePrompt, targetEvidenceText } from '../src/hardcore';

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
});
