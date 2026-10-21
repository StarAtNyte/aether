import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Color, MeshStandardMaterial } from 'three';
import { composePhotoAtlas, neutralise, parseLeafSheet, photoPlan, PHOTO_KINDS, RATIO_MEAN, type LeafSheet } from '../src/materials/foliage-photo';
import { FoliageTextures } from '../src/materials/foliage-textures';
import { applyFoliageShading, foliageSun, foliageTintColor, setFoliageSun, setFoliageTint } from '../src/materials/foliage-shading';

const SHEET_JSON = join(import.meta.dirname, '../../../apps/studio/public/foliage/leaf-sprites.json');

function sheet(): LeafSheet {
  const s = parseLeafSheet(JSON.parse(readFileSync(SHEET_JSON, 'utf8')));
  if (!s) throw new Error('bundled leaf sheet does not parse');
  return s;
}

describe('leaf sprite sheet', () => {
  it('the bundled sheet parses and has every kind a card needs', () => {
    const s = sheet();
    expect(s.sprites.filter((p) => p.use === 'leaf-broad').length).toBeGreaterThanOrEqual(6);
    expect(s.sprites.some((p) => p.use === 'frond')).toBe(true);
    // Conifer sprays, open flowers and daisy heads for the needle, blossom and flower cards.
    expect(s.sprites.filter((p) => p.use === 'needle').length).toBeGreaterThanOrEqual(3);
    expect(s.sprites.filter((p) => p.use === 'blossom').length).toBeGreaterThanOrEqual(3);
    expect(s.sprites.some((p) => p.use === 'flower')).toBe(true);
    for (const p of s.sprites) {
      expect(p.x + p.w).toBeLessThanOrEqual(s.width);
      expect(p.y + p.h).toBeLessThanOrEqual(s.height);
    }
  });

  it('rejects malformed or out-of-bounds indexes', () => {
    const ok = JSON.parse(readFileSync(SHEET_JSON, 'utf8')) as { width: number; sprites: Array<Record<string, unknown>> };
    expect(parseLeafSheet(null)).toBeNull();
    expect(parseLeafSheet({ ...ok, width: 1e6 })).toBeNull();
    expect(parseLeafSheet({ ...ok, sprites: [{ ...ok.sprites[0], x: ok.width }] })).toBeNull();
    expect(parseLeafSheet({ ...ok, sprites: [{ ...ok.sprites[0], use: 'cactus' }] })).toBeNull();
    expect(parseLeafSheet({ ...ok, sprites: [{ ...ok.sprites[0], mean: [Number.NaN, 0, 0] }] })).toBeNull();
    // Without fronds and tufts the cards cannot be made.
    expect(parseLeafSheet({ ...ok, sprites: ok.sprites.filter((p) => p['use'] === 'leaf-broad') })).toBeNull();
  });
});

describe('photographed card plans', () => {
  const s = sheet();
  for (const kind of PHOTO_KINDS) {
    it(`${kind}: deterministic, varied between variants, every leaf inside its cell`, () => {
      const c = 256;
      const a = photoPlan(kind, c, s, 0);
      expect(photoPlan(kind, c, s, 0)).toEqual(a);
      expect(a.length).toBeGreaterThan(0);
      expect(JSON.stringify(photoPlan(kind, c, s, 1))).not.toEqual(JSON.stringify(a));
      for (let v = 0; v < 4; v++) {
        for (const op of photoPlan(kind, c, s, v)) {
          expect(op.sprite).toBeGreaterThanOrEqual(0);
          expect(op.sprite).toBeLessThan(s.sprites.length);
          const tipX = op.x + Math.sin(op.angle) * op.length;
          const tipY = op.y - Math.cos(op.angle) * op.length;
          for (const [x, y] of [[op.x, op.y], [tipX, tipY]] as const) {
            expect(x).toBeGreaterThanOrEqual(-1);
            expect(x).toBeLessThanOrEqual(c + 1);
            expect(y).toBeGreaterThanOrEqual(-1);
            expect(y).toBeLessThanOrEqual(c + 1);
          }
        }
      }
    });
  }

  it('a kind whose sprites the sheet lacks keeps its procedural cards', () => {
    const noNeedles: LeafSheet = { ...s, sprites: s.sprites.filter((p) => p.use !== 'needle') };
    expect(composePhotoAtlas('needles', 256, noNeedles, {} as CanvasImageSource)).toBeNull();
  });

  it('tree and shrub cards grow from the bottom, back to front', () => {
    const ops = photoPlan('shrub', 256, s, 2);
    for (let i = 1; i < ops.length; i++) expect(ops[i]!.y).toBeLessThanOrEqual(ops[i - 1]!.y + 1e-9);
    expect(ops.every((o) => o.y > 0 && o.y <= 256)).toBe(true);
  });
});

describe('ratio conversion', () => {
  it('maps the mean leaf colour to the ratio level and fills transparent pixels with it', () => {
    // Two green solid pixels (one darker), one transparent black pixel.
    const px = new Uint8Array([60, 120, 40, 255, 90, 160, 60, 255, 0, 0, 0, 0]);
    const mean = neutralise(px);
    expect(mean[1]).toBeGreaterThan(mean[0]);
    // Hue divided out: the solid pixels come out nearly grey, the brighter one above the darker one.
    expect(Math.abs(px[0]! - px[1]!)).toBeLessThan(40);
    expect(px[5]!).toBeGreaterThan(px[1]!);
    const fill = Math.round(RATIO_MEAN * 255);
    expect([px[8], px[9], px[10], px[11]]).toEqual([fill, fill, fill, 0]);
  });
});

describe('foliage textures with photos', () => {
  const settle = async (t: FoliageTextures): Promise<void> => {
    for (let i = 0; i < 200 && t.pending; i++) await new Promise((ok) => setTimeout(ok, 5));
  };
  const alphaCount = (tex: { image: unknown }): number => {
    const d = (tex.image as { data: Uint8Array }).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if ((d[i] as number) > 0) n++;
    return n;
  };

  it('starts empty, is pending while it fills, and holds the procedural card where no canvas or sheet is available', async () => {
    const t = new FoliageTextures();
    t.usePhotos('/nowhere/');
    const tex = t.get('shrub');
    // Nothing is synthesised inside get(): the atlas is transparent until its task has run.
    expect(alphaCount(tex)).toBe(0);
    expect(t.pending).toBe(true);
    await settle(t);
    expect(t.pending).toBe(false);
    expect(alphaCount(tex)).toBeGreaterThan(1000);
    t.dispose();
  });

  it('fills kinds without photos procedurally, one task each, and tells the owner', async () => {
    const t = new FoliageTextures();
    let changes = 0;
    t.onChange = () => changes++;
    const a = t.get('needles');
    const b = t.get('grass');
    expect(alphaCount(a) + alphaCount(b)).toBe(0);
    await settle(t);
    expect(alphaCount(a)).toBeGreaterThan(1000);
    expect(alphaCount(b)).toBeGreaterThan(1000);
    expect(changes).toBe(2);
    t.dispose();
  });

  it('a texture disposed before its task runs is left alone', async () => {
    const t = new FoliageTextures();
    const a = t.get('fern');
    t.dispose();
    await new Promise((ok) => setTimeout(ok, 30));
    expect(alphaCount(a)).toBe(0);
  });
});

describe('foliage shading', () => {
  it('gives leaf materials colour and translucency nodes', () => {
    const m = new MeshStandardMaterial();
    applyFoliageShading(m);
    const nm = m as unknown as { colorNode?: unknown; emissiveNode?: unknown };
    expect(nm.colorNode).toBeTruthy();
    expect(nm.emissiveNode).toBeTruthy();
  });
  it('follows the sun and ignores bad input', () => {
    setFoliageSun([0, 2, 0], new Color(1, 0.9, 0.8), 3);
    expect(foliageSun().direction).toEqual([0, 1, 0]);
    expect(foliageSun().irradiance[0]).toBeCloseTo(3, 5);
    setFoliageSun([Number.NaN, 1, 0], new Color(1, 1, 1), 1);
    expect(foliageSun().direction).toEqual([0, 1, 0]);
    setFoliageSun([0, 0, 0], new Color(1, 1, 1), 1);
    expect(foliageSun().direction).toEqual([0, 1, 0]);
    setFoliageSun([0, 1, 0], new Color(1, 1, 1), 2, false);
    expect(foliageSun().irradiance).toEqual([0, 0, 0]);
  });
});

describe('foliage tint from the world\'s look', () => {
  it('multiplies the card colour, ignores bad input and goes back to white', () => {
    setFoliageTint(null);
    expect(foliageTintColor()).toEqual([1, 1, 1]);
    setFoliageTint('#ffd9a0');
    const [r, g, b] = foliageTintColor();
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeLessThan(1);
    expect(b).toBeLessThan(g);
    setFoliageTint('green');
    expect(foliageTintColor()).toEqual([r, g, b]);
    setFoliageTint(null);
    expect(foliageTintColor()).toEqual([1, 1, 1]);
  });
});
