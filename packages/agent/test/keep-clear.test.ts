import { describe, expect, it } from 'vitest';
import { Builder } from '../src/providers/mock/builder';
import { estateGround, grove, landPoints } from '../src/providers/mock/showcase/kit';

const CALM = { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false };

function scatterPoints(b: Builder, id: string): Array<[number, number, number]> {
  const add = b.build().find((p) => p.op === 'add' && p.entity.id === id);
  if (!add || add.op !== 'add') throw new Error('no such entity');
  const shape = add.entity.shape;
  if (shape?.kind !== 'scatter' || !shape.points) throw new Error('no scatter points');
  return shape.points as Array<[number, number, number]>;
}

describe('ground cover keep-out and ground height', () => {
  it('drops clustered points inside a kept-clear rectangle and keeps those outside', () => {
    const b = new Builder(5, [], CALM);
    b.realisticNature = true;
    b.keepClearRect(-10, -6, 10, 6);
    const id = b.scatter('grass', 'grass-tuft', { color: '#808040', size: 0.7 }, 800, [60, 40], [0, 0, 0], { minSpacing: 0.4 });
    const pts = scatterPoints(b, id);
    expect(pts.length).toBeGreaterThan(100);
    expect(pts.some(([x, , z]) => x > -10 && x < 10 && z > -6 && z < 6)).toBe(false);
    expect(pts.some(([x]) => Math.abs(x) > 12)).toBe(true);
  });

  it('puts clustered points on the ground height relative to the layer', () => {
    const b = new Builder(5, [], CALM);
    b.realisticNature = true;
    const id = b.scatter('grass', 'grass-tuft', { color: '#808040', size: 0.7 }, 200, [30, 30], [10, 2, 0], { heightAt: (x) => x * 0.1 });
    for (const [x, y] of scatterPoints(b, id)) expect(y).toBeCloseTo((10 + x) * 0.1 - 2, 1);
  });

  it('estateGround puts the plot at y = 0 and reports the world height of the hills', () => {
    const b = new Builder(5, [], CALM);
    const land = estateGround(b, 11, { size: 240, relief: 36, pad: [4, -3, 20], color: '#7a8a50', resolution: 96 });
    expect(land.h(4, -3)).toBe(0);
    expect(Math.abs(land.h(8, 0))).toBeLessThan(0.01);
    expect(land.h(0, 105)).toBeGreaterThan(3);
    expect(land.slope(4, -3)).toBeLessThan(0.5);
    const placed = b.build().find((p) => p.op === 'add' && p.entity.id === land.id);
    expect(placed).toBeDefined();
    if (placed?.op !== 'add') throw new Error('not an add');
    expect(placed.entity.transform?.position?.[1]).toBeLessThanOrEqual(0);
  });

  it('landPoints reserves spacing and stays where the predicate allows; grove builds an instanced layer', () => {
    const b = new Builder(5, [], CALM);
    const pts = landPoints(b, 60, 50, (x) => x > 0, 6, () => 1.5);
    expect(pts.length).toBeGreaterThan(5);
    for (const p of pts) {
      expect(p[0]).toBeGreaterThan(0);
      expect(p[1]).toBe(1.5);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![2] - pts[j]![2])).toBeGreaterThan(5.5);
    grove(b, 'wood', 'Wood', 'tree-spruce', { height: 12 }, pts, [0.8, 1.2], 'land-1');
    const patch = b.build().find((p) => p.op === 'add' && p.entity.id === 'wood-1');
    expect(patch).toBeDefined();
  });
});
