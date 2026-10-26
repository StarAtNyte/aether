/** Exact merge kernel shared by inline captures and background workers. */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4 } from 'three';
import { setPositionBounds } from '../geometry/position-bounds';
const _nrm = new Matrix3();

/** Merge member geometries, transformed into the parent's frame (positions, normals, uvs, colours, indices). */
export function mergeGeometries(members: readonly { geometry: BufferGeometry; rel: Float64Array }[]): BufferGeometry {
  let verts = 0;
  let idx = 0;
  const first = members[0]?.geometry;
  const hasUv = first?.getAttribute('uv') !== undefined;
  const hasColor = first?.getAttribute('color') !== undefined;
  for (const m of members) {
    verts += m.geometry.getAttribute('position').count;
    idx += m.geometry.index?.count ?? 0;
  }
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uv = hasUv ? new Float32Array(verts * 2) : null;
  const col = hasColor ? new Float32Array(verts * 3) : null;
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0;
  let io = 0;
  const mat = new Matrix4();
  for (const m of members) {
    const g = m.geometry;
    mat.fromArray(m.rel);
    _nrm.getNormalMatrix(mat);
    const e = mat.elements;
    const n = _nrm.elements;
    const p = g.getAttribute('position');
    const q = g.getAttribute('normal');
    const count = p.count;
    for (let i = 0; i < count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const o = (vo + i) * 3;
      pos[o] = (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number);
      pos[o + 1] = (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number);
      pos[o + 2] = (e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + (e[14] as number);
      const nx = q.getX(i);
      const ny = q.getY(i);
      const nz = q.getZ(i);
      let ox = (n[0] as number) * nx + (n[3] as number) * ny + (n[6] as number) * nz;
      let oy = (n[1] as number) * nx + (n[4] as number) * ny + (n[7] as number) * nz;
      let oz = (n[2] as number) * nx + (n[5] as number) * ny + (n[8] as number) * nz;
      const len = Math.hypot(ox, oy, oz) || 1;
      ox /= len;
      oy /= len;
      oz /= len;
      nrm[o] = ox;
      nrm[o + 1] = oy;
      nrm[o + 2] = oz;
    }
    const u = g.getAttribute('uv');
    if (uv && u) for (let i = 0; i < count; i++) {
      uv[(vo + i) * 2] = u.getX(i);
      uv[(vo + i) * 2 + 1] = u.getY(i);
    }
    const c = g.getAttribute('color');
    if (col && c) for (let i = 0; i < count; i++) {
      col[(vo + i) * 3] = c.getX(i);
      col[(vo + i) * 3 + 1] = c.getY(i);
      col[(vo + i) * 3 + 2] = c.getZ(i);
    }
    const gi = g.index;
    if (gi) for (let i = 0; i < gi.count; i++) index[io + i] = gi.getX(i) + vo;
    io += gi?.count ?? 0;
    vo += count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  if (uv) out.setAttribute('uv', new BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new BufferAttribute(col, 3));
  out.setIndex(new BufferAttribute(index, 1));
  setPositionBounds(out, pos);
  return out;
}
