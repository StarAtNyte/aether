/** Pure typed-array BVH construction shared by synchronous picking and worker warmup. */
export const LEAF_TRIANGLES = 8;
/** A built tree. */
export interface TriangleBvh {
  /** Node boxes: min xyz, max xyz (6 floats per node). */
  boxes: Float32Array;
  /**
   * Per node, two uint32: leaves store `[start, count | LEAF_BIT]` into
   * {@link tris}; inner nodes store `[rightChild, 0]` (left child is the next node).
   */
  nodes: Uint32Array;
  /** Triangle ids ordered by leaf. */
  tris: Uint32Array;
  /** Position array the tree was built from (raw access without per-ray lookups). */
  positions: Float32Array;
  /** Index array (null for non-indexed geometry). */
  index: ArrayLike<number> | null;
  nodeCount: number;
  triangleCount: number;
  positionVersion: number;
  indexVersion: number;
}

const LEAF_BIT = 0x80000000;

/** Spread the low 10 bits of `v` so two zero bits separate each (Morton encoding). */
function spread10(v: number): number {
  let x = v & 0x3ff;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x;
}

/**
 * Linear BVH build: sort triangles by the Morton code of their centroids
 * (LSD radix sort, O(n)), split each range at the highest differing code
 * bit (binary search), then compute every box bottom-up with {@link refit}.
 * About 10x faster than a median-split build with similar query cost on
 * terrain-like meshes.
 */
export function buildTriangleBvh(p: Float32Array, idx: ArrayLike<number> | null, n: number, positionVersion: number, indexVersion: number): TriangleBvh {
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const cz = new Float32Array(n);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let t = 0; t < n; t++) {
    const a = (idx ? (idx[t * 3] as number) : t * 3) * 3;
    const b = (idx ? (idx[t * 3 + 1] as number) : t * 3 + 1) * 3;
    const c = (idx ? (idx[t * 3 + 2] as number) : t * 3 + 2) * 3;
    const x = ((p[a] as number) + (p[b] as number) + (p[c] as number)) / 3;
    const y = ((p[a + 1] as number) + (p[b + 1] as number) + (p[c + 1] as number)) / 3;
    const z = ((p[a + 2] as number) + (p[b + 2] as number) + (p[c + 2] as number)) / 3;
    cx[t] = x;
    cy[t] = y;
    cz[t] = z;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const sx = maxX > minX ? 1023 / (maxX - minX) : 0;
  const sy = maxY > minY ? 1023 / (maxY - minY) : 0;
  const sz = maxZ > minZ ? 1023 / (maxZ - minZ) : 0;
  let codes = new Uint32Array(n);
  let tris = new Uint32Array(n);
  for (let t = 0; t < n; t++) {
    const qx = Number.isFinite(cx[t] as number) ? Math.floor(((cx[t] as number) - minX) * sx) : 0;
    const qy = Number.isFinite(cy[t] as number) ? Math.floor(((cy[t] as number) - minY) * sy) : 0;
    const qz = Number.isFinite(cz[t] as number) ? Math.floor(((cz[t] as number) - minZ) * sz) : 0;
    codes[t] = ((spread10(qx) << 2) | (spread10(qy) << 1) | spread10(qz)) >>> 0;
    tris[t] = t;
  }
  // LSD radix sort (4 × 8 bits) of (code, triangle) pairs.
  let codesB = new Uint32Array(n);
  let trisB = new Uint32Array(n);
  const counts = new Uint32Array(256);
  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const bucket = ((codes[i] as number) >>> shift) & 0xff;
      counts[bucket] = (counts[bucket] as number) + 1;
    }
    let sum = 0;
    for (let k = 0; k < 256; k++) {
      const c = counts[k] as number;
      counts[k] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const code = codes[i] as number;
      const bucket = (code >>> shift) & 0xff;
      const slot = counts[bucket] as number;
      counts[bucket] = slot + 1;
      codesB[slot] = code;
      trisB[slot] = tris[i] as number;
    }
    [codes, codesB] = [codesB, codes];
    [tris, trisB] = [trisB, tris];
  }
  // Topology in preorder (left child = parent + 1, inner nodes store the right child).
  const maxNodes = Math.max(1, 2 * n);
  const nodes = new Uint32Array(maxNodes * 2);
  let nodeCount = 0;
  const stackStart: number[] = [0];
  const stackEnd: number[] = [n];
  const stackPatch: number[] = [-1];
  while (stackStart.length > 0) {
    const start = stackStart.pop() as number;
    const end = stackEnd.pop() as number;
    const patch = stackPatch.pop() as number;
    const node = nodeCount++;
    if (patch >= 0) nodes[patch * 2] = node;
    const count = end - start;
    if (count <= LEAF_TRIANGLES) {
      nodes[node * 2] = start;
      nodes[node * 2 + 1] = (count | LEAF_BIT) >>> 0;
      continue;
    }
    const first = codes[start] as number;
    const last = codes[end - 1] as number;
    let mid: number;
    if (first === last) {
      mid = (start + end) >> 1;
    } else {
      // Highest differing bit; the first index whose code has it set splits the range.
      const bit = 31 - Math.clz32((first ^ last) >>> 0);
      const prefix = (last >>> bit) << bit;
      let lo = start;
      let hi = end - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if ((codes[m] as number) >= prefix) hi = m;
        else lo = m + 1;
      }
      mid = lo;
      // Keep leaves reasonably balanced when one side would be tiny.
      if (mid - start < 1 || end - mid < 1) mid = (start + end) >> 1;
    }
    nodes[node * 2 + 1] = 0;
    // The left subtree is emitted next (node + 1); the right child patches this node's slot.
    stackStart.push(mid);
    stackEnd.push(end);
    stackPatch.push(node);
    stackStart.push(start);
    stackEnd.push(mid);
    stackPatch.push(-1);
  }
  const tree: TriangleBvh = {
    boxes: new Float32Array(nodeCount * 6),
    nodes: nodes.slice(0, nodeCount * 2),
    tris,
    positions: p,
    index: idx,
    nodeCount,
    triangleCount: n,
    positionVersion,
    indexVersion,
  };
  refitTriangleBvh(tree, p, idx);
  return tree;
}

/** Recompute node boxes after vertices moved (same topology). Allocation-free. */
export function refitTriangleBvh(tree: TriangleBvh, p: Float32Array, idx: ArrayLike<number> | null): void {
  const { boxes, nodes, tris } = tree;
  // Children always have larger indices than their parent (preorder): walk backwards.
  for (let node = tree.nodeCount - 1; node >= 0; node--) {
    const meta = nodes[node * 2 + 1] as number;
    const b = node * 6;
    if ((meta & LEAF_BIT) !== 0) {
      const start = nodes[node * 2] as number;
      const count = meta & ~LEAF_BIT;
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = start; i < start + count; i++) {
        const t = tris[i] as number;
        for (let k = 0; k < 3; k++) {
          const v = (idx ? (idx[t * 3 + k] as number) : t * 3 + k) * 3;
          const x = p[v] as number, y = p[v + 1] as number, z = p[v + 2] as number;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
      boxes[b] = minX;
      boxes[b + 1] = minY;
      boxes[b + 2] = minZ;
      boxes[b + 3] = maxX;
      boxes[b + 4] = maxY;
      boxes[b + 5] = maxZ;
    } else {
      const l = (node + 1) * 6;
      const r = (nodes[node * 2] as number) * 6;
      for (let k = 0; k < 3; k++) {
        boxes[b + k] = Math.min(boxes[l + k] as number, boxes[r + k] as number);
        boxes[b + 3 + k] = Math.max(boxes[l + 3 + k] as number, boxes[r + 3 + k] as number);
      }
    }
  }
}
