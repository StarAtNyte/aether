/**
 * Where the showroom guide stands at a stop and how the view frames the piece (player/guide/place.ts): she stands beside
 * the piece, outside the visitor's view of it, on the side away from the product card; the piece is framed in the part of
 * the screen the interface leaves free.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@aether/core';
import { clearOfView, framePiece, PERSON_HALF_M, STAND_CLEAR_M, standSpots, viewCone } from '../src/player/guide/place';

// The Rug Exhibition Hall's Mahal wall rug (wall-rug-s3: 1.4 m wide, hung on the wall at z 14.8) and its viewpoint.
const MAHAL = { min: [21.3, 1.2, 14.75] as Vec3, max: [22.7, 3.2, 14.85] as Vec3 };
const EYE: Vec3 = [22, 1.75, 12.01];
const C: Vec3 = [22, 2.2, 14.8];

/** Where a world point lands on the screen (normalised device coordinates) for a view from `eye` looking at `look`. */
function project(p: Readonly<Vec3>, eye: Readonly<Vec3>, look: Readonly<Vec3>, vfov: number, aspect: number): [number, number] {
  const f = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!);
  const fw = [f[0]! / fl, f[1]! / fl, f[2]! / fl];
  const yaw = Math.atan2(-fw[0]!, -fw[2]!);
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [r[1]! * fw[2]! - r[2]! * fw[1]!, r[2]! * fw[0]! - r[0]! * fw[2]!, r[0]! * fw[1]! - r[1]! * fw[0]!];
  const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const z = d[0]! * fw[0]! + d[1]! * fw[1]! + d[2]! * fw[2]!;
  const x = d[0]! * r[0]! + d[1]! * r[1]! + d[2]! * r[2]!;
  const y = d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
  const t = Math.tan(vfov / 2);
  return [x / z / (t * aspect), y / z / t];
}

describe('where the guide stands at a piece', () => {
  it('is never in front of the piece, nor hard against it', () => {
    // Straight in front, and just off its edge in front: in the visitor's view.
    expect(clearOfView(EYE, MAHAL, [22, 0, 13.6])).toBe(false);
    expect(clearOfView(EYE, MAHAL, [22.75, 0, 13.6])).toBe(false);
    // Beside it but touching its footprint.
    expect(clearOfView(EYE, MAHAL, [23.05, 0, 14.6])).toBe(false);
    // Well to one side, clear of its edge: free.
    expect(clearOfView(EYE, MAHAL, [23.6, 0, 13.9])).toBe(true);
    expect(clearOfView(EYE, MAHAL, [20.4, 0, 13.9])).toBe(true);
    // Out of view altogether is no good either.
    expect(clearOfView(EYE, MAHAL, [26, 0, 12.5])).toBe(false);
  });

  it('chooses a spot clear of the view cone (her width included), 0.6 m from the edge, on the visitor left first', () => {
    const d = Math.hypot(EYE[0] - C[0], EYE[2] - C[2]);
    const spots = standSpots(C, EYE, (EYE[0] - C[0]) / d, (EYE[2] - C[2]) / d, d, MAHAL);
    const [x, z, clear] = spots[0] as [number, number, boolean];
    expect(clear).toBe(true);
    const cone = viewCone(EYE, MAHAL);
    // Her angle off the line to the piece, less half her width, is past the cone's edge.
    const a = Math.atan2((x - EYE[0]) * -cone.fz + (z - EYE[2]) * cone.fx, (x - EYE[0]) * cone.fx + (z - EYE[2]) * cone.fz);
    const half = Math.atan2(PERSON_HALF_M, Math.hypot(x - EYE[0], z - EYE[2]));
    expect(a + half < cone.min || a - half > cone.max).toBe(true);
    // The visitor's left (looking +z, left is +x).
    expect(x).toBeGreaterThan(MAHAL.max[0]);
    const gap = Math.hypot(Math.max(MAHAL.min[0] - x, 0, x - MAHAL.max[0]), Math.max(MAHAL.min[2] - z, 0, z - MAHAL.max[2]));
    expect(gap).toBeGreaterThanOrEqual(STAND_CLEAR_M);
    // Every clear spot is listed before every spot in the view.
    const firstBlocked = spots.findIndex((s) => !s[2]);
    expect(spots.slice(firstBlocked).every((s) => !s[2])).toBe(true);
  });
});

describe('framing the piece in the free part of the screen', () => {
  const vfov = (70 * Math.PI) / 180;
  const aspect = 960 / 600;
  // At 960 x 600: left of a 300 px card, below the title, above the caption and the tour bar.
  const free = { x0: -1 + 32 / 960, x1: -1 + (2 * 624) / 960, y0: 1 - (2 * 290) / 600, y1: 1 - (2 * 84) / 600 };
  const target: Vec3 = [C[0], C[1] - 0.1, C[2]];

  it('puts the middle of the piece in the middle of the free area, and steps back until it fits there', () => {
    const shot = framePiece(EYE, target, MAHAL, free, vfov, aspect, 3);
    const [x, y] = project(target, shot.eye, shot.look, vfov, aspect);
    expect(x).toBeCloseTo((free.x0 + free.x1) / 2, 1);
    expect(y).toBeCloseTo((free.y0 + free.y1) / 2, 1);
    // Every corner inside the free area.
    for (const cx of [MAHAL.min[0], MAHAL.max[0]])
      for (const cy of [MAHAL.min[1], MAHAL.max[1]]) {
        const [px, py] = project([cx, cy, 14.75], shot.eye, shot.look, vfov, aspect);
        expect(px).toBeGreaterThanOrEqual(free.x0 - 0.02);
        expect(px).toBeLessThanOrEqual(free.x1 + 0.02);
        expect(py).toBeGreaterThanOrEqual(free.y0 - 0.02);
        expect(py).toBeLessThanOrEqual(free.y1 + 0.02);
      }
    // Back along its line, at the same height.
    expect(shot.eye[2]).toBeLessThan(EYE[2]);
    expect(shot.eye[1]).toBeCloseTo(EYE[1]);
    expect(shot.eye[0]).toBeCloseTo(EYE[0]);
  });

  it('only turns when there is no room behind', () => {
    const shot = framePiece(EYE, target, MAHAL, free, vfov, aspect, 0);
    expect(shot.eye).toEqual(EYE);
    const [x] = project(target, shot.eye, shot.look, vfov, aspect);
    expect(x).toBeCloseTo((free.x0 + free.x1) / 2, 1);
  });
});
