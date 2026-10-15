/**
 * Automatic discrete LOD chains for instanced meshes (scatter layers).
 *
 * Each mesh part is simplified with the QEM simplifier to a few target
 * ratios. Faceted (flat-shaded) parts — the style of most built-in
 * generators — are re-flattened after simplification so every LOD keeps
 * crisp per-face normals; smooth parts keep their original vertex
 * attributes. Levels that would not reduce the triangle count meaningfully
 * are dropped, so a chain always gets strictly cheaper.
 */
import { simplifyMesh, weldPositions } from './simplify';
import { normalsAreSoft } from '../geometry/soften';

/** Geometry of one part at one LOD level. */
export interface LodPart {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
}

/** Input part (structurally a procgen `MeshPart` without its material). */
export type LodSource = LodPart;

/** One level: geometry per source part (same order) and its triangle total. */
export interface LodLevel {
  parts: LodPart[];
  triangles: number;
}

/** Default target triangle ratios after level 0. */
export const LOD_RATIOS: readonly number[] = [0.3, 0.1, 0.03];
/** A level must keep at most this share of the previous level's triangles. */
const MIN_STEP = 0.7;
/** Triangles a simplified part keeps at least. */
const MIN_PART_TRIANGLES = 4;

/** True when most vertices are duplicated per face (flat shading). */
export function isFaceted(positions: Float32Array): boolean {
  const n = positions.length / 3;
  if (n < 6) return false;
  const weld = weldPositions(positions);
  let unique = 0;
  for (let v = 0; v < n; v++) if (weld[v] === v) unique++;
  return unique < n * 0.6;
}

/** Copy the vertices referenced by `indices` into compact arrays (smooth parts). */
function compact(src: LodSource, indices: Uint32Array): LodPart {
  const n = src.positions.length / 3;
  const map = new Int32Array(n).fill(-1);
  let m = 0;
  for (const v of indices) if ((map[v] as number) < 0) map[v] = m++;
  const positions = new Float32Array(m * 3);
  const normals = new Float32Array(m * 3);
  const uvs = src.uvs && src.uvs.length >= n * 2 ? new Float32Array(m * 2) : undefined;
  const colors = src.colors && src.colors.length >= n * 3 ? new Float32Array(m * 3) : undefined;
  for (let v = 0; v < n; v++) {
    const d = map[v] as number;
    if (d < 0) continue;
    for (let k = 0; k < 3; k++) {
      positions[d * 3 + k] = src.positions[v * 3 + k] as number;
      normals[d * 3 + k] = src.normals[v * 3 + k] as number;
      if (colors) colors[d * 3 + k] = (src.colors as Float32Array)[v * 3 + k] as number;
    }
    if (uvs) {
      uvs[d * 2] = (src.uvs as Float32Array)[v * 2] as number;
      uvs[d * 2 + 1] = (src.uvs as Float32Array)[v * 2 + 1] as number;
    }
  }
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) out[i] = map[indices[i] as number] as number;
  return { positions, normals, indices: out, ...(uvs ? { uvs } : {}), ...(colors ? { colors } : {}) };
}

/**
 * Rebuild a faceted part: three own vertices per triangle and either the face normal (flat shading) or,
 * for parts softened by the renderer (`geometry/soften.ts`), the source's blended vertex normals.
 */
function flatten(src: LodSource, indices: Uint32Array, soft: boolean): LodPart {
  const t = indices.length / 3;
  const positions = new Float32Array(t * 9);
  const normals = new Float32Array(t * 9);
  const n = src.positions.length / 3;
  const colors = src.colors && src.colors.length >= n * 3 ? new Float32Array(t * 9) : undefined;
  const uvs = src.uvs && src.uvs.length >= n * 2 ? new Float32Array(t * 6) : undefined;
  const p = src.positions;
  for (let f = 0; f < t; f++) {
    const a = indices[f * 3] as number, b = indices[f * 3 + 1] as number, c = indices[f * 3 + 2] as number;
    const ux = (p[b * 3] as number) - (p[a * 3] as number), uy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number), uz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
    const vx = (p[c * 3] as number) - (p[a * 3] as number), vy = (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number), vz = (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const sn = src.normals;
    const corners = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const v = corners[k] as number;
      const o = (f * 3 + k) * 3;
      positions[o] = p[v * 3] as number;
      positions[o + 1] = p[v * 3 + 1] as number;
      positions[o + 2] = p[v * 3 + 2] as number;
      normals[o] = soft ? (sn[v * 3] as number) : nx;
      normals[o + 1] = soft ? (sn[v * 3 + 1] as number) : ny;
      normals[o + 2] = soft ? (sn[v * 3 + 2] as number) : nz;
      if (colors) {
        const cs = src.colors as Float32Array;
        colors[o] = cs[v * 3] as number;
        colors[o + 1] = cs[v * 3 + 1] as number;
        colors[o + 2] = cs[v * 3 + 2] as number;
      }
      if (uvs) {
        const us = src.uvs as Float32Array;
        uvs[(f * 3 + k) * 2] = us[v * 2] as number;
        uvs[(f * 3 + k) * 2 + 1] = us[v * 2 + 1] as number;
      }
    }
  }
  const idx = new Uint32Array(t * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return { positions, normals, indices: idx, ...(uvs ? { uvs } : {}), ...(colors ? { colors } : {}) };
}

/**
 * Build the LOD chain of a multi-part mesh. Level 0 is the source itself
 * (shared, not copied). Coarser levels simplify every part to the same
 * ratio of its own triangles (at least {@link MIN_PART_TRIANGLES}).
 */
export function buildLodChain(parts: readonly LodSource[], ratios: readonly number[] = LOD_RATIOS): LodLevel[] {
  const triangles = (ps: readonly LodPart[]): number => ps.reduce((s, p) => s + Math.floor(p.indices.length / 3), 0);
  const levels: LodLevel[] = [{ parts: parts.slice(), triangles: triangles(parts) }];
  const faceted = parts.map((p) => isFaceted(p.positions));
  const soft = parts.map((p, i) => faceted[i] === true && normalsAreSoft(p.positions, p.indices, p.normals));
  for (const ratio of ratios) {
    const prev = levels[levels.length - 1] as LodLevel;
    const next: LodPart[] = [];
    for (let i = 0; i < parts.length; i++) {
      const src = parts[i] as LodSource;
      const srcTris = Math.floor(src.indices.length / 3);
      const target = Math.max(MIN_PART_TRIANGLES, Math.ceil(srcTris * ratio));
      if (target >= srcTris) {
        next.push((prev.parts[i] as LodPart));
        continue;
      }
      const res = simplifyMesh(src.positions, src.indices, { targetIndexCount: target * 3, lockBorder: false });
      next.push(faceted[i] ? flatten(src, res.indices, soft[i] === true) : compact(src, res.indices));
    }
    const tris = triangles(next);
    if (tris > prev.triangles * MIN_STEP) continue;
    levels.push({ parts: next, triangles: tris });
  }
  return levels;
}
