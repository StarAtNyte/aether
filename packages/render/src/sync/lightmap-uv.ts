/**
 * Lightmap coordinates on drawn geometry. A baked mesh draws from an unindexed copy of its geometry that carries the atlas
 * coordinates as one more vertex attribute (a vertex shared by two charts needs two coordinates). The copy is made here for
 * merged building geometry (`static-merges.ts`, which asks a {@link LightmapSource} for each member's coordinates) and for
 * standalone meshes (`view/lightmap-controller.ts`).
 */
import { BufferAttribute, BufferGeometry, type Mesh } from 'three';
import { LIGHTMAP_ATTRIBUTE } from '../environment/light-volume-light';

/** Where the merges and the renderer ask for the baked coordinates of a building mesh. */
export interface LightmapSource {
  /** Six floats per triangle (atlas u, v of its three corners, in the mesh's own triangle order), or null: not baked. */
  uv(mesh: Mesh): Float32Array | null;
  /** A baked mesh leaves its merge and draws itself (an eviction, a regroup): it needs its own copy. */
  standalone(mesh: Mesh): void;
}

/**
 * A copy of `geometry` drawn without an index, every attribute expanded to three vertices per triangle, with the atlas
 * coordinates (`uv`: six floats per triangle) as {@link LIGHTMAP_ATTRIBUTE}. Bounds are carried over.
 */
export function expandWithLightmap(geometry: BufferGeometry, uv: Float32Array): BufferGeometry {
  const out = new BufferGeometry();
  const index = geometry.index;
  const corners = index ? index.count : geometry.getAttribute('position').count;
  for (const name of Object.keys(geometry.attributes)) {
    if (name === LIGHTMAP_ATTRIBUTE) continue;
    const a = geometry.getAttribute(name);
    const size = a.itemSize;
    const Ctor = a.array.constructor as new (n: number) => Float32Array;
    const data = new Ctor(corners * size);
    for (let c = 0; c < corners; c++) {
      const v = index ? index.getX(c) : c;
      for (let k = 0; k < size; k++) data[c * size + k] = a.getComponent(v, k);
    }
    out.setAttribute(name, new BufferAttribute(data, size, a.normalized));
  }
  out.setAttribute(LIGHTMAP_ATTRIBUTE, new BufferAttribute(uv.length === corners * 2 ? uv : uv.slice(0, corners * 2), 2));
  if (geometry.boundingSphere) out.boundingSphere = geometry.boundingSphere.clone();
  if (geometry.boundingBox) out.boundingBox = geometry.boundingBox.clone();
  return out;
}

/** The members' coordinates one after the other (the order a merge lists its triangles), or null unless every member has them. */
export function concatMemberUv(members: readonly Mesh[], source: LightmapSource): Float32Array | null {
  const parts: Float32Array[] = [];
  let n = 0;
  for (const m of members) {
    const u = source.uv(m);
    if (!u) return null;
    parts.push(u);
    n += u.length;
  }
  const out = new Float32Array(n);
  let o = 0;
  for (const u of parts) {
    out.set(u, o);
    o += u.length;
  }
  return out;
}
