/**
 * Three.js side of the lightmaps: which meshes can carry one, their geometry in world space for the unwrap and the bake, and
 * the unindexed copy of a geometry that carries the atlas coordinates (a vertex shared by two charts needs two coordinates, so a
 * baked mesh draws from its own expanded vertices; the original geometry is kept and put back when the lightmap goes).
 */
import { DoubleSide, Matrix3, Matrix4, type InstancedMesh, type Mesh, type SkinnedMesh } from 'three';
import { LIGHTMAP_ATTRIBUTE } from '../environment/light-volume-light';
import { LIGHTMAP_MAX_TRIANGLES, type LightmapMesh } from '../environment/lightmap';

/**
 * Meshes the lightmap never touches: instanced and skinned ones, glass, anything that is not plain opaque lit geometry. A mesh
 * hidden by a view (cutaway walls, the roof) still counts: it is baked, so the view can come back.
 */
export function lightmapEligible(mesh: Mesh): boolean {
  if ((mesh as InstancedMesh).isInstancedMesh === true || (mesh as SkinnedMesh).isSkinnedMesh === true) return false;
  if (mesh.userData['aetherNoLightmap'] === true) return false;
  const g = mesh.geometry;
  const m = mesh.material;
  if (!g || Array.isArray(m) || !m) return false;
  if (m.transparent || !m.depthWrite) return false;
  // A thin two-sided surface (a canopy, a curtain, a sheet) shows one atlas texel from both faces: the underside would wear the
  // light of the side the sun and sky reach (a pale blue patch under a canopy). It keeps the light volume's light.
  if (m.side === DoubleSide) return false;
  if (!(m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial && !(m as { isNodeMaterial?: boolean }).isNodeMaterial) return false;
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  if (!p || !n || p.itemSize !== 3 || n.itemSize !== 3 || p.count < 3) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  if (g.getAttribute(LIGHTMAP_ATTRIBUTE) !== undefined) return false;
  const tris = g.index ? g.index.count / 3 : p.count / 3;
  return Number.isInteger(tris) && tris >= 1 && tris <= LIGHTMAP_MAX_TRIANGLES;
}

const _normal = new Matrix3();
const _mat = new Matrix4();

/** The mesh's vertices and normals in world space (fresh arrays) and its triangle list. */
export function worldMeshData(mesh: Mesh): LightmapMesh {
  const g = mesh.geometry;
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  _mat.copy(mesh.matrixWorld);
  _normal.getNormalMatrix(_mat);
  const e = _mat.elements;
  const q = _normal.elements;
  const positions = new Float32Array(p.count * 3);
  const normals = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    positions[i * 3] = (e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number);
    positions[i * 3 + 1] = (e[1] as number) * x + (e[5] as number) * y + (e[9] as number) * z + (e[13] as number);
    positions[i * 3 + 2] = (e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + (e[14] as number);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    let ox = (q[0] as number) * nx + (q[3] as number) * ny + (q[6] as number) * nz;
    let oy = (q[1] as number) * nx + (q[4] as number) * ny + (q[7] as number) * nz;
    let oz = (q[2] as number) * nx + (q[5] as number) * ny + (q[8] as number) * nz;
    const l = Math.hypot(ox, oy, oz) || 1;
    ox /= l;
    oy /= l;
    oz /= l;
    normals[i * 3] = ox;
    normals[i * 3 + 1] = oy;
    normals[i * 3 + 2] = oz;
  }
  const idx = g.index;
  let index: Uint32Array | null = null;
  if (idx) {
    index = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i++) index[i] = idx.getX(i);
  }
  return { positions, normals, index };
}

export { expandWithLightmap } from '../sync/lightmap-uv';
