import { describe, expect, it } from 'vitest';
import { drawMarksRgba } from '../src/review-draw';

function blank(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h * 4).fill(128);
}

describe('drawMarksRgba', () => {
  it('draws an outline and a badge inside the image', () => {
    const w = 300;
    const h = 200;
    const px = blank(w, h);
    drawMarksRgba(px, w, h, [{ n: 14, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }]);
    let changed = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] !== 128 || px[i + 1] !== 128 || px[i + 2] !== 128) changed++;
    expect(changed).toBeGreaterThan(200);
    // The outline touches the box edge at x = 0.3 * 300 = 90, y = 100.
    const i = (100 * w + 90) * 4;
    expect(px[i] !== 128 || px[i + 1] !== 128).toBe(true);
  });

  it('ignores hostile marks and tiny buffers', () => {
    const px = blank(40, 40);
    drawMarksRgba(px, 40, 40, [{ n: Number.NaN, x: 0, y: 0, w: 1, h: 1 }, { n: -5, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, { n: 10_000, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }]);
    expect(px.every((v) => v === 128)).toBe(true);
    expect(() => drawMarksRgba(new Uint8Array(4), 100, 100, [{ n: 1, x: 0.5, y: 0.5, w: 0.1, h: 0.1 }])).not.toThrow();
  });

  it('keeps every write inside the buffer for marks at the edges', () => {
    const w = 64;
    const h = 64;
    const px = new Uint8Array(w * h * 4 + 16);
    px.fill(7, w * h * 4);
    drawMarksRgba(px, w, h, [{ n: 99, x: 1.2, y: 1.2, w: 0.5, h: 0.5 }, { n: 8, x: -0.2, y: -0.2, w: 0.5, h: 0.5 }]);
    expect([...px.slice(w * h * 4)].every((v) => v === 7)).toBe(true);
  });
});
