import { describe, expect, it } from 'vitest';
import { denoiseParams, despeckle } from '../src/view/pathtrace';

function flat(w: number, h: number, v: number): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([v, v, v, 255], i * 4);
  return d;
}

describe('despeckle', () => {
  it('replaces an isolated bright pixel by its neighbours and leaves the rest alone', () => {
    const d = flat(9, 9, 90);
    const at = (x: number, y: number): number => (y * 9 + x) * 4;
    d.set([255, 255, 255, 255], at(4, 4));
    const before = Array.from(d);
    const n = despeckle(d, 9, 9);
    expect(n).toBe(1);
    expect(d[at(4, 4)]).toBe(90);
    expect(d[at(4, 4) + 3]).toBe(255);
    // Nothing else changed.
    for (let i = 0; i < d.length; i++) if (i < at(4, 4) || i >= at(4, 4) + 4) expect(d[i]).toBe(before[i]);
  });
  it('keeps real features: a bright blob several pixels wide, an edge and dark noise', () => {
    const d = flat(12, 12, 60);
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) d.set([240, 240, 240, 255], (y * 12 + x) * 4);
    const before = Array.from(d);
    expect(despeckle(d, 12, 12)).toBe(0);
    expect(Array.from(d)).toEqual(before);
    const edge = flat(10, 10, 20);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) edge.set([200, 200, 200, 255], (y * 10 + x) * 4);
    expect(despeckle(edge, 10, 10)).toBe(0);
    const dark = flat(8, 8, 10);
    dark.set([30, 30, 30, 255], (3 * 8 + 3) * 4);
    expect(despeckle(dark, 8, 8)).toBe(0);
  });
  it('checks every pixel on the original image (neighbouring speckles do not hide each other)', () => {
    const d = flat(9, 9, 80);
    d.set([250, 250, 250, 255], (4 * 9 + 3) * 4);
    d.set([250, 250, 250, 255], (4 * 9 + 6) * 4);
    expect(despeckle(d, 9, 9)).toBe(2);
  });
  it('survives tiny and short buffers', () => {
    expect(despeckle(new Uint8Array(16), 2, 2)).toBe(0);
    expect(despeckle(new Uint8Array(4), 9, 9)).toBe(0);
  });
});

describe('denoiseParams', () => {
  it('smooths more when there are fewer samples and not at all when off', () => {
    const draft = denoiseParams(64, true);
    const good = denoiseParams(256, true);
    const best = denoiseParams(1024, true);
    expect(draft.threshold).toBeGreaterThan(good.threshold);
    expect(good.threshold).toBeGreaterThan(best.threshold);
    expect(draft.sigma).toBeGreaterThanOrEqual(best.sigma);
    const off = denoiseParams(64, false);
    expect(off.sigma).toBeLessThan(0.1);
    expect(off.threshold).toBe(1);
    expect(Number.isFinite(denoiseParams(Number.NaN, true).threshold)).toBe(true);
  });
});
