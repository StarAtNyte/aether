/**
 * A small deterministic software renderer for `render_still`: a visibility
 * buffer (perspective-correct barycentrics, near-plane clipping), a sun
 * shadow map with 3x3 PCF, hemisphere sky light, a Blinn highlight, fog,
 * alpha-blended glass, 2x supersampling and a filmic tone curve. It needs no
 * GPU and no browser, so the same still comes out on any machine. It is a
 * proof-of-look, not the studio's path-traced finish.
 */
import type { Environment, Vec3 } from '@aether/core';
import { materialColor, type Scene, type SceneMesh } from './scene';

/** Camera and output of a still. */
export interface StillOptions {
  width: number;
  height: number;
  /** Eye position; with `lookAt` it overrides the automatic framing. */
  from?: Vec3;
  lookAt?: Vec3;
  /** Automatic framing angles (degrees): yaw around the scene, pitch above the horizon. */
  yawDeg?: number;
  pitchDeg?: number;
  fovDeg?: number;
  /** Abort rendering after this many ms (checked per mesh). */
  deadline?: number;
}

/** A rendered image. */
export interface Still {
  rgba: Uint8Array;
  width: number;
  height: number;
  camera: { from: Vec3; lookAt: Vec3; fovDeg: number };
  triangles: number;
}

interface SkyLook {
  top: [number, number, number];
  horizon: [number, number, number];
  ground: [number, number, number];
  sun: [number, number, number];
  sunScale: number;
  elevation: number;
  azimuth: number;
  ambient: number;
}

const SKIES: Record<string, SkyLook> = {
  day: { top: [0.2, 0.42, 0.85], horizon: [0.72, 0.84, 0.95], ground: [0.32, 0.3, 0.26], sun: [1, 0.95, 0.85], sunScale: 3.2, elevation: 52, azimuth: 40, ambient: 0.55 },
  dawn: { top: [0.3, 0.4, 0.7], horizon: [1, 0.72, 0.55], ground: [0.28, 0.25, 0.25], sun: [1, 0.72, 0.5], sunScale: 2.4, elevation: 14, azimuth: 80, ambient: 0.4 },
  sunset: { top: [0.25, 0.3, 0.6], horizon: [1, 0.55, 0.3], ground: [0.26, 0.2, 0.2], sun: [1, 0.55, 0.3], sunScale: 2.4, elevation: 9, azimuth: -80, ambient: 0.38 },
  night: { top: [0.02, 0.03, 0.09], horizon: [0.07, 0.09, 0.18], ground: [0.03, 0.03, 0.05], sun: [0.55, 0.65, 1], sunScale: 0.55, elevation: 40, azimuth: 30, ambient: 0.18 },
  overcast: { top: [0.55, 0.58, 0.62], horizon: [0.75, 0.77, 0.8], ground: [0.3, 0.3, 0.3], sun: [0.9, 0.92, 0.95], sunScale: 0.9, elevation: 60, azimuth: 40, ambient: 0.85 },
  space: { top: [0, 0, 0.01], horizon: [0.01, 0.01, 0.03], ground: [0.02, 0.02, 0.03], sun: [1, 1, 0.95], sunScale: 3.4, elevation: 30, azimuth: 40, ambient: 0.1 },
  studio: { top: [0.82, 0.83, 0.85], horizon: [0.9, 0.9, 0.92], ground: [0.55, 0.55, 0.57], sun: [1, 1, 1], sunScale: 2.4, elevation: 55, azimuth: 35, ambient: 0.75 },
};

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin3 = (c: readonly number[]): [number, number, number] => [toLinear(c[0] as number), toLinear(c[1] as number), toLinear(c[2] as number)];

/** Narkowicz ACES fit, then sRGB. */
function tonemap(x: number, exposure: number): number {
  const v = x * exposure;
  const a = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  const c = a < 0 ? 0 : a > 1 ? 1 : a;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A mesh the rasterizer draws (scene meshes plus the ground quad). */
interface Draw {
  mesh: SceneMesh;
  /** First global triangle index. */
  first: number;
}

/**
 * Centre and radius to frame: the whole scene, except that a few far-away
 * meshes (distant hills, clouds) do not shrink everything else to a speck:
 * with many meshes the radius covers 90% of them.
 */
export function frameBounds(scene: Scene): { center: Vec3; radius: number } {
  const b = scene.bounds ?? { min: [-5, 0, -5] as Vec3, max: [5, 3, 5] as Vec3 };
  const all: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const whole = Math.max(1, 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
  if (scene.meshes.length < 12) return { center: all, radius: whole };
  const boxes = scene.meshes.map((m) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i] as number, y = m.positions[i + 1] as number, z = m.positions[i + 2] as number;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    return { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] as Vec3, h: 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0) };
  });
  const med = (k: 0 | 1 | 2): number => {
    const v = boxes.map((q) => q.c[k]).sort((p, q) => p - q);
    return v[Math.floor(v.length / 2)] as number;
  };
  const center: Vec3 = [med(0), med(1), med(2)];
  const reach = boxes.map((q) => Math.hypot(q.c[0] - center[0], q.c[1] - center[1], q.c[2] - center[2]) + q.h).sort((p, q) => p - q);
  const radius = Math.min(whole, Math.max(2, reach[Math.floor(reach.length * 0.9)] as number));
  return { center, radius };
}

/** Frame the scene: eye, target and field of view. */
export function frameCamera(scene: Scene, o: Pick<StillOptions, 'from' | 'lookAt' | 'yawDeg' | 'pitchDeg' | 'fovDeg' | 'width' | 'height'>): { from: Vec3; lookAt: Vec3; fovDeg: number } {
  const fovDeg = Math.min(110, Math.max(15, o.fovDeg ?? 45));
  if (o.from && o.lookAt) return { from: o.from, lookAt: o.lookAt, fovDeg };
  const { center, radius } = frameBounds(scene);
  const aspect = o.width / o.height;
  const vf = (fovDeg * Math.PI) / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
  const dist = (radius / Math.sin(Math.min(vf, hf) / 2)) * 1.02;
  const yaw = ((o.yawDeg ?? 35) * Math.PI) / 180;
  const pitch = ((o.pitchDeg ?? 24) * Math.PI) / 180;
  const lookAt = o.lookAt ?? center;
  const from = o.from ?? ([lookAt[0] + Math.sin(yaw) * Math.cos(pitch) * dist, lookAt[1] + Math.sin(pitch) * dist, lookAt[2] + Math.cos(yaw) * Math.cos(pitch) * dist] as Vec3);
  return { from, lookAt, fovDeg };
}

/** A clipped screen-space vertex: pixel position, 1/w and barycentrics of the source triangle. */
interface SV {
  x: number;
  y: number;
  iw: number;
  b0: number;
  b1: number;
  b2: number;
}

const NEAR = 0.05;

/** Render `scene` as seen in `env` (see module docs). */
export function renderStill(scene: Scene, env: Environment, o: StillOptions): Still {
  const ss = o.width * o.height <= 1280 * 720 ? 2 : 1;
  const W = o.width * ss;
  const H = o.height * ss;
  const cam = frameCamera(scene, o);
  const sky = SKIES[env.sky] ?? (SKIES['day'] as SkyLook);
  const exposure = Math.max(0.1, Math.min(4, env.exposure ?? 1)) * 0.55;

  // Sun
  let elev = sky.elevation;
  let sunScale = sky.sunScale * (env.sunIntensity !== undefined ? env.sunIntensity / 2.5 : 1);
  if (env.timeOfDay !== undefined) {
    const h = env.timeOfDay;
    elev = 78 * Math.sin((Math.PI * (h - 6)) / 12);
    if (elev < 4) {
      elev = Math.max(elev, 4);
      sunScale *= 0.2;
    }
  }
  const az = (sky.azimuth * Math.PI) / 180;
  const el = (elev * Math.PI) / 180;
  const sunDir = norm([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
  const sunCol = lin3(sky.sun).map((c) => c * sunScale) as [number, number, number];
  const ambient = Math.max(0, (env.ambientIntensity ?? 0.4) / 0.4) * sky.ambient * 0.5;
  const skyTop = lin3(sky.top);
  const skyHor = lin3(sky.horizon);
  const skyGnd = lin3(sky.ground);

  // Ground quad
  const draws: Draw[] = [];
  const meshes: SceneMesh[] = [...scene.meshes];
  if (env.ground) {
    const b = scene.bounds;
    const half = Math.min(env.ground.size / 2, Math.max(120, b ? 10 * Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) : 120));
    const n = 32;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        pos.push(-half + (2 * half * i) / n, 0, -half + (2 * half * j) / n);
        nor.push(0, 1, 0);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
    meshes.unshift({
      id: '(ground)',
      positions: new Float32Array(pos),
      normals: new Float32Array(nor),
      indices: new Uint32Array(idx),
      vertexColors: null,
      color: materialColor(env.ground.material, [0.36, 0.5, 0.28]),
      emissive: null,
      metalness: 0,
      opacity: 1,
    });
  }
  let total = 0;
  for (const m of meshes) {
    draws.push({ mesh: m, first: total });
    total += m.indices.length / 3;
  }
  const firsts = draws.map((d) => d.first);
  const drawOf = (tri: number): Draw => {
    let lo = 0;
    let hi = firsts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((firsts[mid] as number) <= tri) lo = mid;
      else hi = mid - 1;
    }
    return draws[lo] as Draw;
  };

  // View basis
  const f = norm(sub(cam.lookAt, cam.from));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const tanH = Math.tan((cam.fovDeg * Math.PI) / 360);
  const aspect = W / H;
  const toView = (p: Vec3): Vec3 => {
    const d = sub(p, cam.from);
    return [dot(d, r), dot(d, u), dot(d, f)];
  };

  // Shadow map (orthographic along the sun direction)
  const sb = scene.bounds ?? { min: [-10, 0, -10] as Vec3, max: [10, 5, 10] as Vec3 };
  const sc: Vec3 = [(sb.min[0] + sb.max[0]) / 2, (sb.min[1] + sb.max[1]) / 2, (sb.min[2] + sb.max[2]) / 2];
  const sr = Math.max(2, 0.5 * Math.hypot(sb.max[0] - sb.min[0], sb.max[1] - sb.min[1], sb.max[2] - sb.min[2]));
  const lz = sunDir;
  const side = cross([0, 1, 0], lz);
  const lx = norm(Math.hypot(side[0], side[1], side[2]) < 1e-6 ? [1, 0, 0] : side);
  const ly = cross(lz, lx);
  const SM = 1536;
  const smDepth = new Float32Array(SM * SM).fill(Infinity);
  const toLight = (p: Vec3): Vec3 => {
    const d = sub(p, sc);
    return [((dot(d, lx) / sr) * 0.5 + 0.5) * SM, (0.5 - (dot(d, ly) / sr) * 0.5) * SM, -dot(d, lz) / sr];
  };
  for (const d of draws) {
    if (d.mesh.opacity < 0.5 && d.mesh.id !== '(ground)') continue;
    const P = d.mesh.positions;
    const I = d.mesh.indices;
    const lp = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const t = toLight([P[i] as number, P[i + 1] as number, P[i + 2] as number]);
      lp[i] = t[0];
      lp[i + 1] = t[1];
      lp[i + 2] = t[2];
    }
    for (let t = 0; t < I.length; t += 3) {
      const a = (I[t] as number) * 3;
      const b = (I[t + 1] as number) * 3;
      const c = (I[t + 2] as number) * 3;
      const x0 = lp[a] as number, y0 = lp[a + 1] as number, z0 = lp[a + 2] as number;
      const x1 = lp[b] as number, y1 = lp[b + 1] as number, z1 = lp[b + 2] as number;
      const x2 = lp[c] as number, y2 = lp[c + 1] as number, z2 = lp[c + 2] as number;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(SM - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(SM - 1, Math.ceil(Math.max(y0, y1, y2)));
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
          const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
          const z = w0 * z0 + w1 * z1 + w2 * z2;
          const k = y * SM + x;
          if (z < (smDepth[k] as number)) smDepth[k] = z;
        }
      }
    }
  }
  const shadowAt = (p: Vec3): number => {
    const t = toLight(p);
    const cx = Math.floor(t[0]);
    const cy = Math.floor(t[1]);
    let lit = 0;
    let n = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const x = cx + i;
        const y = cy + j;
        n++;
        if (x < 0 || y < 0 || x >= SM || y >= SM) {
          lit++;
          continue;
        }
        if (t[2] - 0.0035 <= (smDepth[y * SM + x] as number)) lit++;
      }
    }
    return lit / n;
  };

  // Visibility buffer
  const vis = new Int32Array(W * H).fill(-1);
  const visU = new Float32Array(W * H);
  const visV = new Float32Array(W * H);
  const zbuf = new Float32Array(W * H); // stores 1/w (bigger = nearer); 0 = empty

  const project = (v: Vec3): { x: number; y: number; iw: number } => {
    const iw = 1 / v[2];
    return { x: (0.5 + (v[0] * iw) / (tanH * aspect) / 2) * W, y: (0.5 - (v[1] * iw) / tanH / 2) * H, iw };
  };

  const rasterTri = (a: SV, b: SV, c: SV, id: number, writeVis: boolean, cb?: (x: number, y: number, k: number, u: number, v: number, iw: number) => void): void => {
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(area) < 1e-12) return;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const inv = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l0 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) * inv;
        const l1 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) * inv;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const p0 = l0 * a.iw;
        const p1 = l1 * b.iw;
        const p2 = l2 * c.iw;
        const iw = p0 + p1 + p2;
        const k = y * W + x;
        if (iw <= (zbuf[k] as number)) continue;
        const s = 1 / iw;
        const ob1 = (p0 * a.b1 + p1 * b.b1 + p2 * c.b1) * s;
        const ob2 = (p0 * a.b2 + p1 * b.b2 + p2 * c.b2) * s;
        if (cb) {
          cb(x, y, k, ob1, ob2, iw);
        } else if (writeVis) {
          zbuf[k] = iw;
          vis[k] = id;
          visU[k] = ob1;
          visV[k] = ob2;
        }
      }
    }
  };

  /** Clip a view-space triangle at the near plane and rasterize the pieces. */
  const drawTri = (v0: Vec3, v1: Vec3, v2: Vec3, id: number, writeVis: boolean, cb?: (x: number, y: number, k: number, u: number, v: number, iw: number) => void): void => {
    const inV: Array<{ p: Vec3; b: [number, number, number] }> = [
      { p: v0, b: [1, 0, 0] },
      { p: v1, b: [0, 1, 0] },
      { p: v2, b: [0, 0, 1] },
    ];
    const poly: typeof inV = [];
    for (let i = 0; i < 3; i++) {
      const cur = inV[i] as (typeof inV)[number];
      const nxt = inV[(i + 1) % 3] as (typeof inV)[number];
      const cIn = cur.p[2] >= NEAR;
      const nIn = nxt.p[2] >= NEAR;
      if (cIn) poly.push(cur);
      if (cIn !== nIn) {
        const t = (NEAR - cur.p[2]) / (nxt.p[2] - cur.p[2]);
        poly.push({
          p: [cur.p[0] + (nxt.p[0] - cur.p[0]) * t, cur.p[1] + (nxt.p[1] - cur.p[1]) * t, NEAR],
          b: [cur.b[0] + (nxt.b[0] - cur.b[0]) * t, cur.b[1] + (nxt.b[1] - cur.b[1]) * t, cur.b[2] + (nxt.b[2] - cur.b[2]) * t],
        });
      }
    }
    if (poly.length < 3) return;
    const sv = poly.map((q): SV => {
      const s = project(q.p);
      return { x: s.x, y: s.y, iw: s.iw, b0: q.b[0], b1: q.b[1], b2: q.b[2] };
    });
    for (let i = 1; i + 1 < sv.length; i++) rasterTri(sv[0] as SV, sv[i] as SV, sv[i + 1] as SV, id, writeVis, cb);
  };

  const viewCache = new Map<SceneMesh, Float32Array>();
  const viewOf = (m: SceneMesh): Float32Array => {
    let v = viewCache.get(m);
    if (!v) {
      v = new Float32Array(m.positions.length);
      for (let i = 0; i < v.length; i += 3) {
        const t = toView([m.positions[i] as number, m.positions[i + 1] as number, m.positions[i + 2] as number]);
        v[i] = t[0];
        v[i + 1] = t[1];
        v[i + 2] = t[2];
      }
      viewCache.set(m, v);
    }
    return v;
  };

  const deadline = o.deadline ?? Infinity;
  const timeCheck = (): void => {
    if (Date.now() > deadline) throw Object.assign(new Error('render ran out of time'), { name: 'TimeoutError' });
  };

  for (const d of draws) {
    if (d.mesh.opacity < 0.5) continue;
    timeCheck();
    const V = viewOf(d.mesh);
    const I = d.mesh.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = (I[t] as number) * 3;
      const b = (I[t + 1] as number) * 3;
      const c = (I[t + 2] as number) * 3;
      const va: Vec3 = [V[a] as number, V[a + 1] as number, V[a + 2] as number];
      const vb: Vec3 = [V[b] as number, V[b + 1] as number, V[b + 2] as number];
      const vc: Vec3 = [V[c] as number, V[c + 1] as number, V[c + 2] as number];
      if (va[2] < NEAR && vb[2] < NEAR && vc[2] < NEAR) continue;
      drawTri(va, vb, vc, d.first + t / 3, true);
    }
  }

  // Shading
  const img = new Float32Array(W * H * 3);
  const fogDensity = env.fog ? env.fog.density : 0;
  const fogColor = env.fog ? lin3([parseInt(env.fog.color.slice(1, 3), 16) / 255, parseInt(env.fog.color.slice(3, 5), 16) / 255, parseInt(env.fog.color.slice(5, 7), 16) / 255]) : skyHor;
  const eye = cam.from;

  const shade = (m: SceneMesh, tri: number, local: number, u1: number, u2: number, out: [number, number, number]): void => {
    const I = m.indices;
    const ia = I[local * 3] as number;
    const ib = I[local * 3 + 1] as number;
    const ic = I[local * 3 + 2] as number;
    const u0 = 1 - u1 - u2;
    const P = m.positions;
    const N = m.normals;
    const px = (P[ia * 3] as number) * u0 + (P[ib * 3] as number) * u1 + (P[ic * 3] as number) * u2;
    const py = (P[ia * 3 + 1] as number) * u0 + (P[ib * 3 + 1] as number) * u1 + (P[ic * 3 + 1] as number) * u2;
    const pz = (P[ia * 3 + 2] as number) * u0 + (P[ib * 3 + 2] as number) * u1 + (P[ic * 3 + 2] as number) * u2;
    let nx = (N[ia * 3] as number) * u0 + (N[ib * 3] as number) * u1 + (N[ic * 3] as number) * u2;
    let ny = (N[ia * 3 + 1] as number) * u0 + (N[ib * 3 + 1] as number) * u1 + (N[ic * 3 + 1] as number) * u2;
    let nz = (N[ia * 3 + 2] as number) * u0 + (N[ib * 3 + 2] as number) * u1 + (N[ic * 3 + 2] as number) * u2;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const vx = eye[0] - px;
    const vy = eye[1] - py;
    const vz = eye[2] - pz;
    const dist = Math.hypot(vx, vy, vz) || 1;
    // Face the viewer (two-sided surfaces).
    if (nx * vx + ny * vy + nz * vz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    let albedo: [number, number, number];
    if (m.vertexColors) {
      const C = m.vertexColors;
      albedo = [
        (C[ia * 3] as number) * u0 + (C[ib * 3] as number) * u1 + (C[ic * 3] as number) * u2,
        (C[ia * 3 + 1] as number) * u0 + (C[ib * 3 + 1] as number) * u1 + (C[ic * 3 + 1] as number) * u2,
        (C[ia * 3 + 2] as number) * u0 + (C[ib * 3 + 2] as number) * u1 + (C[ic * 3 + 2] as number) * u2,
      ];
    } else albedo = lin3(m.color);
    void tri;
    const ndl = Math.max(0, nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]);
    const sh = ndl > 0 ? shadowAt([px, py, pz]) : 0;
    const hemi = ny * 0.5 + 0.5;
    const ar = (skyGnd[0] + (skyTop[0] - skyGnd[0]) * hemi) * ambient;
    const ag = (skyGnd[1] + (skyTop[1] - skyGnd[1]) * hemi) * ambient;
    const ab = (skyGnd[2] + (skyTop[2] - skyGnd[2]) * hemi) * ambient;
    const diff = ndl * sh;
    let r0 = albedo[0] * (ar + sunCol[0] * diff);
    let g0 = albedo[1] * (ag + sunCol[1] * diff);
    let b0 = albedo[2] * (ab + sunCol[2] * diff);
    // Blinn highlight
    const hx = vx / dist + sunDir[0];
    const hy = vy / dist + sunDir[1];
    const hz = vz / dist + sunDir[2];
    const hl = Math.hypot(hx, hy, hz) || 1;
    const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    const spec = Math.pow(nh, 48) * (0.04 + 0.5 * m.metalness) * sh * (ndl > 0 ? 1 : 0);
    r0 += spec * sunCol[0] + (m.metalness > 0 ? albedo[0] * m.metalness * 0.2 * ar : 0);
    g0 += spec * sunCol[1] + (m.metalness > 0 ? albedo[1] * m.metalness * 0.2 * ag : 0);
    b0 += spec * sunCol[2] + (m.metalness > 0 ? albedo[2] * m.metalness * 0.2 * ab : 0);
    if (m.emissive) {
      const e = lin3(m.emissive);
      r0 += e[0] * 1.4;
      g0 += e[1] * 1.4;
      b0 += e[2] * 1.4;
    }
    // Fog / aerial haze
    const fogAmt = 1 - Math.exp(-(fogDensity > 0 ? fogDensity * 0.08 : 0.00035) * dist);
    out[0] = r0 + (fogColor[0] - r0) * fogAmt;
    out[1] = g0 + (fogColor[1] - g0) * fogAmt;
    out[2] = b0 + (fogColor[2] - b0) * fogAmt;
  };

  const col: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    if ((y & 31) === 0) timeCheck();
    // Sky gradient by view ray
    const sy = (0.5 - (y + 0.5) / H) * 2 * tanH;
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const tri = vis[k] as number;
      if (tri < 0) {
        const sx = ((x + 0.5) / W - 0.5) * 2 * tanH * aspect;
        const dy = f[1] + r[1] * sx + u[1] * sy;
        const l = Math.hypot(f[0] + r[0] * sx + u[0] * sy, dy, f[2] + r[2] * sx + u[2] * sy) || 1;
        const t = Math.max(0, Math.min(1, dy / l));
        const g = Math.pow(t, 0.55);
        col[0] = skyHor[0] + (skyTop[0] - skyHor[0]) * g;
        col[1] = skyHor[1] + (skyTop[1] - skyHor[1]) * g;
        col[2] = skyHor[2] + (skyTop[2] - skyHor[2]) * g;
      } else {
        const d = drawOf(tri);
        shade(d.mesh, tri, tri - d.first, visU[k] as number, visV[k] as number, col);
      }
      img[k * 3] = col[0];
      img[k * 3 + 1] = col[1];
      img[k * 3 + 2] = col[2];
    }
  }

  // Glass and other see-through meshes, far to near, depth-tested but not written.
  const glass = draws.filter((d) => d.mesh.opacity < 0.5);
  const centerDist = (m: SceneMesh): number => {
    const V = viewOf(m);
    return V.length >= 3 ? (V[2] as number) : 0;
  };
  glass.sort((a, b) => centerDist(b.mesh) - centerDist(a.mesh));
  const tmp: [number, number, number] = [0, 0, 0];
  for (const d of glass) {
    timeCheck();
    const V = viewOf(d.mesh);
    const I = d.mesh.indices;
    const alpha = Math.max(0.05, Math.min(0.5, 1 - d.mesh.opacity));
    for (let t = 0; t < I.length; t += 3) {
      const a = (I[t] as number) * 3;
      const b = (I[t + 1] as number) * 3;
      const c = (I[t + 2] as number) * 3;
      const va: Vec3 = [V[a] as number, V[a + 1] as number, V[a + 2] as number];
      const vb: Vec3 = [V[b] as number, V[b + 1] as number, V[b + 2] as number];
      const vc: Vec3 = [V[c] as number, V[c + 1] as number, V[c + 2] as number];
      if (va[2] < NEAR && vb[2] < NEAR && vc[2] < NEAR) continue;
      const local = t / 3;
      drawTri(va, vb, vc, 0, false, (_x, _y, k, u1, u2) => {
        shade(d.mesh, 0, local, u1, u2, tmp);
        const w = alpha + 0.25;
        img[k * 3] = (img[k * 3] as number) * (1 - w) + tmp[0] * w;
        img[k * 3 + 1] = (img[k * 3 + 1] as number) * (1 - w) + tmp[1] * w;
        img[k * 3 + 2] = (img[k * 3 + 2] as number) * (1 - w) + tmp[2] * w;
      });
    }
  }

  // Resolve: box filter, tone map, 8-bit
  const rgba = new Uint8Array(o.width * o.height * 4);
  const s2 = ss * ss;
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const k = ((y * ss + j) * W + (x * ss + i)) * 3;
          // Tone map before averaging: edges stay clean against the bright sky.
          rr += tonemap(img[k] as number, exposure);
          gg += tonemap(img[k + 1] as number, exposure);
          bb += tonemap(img[k + 2] as number, exposure);
        }
      }
      const o4 = (y * o.width + x) * 4;
      rgba[o4] = Math.round((rr / s2) * 255);
      rgba[o4 + 1] = Math.round((gg / s2) * 255);
      rgba[o4 + 2] = Math.round((bb / s2) * 255);
      rgba[o4 + 3] = 255;
    }
  }
  return { rgba, width: o.width, height: o.height, camera: cam, triangles: scene.triangles };
}
