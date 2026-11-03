/**
 * Texture coordinates in metres for any generated mesh, so a photographed finish tiles at its real size on every surface.
 *
 * Generators build from kernel primitives whose UVs span 0..1 per face or around a lathe (a box, a cylinder, a disc): on a
 * 30 m stylobate or a 9 m column the finish's 2 m tile is then stretched over the whole piece, and the stone reads as a
 * smeared, blotchy smudge. Projecting each vertex onto the plane of its dominant normal (the classic box projection) fixes the
 * scale but smears too: on a curved or faceted surface the three corners of one triangle can fall on different planes, and
 * that triangle shows a sliver of texture stretched across it.
 *
 * {@link metreUvMesh} measures the authored UVs per triangle (metres per UV unit along u and along v). Triangles that are
 * already metric keep their UVs (boards along a floor, courses along a wall, the strata of a cliff). The others are projected
 * per triangle, on the plane of the triangle's own normal, and their corners are split where neighbouring triangles chose a
 * different plane: the texture keeps its real size everywhere, with a clean seam where the projection turns a corner instead
 * of a smear. The projected u / v follow the authored directions (rows of a roof run the way the generator laid them out).
 */

/** Metres per UV unit, along u or v, within which authored UVs count as metric (true size up to this much stretch). */
export const METRIC_UV_RANGE: readonly [number, number] = Object.freeze([0.55, 1.8]) as readonly [number, number];
/** Share of a part's area with non-metric UVs above which every triangle is projected (one consistent projection). */
export const REPROJECT_ALL_SHARE = 0.35;
/** Share of a part's area with non-metric UVs below which nothing changes (a few slivers are not worth the seams). */
export const REPROJECT_MIN_SHARE = 0.01;

/** The vertex streams of a mesh part (positions, normals and indices required; colours optional). */
export interface UvMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array | null;
  /** Authored UVs; null projects every triangle. */
  uvs: Float32Array | null;
}

/** Result of {@link metreUvMesh}: the (possibly re-indexed, with split corners) streams and the metre UVs. */
export interface MetreUvResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors: Float32Array | null;
  uvs: Float32Array;
  /** Triangles that were projected. */
  projected: number;
}

/** Metres per UV unit along u and v of one triangle (0 when its UVs are degenerate). */
function stretch(p: Float32Array, t: Float32Array, a: number, b: number, c: number, out: Float64Array): void {
  const e1x = p[b * 3]! - p[a * 3]!, e1y = p[b * 3 + 1]! - p[a * 3 + 1]!, e1z = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const e2x = p[c * 3]! - p[a * 3]!, e2y = p[c * 3 + 1]! - p[a * 3 + 1]!, e2z = p[c * 3 + 2]! - p[a * 3 + 2]!;
  const d1u = t[b * 2]! - t[a * 2]!, d1v = t[b * 2 + 1]! - t[a * 2 + 1]!;
  const d2u = t[c * 2]! - t[a * 2]!, d2v = t[c * 2 + 1]! - t[a * 2 + 1]!;
  const det = d1u * d2v - d2u * d1v;
  // Tangent (dP/du) and bitangent (dP/dv).
  if (Math.abs(det) < 1e-12) {
    out.fill(0);
    return;
  }
  const r = 1 / det;
  out[0] = (e1x * d2v - e2x * d1v) * r;
  out[1] = (e1y * d2v - e2y * d1v) * r;
  out[2] = (e1z * d2v - e2z * d1v) * r;
  out[3] = (e2x * d1u - e1x * d2u) * r;
  out[4] = (e2y * d1u - e1y * d2u) * r;
  out[5] = (e2z * d1u - e1z * d2u) * r;
}

const AXES = [
  // Dominant normal axis → [u axis, v axis] of its plane (box projection: tops x/z, fronts x/y, sides z/y).
  [0, 2],
  [0, 1],
  [2, 1],
] as const;

/**
 * Metre UVs for `mesh` (see the file comment). Returns the input arrays untouched (with its own UVs) when they are already
 * metric; otherwise new arrays, with corners split where the projection changes plane.
 */
export function metreUvMesh(mesh: UvMesh): MetreUvResult {
  const { positions: p, normals: nr, indices: idx } = mesh;
  const colors = mesh.colors ?? null;
  const t = mesh.uvs;
  const tris = idx.length / 3;
  // Per triangle: dominant axis of the face normal (0 y-dominant, 1 z, 2 x), whether its UVs are metric, area.
  const axis = new Uint8Array(tris);
  const bad = new Uint8Array(tris);
  const area = new Float64Array(tris);
  const tb = new Float64Array(6);
  let total = 0;
  let badArea = 0;
  // Authored directions (unit dP/du, dP/dv) per triangle with usable UVs, for the votes below.
  const dirs = new Float32Array(tris * 6);
  const hasDir = new Uint8Array(tris);
  for (let f = 0; f < tris; f++) {
    const a = idx[f * 3]!, b = idx[f * 3 + 1]!, c = idx[f * 3 + 2]!;
    const e1x = p[b * 3]! - p[a * 3]!, e1y = p[b * 3 + 1]! - p[a * 3 + 1]!, e1z = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const e2x = p[c * 3]! - p[a * 3]!, e2y = p[c * 3 + 1]! - p[a * 3 + 1]!, e2z = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz);
    const ar = Math.hypot(fx, fy, fz) / 2;
    area[f] = ar;
    total += ar;
    axis[f] = ay >= ax && ay >= az ? 0 : az >= ax ? 1 : 2;
    if (!t) {
      bad[f] = 1;
      badArea += ar;
      continue;
    }
    stretch(p, t, a, b, c, tb);
    const su = Math.hypot(tb[0]!, tb[1]!, tb[2]!);
    const sv = Math.hypot(tb[3]!, tb[4]!, tb[5]!);
    if (!(su >= METRIC_UV_RANGE[0] && su <= METRIC_UV_RANGE[1] && sv >= METRIC_UV_RANGE[0] && sv <= METRIC_UV_RANGE[1])) {
      bad[f] = 1;
      badArea += ar;
    }
    if (su > 0 && sv > 0) {
      hasDir[f] = 1;
      for (let k = 0; k < 3; k++) {
        dirs[f * 6 + k] = tb[k]! / su;
        dirs[f * 6 + 3 + k] = tb[3 + k]! / sv;
      }
    }
  }
  // Per plane: whether u and v swap (the authored u runs along the plane's v), then the sign of each, area-weighted over the
  // triangles that will be projected, so the projection follows the authored directions (a roof's rows, a column's height).
  const swap = [false, false, false];
  const sign = [1, 1, 1, 1, 1, 1];
  if (t) {
    const vote = new Float64Array(9);
    for (let f = 0; f < tris; f++) {
      if (hasDir[f] !== 1) continue;
      const [ua, va] = AXES[axis[f]!]!;
      const d = f * 6;
      vote[axis[f]! * 3] = vote[axis[f]! * 3]! + area[f]! * (Math.abs(dirs[d + ua]!) + Math.abs(dirs[d + 3 + va]!) - Math.abs(dirs[d + va]!) - Math.abs(dirs[d + 3 + ua]!));
    }
    for (let k = 0; k < 3; k++) swap[k] = vote[k * 3]! < 0;
    for (let f = 0; f < tris; f++) {
      if (hasDir[f] !== 1) continue;
      const k = axis[f]!;
      const [ua, va] = AXES[k]!;
      const d = f * 6;
      vote[k * 3 + 1] = vote[k * 3 + 1]! + area[f]! * dirs[d + (swap[k] ? va : ua)]!;
      vote[k * 3 + 2] = vote[k * 3 + 2]! + area[f]! * dirs[d + 3 + (swap[k] ? ua : va)]!;
    }
    for (let k = 0; k < 3; k++) {
      sign[k * 2] = vote[k * 3 + 1]! < 0 ? -1 : 1;
      sign[k * 2 + 1] = vote[k * 3 + 2]! < 0 ? -1 : 1;
    }
  }
  if (t && (total <= 0 || badArea / total < REPROJECT_MIN_SHARE)) return { positions: p, normals: nr, indices: idx, colors, uvs: t, projected: 0 };
  const all = !t || badArea / total > REPROJECT_ALL_SHARE;
  const n = p.length / 3;
  const shift = pieceOffsets(p, idx);
  const uvAt = (v: number, plane: number, out: Float32Array, o: number): void => {
    if (plane === 3) {
      out[o] = t![v * 2]!;
      out[o + 1] = t![v * 2 + 1]!;
      return;
    }
    const [ua, va] = AXES[plane]!;
    const sw = swap[plane]!;
    out[o] = p[v * 3 + (sw ? va : ua)]! * sign[plane * 2]! + shift[v * 2]!;
    out[o + 1] = p[v * 3 + (sw ? ua : va)]! * sign[plane * 2 + 1]! + shift[v * 2 + 1]!;
  };
  // Usually every vertex is used on one plane only (boxes, flat runs): the streams are shared as they are.
  const vertPlane = new Int8Array(n).fill(-1);
  let conflict = false;
  let projectedCount = 0;
  for (let f = 0; f < tris && !conflict; f++) {
    const project = all || bad[f] === 1;
    if (project) projectedCount++;
    const plane = project ? axis[f]! : 3;
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k]!;
      if (vertPlane[v] === -1) vertPlane[v] = plane;
      else if (vertPlane[v] !== plane) conflict = true;
    }
  }
  if (!conflict) {
    const out = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) uvAt(v, vertPlane[v] === -1 ? (t ? 3 : 0) : vertPlane[v]!, out, v * 2);
    return { positions: p, normals: nr, indices: idx, colors, uvs: out, projected: projectedCount };
  }
  // Corners: one output vertex per (input vertex, plane) pair, plane 3 meaning "authored UVs kept".
  const remap = new Int32Array(n * 4).fill(-1);
  const outIdx = new Uint32Array(idx.length);
  // Each corner becomes at most one output vertex: the output is never larger than three vertices per triangle.
  const cap = Math.min(n * 4, idx.length);
  const pos = new Float32Array(cap * 3);
  const nor = new Float32Array(cap * 3);
  const col = colors ? new Float32Array(cap * 3) : null;
  const uv = new Float32Array(cap * 2);
  let count = 0;
  let projected = 0;
  for (let f = 0; f < tris; f++) {
    const project = all || bad[f] === 1;
    if (project) projected++;
    const plane = project ? axis[f]! : 3;
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k]!;
      const key = v * 4 + plane;
      let o = remap[key]!;
      if (o < 0) {
        o = count++;
        remap[key] = o;
        for (let c = 0; c < 3; c++) {
          pos[o * 3 + c] = p[v * 3 + c]!;
          nor[o * 3 + c] = nr[v * 3 + c]!;
          if (col && colors) col[o * 3 + c] = colors[v * 3 + c]!;
        }
        uvAt(v, plane, uv, o * 2);
      }
      outIdx[f * 3 + k] = o;
    }
  }
  return { positions: pos.slice(0, count * 3), normals: nor.slice(0, count * 3), indices: outIdx, colors: col ? col.slice(0, count * 3) : null, uvs: uv.slice(0, count * 2), projected };
}

/**
 * A texture offset (metres) per piece of the mesh: the steps of a stair, the blocks of a wall or the drums of a column are
 * separate pieces (connected by shared corners, welded by position), and each shows its own crop of the photograph instead of
 * one texture running on through every block, so a run of identical blocks never reads as one uniform slab.
 */
function pieceOffsets(p: Float32Array, idx: Uint32Array): Float32Array {
  const n = p.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const join = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  // Corners at the same place (a box's faces carry their own copies) belong together: weld by position (1 mm).
  const seen = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const qx = Math.round(p[i * 3]! * 1000), qy = Math.round(p[i * 3 + 1]! * 1000), qz = Math.round(p[i * 3 + 2]! * 1000);
    const key = (qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791);
    const hit = seen.get(key);
    if (hit === undefined) seen.set(key, i);
    else if (p[hit * 3] === p[i * 3] && p[hit * 3 + 1] === p[i * 3 + 1] && p[hit * 3 + 2] === p[i * 3 + 2]) join(hit, i);
  }
  for (let f = 0; f < idx.length; f += 3) {
    join(idx[f]!, idx[f + 1]!);
    join(idx[f]!, idx[f + 2]!);
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    // Golden-ratio sequences: neighbouring pieces land far apart in the photograph.
    out[i * 2] = ((r * 0.6180339887) % 1) * 23.7;
    out[i * 2 + 1] = ((r * 0.7548776662) % 1) * 19.3;
  }
  return out;
}
