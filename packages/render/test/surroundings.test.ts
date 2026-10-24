import { describe, expect, it } from 'vitest';
import { computeSkyState } from '../src/environment/sky-state';
import { EMISSION_SOFT_CAP, capEmission } from '../src/materials/material-cache';
import { MAX_TREES, SURROUNDING_PRESETS, SurroundingsRig, daylightFactor, planTrees, resolveSurroundings, ridge } from '../src/environment/surroundings';

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
