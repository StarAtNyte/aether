/**
 * The HLOD proxy bake (hlod.ts; docs/ARCHITECTURE-STREAMING.md §3.3): the full-detail meshes of a cell's entities, in
 * world space, merged into one mesh with their albedo baked into vertex colours, then simplified.
 *
 * - **Gather** ({@link ProxyGather}): every drawn mesh of the entities (generator parts, library models, primitives; the
 *   coarsest level of a level-of-detail chain; instanced copies one by one). A virtual-geometry part is read from its full
 *   source mesh, not its cluster cut. Glass and water (see-through) and scatter fields are left out. The albedo is the
 *   material's resolved colour, times its vertex colours, times the base colour of a natural finish (limestone, roof tile;
 *   a tintable finish such as plaster is its colour), times the average of a model's own colour map.
 * - **Simplify** ({@link simplifyProxy}): pieces smaller than {@link BakeOptions.minSize} go (window bars, flower pots,
 *   balcony rails: under a pixel or two from the far ring), then meshoptimizer's simplifier collapses what stays within
 *   {@link BakeOptions.error} metres, colours weighted, and isolated bits under that error are pruned. A cell still over
 *   {@link BakeOptions.maxTriangles} is simplified further at a larger error, and last by vertex clustering. Vertices are
 *   never moved by the simplifier (collapses only), so the box faces of a facade keep their flat normals and colours.
 *
 * Imported only by the cook's recording (the renderer loads it on demand), so the page bundle does not carry the simplifier.
 */
import { Color, Matrix3, Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type InstancedMesh, type InterleavedBufferAttribute, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { FINISHES } from '@aether/arch';
import type { ProxyMesh } from './hlod';

/** Tunables of the bake. */
export interface BakeOptions {
  /** Largest error a collapse may make (metres). */
  error: number;
  /** Pieces (connected parts of one mesh) whose bounding box is smaller than this on every axis are left out (metres). */
  minSize: number;
  /** Most triangles of one proxy. */
  maxTriangles: number;
}

/**
 * The bake of a level-0 cell drawn past the full-detail ring (1.5 cells, 96 m on a 64 m town grid). At 96 m a 1080 px
 * view at 60 degrees draws about 9 px a metre: 8 cm is under a pixel, a 35 cm piece three.
 */
export const PROXY_BAKE: Readonly<BakeOptions> = { error: 0.08, minSize: 0.35, maxTriangles: 24_000 };

type Simplifier = (typeof import('meshoptimizer/simplifier'))['MeshoptSimplifier'];
let simplifier: Promise<Simplifier> | null = null;

/** meshoptimizer's simplifier (WebAssembly), loaded once. */
export function loadSimplifier(): Promise<Simplifier> {
  simplifier ??= import('meshoptimizer/simplifier').then(async (m) => {
    await m.MeshoptSimplifier.ready;
    return m.MeshoptSimplifier;
  });
  return simplifier;
}

/** Growable float array. */
class Floats {
  a = new Float32Array(1 << 12);
  n = 0;
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  get view(): Float32Array {
    return this.a.subarray(0, this.n);
  }
}

class Uints {
  a = new Uint32Array(1 << 12);
  n = 0;
  push(v: number): void {
    if (this.n + 1 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  get view(): Uint32Array {
    return this.a.subarray(0, this.n);
  }
}

const _m = new Matrix4();
const _n = new Matrix3();
const _v = new Vector3();
const _c = new Color();

/** Average linear colour of a texture's image, by texture (null when its pixels cannot be read, e.g. GPU-compressed). */
const textureAverages = new WeakMap<Texture, [number, number, number] | null>();

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** The average linear colour of `tex`'s image (sampled at 16x16), or null. */
export function textureAverage(tex: Texture): [number, number, number] | null {
  if (textureAverages.has(tex)) return textureAverages.get(tex) ?? null;
  let out: [number, number, number] | null = null;
  try {
    const img = tex.image as unknown;
    const srgb = (tex as { colorSpace?: string }).colorSpace === 'srgb';
    let px: Uint8ClampedArray | Uint8Array | null = null;
    if (img && typeof (img as { data?: unknown }).data === 'object' && ArrayBuffer.isView((img as { data: unknown }).data)) {
      const d = (img as { data: ArrayBufferView }).data;
      if (d instanceof Uint8Array || d instanceof Uint8ClampedArray) px = d;
    } else if (img && typeof OffscreenCanvas !== 'undefined' && typeof (img as { width?: unknown }).width === 'number') {
      const canvas = new OffscreenCanvas(16, 16);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img as CanvasImageSource, 0, 0, 16, 16);
        px = ctx.getImageData(0, 0, 16, 16).data;
      }
    }
    if (px && px.length >= 4) {
      let r = 0, g = 0, b = 0, n = 0;
      const step = Math.max(4, Math.floor(px.length / 4 / 1024) * 4);
      for (let i = 0; i + 3 < px.length; i += step) {
        const a = (px[i + 3] as number) / 255;
        if (a < 0.5) continue;
        const f = (v: number): number => (srgb ? srgbToLinear(v / 255) : v / 255);
        r += f(px[i] as number);
        g += f(px[i + 1] as number);
        b += f(px[i + 2] as number);
        n++;
      }
      if (n > 0) out = [r / n, g / n, b / n];
    }
  } catch {
    out = null;
  }
  textureAverages.set(tex, out);
  return out;
}

/** What a mesh's material contributes to the proxy, or null when it is left out (see-through, not lit). */
function albedoOf(m: Material, finish: string | undefined): { rgb: [number, number, number]; vertexColors: boolean } | null {
  const s = m as MeshStandardMaterial;
  if (!s.isMaterial || s.visible === false) return null;
  if (s.transparent && s.opacity < 0.6) return null;
  if ((s as { transmission?: number }).transmission !== undefined && ((s as { transmission?: number }).transmission ?? 0) > 0.3) return null;
  const a = s.userData?.['aetherAlbedo'] as [number, number, number] | undefined;
  const rgb: [number, number, number] = a ? [a[0], a[1], a[2]] : s.color ? [s.color.r, s.color.g, s.color.b] : [0.6, 0.6, 0.6];
  const def = finish ? (FINISHES as Readonly<Record<string, (typeof FINISHES)[keyof typeof FINISHES] | undefined>>)[finish] : undefined;
  if (def && !def.tintable) {
    _c.set(def.color);
    rgb[0] *= _c.r;
    rgb[1] *= _c.g;
    rgb[2] *= _c.b;
  } else if (!def && s.map && !a) {
    // A model's own colour map (its material colour is a tint of it).
    const t = textureAverage(s.map);
    if (t) {
      rgb[0] *= t[0];
      rgb[1] *= t[1];
      rgb[2] *= t[2];
    } else {
      rgb[0] *= 0.55;
      rgb[1] *= 0.55;
      rgb[2] *= 0.55;
    }
  }
  return { rgb, vertexColors: s.vertexColors === true };
}

/** A read of attribute `a` (plain or interleaved, normalized or not). */
function attr(a: BufferAttribute | InterleavedBufferAttribute | undefined): (BufferAttribute | InterleavedBufferAttribute) | null {
  if (!a) return null;
  const arr = (a as BufferAttribute).array ?? (a as InterleavedBufferAttribute).data?.array;
  // Released CPU copies (gpu/cpu-release.ts) keep the count but not the data.
  if (!arr || arr.length === 0) return null;
  return a;
}

/** The triangles of a cell's meshes in world space, with colours and normals (see the module comment). */
export class ProxyGather {
  private readonly pos = new Floats();
  private readonly nrm = new Floats();
  private readonly col = new Floats();
  private readonly idx = new Uints();
  /** Source triangles gathered. */
  triangles = 0;
  /** Meshes left out (see-through, released, unreadable). */
  skipped = 0;

  /** Add `geometry` drawn with `material` at `matrix` (world), optionally only triangles of index range [start, start + count). */
  addGeometry(geometry: BufferGeometry, matrix: Matrix4, material: Material, finish: string | undefined, start = 0, count = Infinity, tint: Color | null = null): void {
    const look = albedoOf(material, finish);
    const p = attr(geometry.attributes['position'] as BufferAttribute | undefined);
    if (!look || !p) {
      this.skipped++;
      return;
    }
    const nAttr = attr(geometry.attributes['normal'] as BufferAttribute | undefined);
    const cAttr = look.vertexColors ? attr(geometry.attributes['color'] as BufferAttribute | undefined) : null;
    const ix = geometry.index;
    if (ix && !attr(ix)) {
      this.skipped++;
      return;
    }
    const total = ix ? ix.count : p.count;
    const s0 = Math.max(0, Math.max(start, geometry.drawRange.start));
    const s1 = Math.min(total, s0 + Math.min(count, geometry.drawRange.count));
    if (s1 - s0 < 3) return;
    _n.getNormalMatrix(matrix);
    const base = this.pos.n / 3;
    const det = matrix.determinant();
    // The vertices the range uses, once each.
    const remap = new Map<number, number>();
    const vertex = (v: number): number => {
      let o = remap.get(v);
      if (o !== undefined) return o;
      o = base + remap.size;
      remap.set(v, o);
      _v.set(p.getX(v), p.getY(v), p.getZ(v)).applyMatrix4(matrix);
      this.pos.push3(_v.x, _v.y, _v.z);
      if (nAttr) {
        _v.set(nAttr.getX(v), nAttr.getY(v), nAttr.getZ(v)).applyMatrix3(_n).normalize();
        this.nrm.push3(_v.x, _v.y, _v.z);
      } else this.nrm.push3(0, 1, 0);
      let r = look.rgb[0], g = look.rgb[1], b = look.rgb[2];
      if (cAttr) {
        r *= cAttr.getX(v);
        g *= cAttr.getY(v);
        b *= cAttr.getZ(v);
      }
      if (tint) {
        r *= tint.r;
        g *= tint.g;
        b *= tint.b;
      }
      this.col.push3(r, g, b);
      return o;
    };
    for (let i = s0; i + 2 < s1; i += 3) {
      const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, c = ix ? ix.getX(i + 2) : i + 2;
      if (a >= p.count || b >= p.count || c >= p.count) continue;
      const va = vertex(a), vb = vertex(b), vc = vertex(c);
      // A mirroring matrix flips the winding.
      if (det < 0) {
        this.idx.push(va);
        this.idx.push(vc);
        this.idx.push(vb);
      } else {
        this.idx.push(va);
        this.idx.push(vb);
        this.idx.push(vc);
      }
      this.triangles++;
    }
  }

  /** Add mesh `mesh` (world matrices up to date), each material group with its own material; instanced copies one by one. */
  addMesh(mesh: Mesh, finishes: (material: Material) => string | undefined, maxInstances = 4096): void {
    const g = mesh.geometry as BufferGeometry | undefined;
    if (!g?.isBufferGeometry) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    const copies = inst ? Math.min(inst.count, maxInstances) : 1;
    const tint = inst?.instanceColor ? new Color() : null;
    for (let k = 0; k < copies; k++) {
      if (inst) {
        inst.getMatrixAt(k, _m);
        _m.premultiply(mesh.matrixWorld);
        if (tint) inst.getColorAt(k, tint);
      } else _m.copy(mesh.matrixWorld);
      const matrix = _m.clone();
      if (Array.isArray(mesh.material) && g.groups.length > 0) {
        for (const grp of g.groups) {
          const m = mats[grp.materialIndex ?? 0];
          if (m) this.addGeometry(g, matrix, m, finishes(m), grp.start, grp.count, tint);
        }
      } else if (mats[0]) this.addGeometry(g, matrix, mats[0], finishes(mats[0]), 0, Infinity, tint);
    }
  }

  /** The gathered mesh (views into the gather's arrays). */
  mesh(): ProxyMesh {
    return { positions: this.pos.view, normals: this.nrm.view, colors: this.col.view, indices: this.idx.view };
  }
}

/**
 * The meshes of `root` a proxy is made of: every mesh under it, the coarsest level of a level-of-detail object only, minus
 * `skip` (virtual-geometry cluster cuts, scatter fields) and what is not geometry (lines, points, sprites, skinned meshes).
 */
export function proxyMeshes(root: Object3D, skip: ReadonlySet<Object3D>): Mesh[] {
  const out: Mesh[] = [];
  const visit = (o: Object3D): void => {
    if (skip.has(o)) return;
    const lod = o as Object3D & { isLOD?: boolean; levels?: Array<{ object: Object3D }> };
    if (lod.isLOD && lod.levels && lod.levels.length > 0) {
      visit(lod.levels[lod.levels.length - 1]!.object);
      return;
    }
    const m = o as Mesh & { isSkinnedMesh?: boolean };
    if (m.isMesh && !m.isSkinnedMesh) out.push(m);
    for (const c of o.children) visit(c);
  };
  visit(root);
  return out;
}

/** The connected pieces of `mesh` (by shared positions) whose bounding box reaches `minSize` on some axis: their triangles. */
export function dropSmallPieces(mesh: ProxyMesh, remap: Uint32Array, minSize: number): Uint32Array {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[x] !== r) {
      const nx = parent[x] as number;
      parent[x] = r;
      x = nx;
    }
    return r;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i] as number] as number, b = remap[indices[i + 1] as number] as number, c = remap[indices[i + 2] as number] as number;
    unite(a, b);
    unite(b, c);
  }
  const lo = new Float32Array(nv * 3).fill(Infinity);
  const hi = new Float32Array(nv * 3).fill(-Infinity);
  for (let v = 0; v < nv; v++) {
    const r = find(remap[v] as number);
    for (let k = 0; k < 3; k++) {
      const x = positions[v * 3 + k] as number;
      if (x < (lo[r * 3 + k] as number)) lo[r * 3 + k] = x;
      if (x > (hi[r * 3 + k] as number)) hi[r * 3 + k] = x;
    }
  }
  const out = new Uint32Array(indices.length);
  let n = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const r = find(remap[indices[i] as number] as number);
    const size = Math.max((hi[r * 3] as number) - (lo[r * 3] as number), (hi[r * 3 + 1] as number) - (lo[r * 3 + 1] as number), (hi[r * 3 + 2] as number) - (lo[r * 3 + 2] as number));
    if (size < minSize) continue;
    out[n++] = indices[i] as number;
    out[n++] = indices[i + 1] as number;
    out[n++] = indices[i + 2] as number;
  }
  return out.slice(0, n);
}

/** The vertices `indices` use, in order of first use, and the indices into them. */
export function compactProxy(mesh: ProxyMesh, indices: Uint32Array): ProxyMesh {
  const map = new Int32Array(mesh.positions.length / 3).fill(-1);
  let n = 0;
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] as number;
    if (map[v] === -1) map[v] = n++;
    out[i] = map[v] as number;
  }
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  for (let v = 0; v < map.length; v++) {
    const o = map[v] as number;
    if (o < 0) continue;
    for (let k = 0; k < 3; k++) {
      positions[o * 3 + k] = mesh.positions[v * 3 + k] as number;
      normals[o * 3 + k] = mesh.normals[v * 3 + k] as number;
      colors[o * 3 + k] = mesh.colors[v * 3 + k] as number;
    }
  }
  return { positions, normals, colors, indices: out };
}

/**
 * Flat-shaded mesh of welded triangles `idx` (indices into the welded vertices of `mesh`): each corner takes the position
 * and the colour of its welded vertex and the normal of its triangle; corners equal in vertex and normal are shared.
 * Degenerate triangles go.
 */
export function flatProxy(P: Float32Array, colors: Float32Array, idx: Uint32Array): ProxyMesh {
  const key = new Map<number, number>();
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const out: number[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] as number, b = idx[t + 1] as number, c = idx[t + 2] as number;
    const ux = (P[b * 3] as number) - (P[a * 3] as number), uy = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number), uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const vx = (P[c * 3] as number) - (P[a * 3] as number), vy = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number), vz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-9)) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    // Normals quantized to 1/127 per component (what the file stores) share corners.
    const nk = (Math.round(nx * 127) + 127) * 65536 + (Math.round(ny * 127) + 127) * 256 + (Math.round(nz * 127) + 127);
    for (const v of [a, b, c]) {
      const k = v * 16_777_216 + nk;
      let o = key.get(k);
      if (o === undefined) {
        o = pos.length / 3;
        key.set(k, o);
        pos.push(P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number);
        nrm.push(nx, ny, nz);
        col.push(colors[v * 3] as number, colors[v * 3 + 1] as number, colors[v * 3 + 2] as number);
      }
      out.push(o);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint32Array(out) };
}

/**
 * Simplify a gathered mesh into a proxy (see the module comment). The simplifier works on the mesh welded by position: a
 * facade is boxes whose corners are split per face, and split corners where three faces meet are never collapsed, so
 * nothing would simplify; welded, a thin board flattens and goes, and a wall keeps its corners. The result is shaded flat
 * again ({@link flatProxy}), each welded vertex with the mean colour of the corners welded into it.
 */
export async function simplifyProxy(mesh: ProxyMesh, opts: Readonly<BakeOptions> = PROXY_BAKE): Promise<ProxyMesh & { error: number }> {
  if (mesh.indices.length === 0) return { ...compactProxy(mesh, mesh.indices), error: 0 };
  const S = await loadSimplifier();
  const positions = mesh.positions.slice();
  const remap = S.generatePositionRemap(positions, 3);
  const kept = dropSmallPieces(mesh, remap, opts.minSize);
  if (kept.length === 0) return { ...compactProxy(mesh, kept), error: 0 };
  let idx = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) idx[i] = remap[kept[i] as number] as number;
  const nv = positions.length / 3;
  const colors = new Float32Array(nv * 3);
  const count = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const r = remap[v] as number;
    for (let k = 0; k < 3; k++) colors[r * 3 + k] = (colors[r * 3 + k] as number) + (mesh.colors[v * 3 + k] as number);
    count[r] = (count[r] as number) + 1;
  }
  for (let v = 0; v < nv; v++) {
    const n = count[v] as number;
    if (n > 1) for (let k = 0; k < 3; k++) colors[v * 3 + k] = (colors[v * 3 + k] as number) / n;
  }
  // Only the welded vertices in use go to the simplifier (unused copies in its vertex buffer stop every collapse).
  const welded = compactProxy({ positions, normals: positions, colors, indices: idx }, idx);
  return simplifyWelded(welded.positions, welded.colors, welded.indices, opts);
}

async function simplifyWelded(positions: Float32Array, colors: Float32Array, idx: Uint32Array, opts: Readonly<BakeOptions>): Promise<ProxyMesh & { error: number }> {
  const S = await loadSimplifier();
  const weights = [0.5, 0.5, 0.5];
  let [out, err] = S.simplifyWithAttributes(idx, positions, 3, colors, 3, weights, null, 0, opts.error, ['ErrorAbsolute', 'Prune']);
  idx = out;
  const max = opts.maxTriangles * 3;
  if (idx.length > max) {
    [out, err] = S.simplifyWithAttributes(idx, positions, 3, colors, 3, weights, null, max, opts.error * 6, ['ErrorAbsolute', 'Prune']);
    idx = out;
  }
  if (idx.length > max) {
    // The clustering's error is relative to the mesh's extent.
    const scale = Math.max(1e-6, S.getScale(positions, 3));
    [out, err] = S.simplifySloppy(idx, positions, 3, null, max, (opts.error * 12) / scale);
    idx = out;
    err *= scale;
  }
  return { ...flatProxy(positions, colors, idx), error: err };
}
