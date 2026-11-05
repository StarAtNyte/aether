import { describe, expect, it } from 'vitest';
import { Texture } from 'three';
import { bakeFlipY, flipRows, geckoSafePath, geckoStartLevel, GECKO_DISCRETE_START_LEVEL, GECKO_START_LEVEL, isGeckoAgent } from '../src/gpu/gecko-safe';
import { needsPriming, primeTarget, type ClearableRenderer } from '../src/gpu/prime-target';
import { cutsAt } from '../src/gpu/performance';
import { planSunShadows } from '../src/environment/sun-shadow-plan';

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('Firefox on WebGL2 path', () => {
  it('tells Gecko from browsers that only say "like Gecko"', () => {
    expect(isGeckoAgent(FIREFOX)).toBe(true);
    expect(isGeckoAgent(CHROME)).toBe(false);
  });
  it('applies to Gecko on WebGL2 with a hardware GPU only', () => {
    expect(geckoSafePath('webgl2', 'NVIDIA GeForce RTX 3050', FIREFOX)).toBe(true);
    expect(geckoSafePath('webgl2', 'Mesa Intel(R) UHD Graphics 620', FIREFOX)).toBe(true);
    expect(geckoSafePath('webgpu', 'NVIDIA GeForce RTX 3050', FIREFOX)).toBe(false);
    expect(geckoSafePath('webgl2', 'NVIDIA GeForce RTX 3050', CHROME)).toBe(false);
    expect(geckoSafePath('webgl2', 'llvmpipe (LLVM 15.0.7, 256 bits)', FIREFOX)).toBe(false);
  });
  it('starts on the ladder with no room light, one shadow map and the lowest tier, with effects kept', () => {
    const c = cutsAt(GECKO_START_LEVEL);
    expect(c.lightVolume).toBe(false);
    expect(c.cascades).toBe(false);
    expect(c.tierCap).toBe('low');
    expect(c.effects).toBe(1);
  });
  it('starts a discrete GPU on medium at the lowest, never on low', () => {
    expect(geckoStartLevel('discrete')).toBe(GECKO_DISCRETE_START_LEVEL);
    expect(cutsAt(geckoStartLevel('discrete')).tierCap).toBe('medium');
    expect(geckoStartLevel('integrated')).toBe(GECKO_START_LEVEL);
    expect(geckoStartLevel('unknown')).toBe(GECKO_START_LEVEL);
  });

  it('uses the shader filter on the low tier when the map is compared with NEAREST, never on software', () => {
    const base = { tier: 'low' as const, still: false, shadowMapCap: 2048, contentRadius: 100, voxel: false };
    expect(planSunShadows(base).filter).toBe('pcf');
    const safe = planSunShadows({ ...base, nearestCompare: true });
    expect(safe.filter).toBe('soft');
    expect(safe.cascades).toBe(1);
    expect(safe.filterSamples).toBeGreaterThan(0);
    expect(planSunShadows({ ...base, nearestCompare: true, software: true }).filter).toBe('pcf');
  });
});

describe('baking flipY into the data', () => {
  it('flips rows', () => {
    const d = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(flipRows(d, 3)).toBe(true);
    expect([...d]).toEqual([5, 6, 3, 4, 1, 2]);
    expect(flipRows(new Uint8Array(5), 2)).toBe(false);
    expect(flipRows(new Uint8Array(4), 1)).toBe(false);
  });
  it('turns the flag off and flips a typed-array texture once', () => {
    const t = new Texture() as Texture & { image: { data: Uint8Array; height: number; width: number } };
    t.image = { data: new Uint8Array([1, 1, 2, 2, 3, 3, 4, 4]), width: 2, height: 4 };
    t.flipY = true;
    expect(bakeFlipY(t)).toBe(true);
    expect(t.flipY).toBe(false);
    expect([...t.image.data]).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
    expect(bakeFlipY(t)).toBe(false);
    expect([...t.image.data]).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
  });
  it('flips half-float and float data too, and leaves DOM-style images alone', () => {
    const h = new Texture() as Texture & { image: unknown };
    h.image = { data: new Uint16Array([1, 2, 3, 4]), width: 1, height: 2 };
    h.flipY = true;
    expect(bakeFlipY(h)).toBe(true);
    expect([...(h.image as { data: Uint16Array }).data]).toEqual([3, 4, 1, 2]);
    const dom = new Texture() as Texture & { image: unknown };
    dom.image = { width: 2, height: 2 };
    dom.flipY = true;
    expect(bakeFlipY(dom)).toBe(false);
    expect(dom.flipY).toBe(true);
  });
});

describe('priming render targets', () => {
  function fake(): { r: ClearableRenderer; log: string[] } {
    const log: string[] = [];
    let current: unknown = 'screen';
    const r: ClearableRenderer = {
      getRenderTarget: () => current,
      setRenderTarget: (t) => {
        current = t;
        log.push(t === 'screen' ? 'bind screen' : 'bind target');
      },
      clear: () => {
        log.push('clear');
        return Promise.resolve();
      },
    };
    return { r, log };
  }
  it('clears once per allocation and restores the previous target', () => {
    const { r, log } = fake();
    const t = { width: 2, height: 2 };
    expect(needsPriming(t)).toBe(true);
    expect(primeTarget(r, t)).toBe(true);
    expect(log).toEqual(['bind target', 'clear', 'bind screen']);
    expect(primeTarget(r, t)).toBe(false);
    t.width = 640;
    expect(needsPriming(t)).toBe(true);
    expect(primeTarget(r, t)).toBe(true);
  });
  it('never throws, and does not count a failed clear as done', () => {
    const r: ClearableRenderer = { getRenderTarget: () => null, setRenderTarget: () => undefined, clear: () => { throw new Error('lost'); } };
    const t = { width: 4, height: 4 };
    expect(primeTarget(r, t)).toBe(false);
    expect(needsPriming(t)).toBe(true);
  });
});
