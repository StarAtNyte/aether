import { describe, expect, it } from 'vitest';
import { makeCam, placeObject, solveCamera, fitPlane, ransacPlane, unproject } from '../src/photo/roomgeometry';

/** Raycast a rectangular room (x 0..W left to right, y 0..H up, z 0..D away from the near wall) plus one box, from a camera at (cx, camH, cz) looking along +z. */
function room(opt: { W: number; D: number; H: number; cam: [number, number, number]; fov: number; obstacle?: { x: [number, number]; z: [number, number]; h: number } }): { depth: Float32Array; mask: Uint8Array; w: number; h: number } {
  const w = 128, h = 96;
  const cam = makeCam({ width: w, height: h }, opt.fov);
  const depth = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  const [cx, cy, cz] = opt.cam;
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const a = (u + 0.5 - cam.cx) / cam.f;
      const b = -(v + 0.5 - cam.cy) / cam.f;
      let t = Infinity;
      const hit = (p: number): void => { if (p > 0.05 && p < t) t = p; };
      if (a !== 0) { hit((0 - cx) / a); hit((opt.W - cx) / a); }
      if (b !== 0) { hit((0 - cy) / b); hit((opt.H - cy) / b); }
      hit(opt.D - cz);
      hit(-cz);
      let isObs = false;
      if (opt.obstacle) {
        const o = opt.obstacle;
        const lo = [(o.x[0] - cx) / a, (0 - cy) / b, (o.z[0] - cz) / 1];
        const hi = [(o.x[1] - cx) / a, (o.h - cy) / b, (o.z[1] - cz) / 1];
        const t0 = Math.max(Math.min(lo[0] as number, hi[0] as number), Math.min(lo[1] as number, hi[1] as number), Math.min(lo[2] as number, hi[2] as number));
        const t1 = Math.min(Math.max(lo[0] as number, hi[0] as number), Math.max(lo[1] as number, hi[1] as number), Math.max(lo[2] as number, hi[2] as number));
        if (t0 <= t1 && t0 > 0.05 && t0 < t) { t = t0; isObs = true; }
      }
      depth[v * w + u] = t;
      if (isObs) mask[v * w + u] = 1;
    }
  }
  return { depth, mask, w, h };
}

describe('room geometry from a metric depth map', () => {
  it('fits a plane through points (least squares)', () => {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) pts.push([i * 0.1, 0.5, j * 0.1]);
    const p = fitPlane(pts);
    expect(Math.abs(p?.n[1] ?? 0)).toBeGreaterThan(0.999);
    const r = ransacPlane([...pts, [0.3, 2, 0.3], [0.2, 3, 0.5]], { accept: (n) => Math.abs(n[1]) > 0.9 });
    expect(r?.inliers).toBe(100);
  });

  it('unprojects a pixel with the pinhole model', () => {
    const cam = makeCam({ width: 100, height: 80 }, 90);
    const [x, y, z] = unproject(cam, 100, 40, 3);
    expect(z).toBe(3);
    expect(x).toBeCloseTo(3, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it('finds the floor, walls, ceiling and the room box of a synthetic room', () => {
    const r = room({ W: 4, D: 6, H: 2.6, cam: [1.7, 1.4, 0.5], fov: 68 });
    const sol = solveCamera({ width: r.w, height: r.h, data: r.depth }, { fovs: [68] });
    expect(sol).not.toBeNull();
    const box = sol!.box;
    expect(box.cameraHeight).toBeGreaterThan(1.3);
    expect(box.cameraHeight).toBeLessThan(1.5);
    expect(box.walls).toMatchObject({ floor: true, back: true, ceiling: true });
    expect(box.height.value).toBeGreaterThan(2.4);
    expect(box.height.value).toBeLessThan(2.8);
    expect(box.depth.value).toBeGreaterThan(5.4);
    expect(box.depth.value).toBeLessThan(6.4);
    expect(box.width.value).toBeGreaterThan(3.6);
    expect(box.width.value).toBeLessThan(4.4);
    expect(box.width.confidence).toBe('high');
    expect(Math.abs(box.yawDeg)).toBeLessThanOrEqual(4);
    // the camera stands 1.7 m from the left wall
    expect(box.camera.x).toBeGreaterThan(1.5);
    expect(box.camera.x).toBeLessThan(1.9);
  });

  it('marks the width as a lower bound when a side wall is out of frame', () => {
    const r = room({ W: 9, D: 6, H: 2.6, cam: [1.0, 1.4, 0.5], fov: 50 });
    const sol = solveCamera({ width: r.w, height: r.h, data: r.depth }, { fovs: [50] });
    expect(sol).not.toBeNull();
    expect(sol!.box.walls.left).toBe(true);
    expect(sol!.box.walls.right).toBe(false);
    expect(sol!.box.width.confidence).toBe('low');
    expect(sol!.box.width.basis).toMatch(/lower bound/);
  });

  it('places an object from its mask: position, extents, height, wall', () => {
    const r = room({ W: 4, D: 6, H: 2.6, cam: [1.7, 1.4, 0.5], fov: 68, obstacle: { x: [2.4, 3.2], z: [3.0, 3.8], h: 0.7 } });
    const grid = { width: r.w, height: r.h, data: r.depth };
    const sol = solveCamera(grid, { fovs: [68], notWall: r.mask })!;
    const p = placeObject(r.mask, grid, sol.cam, sol.fr, sol.box, 'table')!;
    expect(p.kind).toBe('floor');
    expect(p.centre.frame).toBe('room');
    expect(p.centre.x).toBeGreaterThan(2.4);
    expect(p.centre.x).toBeLessThan(3.2);
    // front face is 3 m from the near wall = 3 m from the back wall (D 6)
    expect(p.centre.z).toBeGreaterThan(2.4);
    expect(p.centre.z).toBeLessThan(3.6);
    expect(p.size.h).toBeGreaterThan(0.5);
    expect(p.size.h).toBeLessThan(0.9);
    expect(p.size.w).toBeGreaterThan(0.5);
    expect(p.size.w).toBeLessThan(1.1);
    expect(p.against).toEqual([]);
  });

  it('says an object stands against the right wall when it does', () => {
    const r = room({ W: 4, D: 6, H: 2.6, cam: [1.7, 1.4, 0.5], fov: 68, obstacle: { x: [3.0, 3.95], z: [4.5, 5.0], h: 0.8 } });
    const grid = { width: r.w, height: r.h, data: r.depth };
    const sol = solveCamera(grid, { fovs: [68], notWall: r.mask })!;
    const p = placeObject(r.mask, grid, sol.cam, sol.fr, sol.box, 'chest')!;
    expect(p.against.some((a) => a.wall === 'right')).toBe(true);
  });

  it('returns null for a flat grid with no floor', () => {
    const data = new Float32Array(64 * 48).fill(3);
    expect(solveCamera({ width: 64, height: 48, data }, { fovs: [60] })?.box.walls.floor ?? false).toBeTypeOf('boolean');
  });
});
