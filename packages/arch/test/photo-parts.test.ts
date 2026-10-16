import { describe, expect, it } from 'vitest';
import { buildFurniture, furnitureByKind, furnitureSize, type ArchOutput } from '../src/index';

function build(kind: string, params: Record<string, string | number | boolean>): { out: ArchOutput; size: [number, number, number] } {
  const def = furnitureByKind(kind);
  if (!def) throw new Error(`no ${kind}`);
  return { out: buildFurniture(def, params, 7), size: furnitureSize(def, params) };
}

function stats(out: ArchOutput): { tris: number; finite: boolean; maxY: number; finishes: string[] } {
  let tris = 0;
  let finite = true;
  let maxY = 0;
  const finishes: string[] = [];
  for (const p of out.parts) {
    tris += p.indices.length / 3;
    for (let i = 0; i < p.positions.length; i++) if (!Number.isFinite(p.positions[i] as number)) finite = false;
    for (let i = 1; i < p.positions.length; i += 3) maxY = Math.max(maxY, p.positions[i] as number);
    const f = (p.material as { finish?: string }).finish;
    if (f) finishes.push(f);
  }
  return { tris, finite, maxY, finishes };
}

describe('parts the photos needed', () => {
  it('beds have headboard shapes, printed bedding and a four-poster frame', () => {
    const plain = stats(build('bed', {}).out);
    for (const headboardStyle of ['slab', 'panel', 'tufted', 'slats']) {
      const s = stats(build('bed', { headboardStyle, headboardHeight: 1.2 }).out);
      expect(s.finite).toBe(true);
      expect(s.tris).toBeGreaterThan(100);
      expect(s.maxY).toBeLessThan(1.4);
    }
    expect(stats(build('bed', { headboardStyle: 'tufted' }).out).tris).toBeGreaterThan(plain.tris);
    expect(stats(build('bed', { pattern: 'floral' }).out).finishes).toContain('wallpaper-floral');
    expect(stats(build('bed', {}).out).finishes).not.toContain('wallpaper-floral');
    const poster = build('bed', { canopy: true, canopyHeight: 2.2 });
    expect(stats(poster.out).maxY).toBeGreaterThan(2.1);
    expect(poster.size[1]).toBeGreaterThanOrEqual(2.2);
    // The footprint does not change: posts stand on the frame corners.
    expect(poster.size[0]).toBe(build('bed', {}).size[0]);
  });

  it('side tables come as round pedestals and wire frames with their own height and top', () => {
    const cab = build('nightstand', {});
    expect(cab.size).toEqual([0.48, 0.55, 0.4]);
    for (const style of ['round', 'wire']) {
      const t = build('nightstand', { style, height: 0.5, diameter: 0.4 });
      expect(t.size).toEqual([0.4, 0.5, 0.4]);
      const s = stats(t.out);
      expect(s.finite).toBe(true);
      expect(s.maxY).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(s.maxY).toBeGreaterThan(0.45);
      expect(t.out.colliders.length).toBeGreaterThan(0);
    }
  });

  it('rugs can be woven in zigzag or stripes: bands in the accents, all facing up and inside the rug', () => {
    const plain = build('rug', { width: 2.4, depth: 1.7 });
    for (const pattern of ['zigzag', 'stripes']) {
      const t = build('rug', { width: 2.4, depth: 1.7, pattern });
      const s = stats(t.out);
      expect(s.finite).toBe(true);
      expect(s.tris).toBeGreaterThan(stats(plain.out).tris + 20);
      expect(t.size).toEqual(plain.size);
      let down = 0;
      for (const p of t.out.parts) {
        for (let i = 0; i < p.positions.length; i += 3) {
          expect(Math.abs(p.positions[i] as number)).toBeLessThanOrEqual(1.2 + 1e-6);
          expect(Math.abs(p.positions[i + 2] as number)).toBeLessThanOrEqual(0.85 + 1e-6);
        }
        for (let i = 1; i < p.normals.length; i += 3) if ((p.normals[i] as number) < -0.5) down++;
      }
      // Only the rug's bound edge faces sideways; nothing faces down.
      expect(down).toBe(0);
    }
    expect(stats(build('rug', { pattern: 'zigzag', shape: 'round' }).out).tris).toBe(stats(build('rug', { shape: 'round' }).out).tris);
  });

  it('palms are arching fronds of bounded cost, tall or a single small frond', () => {
    for (const height of [0.45, 1.5]) {
      const t = build('plant', { species: 'palm', height });
      const s = stats(t.out);
      expect(s.finite).toBe(true);
      expect(s.tris).toBeGreaterThan(200);
      expect(s.tris).toBeLessThan(60_000);
      expect(s.maxY).toBeLessThanOrEqual(height * 1.1);
    }
  });
});
