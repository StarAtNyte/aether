/**
 * Baked lightmaps of a building: the per-surface companion of the probe volume (`light-volume.ts`).
 *
 * The volume lights every point of a room from probes 0.45 m apart, so a wall corner, the floor under a sofa or the
 * ceiling above a pendant all read the same smooth value. A lightmap stores the same two quantities per surface texel
 * (a few centimetres apart) instead:
 *
 * - `vis`: the cosine-weighted share of the sky the texel sees (ambient occlusion of the sky and image light);
 * - `B`: the irradiance that reaches it after bouncing (sun patches on the floor, lamps on the walls, the lit
 *   ground outside, all reflected by the surfaces' own colours), without the direct light of the sun and the lamps,
 *   which the renderer keeps computing live (shadow maps, switched lamps, opening doors).
 *
 * `B` is re-lightable (`relight.ts`, docs/LIGHTING-BAKE.md): it is baked as parts, one per unit source (the sky's constant
 * and gradient terms, the lamps, a sun from each of 15 key directions), and the shader weights them with the live light. A
 * new hour changes uniforms, never the bake.
 *
 * The runtime formula is the volume's (`ambientOcclusion *= vis`, `irradiance += B / vis`), so a baked surface and a
 * volume-lit surface look alike side by side and a missing lightmap falls back to the volume without a visible jump.
 *
 * The bake is a small path tracer on the CPU (pure, deterministic, no three.js; it runs in a worker): every covered
 * texel of an atlas shoots cosine-weighted, stratified rays against the building's {@link TraceScene}; a ray that
 * leaves the building counts as sky, a ray that hits a surface collects that surface's outgoing radiance per part (direct
 * sun keys and lamps with shadow rays, plus the ambient and bounce the already-baked volume holds there: a final gather,
 * so the volume supplies the later bounces). The result is denoised with an edge-aware filter inside the atlas and encoded
 * by {@link encodeLightmap}.
 *
 * Surfaces are unwrapped into axis-aligned charts (the six directions a wall, floor or tabletop faces; connected
 * triangles of the same direction share one chart) and shelf-packed into one square atlas of 256, 512 or 1024 texels.
 */
import { PART_FLOATS, sampleStrided, TraceScene, type V3, type VolumeGrid, type VolumeLamp } from './light-volume';
import { groundFactors, LAYER_CHROMA, LAYER_SUN0, lightmapLayers, LUM, partCount, PART_LAMP, PART_SKY0, PART_SKY1, PART_SUN0, scaleCount } from './relight';

/** Bump when the unwrap, the bake or the encoding changes: stored lightmaps stop matching. */
export const LIGHTMAP_VERSION = 5;
/** Most triangles baked in one lightmap (the rest keep the volume). */
export const LIGHTMAP_MAX_TRIANGLES = 160_000;
/** Empty texels around every chart (bilinear filtering never reaches another chart). */
export const CHART_PAD = 2;
/** Fewest texels per metre the unwrap accepts before it drops meshes. */
export const MIN_DENSITY = 4;
/** Most texels per metre the unwrap ever uses (the quality plans cap it lower). */
export const MAX_DENSITY = 64;
/** Metres a texel's rays start off the surface. */
const RAY_BIAS = 0.02;
const SPACES = [256, 512, 1024] as const;
/** Texels kept empty along the top and left of the atlas. */
const RESERVED = 3;

export type LightmapQuality = 'low' | 'medium' | 'high';

/** What a bake costs: the atlas size and the rays per texel. */
export interface LightmapPlan {
  quality: LightmapQuality;
  /** Largest atlas edge in texels (the unwrap shrinks it when the surfaces need less). */
  size: number;
  samples: number;
  /** Most texels per metre: a small room stops here and its atlas shrinks instead of spending rays on a centimetre. */
  density: number;
}

const QUALITY: Readonly<Record<LightmapQuality, { size: number; samples: number; density: number }>> = {
  low: { size: 256, samples: 24, density: 10 },
  medium: { size: 512, samples: 48, density: 20 },
  high: { size: 1024, samples: 96, density: 32 },
};

/** The plan for a quality, with an optional ray-count override (clamped to 8..512). */
export function planLightmap(quality: LightmapQuality, samples?: number): LightmapPlan {
  const q = QUALITY[quality] ?? QUALITY.medium;
  const s = samples === undefined || !Number.isFinite(samples) ? q.samples : Math.max(8, Math.min(1024, Math.round(samples)));
  return { quality, size: q.size, samples: s, density: q.density };
}

/** One mesh offered to the unwrap and the bake, in world space. */
export interface LightmapMesh {
  /** Three floats per vertex. */
  positions: Float32Array;
  /** Three floats per vertex (unit). */
  normals: Float32Array;
  /** Triangle list, or null when the vertices are already listed three at a time. */
  index: Uint32Array | null;
}

export function meshTriangleCount(m: Pick<LightmapMesh, 'positions' | 'index'>): number {
  return m.index ? Math.floor(m.index.length / 3) : Math.floor(m.positions.length / 9);
}

/** The atlas assignment of a set of meshes. */
export interface LightmapLayout {
  /** Atlas edge in texels. */
  size: number;
  /** Texels per metre the charts were scaled to. */
  density: number;
  /** Per mesh: six floats per triangle (u, v of its three corners, 0..1), or null for a mesh that is not baked. */
  uv: Array<Float32Array | null>;
  charts: number;
  /** Texels inside charts (without padding). */
  texels: number;
}

interface Chart {
  mesh: number;
  tris: number[];
  /** Axis the chart faces along (0 x, 1 y, 2 z). */
  axis: number;
  minU: number;
  minV: number;
  extU: number;
  extV: number;
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

const U_AXIS = [2, 0, 0] as const;
const V_AXIS = [1, 2, 1] as const;

function corner(m: LightmapMesh, t: number, k: number): number {
  return m.index ? (m.index[t * 3 + k] as number) : t * 3 + k;
}

/** Union-find with path halving. */
class Sets {
  readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    const p = this.parent;
    while (p[a] !== a) {
      p[a] = p[p[a] as number] as number;
      a = p[a] as number;
    }
    return a;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** Vertex → representative vertex index at the same place (1 mm grid). */
function weldVertices(positions: Float32Array, count: number): Int32Array {
  const rep = new Int32Array(count);
  const q = new Int32Array(count * 3);
  const table = new Map<number, number>();
  for (let v = 0; v < count; v++) {
    const qx = Math.round((positions[v * 3] as number) * 1000);
    const qy = Math.round((positions[v * 3 + 1] as number) * 1000);
    const qz = Math.round((positions[v * 3 + 2] as number) * 1000);
    q[v * 3] = qx;
    q[v * 3 + 1] = qy;
    q[v * 3 + 2] = qz;
    let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) | 0;
    for (;;) {
      const r = table.get(h);
      if (r === undefined) {
        table.set(h, v);
        rep[v] = v;
        break;
      }
      if (q[r * 3] === qx && q[r * 3 + 1] === qy && q[r * 3 + 2] === qz) {
        rep[v] = r;
        break;
      }
      h = (h + 1) | 0;
    }
  }
  return rep;
}

/** Charts of one mesh: connected triangles that face the same axis direction. Degenerate triangles belong to none. */
function meshCharts(m: LightmapMesh, meshIndex: number, out: Chart[]): void {
  const T = meshTriangleCount(m);
  const V = Math.floor(m.positions.length / 3);
  const P = m.positions;
  const N = m.normals;
  const bin = new Int8Array(T).fill(-1);
  const nrm = new Float32Array(T * 3);
  for (let t = 0; t < T; t++) {
    const a = corner(m, t, 0) * 3, b = corner(m, t, 1) * 3, c = corner(m, t, 2) * 3;
    const e1x = (P[b] as number) - (P[a] as number), e1y = (P[b + 1] as number) - (P[a + 1] as number), e1z = (P[b + 2] as number) - (P[a + 2] as number);
    const e2x = (P[c] as number) - (P[a] as number), e2y = (P[c + 1] as number) - (P[a + 1] as number), e2z = (P[c + 2] as number) - (P[a + 2] as number);
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9) || !Number.isFinite(l)) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    // Face the way the mesh's own normals do (a mirrored winding must not flip the chart).
    const sx = (N[a] as number) + (N[b] as number) + (N[c] as number);
    const sy = (N[a + 1] as number) + (N[b + 1] as number) + (N[c + 1] as number);
    const sz = (N[a + 2] as number) + (N[b + 2] as number) + (N[c + 2] as number);
    if (nx * sx + ny * sy + nz * sz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    nrm[t * 3] = nx;
    nrm[t * 3 + 1] = ny;
    nrm[t * 3 + 2] = nz;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    bin[t] = axis * 2 + ((axis === 0 ? nx : axis === 1 ? ny : nz) < 0 ? 1 : 0);
  }
  const rep = weldVertices(P, V);
  const first = new Int32Array(V * 6).fill(-1);
  const sets = new Sets(T);
  for (let t = 0; t < T; t++) {
    const b = bin[t] as number;
    if (b < 0) continue;
    for (let k = 0; k < 3; k++) {
      const slot = (rep[corner(m, t, k)] as number) * 6 + b;
      const f = first[slot] as number;
      if (f < 0) first[slot] = t;
      else if ((nrm[t * 3] as number) * (nrm[f * 3] as number) + (nrm[t * 3 + 1] as number) * (nrm[f * 3 + 1] as number) + (nrm[t * 3 + 2] as number) * (nrm[f * 3 + 2] as number) >= 0.9) sets.union(t, f);
    }
  }
  const byRoot = new Map<number, Chart>();
  for (let t = 0; t < T; t++) {
    const b = bin[t] as number;
    if (b < 0) continue;
    const root = sets.find(t);
    let ch = byRoot.get(root);
    if (!ch) {
      ch = { mesh: meshIndex, tris: [], axis: b >> 1, minU: Infinity, minV: Infinity, extU: 0, extV: 0, x: 0, y: 0, w: 0, h: 0, area: 0 };
      byRoot.set(root, ch);
    }
    ch.tris.push(t);
  }
  for (const ch of byRoot.values()) {
    const ua = U_AXIS[ch.axis] as number;
    const va = V_AXIS[ch.axis] as number;
    let maxU = -Infinity, maxV = -Infinity;
    for (const t of ch.tris) {
      for (let k = 0; k < 3; k++) {
        const o = corner(m, t, k) * 3;
        const u = P[o + ua] as number;
        const v = P[o + va] as number;
        if (u < ch.minU) ch.minU = u;
        if (v < ch.minV) ch.minV = v;
        if (u > maxU) maxU = u;
        if (v > maxV) maxV = v;
      }
    }
    ch.extU = maxU - ch.minU;
    ch.extV = maxV - ch.minV;
    ch.area = ch.extU * ch.extV;
    out.push(ch);
  }
}

/** Shelf-pack `charts` (sized for `density`) into `size` × `size`; false when they do not fit. Sets x, y, w, h. */
function pack(charts: Chart[], edge: number, density: number): boolean {
  // The first texels of the atlas stay empty: the corner texel is where triangles no chart holds point.
  const size = edge - RESERVED;
  for (const c of charts) {
    c.w = Math.max(2, Math.ceil(c.extU * density)) + 2 * CHART_PAD;
    c.h = Math.max(2, Math.ceil(c.extV * density)) + 2 * CHART_PAD;
    if (c.w > size || c.h > size) return false;
  }
  const order = charts.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of order) {
    if (x + c.w > size) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    if (y + c.h > size) return false;
    c.x = x + RESERVED;
    c.y = y + RESERVED;
    x += c.w;
    rowH = Math.max(rowH, c.h);
  }
  return true;
}

/**
 * Unwrap `meshes` into one atlas of at most `maxSize` texels (rounded up to 256, 512 or 1024 by what the surfaces need).
 * The charts are scaled to the largest density that fits (at most `maxDensity` texels per metre); when even {@link MIN_DENSITY} does not, the meshes with the
 * most surface are left out (their entry in `uv` is null) until it does. Null when nothing can be baked.
 */
export function unwrapLightmap(meshes: readonly LightmapMesh[], maxSize: number, maxDensity = MAX_DENSITY): LightmapLayout | null {
  const edge = SPACES.filter((s) => s <= maxSize).pop() ?? SPACES[0];
  const all: Chart[][] = [];
  let triangles = 0;
  for (let i = 0; i < meshes.length; i++) {
    const list: Chart[] = [];
    const m = meshes[i] as LightmapMesh;
    if (triangles + meshTriangleCount(m) <= LIGHTMAP_MAX_TRIANGLES) {
      meshCharts(m, i, list);
      triangles += meshTriangleCount(m);
    }
    all.push(list);
  }
  const keep = all.map((l) => l.length > 0);
  const area = (i: number): number => (all[i] as Chart[]).reduce((s, c) => s + c.area, 0);
  const fit = (): { charts: Chart[]; density: number; size: number } | null => {
    const charts = all.flatMap((l, i) => (keep[i] ? l : []));
    if (charts.length === 0) return null;
    // Largest density that fits the biggest atlas (bisection on the monotone "fits").
    let lo = MIN_DENSITY;
    let hi = Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, maxDensity));
    if (!pack(charts, edge, lo)) return null;
    if (pack(charts, edge, hi)) lo = hi;
    else {
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (pack(charts, edge, mid)) lo = mid;
        else hi = mid;
      }
    }
    // The smallest square edge that holds them at that density.
    let size = edge;
    for (const s of SPACES) {
      if (s >= edge) break;
      if (pack(charts, s, lo)) {
        size = s;
        break;
      }
    }
    pack(charts, size, lo);
    return { charts, density: lo, size };
  };
  let packed = fit();
  while (!packed) {
    // Drop the mesh with the most surface (a terrain-sized plane, not a room) and try again.
    let drop = -1;
    for (let i = 0; i < all.length; i++) if (keep[i] && (drop < 0 || area(i) > area(drop))) drop = i;
    if (drop < 0) return null;
    keep[drop] = false;
    packed = fit();
  }
  const { charts, density, size } = packed;
  const uv: Array<Float32Array | null> = meshes.map((m, i) => (keep[i] ? new Float32Array(meshTriangleCount(m) * 6) : null));
  // Triangles no chart holds (degenerate) point at the reserved empty texel (0.5, 0.5).
  const empty = 0.5 / size;
  for (const a of uv) if (a) for (let i = 0; i < a.length; i++) a[i] = empty;
  let texels = 0;
  for (const c of charts) {
    const m = meshes[c.mesh] as LightmapMesh;
    const out = uv[c.mesh] as Float32Array;
    const ua = U_AXIS[c.axis] as number;
    const va = V_AXIS[c.axis] as number;
    texels += (c.w - 2 * CHART_PAD) * (c.h - 2 * CHART_PAD);
    for (const t of c.tris) {
      for (let k = 0; k < 3; k++) {
        const o = corner(m, t, k) * 3;
        const X = c.x + CHART_PAD + (((m.positions[o + ua]) as number) - c.minU) * density;
        const Y = c.y + CHART_PAD + (((m.positions[o + va]) as number) - c.minV) * density;
        out[t * 6 + k * 2] = X / size;
        out[t * 6 + k * 2 + 1] = Y / size;
      }
    }
  }
  return { size, density, uv, charts: charts.length, texels };
}

/** Quantise layout coordinates to 16 bits (the stored form; 1/65535 of the atlas is far below a texel). */
export function quantizeUv(uv: Float32Array): Uint16Array {
  const out = new Uint16Array(uv.length);
  for (let i = 0; i < uv.length; i++) out[i] = Math.max(0, Math.min(65535, Math.round((uv[i] as number) * 65535)));
  return out;
}

export function dequantizeUv(q: Uint16Array): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (q[i] as number) / 65535;
  return out;
}

// --- texels ---------------------------------------------------------------------------------------------------------

/** World position and normal of every covered texel of an atlas. */
export interface Texels {
  size: number;
  /** 0 empty, 1 inside a chart, 2 a gutter texel copied from a neighbour (bilinear filtering across the chart edge). */
  cov: Uint8Array;
  pos: Float32Array;
  nrm: Float32Array;
  /** Gutter texel → the covered texel it copies (-1: none). */
  source: Int32Array;
  covered: number;
}

/** Rasterise the baked triangles into the atlas: for each texel centre, the point and normal of the surface under it. */
export function rasterizeTexels(meshes: readonly LightmapMesh[], layout: LightmapLayout): Texels {
  const S = layout.size;
  const cov = new Uint8Array(S * S);
  const pos = new Float32Array(S * S * 3);
  const nrm = new Float32Array(S * S * 3);
  const err = new Float32Array(S * S).fill(Infinity);
  const source = new Int32Array(S * S).fill(-1);
  let covered = 0;
  for (let mi = 0; mi < meshes.length; mi++) {
    const uv = layout.uv[mi];
    if (!uv) continue;
    const m = meshes[mi] as LightmapMesh;
    const T = meshTriangleCount(m);
    for (let t = 0; t < T; t++) {
      const x0 = (uv[t * 6] as number) * S, y0 = (uv[t * 6 + 1] as number) * S;
      const x1 = (uv[t * 6 + 2] as number) * S, y1 = (uv[t * 6 + 3] as number) * S;
      const x2 = (uv[t * 6 + 4] as number) * S, y2 = (uv[t * 6 + 5] as number) * S;
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-9) continue;
      const a = corner(m, t, 0) * 3, b = corner(m, t, 1) * 3, c = corner(m, t, 2) * 3;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1));
      const maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1));
      const maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
      for (let j = minY; j <= maxY; j++) {
        for (let i = minX; i <= maxX; i++) {
          const px = i + 0.5, py = j + 0.5;
          let l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den;
          let l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
          let l2 = 1 - l0 - l1;
          let e = 0;
          if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) {
            // Outside by less than a texel still counts (thin charts would otherwise lose their texels): use the
            // nearest point of the triangle, found by clamping the weights.
            l0 = Math.max(0, l0);
            l1 = Math.max(0, l1);
            l2 = Math.max(0, l2);
            const s = l0 + l1 + l2;
            if (!(s > 0)) continue;
            l0 /= s;
            l1 /= s;
            l2 /= s;
            e = Math.hypot(px - (l0 * x0 + l1 * x1 + l2 * x2), py - (l0 * y0 + l1 * y1 + l2 * y2));
            if (e > 1) continue;
          }
          const o = j * S + i;
          if (cov[o] && (err[o] as number) <= e) continue;
          if (!cov[o]) covered++;
          cov[o] = 1;
          err[o] = e;
          for (let k = 0; k < 3; k++) {
            pos[o * 3 + k] = l0 * (m.positions[a + k] as number) + l1 * (m.positions[b + k] as number) + l2 * (m.positions[c + k] as number);
            nrm[o * 3 + k] = l0 * (m.normals[a + k] as number) + l1 * (m.normals[b + k] as number) + l2 * (m.normals[c + k] as number);
          }
          const l = Math.hypot(nrm[o * 3] as number, nrm[o * 3 + 1] as number, nrm[o * 3 + 2] as number) || 1;
          nrm[o * 3] = (nrm[o * 3] as number) / l;
          nrm[o * 3 + 1] = (nrm[o * 3 + 1] as number) / l;
          nrm[o * 3 + 2] = (nrm[o * 3 + 2] as number) / l;
        }
      }
    }
  }
  // Gutters: an empty texel next to a covered one copies it (4-neighbours first), so filtering at a chart's edge never
  // blends in empty black.
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const o = j * S + i;
      if (cov[o]) continue;
      let s = -1;
      for (const [dx, dy] of NEIGHBOURS) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        if (cov[y * S + x] === 1) {
          s = y * S + x;
          break;
        }
      }
      if (s >= 0) source[o] = s;
    }
  }
  for (let o = 0; o < S * S; o++) if ((source[o] as number) >= 0) cov[o] = 2;
  return { size: S, cov, pos, nrm, source, covered };
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// --- the bake -------------------------------------------------------------------------------------------------------

/** A furniture box in the trace scene: a texel inside it belongs to that furniture, which must not shadow it. */
export interface ProxyBox {
  lo: V3;
  hi: V3;
  /** First of its 12 triangles. */
  tri: number;
}

/** Everything {@link LightmapBaker} reads. */
export interface LightmapBakeInput {
  scene: TraceScene;
  proxies: readonly ProxyBox[];
  meshes: readonly LightmapMesh[];
  layout: LightmapLayout;
  grid: VolumeGrid;
  /** The finished re-lightable volume as one field (`light-volume.ts` `partsField`): visibility then the parts, per probe. */
  field: Float32Array;
  /** Floats per probe of {@link field}: 4 + parts · PART_FLOATS. */
  stride: number;
  /** Free-distance codes of the volume (two per probe). */
  codes: Float32Array;
  /** Directions toward the sun of the sun keys (the volume's, in its order). */
  sunKeys: readonly V3[];
  ground: { y: number; albedo: V3 };
  /** The lamps at full strength. */
  lamps: readonly VolumeLamp[];
  samples: number;
  /**
   * Gather only every `count`-th covered texel from `index` (a bake split over threads, scripts/blender-bake.ts): the baker
   * stops after the gather ({@link LightmapBaker.gathered}); {@link LightmapBaker.finishFrom} denoises and encodes the merged
   * texels of all the shares.
   */
  split?: { index: number; count: number };
}

/** The finished bake. */
export interface LightmapResult {
  size: number;
  /** Layers of {@link rgba} (`relight.ts` `lightmapLayers`). */
  layers: number;
  /** Sun keys stored. */
  keys: number;
  /**
   * The atlas layers, `size × size` RGBA each, rows from the top, layer after layer (`relight.ts`: sky0, sky1, lamp, the sun
   * keys' chroma, their luminance three to a layer; {@link encodePart}), the sky visibility in a of every layer (0: no data).
   */
  rgba: Uint8Array;
  /** The value a code of 255 stands for (`relight.ts` `scaleCount`: sky0, sky1, lamp, chroma (1), each key). */
  scales: Float32Array;
  texels: number;
  rays: number;
}

type Stage = 'raster' | 'gather' | 'denoise' | 'encode' | 'done';

const CELL = 0.1;
/** Slots of the shading cache (2^18: 9 MB of floats per 9 parts). */
const TABLE_BITS = 18;

function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Bakes a {@link LightmapBakeInput} in time slices ({@link step}) or at once ({@link run}). The result does not depend
 * on how the work is sliced. Every ray carries all the parts at once: one trace, one shadow test per sun key and lamp at a
 * hit (cached per 10 cm cell), one read of the volume.
 */
export class LightmapBaker {
  private stage: Stage = 'raster';
  private texels: Texels | null = null;
  private order: Int32Array = new Int32Array(0);
  private cursor = 0;
  private vis = new Float32Array(0);
  /** Per texel, per part, RGB. */
  private bounce = new Float32Array(0);
  /** Texels whose rays mostly left through back faces (on a chart edge, flush with a wall): filled from their neighbours. */
  private bad = new Uint8Array(0);
  private result: LightmapResult | null = null;
  /** Texels no neighbour could fill (set while denoising). */
  leftover = 0;
  private rays = 0;
  readonly parts: number;
  /** Floats of light per texel: parts × 3. */
  private readonly PL: number;
  /**
   * Per part and channel: what a ray that lands on the open ground adds, π times the ground's radiance under the part's unit
   * source (a surface hit adds albedo × irradiance, which is the same π × radiance; the single-time bake added the radiance
   * alone, a third of the ground's light).
   */
  private readonly groundL: Float32Array;
  private readonly samples: number;
  private readonly dirs: Float32Array;
  // Shading cache: per part, the irradiance at a hit (direct sun and lamps, the volume's ambient and bounce), by triangle and 10 cm cell.
  private readonly tableBits: number;
  private readonly keyA: Int32Array;
  private readonly keyB: Int32Array;
  private readonly vals: Float32Array;
  private readonly n3: [number, number, number] = [0, 0, 0];
  private readonly volScratch: Float32Array;
  private readonly shade: Float32Array;
  private readonly sum: Float64Array;

  constructor(private readonly input: LightmapBakeInput) {
    this.samples = Math.max(4, Math.min(1024, Math.floor(input.samples)));
    this.parts = partCount(input.sunKeys.length);
    if (input.stride !== 4 + this.parts * PART_FLOATS) throw new Error('lightmap bake: the volume has other parts than the keys');
    this.PL = this.parts * 3;
    const gf = groundFactors(input.sunKeys);
    this.groundL = new Float32Array(this.PL);
    for (let p = 0; p < this.parts; p++) for (let c = 0; c < 3; c++) this.groundL[p * 3 + c] = Math.max(0, Math.min(1, input.ground.albedo[c as 0 | 1 | 2])) * gf[p]!;
    // Cosine-weighted, stratified directions in the local frame (z up); each texel turns them by its own angle.
    const R = this.samples;
    this.dirs = new Float32Array(R * 3);
    for (let k = 0; k < R; k++) {
      const u1 = (k + 0.5) / R;
      const u2 = radicalInverse2(k);
      const r = Math.sqrt(u1);
      const phi = 2 * Math.PI * u2;
      this.dirs[k * 3] = r * Math.cos(phi);
      this.dirs[k * 3 + 1] = r * Math.sin(phi);
      this.dirs[k * 3 + 2] = Math.sqrt(1 - u1);
    }
    // The same table whatever the part count: which hit point fills a cell (the cell's value) then does not depend on the parts,
    // so two bakes of the same building with other sun keys carry the same noise and differ only by their light.
    this.tableBits = TABLE_BITS;
    this.keyA = new Int32Array(1 << this.tableBits).fill(-1);
    this.keyB = new Int32Array(1 << this.tableBits);
    this.vals = new Float32Array(this.PL << this.tableBits);
    this.volScratch = new Float32Array(input.stride);
    this.shade = new Float32Array(this.PL);
    this.sum = new Float64Array(this.PL);
  }

  get progress(): number {
    if (this.stage === 'done') return 1;
    if (this.stage === 'raster') return 0;
    if (this.stage === 'gather') return 0.05 + 0.85 * (this.cursor / Math.max(1, this.order.length));
    return this.stage === 'denoise' ? 0.92 : 0.97;
  }

  get done(): boolean {
    return this.stage === 'done';
  }

  /** Work for about `budgetMs`; true once finished. */
  step(budgetMs: number, now: () => number = () => performance.now()): boolean {
    const until = now() + Math.max(0.5, budgetMs);
    while (this.stage !== 'done') {
      if (this.stage === 'raster') {
        this.raster();
      } else if (this.stage === 'gather') {
        const n = this.order.length;
        const sp = this.input.split;
        while (this.cursor < n) {
          const i = this.cursor++;
          if (!sp) this.gatherTexel(this.order[i] as number, this.order[i] as number);
          else if (i % sp.count === sp.index) this.gatherTexel(this.order[i] as number, (i - sp.index) / sp.count);
          if ((this.cursor & 15) === 0 && now() > until) return false;
        }
        if (sp) {
          this.stage = 'done';
          return true;
        }
        this.stage = 'denoise';
      } else if (this.stage === 'denoise') {
        this.denoise();
        this.stage = 'encode';
      } else {
        this.encode();
        this.stage = 'done';
      }
      if (now() > until && this.stage !== 'done') return false;
    }
    return true;
  }

  private raster(): void {
    this.texels = rasterizeTexels(this.input.meshes, this.input.layout);
    const t = this.texels;
    const list: number[] = [];
    for (let o = 0; o < t.cov.length; o++) if (t.cov[o] === 1) list.push(o);
    this.order = Int32Array.from(list);
    // A share of a split bake keeps only its own texels (a 1024² atlas of 18 parts is 216 MB per baker otherwise).
    const sp = this.input.split;
    const slots = sp ? Math.max(0, Math.ceil((this.order.length - sp.index) / sp.count)) : t.size * t.size;
    this.vis = new Float32Array(slots);
    this.bounce = new Float32Array(slots * this.PL);
    this.bad = new Uint8Array(slots);
    this.stage = 'gather';
    this.cursor = 0;
  }

  run(): LightmapResult {
    while (!this.step(1e9)) {
      /* keep going */
    }
    return this.result as LightmapResult;
  }

  get output(): LightmapResult | null {
    return this.result;
  }

  /**
   * A split bake's share after its gather: for each of its texels (every `count`-th of the covered texels in order, from
   * `index`), the visibility, the parts' RGB and whether it lay inside a wall (filled from its neighbours later).
   */
  gathered(): { vis: Float32Array; bounce: Float32Array; bad: Uint8Array; rays: number } {
    // A share stores its texels compactly, in order (see raster).
    if (this.input.split) return { vis: this.vis.slice(), bounce: this.bounce.slice(), bad: this.bad.slice(), rays: this.rays };
    const sp = { index: 0, count: 1 };
    const PL = this.PL;
    const n = this.order.length;
    const vis = new Float32Array(n);
    const bounce = new Float32Array(n * PL);
    const bad = new Uint8Array(n);
    for (let k = 0, i = sp.index; i < this.order.length; i += sp.count, k++) {
      const o = this.order[i] as number;
      vis[k] = this.vis[o] as number;
      bounce.set(this.bounce.subarray(o * PL, (o + 1) * PL), k * PL);
      bad[k] = this.bad[o] as number;
    }
    return { vis, bounce, bad, rays: this.rays };
  }

  /**
   * Finish a split bake from the shares of every thread (`shares[i]` from the baker with `split.index` i, in order): denoise and
   * encode as the single bake does. Call on a baker made with the same input and no split.
   */
  finishFrom(shares: ReadonlyArray<ReturnType<LightmapBaker['gathered']>>): LightmapResult {
    if (this.stage === 'raster') this.raster();
    const PL = this.PL;
    const count = shares.length;
    let rays = 0;
    for (const [index, sh] of shares.entries()) {
      rays += sh.rays;
      for (let k = 0, i = index; i < this.order.length; i += count, k++) {
        const o = this.order[i] as number;
        this.vis[o] = sh.vis[k] as number;
        this.bounce.set(sh.bounce.subarray(k * PL, (k + 1) * PL), o * PL);
        this.bad[o] = sh.bad[k] as number;
      }
    }
    this.rays = rays;
    this.denoise();
    this.encode();
    this.stage = 'done';
    return this.result as LightmapResult;
  }

  /** The bounce of the parts at a texel before encoding (tests: compare with the sum the shader makes). */
  rawTexel(o: number): { vis: number; bounce: Float32Array } {
    return { vis: this.vis[o] as number, bounce: this.bounce.slice(o * this.PL, (o + 1) * this.PL) };
  }

  /** Per part, the irradiance at a hit point: direct sun keys and lamps, the ambient the volume lets in, the volume's bounce. */
  private incident(tri: number, hx: number, hy: number, hz: number, n: [number, number, number], out: Float32Array): void {
    const PL = this.PL;
    const cx = Math.floor(hx / CELL), cy = Math.floor(hy / CELL), cz = Math.floor(hz / CELL);
    let h1 = (Math.imul(tri, 0x9e3779b1) ^ Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) | 0;
    if (h1 === -1) h1 = 0;
    const h2 = (Math.imul(tri + 7, 0x85ebca6b) ^ Math.imul(cx + 11, 0xc2b2ae35) ^ Math.imul(cy + 13, 0x27d4eb2f) ^ Math.imul(cz + 17, 0x165667b1)) | 0;
    const mask = (1 << this.tableBits) - 1;
    const slot = (h1 >>> 0) & mask;
    let free = -1;
    for (let probe = 0; probe < 4; probe++) {
      const s = (slot + probe) & mask;
      if (this.keyA[s] === h1 && this.keyB[s] === h2) {
        for (let k = 0; k < PL; k++) out[k] = this.vals[s * PL + k] as number;
        return;
      }
      if (this.keyA[s] === -1) {
        free = s;
        break;
      }
    }
    const { scene, sunKeys, lamps, grid, field, stride, codes } = this.input;
    scene.skipLo = scene.skipHi = 0;
    const maxT = 60;
    const ox = hx + n[0] * 2e-3, oy = hy + n[1] * 2e-3, oz = hz + n[2] * 2e-3;
    // What the volume holds half a probe out along the normal: the sky the hit sees and each part's bounce that reaches it.
    const half = grid.spacing * 0.5;
    const v = this.volScratch;
    sampleStrided(grid, field, stride, codes, null, hx + n[0] * half, hy + n[1] * half, hz + n[2] * half, v);
    const vis = Math.max(0, Math.min(1, v[0]! + v[1]! * n[0] + v[2]! * n[1] + v[3]! * n[2]));
    for (let p = 0; p < this.parts; p++) {
      for (let c = 0; c < 3; c++) {
        const so = 4 + p * PART_FLOATS + c * 4;
        let b = v[so]! + v[so + 1]! * n[0] + v[so + 2]! * n[1] + v[so + 3]! * n[2];
        if (p !== PART_SKY1 && b < 0) b = 0;
        out[p * 3 + c] = b + (p === PART_SKY0 ? vis : p === PART_SKY1 ? vis * n[1] : 0);
      }
    }
    for (let k = 0; k < sunKeys.length; k++) {
      const s = sunKeys[k] as V3;
      const cos = n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
      if (cos > 0 && !scene.occluded(ox, oy, oz, s[0], s[1], s[2], maxT)) {
        const q = (PART_SUN0 + k) * 3;
        out[q] = out[q]! + cos;
        out[q + 1] = out[q + 1]! + cos;
        out[q + 2] = out[q + 2]! + cos;
      }
    }
    for (const lamp of lamps) {
      const lx = lamp.position[0] - ox, ly = lamp.position[1] - oy, lz = lamp.position[2] - oz;
      const d2 = lx * lx + ly * ly + lz * lz;
      const d = Math.sqrt(d2);
      if (!(d > 1e-3) || d >= lamp.range) continue;
      const cos = (n[0] * lx + n[1] * ly + n[2] * lz) / d;
      if (cos <= 0) continue;
      const f = 1 - (d / lamp.range) ** 4;
      const att = (f * f) / Math.max(0.01, d2);
      if (scene.occluded(ox, oy, oz, lx / d, ly / d, lz / d, d - 0.05)) continue;
      const q = PART_LAMP * 3;
      out[q] = out[q]! + lamp.color[0] * att * cos;
      out[q + 1] = out[q + 1]! + lamp.color[1] * att * cos;
      out[q + 2] = out[q + 2]! + lamp.color[2] * att * cos;
    }
    // A free slot of the probe run, else the first one is replaced.
    const put = free >= 0 ? free : slot;
    this.keyA[put] = h1;
    this.keyB[put] = h2;
    for (let k = 0; k < PL; k++) this.vals[put * PL + k] = out[k] as number;
  }

  /** Gather texel `o` of the atlas into storage slot `w` (`o` itself, or its place in a split bake's share). */
  private gatherTexel(o: number, w: number): void {
    const t = this.texels as Texels;
    const { scene, proxies, ground } = this.input;
    const PL = this.PL;
    const px = t.pos[o * 3] as number, py = t.pos[o * 3 + 1] as number, pz = t.pos[o * 3 + 2] as number;
    const nx = t.nrm[o * 3] as number, ny = t.nrm[o * 3 + 1] as number, nz = t.nrm[o * 3 + 2] as number;
    // Tangent frame.
    let tx: number, ty: number, tz: number;
    if (Math.abs(ny) < 0.9) {
      tx = nz;
      ty = 0;
      tz = -nx;
    } else {
      tx = 0;
      ty = -nz;
      tz = ny;
    }
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    // A per-texel turn of the ray set around the normal (no pattern repeats between neighbours).
    const ang = hash01(o * 2 + 1) * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ox = px + nx * RAY_BIAS, oy = py + ny * RAY_BIAS, oz = pz + nz * RAY_BIAS;
    // The furniture this texel lies on does not shadow it.
    scene.skipLo = scene.skipHi = 0;
    for (const p of proxies) {
      const m = 0.03;
      if (px >= p.lo[0] - m && px <= p.hi[0] + m && py >= p.lo[1] - m && py <= p.hi[1] + m && pz >= p.lo[2] - m && pz <= p.hi[2] + m) {
        scene.skipLo = p.tri;
        scene.skipHi = p.tri + 12;
        break;
      }
    }
    const skipLo = scene.skipLo, skipHi = scene.skipHi;
    const R = this.samples;
    const maxT = Math.max(30, 2 * (this.input.grid.spacing * Math.max(this.input.grid.nx, this.input.grid.ny, this.input.grid.nz)));
    let escaped = 0;
    const sum = this.sum;
    sum.fill(0);
    let back = 0;
    const n3 = this.n3;
    const sh = this.shade;
    for (let k = 0; k < R; k++) {
      const lx = (this.dirs[k * 3] as number) * ca - (this.dirs[k * 3 + 1] as number) * sa;
      const ly = (this.dirs[k * 3] as number) * sa + (this.dirs[k * 3 + 1] as number) * ca;
      const lz = this.dirs[k * 3 + 2] as number;
      const dx = tx * lx + bx * ly + nx * lz;
      const dy = ty * lx + by * ly + ny * lz;
      const dz = tz * lx + bz * ly + nz * lz;
      scene.skipLo = skipLo;
      scene.skipHi = skipHi;
      const tri = scene.intersect(ox, oy, oz, dx, dy, dz, maxT);
      this.rays++;
      if (tri < 0) {
        if (dy > 0 || oy <= ground.y) escaped++;
        else for (let q = 0; q < PL; q++) sum[q] = sum[q]! + this.groundL[q]!;
        continue;
      }
      const dist = scene.hitT;
      scene.normal(tri, n3);
      if (n3[0] * dx + n3[1] * dy + n3[2] * dz > 0) {
        if (!scene.twoSided[tri]) back++;
        n3[0] = -n3[0];
        n3[1] = -n3[1];
        n3[2] = -n3[2];
      }
      this.incident(tri, ox + dx * dist, oy + dy * dist, oz + dz * dist, n3, sh);
      const ar = scene.albedo[tri * 3] as number, ag = scene.albedo[tri * 3 + 1] as number, ab = scene.albedo[tri * 3 + 2] as number;
      for (let q = 0; q < PL; q += 3) {
        sum[q] = sum[q]! + ar * sh[q]!;
        sum[q + 1] = sum[q + 1]! + ag * sh[q + 1]!;
        sum[q + 2] = sum[q + 2]! + ab * sh[q + 2]!;
      }
    }
    scene.skipLo = scene.skipHi = 0;
    // A texel inside a wall (most rays leave through its back faces) has no light of its own: it takes its neighbours'.
    if (back / R > 0.3) {
      this.bad[w] = 1;
      return;
    }
    this.vis[w] = escaped / R;
    for (let q = 0; q < PL; q++) this.bounce[w * PL + q] = sum[q]! / R;
  }

  /** Luminance of a texel's parts under unit weights (the sky gradient left out: it is signed): what the denoiser compares. */
  private lum(b: Float32Array, o: number): number {
    const PL = this.PL;
    let r = 0, g = 0, bl = 0;
    for (let p = 0; p < this.parts; p++) {
      if (p === PART_SKY1) continue;
      r += b[o * PL + p * 3] as number;
      g += b[o * PL + p * 3 + 1] as number;
      bl += b[o * PL + p * 3 + 2] as number;
    }
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  }

  /** Two passes (steps 1 and 2) of an edge-aware 3 × 3 filter: only texels on the same surface (normal, distance) count. */
  private denoise(): void {
    const t = this.texels as Texels;
    const S = t.size;
    const cov = t.cov;
    const PL = this.PL;
    this.fillBad();
    const sigmaP = 3 / this.input.layout.density;
    // Noise of a visibility estimate from R stratified rays.
    const sigmaVis = Math.max(0.03, 2.2 * Math.sqrt(0.25 / this.samples));
    let vis = this.vis;
    let bounce = this.bounce;
    const acc = new Float64Array(PL);
    const lumOf = new Float32Array(S * S);
    for (const step of [1, 2]) {
      const vo = new Float32Array(vis.length);
      const bo = new Float32Array(bounce.length);
      for (let o = 0; o < S * S; o++) if (cov[o] === 1) lumOf[o] = this.lum(bounce, o);
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const o = j * S + i;
          if (cov[o] !== 1) continue;
          const lumI = lumOf[o] as number;
          let ws = 0, sv = 0;
          acc.fill(0);
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const x = i + di * step, y = j + dj * step;
              if (x < 0 || y < 0 || x >= S || y >= S) continue;
              const q = y * S + x;
              if (cov[q] !== 1) continue;
              const dn = (t.nrm[o * 3] as number) * (t.nrm[q * 3] as number) + (t.nrm[o * 3 + 1] as number) * (t.nrm[q * 3 + 1] as number) + (t.nrm[o * 3 + 2] as number) * (t.nrm[q * 3 + 2] as number);
              if (dn < 0.9) continue;
              const ddx = (t.pos[o * 3] as number) - (t.pos[q * 3] as number);
              const ddy = (t.pos[o * 3 + 1] as number) - (t.pos[q * 3 + 1] as number);
              const ddz = (t.pos[o * 3 + 2] as number) - (t.pos[q * 3 + 2] as number);
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 > 4 * sigmaP * sigmaP) continue;
              const dv = (vis[o] as number) - (vis[q] as number);
              const dl = lumI - (lumOf[q] as number);
              const w = Math.exp(-d2 / (2 * sigmaP * sigmaP) - (dv * dv) / (2 * sigmaVis * sigmaVis) - (dl * dl) / (2 * (0.3 * (lumI + (lumOf[q] as number)) + 0.02) ** 2)) * (di === 0 && dj === 0 ? 1.5 : 1);
              ws += w;
              sv += w * (vis[q] as number);
              for (let k = 0; k < PL; k++) acc[k] = acc[k]! + w * (bounce[q * PL + k] as number);
            }
          }
          vo[o] = ws > 0 ? sv / ws : (vis[o] as number);
          for (let k = 0; k < PL; k++) bo[o * PL + k] = ws > 0 ? acc[k]! / ws : (bounce[o * PL + k] as number);
        }
      }
      vis = vo;
      bounce = bo;
    }
    this.vis = vis;
    this.bounce = bounce;
  }

  /** Bad texels take the mean of their good 8-neighbours on the same surface, a ring at a time (six rings at most). */
  private fillBad(): void {
    const t = this.texels as Texels;
    const S = t.size;
    const PL = this.PL;
    const acc = new Float64Array(PL);
    for (let ring = 0; ring < 6; ring++) {
      const fixed: number[] = [];
      for (let o = 0; o < S * S; o++) {
        if (!this.bad[o]) continue;
        const i = o % S, j = (o - i) / S;
        let n = 0, v = 0;
        acc.fill(0);
        for (const [dx, dy] of NEIGHBOURS) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          const q = y * S + x;
          if (t.cov[q] !== 1 || this.bad[q]) continue;
          const dn = (t.nrm[o * 3] as number) * (t.nrm[q * 3] as number) + (t.nrm[o * 3 + 1] as number) * (t.nrm[q * 3 + 1] as number) + (t.nrm[o * 3 + 2] as number) * (t.nrm[q * 3 + 2] as number);
          if (dn < 0.9) continue;
          n++;
          v += this.vis[q] as number;
          for (let k = 0; k < PL; k++) acc[k] = acc[k]! + (this.bounce[q * PL + k] as number);
        }
        if (n === 0) continue;
        this.vis[o] = v / n;
        for (let k = 0; k < PL; k++) this.bounce[o * PL + k] = acc[k]! / n;
        fixed.push(o);
      }
      if (fixed.length === 0) break;
      for (const o of fixed) this.bad[o] = 0;
    }
    // Whatever is left (a chart that lies inside a solid: a thin curtain, a canopy, a wall behind a box) takes what the light volume
    // holds at its own spot: a building-wide mean (or open sky) read as a pale patch against the walls around it.
    const { grid, field, stride, codes } = this.input;
    const half = grid.spacing * 0.5;
    const v = this.volScratch;
    let left = 0;
    for (let o = 0; o < S * S; o++) {
      if (!this.bad[o]) continue;
      left++;
      const nx = t.nrm[o * 3] as number, ny = t.nrm[o * 3 + 1] as number, nz = t.nrm[o * 3 + 2] as number;
      sampleStrided(grid, field, stride, codes, null, (t.pos[o * 3] as number) + nx * half, (t.pos[o * 3 + 1] as number) + ny * half, (t.pos[o * 3 + 2] as number) + nz * half, v);
      this.vis[o] = Math.max(0, Math.min(1, v[0]! + v[1]! * nx + v[2]! * ny + v[3]! * nz));
      for (let p = 0; p < this.parts; p++) {
        for (let c = 0; c < 3; c++) {
          const so = 4 + p * PART_FLOATS + c * 4;
          const b = v[so]! + v[so + 1]! * nx + v[so + 2]! * ny + v[so + 3]! * nz;
          this.bounce[o * PL + p * 3 + c] = p === PART_SKY1 ? b : Math.max(0, b);
        }
      }
    }
    this.leftover = left;
  }

  private encode(): void {
    this.result = encodeLightmap(this.texels as Texels, this.vis, this.bounce, this.parts, this.rays);
  }
}

/**
 * Encode a bake's texels (`vis` per texel, `bounce`: every part's RGB per texel, parts in order) into the stored layers
 * (`relight.ts`): the CPU bake's last step, and that of a bake made elsewhere (Cycles, scripts/blender-bake.ts) on the same
 * texels.
 */
export function encodeLightmap(t: Pick<Texels, 'size' | 'cov' | 'source' | 'covered'>, vis: Float32Array, bounce: Float32Array, parts: number, rays: number): LightmapResult {
  const S = t.size;
  const P = parts;
  const PL = parts * 3;
  const K = P - PART_SUN0;
  const layers = lightmapLayers(K);
  const scales = new Float32Array(scaleCount(K)).fill(1);
  // Per texel: the sun keys' luminance and their chroma (`relight.ts`: the keys share it).
  const N = S * S;
  const lum = new Float32Array(N * K);
  const chroma = new Float32Array(N * 3);
  for (let o = 0; o < N; o++) {
    if (t.cov[o] !== 1) continue;
    for (let k = 0; k < K; k++) {
      const q = o * PL + (PART_SUN0 + k) * 3;
      const r = Math.max(0, bounce[q] as number), g = Math.max(0, bounce[q + 1] as number), b = Math.max(0, bounce[q + 2] as number);
      lum[o * K + k] = LUM[0] * r + LUM[1] * g + LUM[2] * b;
      chroma[o * 3] = (chroma[o * 3] as number) + r;
      chroma[o * 3 + 1] = (chroma[o * 3 + 1] as number) + g;
      chroma[o * 3 + 2] = (chroma[o * 3 + 2] as number) + b;
    }
  }
  // The scale of each stored value: the 99.9th percentile of its texels (the logarithmic code keeps the dark ones, see
  // `encodePart`). Not the brightest: a lamp's own shade, a centimetre from the light, takes thousands of times what the walls
  // take, and the walls' lamp light then sank to the code's floor and flickered between it and nothing, texel by texel.
  const scaleOf = (value: (o: number) => number): number => {
    const v: number[] = [];
    for (let o = 0; o < N; o++) if (t.cov[o] === 1) v.push(value(o));
    v.sort((x, y) => x - y);
    return Math.max(1e-6, v.length > 0 ? (v[Math.min(v.length - 1, Math.floor(v.length * 0.999))] as number) : 1e-6);
  };
  for (const p of [PART_SKY0, PART_SKY1, PART_LAMP]) scales[p] = scaleOf((o) => Math.max(Math.abs(bounce[o * PL + p * 3] as number), Math.abs(bounce[o * PL + p * 3 + 1] as number), Math.abs(bounce[o * PL + p * 3 + 2] as number)));
  for (let k = 0; k < K; k++) scales[LAYER_SUN0 + k] = scaleOf((o) => lum[o * K + k] as number);
  const rgba = new Uint8Array(N * 4 * layers);
  const layer = N * 4;
  for (let o = 0; o < N; o++) {
    const src = t.cov[o] === 1 ? o : t.cov[o] === 2 ? (t.source[o] as number) : -1;
    if (src < 0) continue;
    const a = encodeVis(vis[src] as number);
    for (const p of [PART_SKY0, PART_SKY1, PART_LAMP]) {
      const d = p * layer + o * 4;
      for (let c = 0; c < 3; c++) rgba[d + c] = encodePart((bounce[src * PL + p * 3 + c] as number) / (scales[p] as number), p === PART_SKY1);
    }
    // Chroma over its largest channel (white where no sun reaches).
    const cr = chroma[src * 3] as number, cg = chroma[src * 3 + 1] as number, cb = chroma[src * 3 + 2] as number;
    const m = Math.max(cr, cg, cb);
    const dc = LAYER_CHROMA * layer + o * 4;
    rgba[dc] = m > 1e-9 ? Math.round((255 * cr) / m) : 255;
    rgba[dc + 1] = m > 1e-9 ? Math.round((255 * cg) / m) : 255;
    rgba[dc + 2] = m > 1e-9 ? Math.round((255 * cb) / m) : 255;
    for (let k = 0; k < K; k++) rgba[(LAYER_SUN0 + Math.floor(k / 3)) * layer + o * 4 + (k % 3)] = encodePart((lum[src * K + k] as number) / (scales[LAYER_SUN0 + k] as number), false);
    for (let l = 0; l < layers; l++) rgba[l * layer + o * 4 + 3] = a;
  }
  return { size: S, layers, keys: K, rgba, scales, texels: t.covered, rays };
}

/**
 * Stops of light a byte of an unsigned part spans: values from the scale down to 2^-16 of it, in steps of 4.3 % (a light
 * that is only a few percent of the brightest texel, in a dark corner, keeps the same relative precision as a sun patch).
 */
export const LOG_STOPS = 16;

/**
 * A part's value over its scale as a byte: logarithmic over {@link LOG_STOPS} stops, 0 for none. A signed part (the sky gradient)
 * codes −1..1 around 128, sqrt-coded. Measured on Casa del Patio against other codings (docs/LIGHTING-BAKE.md): sqrt at the
 * 99.7th percentile clipped the lamps' halos (the worst texel off by 90 %).
 */
export function encodePart(v: number, signed: boolean): number {
  const x = Number.isFinite(v) ? v : 0;
  if (!signed) return x <= 2 ** -LOG_STOPS ? 0 : Math.max(1, Math.min(255, Math.round(255 * (1 + Math.log2(Math.min(1, x)) / LOG_STOPS))));
  const m = Math.sqrt(Math.min(1, Math.abs(x)));
  return Math.max(1, Math.min(255, Math.round(128 + (x < 0 ? -m : m) * 127)));
}

/** The inverse of {@link encodePart} (the shader's decode). */
export function decodePart(code: number, signed: boolean): number {
  if (!signed) return code === 0 ? 0 : 2 ** (LOG_STOPS * (code / 255 - 1));
  const m = (code - 128) / 127;
  return m * Math.abs(m);
}

function radicalInverse2(k: number): number {
  let bits = k >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits / 4294967296;
}

/**
 * Sky visibility in the atlas' alpha byte. Alpha 0 means "no data" (the surface keeps the volume's light), so a covered texel is
 * stored from {@link VIS_BASE} up: a lossy image (WebP) moves values near zero by a few steps, and a dark room's visibility
 * (a few percent) stored as it was came back as 0 over whole blocks, which the shader read as "no data" (open sky, white squares).
 */
export const VIS_BASE = 16;
export const VIS_SPAN = 255 - VIS_BASE;
export function encodeVis(vis: number): number {
  return VIS_BASE + Math.max(0, Math.min(VIS_SPAN, Math.round((Number.isFinite(vis) ? vis : 0) * VIS_SPAN)));
}
export function decodeVis(alpha: number): number {
  return Math.max(0, Math.min(1, (alpha - VIS_BASE) / VIS_SPAN));
}

/**
 * Decode one atlas texel the way the shader does (tests, diagnostics): the visibility and every part's RGB bounce for unit
 * weights (the sun keys coloured by the shared chroma); null where the atlas has no data.
 */
export function decodeTexel(r: Pick<LightmapResult, 'rgba' | 'scales' | 'size' | 'keys'>, x: number, y: number): { vis: number; parts: Array<[number, number, number]> } | null {
  const N = r.size * r.size;
  const at = (l: number, c: number): number => r.rgba[l * N * 4 + (y * r.size + x) * 4 + c] as number;
  const a = at(0, 3);
  if (a === 0) return null;
  const parts: Array<[number, number, number]> = [];
  for (const p of [PART_SKY0, PART_SKY1, PART_LAMP]) parts.push([0, 1, 2].map((c) => decodePart(at(p, c), p === PART_SKY1) * (r.scales[p] as number)) as [number, number, number]);
  const ch = [at(LAYER_CHROMA, 0) / 255, at(LAYER_CHROMA, 1) / 255, at(LAYER_CHROMA, 2) / 255];
  const cl = LUM[0] * ch[0]! + LUM[1] * ch[1]! + LUM[2] * ch[2]!;
  for (let k = 0; k < r.keys; k++) {
    const l = decodePart(at(LAYER_SUN0 + Math.floor(k / 3), k % 3), false) * (r.scales[LAYER_SUN0 + k] as number);
    parts.push(ch.map((c) => (cl > 0 ? (l * c) / cl : l)) as [number, number, number]);
  }
  return { vis: decodeVis(a), parts };
}
