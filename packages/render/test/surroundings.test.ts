import { describe, expect, it } from 'vitest';
import { computeSkyState } from '../src/environment/sky-state';
import { EMISSION_SOFT_CAP, capEmission } from '../src/materials/material-cache';
import { MAX_TREES, RANGE_MAX_DISTANCE, SURROUNDING_PRESETS, SurroundingsRig, daylightFactor, landHeight, planLand, planRanges, planTrees, resolveSurroundings, ridge } from '../src/environment/surroundings';
import { RANGE_TEX_H, RANGE_TEX_W, paintRange, rangeGeometry } from '../src/environment/mountain-range';

const sky = computeSkyState({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 });

describe('surroundings data', () => {
  it('resolves a preset with the world fields on top, and nothing for none or absent', () => {
    expect(resolveSurroundings(undefined)).toBeNull();
    expect(resolveSurroundings({ preset: 'none' })).toBeNull();
    expect(resolveSurroundings({})).toMatchObject({ ...SURROUNDING_PRESETS.countryside, seed: 1 });
    expect(resolveSurroundings({ preset: 'woodland', hills: 0, trees: 0.2 })).toMatchObject({ hills: 0, trees: 0.2, species: 'conifer' });
  });

  it('plans the same trees for the same data, outside the clear radius, within the budget', () => {
    const r = resolveSurroundings({ preset: 'countryside', seed: 7 })!;
    const a = planTrees(r);
    const b = planTrees(r);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(40);
    expect(a.length).toBeLessThanOrEqual(MAX_TREES);
    for (const t of a) expect(Math.hypot(t.x, t.z)).toBeGreaterThanOrEqual(r.clearRadius - 1e-6);
    expect(a.some((t) => t.conifer)).toBe(true);
    expect(a.some((t) => !t.conifer)).toBe(true);
    expect(planTrees({ ...r, seed: 8 })).not.toEqual(a);
    expect(planTrees({ ...r, trees: 0 })).toHaveLength(0);
  });

  it('draws a ridge that closes on itself and stays in range', () => {
    expect(ridge(3, 0)).toBeCloseTo(ridge(3, Math.PI * 2), 6);
    for (let i = 0; i < 64; i++) {
      const v = ridge(3, (i / 64) * Math.PI * 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(daylightFactor(60)).toBeGreaterThan(0.95);
    expect(daylightFactor(-30)).toBeLessThan(0.1);
  });
});

describe('SurroundingsRig', () => {
  it('builds hills, fields and instanced trees from data, rebuilds only on a change and goes away without it', () => {
    const rig = new SurroundingsRig();
    expect(rig.active).toBe(false);
    rig.apply({ preset: 'countryside' }, sky, undefined);
    expect(rig.active).toBe(true);
    expect(rig.group.visible).toBe(true);
    // Two hill layers, one field ring, one or two tree kinds.
    expect(rig.drawCalls).toBeGreaterThanOrEqual(4);
    expect(rig.drawCalls).toBeLessThanOrEqual(5);
    expect(rig.treeTriangles).toBeGreaterThan(5_000);
    expect(rig.treeTriangles).toBeLessThan(120_000);
    const before = rig.group.children.slice();
    rig.apply({ preset: 'countryside' }, sky, '#cfd8e0');
    expect(rig.group.children).toEqual(before);
    rig.setBrightness(0.5);
    rig.apply({ preset: 'woodland', hills: 0 }, sky, undefined);
    expect(rig.drawCalls).toBeLessThan(5);
    rig.apply(undefined, sky, undefined);
    expect(rig.active).toBe(false);
    expect(rig.group.visible).toBe(false);
    rig.dispose();
  });
});

describe('mountain ranges and land', () => {
  it('plans a far, taller, hazier range behind a nearer one, inside the far plane', () => {
    const r = resolveSurroundings({ preset: 'alpine' })!;
    const [far, near] = planRanges(r);
    expect(far!.distance).toBeGreaterThan(near!.distance);
    expect(far!.distance).toBeLessThanOrEqual(RANGE_MAX_DISTANCE);
    expect(far!.height).toBeGreaterThan(near!.height);
    expect(far!.haze).toBeGreaterThan(near!.haze);
    expect(planRanges(resolveSurroundings({ preset: 'meadow' })!)).toHaveLength(0);
  });

  it('draws a range with distinct summits over its foothills, snow high and none at the foot', () => {
    const spec = { seed: 9, distance: 1500, depth: 1100, height: 520, feature: 950, snowline: 0.6 };
    const img = paintRange(spec, 256, 64, 48);
    expect(img.crest).toHaveLength(129);
    expect(img.crest[0]).toBe(img.crest[128]);
    expect(Math.max(...img.crest)).toBeCloseTo(img.top, 0);
    expect(Math.min(...img.crest)).toBeLessThan(img.top * 0.6);
    const g = rangeGeometry(img, 1500);
    expect(g.index!.count / 3).toBe(256);
    let high = 0;
    let low = 0;
    let cols = 0;
    for (let x = 0; x < 256; x++) {
      const crestRow = Math.floor(((img.crest[Math.floor(x / 2)] as number) / img.top) * 63);
      if (crestRow < 50) continue;
      cols++;
      high += img.mask[((crestRow - 1) * 256 + x) * 4]! > 128 ? 1 : 0;
      low += img.mask[(1 * 256 + x) * 4]! > 128 ? 1 : 0;
    }
    expect(cols).toBeGreaterThan(10);
    expect(high).toBeGreaterThan(cols * 0.3);
    expect(low).toBe(0);
    expect(RANGE_TEX_W * RANGE_TEX_H).toBeLessThanOrEqual(2048 * 256);
  });

  it('rolls the land only past the built ground and never below it', () => {
    const r = resolveSurroundings({ preset: 'alpine' })!;
    const land = planLand(r, 260)!;
    expect(land.inner).toBeGreaterThan(130);
    expect(land.inner).toBeLessThan(150);
    expect(land.outer).toBeLessThan(planRanges(r)[1]!.distance);
    expect(landHeight(land, land.inner, 0)).toBeCloseTo(0.05, 3);
    let top = 0;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const h = landHeight(land, Math.cos(a) * 600, Math.sin(a) * 600);
      expect(h).toBeGreaterThanOrEqual(0.05);
      top = Math.max(top, h);
    }
    expect(top).toBeGreaterThan(8);
    expect(planLand(r, 4000)).toBeNull();
  });

  it('adds the ranges and the land within a few draw calls', () => {
    const rig = new SurroundingsRig();
    rig.apply({ preset: 'alpine' }, sky, '#f0d4bc', { size: 260 });
    // The ranges (one mesh), land rising into foothills, conifers.
    expect(rig.drawCalls).toBe(3);
    // On a world's own terrain: the ranges, the foothill ridge, conifers.
    rig.apply({ preset: 'alpine' }, sky, '#f0d4bc', null);
    expect(rig.drawCalls).toBe(3);
    rig.dispose();
  });
});

describe('emission cap', () => {
  it('leaves ordinary glows alone and turns the excess of a hot sign into white, not more light', () => {
    expect(capEmission(1)).toEqual({ intensity: 1, white: 0 });
    expect(capEmission(EMISSION_SOFT_CAP)).toEqual({ intensity: EMISSION_SOFT_CAP, white: 0 });
    const sign = capEmission(3);
    expect(sign.intensity).toBeGreaterThan(EMISSION_SOFT_CAP);
    expect(sign.intensity).toBeLessThan(2.1);
    expect(sign.white).toBeGreaterThan(0.2);
    expect(sign.white).toBeLessThanOrEqual(0.5);
    expect(capEmission(30).intensity).toBeLessThan(9);
  });
});
