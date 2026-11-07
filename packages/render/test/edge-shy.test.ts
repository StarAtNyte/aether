import { describe, expect, it } from 'vitest';
import { edgeNudge, type GroundSheet } from '../src/view/edge-shy';
import { buildSkirtGeometry, rimHeights } from '../src/environment/terrain-skirt';

const sheet: GroundSheet = { minX: -160, maxX: 160, minZ: -160, maxZ: 160, minY: 0, maxY: 44 };

describe('edgeNudge', () => {
  it('moves a camera hanging far past the rim back, target with it, pitch unchanged', () => {
    const pos: [number, number, number] = [0, 100, 400];
    const target: [number, number, number] = [0, 10, 300];
    const out = edgeNudge(pos, target, sheet);
    expect(out.pos[2]).toBeLessThan(400);
    expect(out.target[2] - out.pos[2]).toBeCloseTo(-100, 6);
    expect(out.pos[1]).toBe(100);
  });
  it('leaves a camera inside the margin alone', () => {
    const pos: [number, number, number] = [100, 60, 170];
    expect(edgeNudge(pos, [0, 5, 0], sheet).pos).toBe(pos);
  });
});

describe('terrain skirt', () => {
  it('starts at the rim height and stays small', () => {
    const verts: Array<[number, number, number]> = [];
    for (let i = 0; i <= 40; i++) verts.push([-160 + i * 8, 7, -160], [160, 7, -160 + i * 8], [-160 + i * 8, 7, 160], [-160, 7, -160 + i * 8]);
    const rim = rimHeights(sheet, verts);
    expect(rim.every((v) => v === 7)).toBe(true);
    const g = buildSkirtGeometry(sheet, rim, '#6f9a4a');
    expect(g.getAttribute('position').getY(0)).toBeCloseTo(6.6, 5);
    expect((g.getIndex()?.count ?? 0) / 3).toBeLessThan(8000);
  });
});
