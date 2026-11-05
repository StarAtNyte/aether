/**
 * Which mesh parts become virtual geometry (no three.js here: the generation workers decide it once per output,
 * see geometry/buffer-geometry.ts `preparePart`).
 */

/** Mesh parts with at least this many triangles are drawn as virtual geometry. */
export const VIRTUAL_MIN_TRIANGLES = 20_000;
/** Parts whose islands average fewer triangles than this are kits of small pieces, not surfaces (see {@link isKitOfPieces}). */
export const KIT_ISLAND_TRIANGLES = 96;

/**
 * True when a mesh is a kit of many small separate pieces (window trims, balusters, flowers) rather than a continuous
 * surface: its connected islands (vertices welded by position) average fewer than {@link KIT_ISLAND_TRIANGLES} triangles.
 * Cluster LOD halves the triangles of a group by collapsing whole pieces, so such a mesh loses its trims at close range;
 * it is drawn as an ordinary mesh instead. Linear in the vertex count.
 */
export function isKitOfPieces(positions: Float32Array, indices: Uint32Array): boolean {
  const n = Math.floor(positions.length / 3);
  const tris = Math.floor(indices.length / 3);
  if (n === 0 || tris === 0) return false;
  // Weld by quantised position (1 mm), then union-find over triangle edges.
  const id = new Int32Array(n);
  const seen = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const x = Math.round((positions[i * 3] as number) * 1000), y = Math.round((positions[i * 3 + 1] as number) * 1000), z = Math.round((positions[i * 3 + 2] as number) * 1000);
    const key = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
    const hit = seen.get(key);
    if (hit === undefined) { seen.set(key, i); id[i] = i; } else id[i] = hit;
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a] as number] as number; a = parent[a] as number; }
    return a;
  };
  for (let t = 0; t < tris; t++) {
    const a = find(id[indices[t * 3] as number] as number), b = find(id[indices[t * 3 + 1] as number] as number), c = find(id[indices[t * 3 + 2] as number] as number);
    if (a !== b) parent[b] = a;
    const r = find(a);
    if (r !== c) parent[c] = r;
  }
  let islands = 0;
  for (let i = 0; i < n; i++) if (id[i] === i && find(i) === i) islands++;
  return tris / Math.max(1, islands) < KIT_ISLAND_TRIANGLES;
}
