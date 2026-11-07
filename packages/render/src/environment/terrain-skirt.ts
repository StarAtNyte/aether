/**
 * A skirt of far hills round a terrain sheet. A generated terrain is a finite square: from a high camera its rim shows as a
 * cliff over the void. The skirt starts exactly at the rim (heights read from the terrain's own edge vertices) and rolls up
 * into low ridgelines out to the haze, coloured by the terrain's edge: one vertex-coloured mesh of about 2,000 triangles on one
 * lit material that takes the scene's fog (it fades into the aerial perspective toward the horizon). Static; no shadows.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import type { GroundSheet } from '../view/edge-shy';

/** Samples along each side of the sheet. */
const SIDE = 64;
/** Distances (m, for a sheet 320 m across) of the rings from the rim. */
const RINGS = [0, 8, 20, 40, 75, 130, 220, 350, 520, 750, 1050, 1400];

function hash(i: number): number {
  let h = Math.imul(i | 0, 374761393) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth 1-D value noise, a closed loop of `period` cells. */
function loop(t: number, period: number, seed: number): number {
  const x = t * period;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  const a = hash(((i % period) + period) % period + seed * 977);
  const b = hash((((i + 1) % period) + period) % period + seed * 977);
  return a + (b - a) * s;
}

/** Heights of the terrain's rim at the sheet's perimeter samples (4 × {@link SIDE}), from its edge vertices. */
export function rimHeights(sheet: GroundSheet, vertices: Iterable<readonly [number, number, number]>): Float32Array {
  const out = new Float32Array(SIDE * 4).fill(Number.NaN);
  const w = sheet.maxX - sheet.minX;
  const d = sheet.maxZ - sheet.minZ;
  const tolX = w * 0.012;
  const tolZ = d * 0.012;
  for (const [x, y, z] of vertices) {
    let k = -1;
    if (z <= sheet.minZ + tolZ) k = Math.floor(((x - sheet.minX) / w) * SIDE);
    else if (x >= sheet.maxX - tolX) k = SIDE + Math.floor(((z - sheet.minZ) / d) * SIDE);
    else if (z >= sheet.maxZ - tolZ) k = 2 * SIDE + Math.floor(((sheet.maxX - x) / w) * SIDE);
    else if (x <= sheet.minX + tolX) k = 3 * SIDE + Math.floor(((sheet.maxZ - z) / d) * SIDE);
    if (k < 0) continue;
    const j = Math.min(SIDE * 4 - 1, k);
    const cur = out[j] as number;
    if (Number.isNaN(cur) || y > cur) out[j] = y;
  }
  // Fill what no vertex reached with the nearest known neighbour.
  let any = false;
  for (const v of out) if (!Number.isNaN(v)) any = true;
  if (!any) return out.fill((sheet.minY + sheet.maxY) / 2);
  for (let pass = 0; pass < SIDE * 4; pass++) {
    let done = true;
    for (let i = 0; i < out.length; i++) {
      if (!Number.isNaN(out[i] as number)) continue;
      const a = out[(i + out.length - 1) % out.length] as number;
      const b = out[(i + 1) % out.length] as number;
      if (!Number.isNaN(a)) out[i] = a;
      else if (!Number.isNaN(b)) out[i] = b;
      else done = false;
    }
    if (done) break;
  }
  return out;
}

/** The point of the perimeter sample `i` (centre of its cell) and its outward direction in plan. */
function perimeter(sheet: GroundSheet, i: number): { x: number; z: number; nx: number; nz: number } {
  const w = sheet.maxX - sheet.minX;
  const d = sheet.maxZ - sheet.minZ;
  const side = Math.floor(i / SIDE);
  const t = ((i % SIDE) + 0.5) / SIDE;
  let x: number;
  let z: number;
  if (side === 0) [x, z] = [sheet.minX + t * w, sheet.minZ];
  else if (side === 1) [x, z] = [sheet.maxX, sheet.minZ + t * d];
  else if (side === 2) [x, z] = [sheet.maxX - t * w, sheet.maxZ];
  else [x, z] = [sheet.minX, sheet.maxZ - t * d];
  const cx = (sheet.minX + sheet.maxX) / 2;
  const cz = (sheet.minZ + sheet.maxZ) / 2;
  // Mostly the side's normal, bent toward the radial direction so the corners fan out.
  const sn = side === 0 ? [0, -1] : side === 1 ? [1, 0] : side === 2 ? [0, 1] : [-1, 0];
  const rx = x - cx;
  const rz = z - cz;
  const rl = Math.hypot(rx, rz) || 1;
  let nx = (sn[0] as number) * 0.6 + (rx / rl) * 0.4;
  let nz = (sn[1] as number) * 0.6 + (rz / rl) * 0.4;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl;
  nz /= nl;
  return { x, z, nx, nz };
}

/** The skirt's geometry: rings of perimeter samples, rim height first, then rolling ridges that rise with distance. */
export function buildSkirtGeometry(sheet: GroundSheet, rim: Float32Array, color: string, seed = 1): BufferGeometry {
  const n = SIDE * 4;
  const rows = RINGS.length;
  const scale = Math.max(0.5, Math.max(sheet.maxX - sheet.minX, sheet.maxZ - sheet.minZ) / 320);
  const base = new Color(color);
  const rock = new Color('#7d766b');
  const haze = new Color('#8fa0a8');
  const pos = new Float32Array(n * rows * 3);
  const col = new Float32Array(n * rows * 3);
  const tmp = new Color();
  const relief = Math.max(8, sheet.maxY - sheet.minY);
  for (let r = 0; r < rows; r++) {
    const dist = (RINGS[r] as number) * scale;
    const rise = Math.min(1, dist / (700 * scale));
    for (let i = 0; i < n; i++) {
      const p = perimeter(sheet, i);
      const t = i / n;
      const h0 = rim[i] as number;
      const ridge = 0.25 + 0.75 * loop(t, 11, seed) * (0.6 + 0.4 * loop(t, 29, seed + 3));
      const swell = loop(t * 7 + r * 0.37, 14, seed + 5);
      // From the rim's height toward a rolling country that climbs to ridgelines (never above the nearer relief's reach).
      const settle = Math.min(1, dist / (90 * scale));
      const level = h0 * (1 - 0.45 * settle) + sheet.minY * 0.45 * settle;
      const y = (r === 0 ? h0 - 0.4 : level + (ridge * relief * 2.2 * rise * rise + swell * relief * 0.35 * settle) * (r === rows - 1 ? 0.8 : 1));
      const o = (r * n + i) * 3;
      pos[o] = p.x + p.nx * dist;
      pos[o + 1] = y;
      pos[o + 2] = p.z + p.nz * dist;
      // Edge biome first, then rock with height, then haze with distance.
      tmp.copy(base).multiplyScalar(0.55 + 0.2 * swell);
      tmp.lerp(rock, Math.min(0.7, Math.max(0, (y - sheet.minY) / (relief * 3.2))));
      tmp.lerp(haze, Math.min(0.55, dist / (1400 * scale) * 0.6));
      col[o] = tmp.r;
      col[o + 1] = tmp.g;
      col[o + 2] = tmp.b;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      const c = (r + 1) * n + i;
      const d = (r + 1) * n + ((i + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** One skirt mesh for a terrain sheet; the caller adds it to the scene and disposes it with {@link disposeSkirt}. */
export function buildTerrainSkirt(sheet: GroundSheet, rim: Float32Array, color: string, seed = 1): Mesh {
  const mesh = new Mesh(buildSkirtGeometry(sheet, rim, color, seed), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  mesh.name = 'terrain-skirt';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.userData['skirt'] = true;
  return mesh;
}

export function disposeSkirt(o: Object3D): void {
  const m = o as Mesh;
  m.geometry?.dispose();
  (m.material as MeshLambertMaterial | undefined)?.dispose();
}
