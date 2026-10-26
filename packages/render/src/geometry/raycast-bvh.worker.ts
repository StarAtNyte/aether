import { buildTriangleBvh } from './raycast-bvh-build';
import type { BvhBuffers } from './raycast-bvh-client';

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = event => {
  const { id, positions, index, triangles } = event.data;
  let result: BvhBuffers | null = null;
  try {
    if (!Number.isSafeInteger(id) || !(positions instanceof Float32Array) || positions.length % 3 !== 0
      || (index !== null && !(index instanceof Uint16Array) && !(index instanceof Uint32Array))
      || !Number.isSafeInteger(triangles) || triangles < 1 || triangles > Math.floor((index?.length ?? positions.length / 3) / 3)) throw new Error('Invalid BVH request');
    const tree = buildTriangleBvh(positions, index, triangles, 0, 0);
    result = { boxes: tree.boxes, nodes: tree.nodes, tris: tree.tris, nodeCount: tree.nodeCount, triangleCount: tree.triangleCount };
  } catch { /* The caller retains synchronous picking and idle fallback. */ }
  scope.postMessage({ id, result }, result ? [result.boxes.buffer, result.nodes.buffer, result.tris.buffer] : []);
};
