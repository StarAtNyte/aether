/**
 * High-detail sculpture generator: weathered colossal heads, carved standing
 * stones and eroded boulders with hundreds of thousands of smooth triangles.
 * Meant for virtual geometry (the renderer draws a view-dependent cluster
 * cut), so detail costs memory, not frame time.
 *
 * Tessellation is a spherified cube (uniform triangles, shared vertices,
 * deterministic seams) displaced by analytic sculpt functions plus erosion
 * noise; normals are smooth (area-weighted).
 */
import type { Noise } from '../noise';
import type { MaterialSpec, Vec3 } from '@aether/core';
import { MeshBuilder, type Mesh } from '../kernel/mesh';
import type { SdfNode } from '../types';
import type { InternalApi } from '../api';
import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear, type RGB } from '../color';
import { defineGenerator, lin, pBool, pColor, pInt, pNum, pVariant, shade } from './kit';

/** Grid edge per cube face for each detail level (12·N² triangles: 49k … 786k). */
const DETAIL_GRID = [64, 128, 192, 256] as const;

/**
 * Smooth stone (no flat shading: the geometry carries the detail). White base
 * colour: the vertex colours already hold the stone's tone (the preset's grey
 * would multiply them down to near black).
 */
const SMOOTH_STONE = { preset: 'stone', color: '#ffffff', vertexColors: true, roughness: 0.9 } as const;

function gauss(x: number, w: number): number {
  return Math.exp(-(x * x) / (w * w));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Radius along unit direction (dx, dy, dz) of the superellipsoid
 * |x|^n + |y|^n + |z|^n = 1: n = 2 is a sphere, larger n a rounded box.
 */
function superRadius(dx: number, dy: number, dz: number, n: number): number {
  return (Math.abs(dx) ** n + Math.abs(dy) ** n + Math.abs(dz) ** n) ** (-1 / n);
}

/** Fractal noise (4 octaves, lacunarity 2.1). */
function fbm3(n: Noise, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n.noise3(x * f, y * f, z * f);
    f *= 2.1;
    amp *= 0.5;
  }
  return sum;
}

/** Shape function: maps a unit direction to a point (written to `out`) and returns a cavity value 0..1. */
type Sculpt = (dx: number, dy: number, dz: number, out: Float64Array) => number;

/**
 * Spherified-cube mesh of `n` quads per face edge, displaced by `sculpt`.
 * Lattice points shared between faces get one vertex (exact integer keys),
 * so the surface is closed and the cluster builder sees one manifold.
 */
function sculptedCube(api: InternalApi, n: number, sculpt: Sculpt, cavity: Float32Array | null): Mesh {
  const faces: Array<[number, number, number, number, number, number, number, number, number]> = [
    // normal, u axis, v axis
    [1, 0, 0, 0, 0, -1, 0, 1, 0],
    [-1, 0, 0, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 0, 0, -1],
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0, 0, 0, 1, 0],
    [0, 0, -1, -1, 0, 0, 0, 1, 0],
  ];
  const b = new MeshBuilder(6 * n * n + 2, 6 * n * n * 6);
  const ids = new Map<number, number>();
  const grid = new Int32Array((n + 1) * (n + 1));
  const out = new Float64Array(3);
  const side = n + 1;
  for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of faces) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const a = (2 * i) / n - 1;
        const c = (2 * j) / n - 1;
        // Integer lattice coordinates on the cube surface (exact seams).
        const X = Math.round(((nx + ux * a + vx * c) + 1) * n / 2);
        const Y = Math.round(((ny + uy * a + vy * c) + 1) * n / 2);
        const Z = Math.round(((nz + uz * a + vz * c) + 1) * n / 2);
        const key = (X * side + Y) * side + Z;
        let id = ids.get(key);
        if (id === undefined) {
          const x = (2 * X) / n - 1;
          const y = (2 * Y) / n - 1;
          const z = (2 * Z) / n - 1;
          // Spherified cube: near-uniform triangle sizes.
          const sx = x * Math.sqrt(1 - (y * y) / 2 - (z * z) / 2 + (y * y * z * z) / 3);
          const sy = y * Math.sqrt(1 - (z * z) / 2 - (x * x) / 2 + (z * z * x * x) / 3);
          const sz = z * Math.sqrt(1 - (x * x) / 2 - (y * y) / 2 + (x * x * y * y) / 3);
          const cav = sculpt(sx, sy, sz, out);
          id = b.vertex(out[0] as number, out[1] as number, out[2] as number, sx, sy, sz, 0, 0);
          if (cavity && id < cavity.length) cavity[id] = cav;
          ids.set(key, id);
        }
        grid[j * side + i] = id;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p00 = grid[j * side + i] as number;
        const p10 = grid[j * side + i + 1] as number;
        const p01 = grid[(j + 1) * side + i] as number;
        const p11 = grid[(j + 1) * side + i + 1] as number;
        // Alternate the diagonal for an even, isotropic triangulation.
        if ((i + j) % 2 === 0) {
          b.tri(p00, p10, p11);
          b.tri(p00, p11, p01);
        } else {
          b.tri(p00, p10, p01);
          b.tri(p10, p11, p01);
        }
      }
    }
  }
  return api.fromBuilder(b).recomputeNormals();
}

/** Colossal head on a shoulder block (Easter-Island-like), unit height 2 centred at y = 0. */
function headSculpt(noise: Noise, erosion: number): Sculpt {
  return (dx, dy, dz, out) => {
    // Tall, blocky base volume (rounded-box superellipsoid) with a flat crown.
    const sr = superRadius(dx, dy, dz, 3.4);
    let x = dx * sr * 0.46;
    let y = dy * sr;
    let z = dz * sr * 0.42;
    if (y > 0.82) y = 0.82 + (y - 0.82) * 0.3;
    // Shoulder block below the chin.
    const below = smoothstep(-0.62, -0.95, dy);
    x *= 1 + 0.55 * below;
    z *= 1 + 0.35 * below;
    const front = smoothstep(0.05, 0.55, dz);
    const ax = Math.abs(dx);
    let d = 0;
    // Heavy brow, deep eye shadows, long straight nose, pursed lips, jutting chin.
    d += front * gauss(dy - 0.3, 0.07) * gauss(dx, 0.42) * 0.07;
    d -= front * gauss(ax - 0.19, 0.09) * gauss(dy - 0.18, 0.07) * 0.08;
    const noseBand = smoothstep(0.36, 0.24, dy) * smoothstep(-0.24, -0.12, dy);
    const noseW = 0.06 + 0.05 * smoothstep(0.2, -0.18, dy);
    d += front * gauss(dx, noseW) * noseBand * (0.13 + 0.05 * smoothstep(0.25, -0.15, dy));
    d += front * gauss(dy + 0.17, 0.045) * gauss(ax - 0.085, 0.05) * 0.045;
    d += front * gauss(dy + 0.33, 0.04) * gauss(dx, 0.2) * 0.05;
    d -= front * gauss(dy + 0.385, 0.012) * gauss(dx, 0.2) * 0.03;
    d += front * gauss(dy + 0.43, 0.035) * gauss(dx, 0.17) * 0.035;
    d += front * gauss(dy + 0.56, 0.08) * gauss(dx, 0.24) * 0.07;
    // Long ears.
    const sideW = smoothstep(0.55, 0.85, ax) * gauss(dz + 0.02, 0.12);
    d += sideW * smoothstep(0.32, 0.18, dy) * smoothstep(-0.4, -0.25, dy) * 0.05;
    // Erosion: broad weathering, pits and vertical rain streaks.
    const e = fbm3(noise, dx * 3.1, dy * 3.1, dz * 3.1, 4) * 0.03 + noise.noise3(dx * 23, dy * 23, dz * 23) * 0.006;
    const pit = Math.max(0, noise.noise3(dx * 41 + 7, dy * 41, dz * 41) - 0.45) * 0.03;
    const streak = Math.max(0, noise.noise3(dx * 9, dy * 0.8, dz * 9)) * 0.012;
    d += erosion * (e - pit - streak);
    const r = 1 + d;
    out[0] = x * r;
    out[1] = y * (1 + d * 0.3);
    out[2] = z * r;
    return Math.min(1, Math.max(0, -d * 10 + pit * 30));
  };
}

/** Standing stone with carved rings and a spiral band. */
function monolithSculpt(noise: Noise, erosion: number, carved: boolean): Sculpt {
  return (dx, dy, dz, out) => {
    const taper = 1 - 0.18 * smoothstep(-0.2, 1, dy);
    // Slab: a rounded box (superellipsoid), slightly tapering, with a weathered crown.
    const sr = superRadius(dx, dy, dz, 6);
    let x = dx * sr * 0.34 * taper;
    let z = dz * sr * 0.2 * taper;
    let y = dy * sr;
    if (y > 0.9) y = 0.9 + (y - 0.9) * 0.4;
    let groove = 0;
    if (carved) {
      const band = Math.abs(Math.sin(dy * 26));
      groove += smoothstep(0.92, 1, band) * smoothstep(0.75, 0.5, Math.abs(dy)) * 0.022;
      const spiral = Math.abs(Math.sin(Math.atan2(dz, dx) * 3 + dy * 9));
      groove += smoothstep(0.94, 1, spiral) * smoothstep(0.7, 0.2, Math.abs(dy)) * 0.016;
      // Glyph dots between the rings.
      const g = noise.noise3(dx * 30, dy * 30, dz * 30);
      groove += smoothstep(0.55, 0.7, g) * 0.01 * smoothstep(0.6, 0.3, Math.abs(dy));
    }
    const e = fbm3(noise, dx * 2.7, dy * 2.7, dz * 2.7, 4) * 0.05 + noise.noise3(dx * 19, dy * 19, dz * 19) * 0.007;
    const r = 1 + erosion * e - groove;
    x *= r;
    z *= r;
    y *= 1 + erosion * e * 0.2;
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return Math.min(1, groove * 40 + Math.max(0, -e) * 4);
  };
}

/** Eroded boulder. */
function boulderSculpt(noise: Noise, erosion: number): Sculpt {
  return (dx, dy, dz, out) => {
    const e = fbm3(noise, dx * 1.6, dy * 1.6, dz * 1.6, 5) * 0.35 + Math.abs(noise.noise3(dx * 7, dy * 7, dz * 7)) * -0.05 * erosion;
    const r = 1 + e;
    out[0] = dx * r;
    out[1] = dy * r * 0.72;
    out[2] = dz * r * 0.9;
    return Math.min(1, Math.max(0, -e * 3));
  };
}

const colossus = defineGenerator({
  id: 'colossus',
  description:
    'Ancient high-detail sculpture (hundreds of thousands of smooth triangles, drawn as virtual geometry): colossal stone head on a shoulder block, carved standing stone with rings and a spiral, or an eroded boulder. Use for monuments, ancient ruins and benchmark scenes.',
  category: 'props',
  params: {
    height: pNum(8, 1, 60, 'total height in meters'),
    color: pColor('#9a8f80', 'stone color'),
    mossColor: pColor('#5f7444', 'lichen color on upward surfaces'),
    variant: pVariant(2, '0 colossal head, 1 carved standing stone, 2 eroded boulder'),
    detail: pInt(3, 1, 4, 'tessellation: 1 ≈ 49k, 2 ≈ 196k, 3 ≈ 442k, 4 ≈ 786k triangles'),
    erosion: pNum(1, 0, 2, 'weathering strength'),
    carved: pBool(true, 'carved rings and glyphs (standing stone)'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const n = DETAIL_GRID[Math.min(DETAIL_GRID.length - 1, Math.max(0, p.int('detail') - 1))] as number;
    const erosion = p.num('erosion');
    const sculpt = variant === 0 ? headSculpt(api.noise, erosion) : variant === 1 ? monolithSculpt(api.noise, erosion, p.bool('carved')) : boulderSculpt(api.noise, erosion);
    const cavity = new Float32Array(6 * n * n + 2);
    const mesh = sculptedCube(api, n, sculpt, cavity);
    // Unit volume spans y ∈ [-1, 1] (boulders [-0.72, 0.72]): stand it on the ground at height H.
    const b0 = mesh.bounds();
    const s = H / Math.max(1e-6, b0.max[1] - b0.min[1]);
    mesh.scale(s, s, s).translate(0, -b0.min[1] * s, 0);
    const base = lin(p.color('color'));
    const dark = lin(shade(p.color('color'), -0.45));
    const light = lin(shade(p.color('color'), 0.18));
    const moss = lin(p.color('mossColor'));
    const tmp: RGB = [0, 0, 0];
    const noise = api.noise;
    let v = 0;
    mesh.paintFn((x, y, z, _nx, ny, _nz, out) => {
      const k = 0.5 + 0.5 * noise.noise3(x * 0.9, y * 0.9, z * 0.9);
      mixLinear(base, light, k * 0.7, tmp);
      mixLinear(tmp, dark, Math.min(1, (cavity[v] ?? 0) * 0.8 + (y < H * 0.04 ? 0.35 : 0)), out);
      if (ny > 0.55) mixLinear(out, moss, Math.min(0.85, (ny - 0.55) * 2.2 * (0.6 + 0.4 * noise.noise3(x * 2, y * 2, z * 2))), out);
      v++;
    });
    api.add(mesh, SMOOTH_STONE);
    const bb = mesh.bounds();
    const w = bb.max[0] - bb.min[0];
    const d = bb.max[2] - bb.min[2];
    if (variant === 2) api.collider(cylinderCollider(0, H / 2, 0, Math.min(w, d) * 0.45, H * 0.9));
    else api.collider(boxCollider((bb.max[0] + bb.min[0]) / 2, H / 2, (bb.max[2] + bb.min[2]) / 2, w * 0.9, H, d * 0.9));
    return api.build();
  },
});

/** Weathered marble: a pale, finely textured stone (the polished-marble finish reads too veiny at this scale). */
const marble = (color: string): MaterialSpec => ({ finish: 'plaster', color, roughness: 0.6 });

/** Cell size (metres on the nominal 2 m figure) per detail level: ≈ 13k, 27k, 55k, 115k triangles. */
const SCULPT_CELL = [0.032, 0.022, 0.015, 0.0105] as const;

/**
 * Poses in the figure's nominal 2 m frame (sole y = 0, facing +Z, its right side -X; angles in degrees), with the
 * grip of the held spear (from the hand frame) and SDF props that belong to the stone: shield, throne back.
 */
function statuePose(variant: number, seed: number, turn: number): { figure: SdfNode; props: SdfNode[]; spear: [Vec3, Vec3] | null } {
  const fist = [72, 77, 52];
  if (variant === 1) {
    // seated goddess on a throne, one hand on the lap, the other raised (sceptre hand)
    return {
      figure: {
        shape: 'figure', sex: 'f', seed, seat: 0.47, hair: 'wavy', chest: { yaw: -8.6 }, head: { yaw: 17 + turn, pitch: 5.7 },
        armR: { wrist: [-0.14, 0.72, 0.36], pole: [-1, 0, -0.2], fingers: [0.1, -0.3, 1], dorsal: [0, 1, 0] },
        armL: { wrist: [0.26, 1.28, 0.12], pole: [1, -0.8, -0.3], fingers: [-0.1, 0.05, 1], dorsal: [1, 0, 0.1], curl: fist, thumbCurl: 0.9, spread: 0 },
      },
      props: [{ shape: 'box', size: [0.54, 0.62, 0.09], round: 0.025, at: [0, 0.78, -0.235] }], // throne back on the figure's seat block
      spear: null,
    };
  }
  if (variant === 2) {
    // striding warrior, spear raised overhead, round shield on the left forearm
    const shield: SdfNode = {
      op: 'union', k: 0.02, at: [0.43, 1.15, 0.24], rot: [0, -19, -90],
      items: [
        { shape: 'cylinder', r: 0.22, h: 0.022 },
        { shape: 'torus', R: 0.205, r: 0.018, at: [0, 0.008, 0] },
        { shape: 'ellipsoid', r: [0.07, 0.035, 0.07], at: [0, 0.012, 0] },
      ],
    };
    return {
      figure: {
        shape: 'figure', sex: 'm', seed, garment: 'chiton', weight: 'L', hair: 'curly',
        hip: { y: 0.94, roll: -2.3 }, chest: { yaw: 20, pitch: 6.9 }, head: { yaw: -17 + turn, pitch: 2.9 },
        weightAnkle: [0.13, 0.1, -0.38], freeAnkle: [-0.14, 0.08, 0.36],
        armR: { wrist: [-0.26, 1.7, 0.2], pole: [-1, -0.3, -0.4], fingers: [0, 0.3, 1], dorsal: [-1, 0, 0], curl: fist, thumbCurl: 0.9, spread: 0 },
        armL: { wrist: [0.34, 1.2, 0.2], pole: [1, -0.6, -0.5], fingers: [0, 1, 0.2], dorsal: [1, 0, 0], curl: [63, 69, 46] },
        drape: { skirtBottom: 0.58, hemY: 1.05, belt: true, mantle: false, folds: 22, foldAmp: 0.012, legPush: -0.01 },
      },
      props: [shield],
      // along the fist's grip axis, tilted forward and down
      spear: [[-0.226, 0.4, 0.67], [-0.226, 2.58, 0.02]],
    };
  }
  // standing goddess (Athena type): weight on the right leg, the right arm raised to a tall spear, mantle behind
  return {
    figure: {
      shape: 'figure', sex: 'f', seed, garment: 'peplos', weight: 'R', hair: 'wavy',
      hip: { roll: 2.9 }, head: { yaw: -14.3 + turn, pitch: 4.6 },
      armR: { wrist: [-0.38, 1.47, 0.08], pole: [-0.5, -1, -0.45], fingers: [0.1, 0.05, 1], dorsal: [-1, 0, 0.1], curl: fist, thumbCurl: 0.9, spread: 0 },
      armL: { wrist: [0.27, 0.96, 0.06], pole: [0.5, 0, -1], fingers: [0.15, -1, 0.1], dorsal: [1, 0, 0], curl: [17, 20, 14] },
      drape: { mantle: true },
    },
    props: [],
    spear: [[-0.338, 0.01, 0.154], [-0.338, 2.35, 0.154]],
  };
}

const sculptedStatue = defineGenerator({
  id: 'sculpted-statue',
  description:
    'Carved classical marble statue on a plinth (a sculpted figure: face, hands, hair, folded drapery): standing goddess with spear, seated goddess on a throne, or striding warrior with spear and shield.',
  category: 'props',
  params: {
    height: pNum(2.4, 0.5, 30, 'figure height in meters (sole to crown, without the plinth)'),
    color: pColor('#ece5d8', 'marble colour'),
    variant: pVariant(2, '0 standing goddess with raised spear, 1 seated goddess on a throne, 2 striding warrior with spear and shield'),
    pedestal: pBool(true, 'stand on a stepped plinth'),
    detail: pInt(2, 1, 4, 'sculpt resolution: 1 ≈ 13k, 2 ≈ 27k, 3 ≈ 55k, 4 ≈ 115k triangles'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const s = H / 2; // the figure is sculpted at a nominal 2 m
    const mat = marble(p.color('color'));
    const pose = statuePose(variant, 100 + Math.floor(api.rng() * 1000), (api.rng() - 0.5) * 10);
    const tree: SdfNode = pose.props.length ? { op: 'union', items: [pose.figure, ...pose.props] } : pose.figure;
    const cell = SCULPT_CELL[Math.min(SCULPT_CELL.length, Math.max(1, p.int('detail'))) - 1] as number;
    const fig = api.sdf(tree, { cell, smooth: 1, project: 1 });
    const fb = fig.bounds();
    const ped = p.bool('pedestal') ? H * 0.14 : 0;
    const y0 = ped - fb.min[1] * s; // sandals on the plinth
    fig.scale(s).translate(0, y0, 0);
    api.add(fig, mat);
    if (pose.spear) {
      // bronze spear (shaft and leaf blade) through the closed fist
      const [a, b] = pose.spear;
      const at = (q: Vec3): Vec3 => [q[0] * s, q[1] * s + y0, q[2] * s];
      const dir: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      const tip: Vec3 = [b[0] + (dir[0] / l) * 0.2, b[1] + (dir[1] / l) * 0.2, b[2] + (dir[2] / l) * 0.2];
      const bronze: MaterialSpec = { finish: 'brass', color: '#6d5532', roughness: 0.55, metalness: 0.8 };
      api.add(api.limb(at(a), at(b), 0.014 * s, 0.014 * s, 10), bronze);
      api.add(api.limb(at(b), at(tip), 0.03 * s, 0.002 * s, 10), bronze);
    }
    // plinth sized to the figure's footprint: a base step, a die and a cornice
    const w = Math.max(fb.max[0] - fb.min[0], fb.max[2] - fb.min[2]) * s * 1.08 + H * 0.06;
    const cx = ((fb.min[0] + fb.max[0]) / 2) * s, cz = ((fb.min[2] + fb.max[2]) / 2) * s;
    if (ped > 0) {
      const ps = marble(shade(p.color('color'), -0.06));
      api.add(api.roundedBox(w * 1.14, ped * 0.22, w * 1.14, ped * 0.03, 2).translate(cx, ped * 0.11, cz), ps);
      api.add(api.roundedBox(w, ped * 0.62, w, ped * 0.02, 2).translate(cx, ped * 0.53, cz), ps);
      api.add(api.roundedBox(w * 1.07, ped * 0.16, w * 1.07, ped * 0.03, 2).translate(cx, ped * 0.92, cz), ps);
    }
    const top = ped + (fb.max[1] - fb.min[1]) * s;
    api.collider(boxCollider(cx, top / 2, cz, Math.max(w, (fb.max[0] - fb.min[0]) * s), top, Math.max(w, (fb.max[2] - fb.min[2]) * s)));
    return api.build();
  },
});

/** Sculpture generators in catalog order. */
export const SCULPTURE_GENERATORS = [colossus, sculptedStatue];
