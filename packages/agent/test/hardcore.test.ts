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

  it('frames hero shots of a block world from its spawn and block edits, above the generated land', () => {
    const tpl = (slug: string): WorldDoc => createWorld((JSON.parse(readFileSync(fileURLToPath(new URL(`../../../apps/studio/public/templates/worlds/${slug}.json`, import.meta.url)), 'utf8')) as { world: WorldDoc }).world);
    // A rolling ground that rises to the east, the way generated land would.
    const groundAt = (x: number, z: number) => 60 + Math.round(x / 4) + Math.round(Math.sin(z / 6) * 5);
    for (const slug of ['blockfall', 'survival-world']) {
      const world = tpl(slug);
      expect(Object.keys(world.entities)).toEqual([]);
      const shots = heroShots(world, { groundAt });
      expect(shots.map((s) => s.name)).toEqual(['hero-establishing', 'hero-street', 'hero-landmark', 'hero-rooftops']);
      for (const s of shots) {
        const [x, y, z] = s.pose.position as [number, number, number];
        const t = s.pose.target as [number, number, number];
        for (const v of [x, y, z, ...t]) expect(Number.isFinite(v)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(groundAt(x, z) + 1.7);
        expect(t[1]).toBeGreaterThanOrEqual(groundAt(t[0], t[2]) + 1);
        // Every camera stays within reach of the spawn, where the terrain streams in.
        expect(Math.hypot(x - world.player.spawn[0], z - world.player.spawn[2])).toBeLessThan(120);
        // It looks across the place, never straight down (a spawn at the centre of the frame gives no side to come from).
        expect(Math.hypot(t[0] - x, t[2] - z), `${slug} ${s.name}`).toBeGreaterThan(8);
        // And the land never hides what it looks at.
        for (let f = 0.1; f < 0.95; f += 0.05) {
          const qx = x + (t[0] - x) * f;
          const qz = z + (t[2] - z) * f;
          expect(y + (t[1] - y) * f, `${slug} ${s.name} at ${f.toFixed(2)}`).toBeGreaterThanOrEqual(groundAt(qx, qz) + 1.5);
        }
      }
      // The street shot stands on the spawn, at eye height unless a rise hides the landmark.
      const sp = world.player.spawn;
      expect(shots[1]!.pose.position[1]).toBeGreaterThanOrEqual(groundAt(sp[0], sp[2]) + 1.7);
      expect(shots[1]!.pose.position[1]).toBeLessThan(groundAt(sp[0], sp[2]) + 30);
    }
    // What the edits built (a castle keep 25 blocks over the land) is cleared and looked over, like the land.
    const keep = (x: number, z: number) => (Math.hypot(x - 17, z - 28) < 14 ? groundAt(17, 28) + 25 : -1);
    const solid = (x: number, z: number) => Math.max(groundAt(x, z), keep(x, z));
    for (const s of heroShots(tpl('blockfall'), { groundAt, builtAt: keep })) {
      const p = s.pose.position as [number, number, number];
      const t = s.pose.target as [number, number, number];
      expect(p[1], s.name).toBeGreaterThanOrEqual(solid(p[0], p[2]) + 1.7);
      for (let f = 0.1; f < 0.95; f += 0.05) expect(p[1] + (t[1] - p[1]) * f, `${s.name} at ${f.toFixed(2)}`).toBeGreaterThanOrEqual(solid(p[0] + (t[0] - p[0]) * f, p[2] + (t[2] - p[2]) * f) + 1.5);
    }
    // Without a ground function the land is taken to lie just above the sea, never at y 0.
    for (const s of heroShots(tpl('survival-world'))) expect(s.pose.position[1]).toBeGreaterThan(40);
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
