import { describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLab } from '../src/photo/colour';
import { colourName, estimateIlluminant, labHex, labToRgb, measureAppearance, normaliseHex } from '../src/photo/appearance';
import { hexDeltaE } from '../src/photo/colour';

const W = 120, H = 90;
/** An RGBA raster filled by `f(x, y)` and an all-ones mask of the box. */
function make(f: (x: number, y: number) => [number, number, number]): { r: { width: number; height: number; data: Uint8ClampedArray }; m: { width: number; height: number; data: Uint8Array } } {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [R, G, B] = f(x, y);
    data.set([R, G, B, 255], (y * W + x) * 4);
  }
  return { r: { width: W, height: H, data }, m: { width: W, height: H, data: new Uint8Array(W * H).fill(1) } };
}

describe('appearance of a masked region', () => {
  it('Lab and RGB round-trip, and plain-words names read sensibly', () => {
    for (const c of [[10, 40, 90], [200, 180, 140], [30, 100, 110]] as Array<[number, number, number]>) {
      const lab = rgbToLab(...c);
      const back = labToRgb(lab.L, lab.a, lab.b);
      expect(Math.abs(back[0] - c[0]) + Math.abs(back[1] - c[1]) + Math.abs(back[2] - c[2])).toBeLessThanOrEqual(3);
    }
    const name = (rgb: [number, number, number]): string => colourName(rgbToLab(...rgb));
    expect(name([26, 35, 80])).toBe('dark blue');
    expect(name([20, 90, 100])).toMatch(/teal|cyan/);
    expect(name([240, 235, 225])).toMatch(/white|light|cream/);
    expect(name([128, 128, 128])).toBe('grey');
    expect(name([110, 70, 40])).toMatch(/brown/);
    expect(name([200, 30, 30])).toBe('red');
    expect(name([30, 150, 60])).toBe('green');
    expect(name([5, 5, 5])).toBe('black');
    expect(labHex(50, 0, 0)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('reads a dark blue carpet as dark blue, within a close ΔE, with specular patches ignored', () => {
    const blue: [number, number, number] = [24, 40, 92];
    const { r, m } = make((x, y) => (x > 50 && x < 70 && y > 30 && y < 40 ? [250, 250, 245] : blue));
    const a = measureAppearance(r, m, [0, 0, 1, 1])!;
    expect(a.colour.name).toBe('dark blue');
    expect(deltaE2000({ L: a.colour.lab[0], a: a.colour.lab[1], b: a.colour.lab[2] }, rgbToLab(...blue))).toBeLessThan(3);
    expect(a.glareShare).toBeGreaterThan(0.01);
    expect(a.finish).not.toBe('glossy');
    expect(a.palette.length).toBeGreaterThan(0);
    expect(a.palette[0]?.share).toBeGreaterThan(0.5);
    expect(a.luminance).toBeLessThan(0.1);
  });

  it('a teal carpet is not read as dark blue', () => {
    const { r, m } = make(() => [20, 100, 110]);
    const a = measureAppearance(r, m, [0, 0, 1, 1])!;
    expect(a.colour.name).not.toBe('dark blue');
    expect(a.colour.name).toMatch(/teal|cyan/);
  });

  it('respects the mask: only masked pixels count', () => {
    const { r, m } = make((x) => (x < 60 ? [200, 30, 30] : [30, 30, 200]));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.data[y * W + x] = x < 60 ? 1 : 0;
    const a = measureAppearance(r, m, [0, 0, 0.5, 1])!;
    expect(a.colour.name).toMatch(/red/);
  });

  it('too few pixels give nothing', () => {
    const { r, m } = make(() => [1, 2, 3]);
    m.data.fill(0);
    m.data[5] = 1;
    expect(measureAppearance(r, m, [0, 0, 1, 1])).toBeNull();
  });

  it('tells stripes, check and plain apart', () => {
    const flat = make(() => [180, 170, 150]);
    const plain = measureAppearance(flat.r, flat.m, [0, 0, 1, 1])!;
    expect(plain.pattern.kind).toBe('plain');
    const rows = make((_, y) => (Math.floor(y / 6) % 2 ? [220, 215, 200] : [120, 110, 100]));
    expect(measureAppearance(rows.r, rows.m, [0, 0, 1, 1])!.pattern.kind).toBe('stripe-h');
    const cols = make((x) => (Math.floor(x / 8) % 2 ? [220, 215, 200] : [120, 110, 100]));
    expect(measureAppearance(cols.r, cols.m, [0, 0, 1, 1])!.pattern.kind).toBe('stripe-v');
    const check = make((x, y) => ((Math.floor(x / 8) + Math.floor(y / 6)) % 2 ? [220, 215, 200] : [120, 110, 100]));
    expect(measureAppearance(check.r, check.m, [0, 0, 1, 1])!.pattern.kind).toBe('check');
  });

  it('flags a glossy surface by its share of highlights', () => {
    const { r, m } = make((x, y) => ((x * 7 + y * 13) % 5 === 0 ? [252, 252, 250] : [90, 60, 40]));
    const a = measureAppearance(r, m, [0, 0, 1, 1])!;
    expect(a.finish).toBe('glossy');
    expect(a.colour.name).toMatch(/brown/);
  });
});


describe('dark colours under low exposure', () => {
  // A dark blue carpet (#1b2a4a) photographed at 0.5x exposure with a warm cast, a cast shadow across a third of it and a glare spot.
  const CARPET: [number, number, number] = [27, 42, 74];
  const seen = (c: [number, number, number], k = 0.5): [number, number, number] => {
    const lin = c.map((v) => (v / 255) ** 2.2);
    const cast = [1.12, 1.0, 0.86];
    return lin.map((v, i) => Math.round(255 * Math.min(1, v * k * (cast[i] as number)) ** (1 / 2.2))) as [number, number, number];
  };
  const scene = make((x, y) => {
    const base = seen(CARPET);
    const n = ((x * 7 + y * 13) % 5) - 2; // texture noise
    if (x > 80) return base.map((v) => Math.round(v * 0.55 + n)) as [number, number, number]; // cast shadow
    if (x === 30 && y === 30) return [250, 250, 250];
    return base.map((v) => Math.max(0, v + n)) as [number, number, number];
  });

  it('reports the carpet dark blue, not black, ignoring the shadow and the glare', () => {
    const a = measureAppearance(scene.r, scene.m, [0, 0, 1, 1], { dominant: true });
    expect(a).not.toBeNull();
    const c = a!.colour;
    expect(c.lab[0]).toBeGreaterThan(10); // not black
    expect(c.name).toMatch(/blue/);
    // within a few delta E of the lit carpet as seen
    const lit = rgbToLab(...seen(CARPET));
    const got = rgbToLab(parseInt(c.hex.slice(1, 3), 16), parseInt(c.hex.slice(3, 5), 16), parseInt(c.hex.slice(5, 7), 16));
    expect(deltaE2000(lit, got)).toBeLessThan(6);
  });

  it('removes the cast and the exposure with a white ceiling as the reference', () => {
    const ceiling = seen([236, 236, 232]);
    const ceilHex = `#${ceiling.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const ill = estimateIlluminant([{ hex: ceilHex, kind: 'ceiling' }]);
    expect(ill).not.toBeNull();
    expect(ill!.exposure).toBeGreaterThan(1.4);
    const carpetHex = `#${seen(CARPET).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const fixed = normaliseHex(carpetHex, ill!);
    const truth = '#1b2a4a';
    expect(hexDeltaE(fixed, truth) ?? 99).toBeLessThan(hexDeltaE(carpetHex, truth) ?? 0);
    expect(hexDeltaE(fixed, truth) ?? 99).toBeLessThan(14);
  });

  it('keeps a purple wall purple: no white reference, no correction', () => {
    expect(estimateIlluminant([{ hex: '#6b4e6d', kind: 'wall' }])).toBeNull();
  });
});
