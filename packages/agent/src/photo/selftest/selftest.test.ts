import { describe, expect, it } from 'vitest';
import { roomToWorld } from '../perception/buildplan';
import { buildMasks, decodeMasks } from './fixture';
import { familyOf, maskIou, median, resampleMask } from './metrics';
import { backIndex, basis, makeCamera, planToRoom, rayAt, vfovOf } from './truth';

describe('self-test truth geometry', () => {
  it('planToRoom is the inverse of the build plan roomToWorld for every back wall', () => {
    const W = 4.2;
    const D = 5.88;
    for (let back = 0; back < 4; back++) {
      const w = back % 2 === 0 ? W : D;
      const d = back % 2 === 0 ? D : W;
      for (const [u, v] of [[0.3, 0.7], [1.9, 3.1], [w - 0.2, d - 0.4]] as Array<[number, number]>) {
        const [x, z] = roomToWorld(u, v, back, W, D);
        const [u2, v2] = planToRoom(back, x, z, W, D);
        expect(u2).toBeCloseTo(u, 9);
        expect(v2).toBeCloseTo(v, 9);
      }
    }
  });

  it('camera basis: heading 0 looks north, 90 east; right of north is east; pitch up raises the look', () => {
    const n = basis(0, 0);
    expect(n.fwd[2]).toBeCloseTo(-1);
    expect(n.right[0]).toBeCloseTo(1);
    expect(n.up[1]).toBeCloseTo(1);
    const e = basis(90, 0);
    expect(e.fwd[0]).toBeCloseTo(1);
    expect(e.right[2]).toBeCloseTo(1);
    expect(basis(0, 30).fwd[1]).toBeGreaterThan(0.49);
    expect(backIndex(0)).toBe(0);
    expect(backIndex(100)).toBe(1);
    expect(backIndex(-80)).toBe(3);
  });

  it('rays: the centre ray is the optical axis and the horizontal edge ray spans half the horizontal field of view', () => {
    const cam = makeCamera(0, [0, 0], 1.5, 40, -5, 70, 1.5);
    const c = rayAt(cam, 49.5, 33.5, 100, 67);
    const f = basis(40, -5).fwd;
    expect(c[0]).toBeCloseTo(f[0], 2);
    expect(c[2]).toBeCloseTo(f[2], 2);
    const flat = makeCamera(0, [0, 0], 1.5, 0, 0, 70, 1.5);
    const edge = rayAt(flat, 0, 33.5, 100, 67);
    // x over -z at the left edge column centre: tan(35 deg) * 0.99
    expect(Math.abs(edge[0] / edge[2])).toBeCloseTo(Math.tan((35 * Math.PI) / 180) * 0.99, 2);
    expect(vfovOf(70, 1.5)).toBeCloseTo(2 * Math.atan(Math.tan((35 * Math.PI) / 180) / 1.5) * (180 / Math.PI), 6);
  });

  it('buildMasks labels pieces and structure by normal and keeps the visible extents in the room frame', () => {
    const cam = makeCamera(0, [2, 5], 1.5, 0, 0, 70, 1.5);
    const room = { building: 'b', roomKey: 'r', bbox: [0, 0, 4, 6] as [number, number, number, number], width: 4, depth: 6, height: 2.7, back: 0, yawRel: 0 };
    const items = [{ id: 'chair', kind: 'chair', name: 'chair', mount: 'floor', yaw: 0, centre: { u: 2, v: 2 }, size: { w: 0.5, d: 0.5, h: 0.9 }, y0: 0, y1: 0.9, hexes: {}, mainHex: null }];
    const hits = [
      { id: 'chair', p: [1.8, 0.5, 2.1] as [number, number, number], ny: 0 }, { id: 'chair', p: [2.2, 0.8, 1.9] as [number, number, number], ny: 1 },
      { id: 'chair', p: [2.0, 0.2, 2.0] as [number, number, number], ny: 0 }, { id: 'chair', p: [2.1, 0.6, 2.2] as [number, number, number], ny: 0 },
      { id: 'shell', p: [0, 0, 0] as [number, number, number], ny: 1 }, { id: 'shell', p: [0, 2, 0] as [number, number, number], ny: -1 }, { id: 'shell', p: [0, 1, 0] as [number, number, number], ny: 0 }, null,
    ];
    const r = buildMasks(cam, room, items, 4, 2, hits);
    expect(r.masks.labels.slice(0, 5)).toEqual(['none', 'floor', 'ceiling', 'wall', 'other']);
    const dm = decodeMasks(r.masks);
    expect(Array.from(dm.data)).toEqual([5, 5, 5, 5, 1, 2, 3, 0]);
    expect(r.visible['chair']?.centre.u).toBeGreaterThan(1.7);
    expect(r.visible['chair']?.samples).toBe(4);
    expect(dm.depthZ[4]).toBeGreaterThan(0);
  });
});

describe('self-test metrics', () => {
  it('maskIou, median and resampling', () => {
    expect(maskIou([1, 1, 0, 0], [1, 0, 1, 0])).toBeCloseTo(1 / 3);
    expect(maskIou([0, 0], [0, 0])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(Array.from(resampleMask([1, 0, 0, 1], 2, 2, 4, 4)).reduce((a, b) => a + b, 0)).toBe(8);
  });
  it('label families treat a nightstand as a table and a pillow as bed linen', () => {
    expect(familyOf('nightstand')).toBe(familyOf('desk'));
    expect(familyOf('bed duvet')).toBe('bed');
    expect(familyOf('sofa')).not.toBe(familyOf('bed'));
  });
});
