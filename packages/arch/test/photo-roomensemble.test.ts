import { describe, expect, it } from 'vitest';
import type { Segment } from '../src/photo/lines';
import { detectSegments } from '../src/photo/lines';
import { solveManhattan, type ManhattanCamera } from '../src/photo/manhattan';
import { estimateRoomEnsemble } from '../src/photo/roomensemble';
import { makeCam } from '../src/photo/roomgeometry';

type V3 = [number, number, number];
const rad = (d: number): number => (d * Math.PI) / 180;
/** World axes seen by a camera turned `yaw` about the vertical and tilted `pitch` down (an independent construction of the test). */
function axes(yaw: number, pitch: number): { x: V3; y: V3; z: V3 } {
  const rot = (v: V3): V3 => {
    const a = rad(yaw), b = rad(pitch);
    const x1 = Math.cos(a) * v[0] + Math.sin(a) * v[2];
    const z1 = -Math.sin(a) * v[0] + Math.cos(a) * v[2];
    return [x1, Math.cos(b) * v[1] + Math.sin(b) * z1, -Math.sin(b) * v[1] + Math.cos(b) * z1];
  };
  return { x: rot([1, 0, 0]), y: rot([0, 1, 0]), z: rot([0, 0, 1]) };
}
function segmentsOf(fov: number, yaw: number, pitch: number, W = 640, H = 480): Segment[] {
  const f = W / 2 / Math.tan(rad(fov) / 2);
  const ax = axes(yaw, pitch);
  const out: Segment[] = [];
  let s = 17;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 90; i++) {
    const a = [ax.x, ax.y, ax.z][i % 3] as V3;
    const P: V3 = [(rnd() - 0.5) * 5, (rnd() - 0.5) * 2.4, 2.5 + rnd() * 6];
    const pts = [-0.9, 0.9].map((t): [number, number] | null => {
      const q: V3 = [P[0] + a[0] * t, P[1] + a[1] * t, P[2] + a[2] * t];
      return q[2] > 0.3 ? [W / 2 + (f * q[0]) / q[2], H / 2 - (f * q[1]) / q[2]] : null;
    });
    if (!pts[0] || !pts[1]) continue;
    const len = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
    if (len < 25) continue;
    out.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], length: len, contrast: 40 });
  }
  return out;
}

describe('vanishing-point camera', () => {
  it('recovers the field of view and the vertical axis of a synthetic Manhattan scene', () => {
    for (const [fov, yaw, pitch] of [[70, 20, 8], [60, -25, 3], [80, 10, 12]] as const) {
      const segs = segmentsOf(fov, yaw, pitch);
      expect(segs.length).toBeGreaterThan(40);
      const m = solveManhattan(segs, 640, 480) as ManhattanCamera;
      expect(m).not.toBeNull();
      expect(Math.abs(m.fovDeg - fov)).toBeLessThan(9);
      const up = axes(yaw, pitch).y;
      const dot = m.axes.up[0] * up[0] + m.axes.up[1] * up[1] + m.axes.up[2] * up[2];
      expect(Math.abs(dot)).toBeGreaterThan(0.995);
      expect(m.explained).toBeGreaterThan(0.8);
    }
  });

  it('a wide lens seen almost square on reads closer to its true angle with the default prior than with a full-weight one', () => {
    const segs = segmentsOf(95, 4, 3);
    const strong = solveManhattan(segs, 640, 480, { fovPriorWeight: 1 }) as ManhattanCamera;
    const dflt = solveManhattan(segs, 640, 480) as ManhattanCamera;
    expect(Math.abs(dflt.fovDeg - 95)).toBeLessThanOrEqual(Math.abs(strong.fovDeg - 95));
    expect(dflt.fovDeg).toBeGreaterThan(80);
  });

  it('refuses too few lines', () => {
    expect(solveManhattan(segmentsOf(70, 0, 0).slice(0, 4), 640, 480)).toBeNull();
  });
});

describe('line segments from pixels', () => {
  it('finds the edges of a bright rectangle and nothing in a flat image', () => {
    const w = 200, h = 150;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 40; y < 110; y++) for (let x = 50; x < 150; x++) { const o = (y * w + x) * 4; data[o] = 30; data[o + 1] = 30; data[o + 2] = 40; }
    const r = detectSegments({ width: w, height: h, data }, { width: 200, minLength: 30 });
    expect(r.segments.length).toBeGreaterThanOrEqual(3);
    const flat = detectSegments({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(120) });
    expect(flat.segments.length).toBe(0);
  });
});

describe('room box ensemble', () => {
  it('ranks families by agreement and drops an implausible camera height', () => {
    const w = 96, h = 72;
    const cam = makeCam({ width: w, height: h }, 68);
    const depth = new Float32Array(w * h);
    const W = 4, D = 6, H = 2.6;
    const [cx, cy, cz] = [2.1, 1.4, 0.5];
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const a = (u + 0.5 - cam.cx) / cam.f, b = -(v + 0.5 - cam.cy) / cam.f;
      let t = Infinity;
      const hit = (p: number): void => { if (p > 0.05 && p < t) t = p; };
      if (a !== 0) { hit((0 - cx) / a); hit((W - cx) / a); }
      if (b !== 0) { hit((0 - cy) / b); hit((H - cy) / b); }
      hit(D - cz);
      depth[v * w + u] = t;
    }
    const vp: ManhattanCamera = { fovDeg: 68, fovRange: [64, 72], pitchDeg: 0, yawDeg: 0, rollDeg: 0, support: [0.4, 0.2, 0.2], explained: 0.8, axes: { up: [0, 1, 0], depth: [0, 0, 1], across: [1, 0, 0] }, segmentsUsed: 60 };
    const e = estimateRoomEnsemble({ metric: { width: w, height: h, data: depth }, relative: null, vp, trainedFovDeg: null });
    expect(e).not.toBeNull();
    expect(Math.abs((e as NonNullable<typeof e>).width.value / W - 1)).toBeLessThan(0.12);
    expect(Math.abs((e as NonNullable<typeof e>).height.value / H - 1)).toBeLessThan(0.15);
    expect((e as NonNullable<typeof e>).estimators.some((x) => x.name === 'vp-metric')).toBe(true);
  });

  it('is null without any estimator', () => {
    expect(estimateRoomEnsemble({ metric: null, relative: null, vp: null })).toBeNull();
  });
});
