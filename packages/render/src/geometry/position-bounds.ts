/** Exact Three-style bounds for packed xyz positions without rescanning the box for the sphere. */
import { Box3, Sphere, type BufferGeometry } from 'three';

/** For unnormalized, packed xyz Float32Array geometry without morph targets. */
export function setPositionBounds(geometry: BufferGeometry, positions: Float32Array): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  if (positions.length && !Number.isFinite(minX + minY + minZ + maxX + maxY + maxZ)) {
    // Retain Three's diagnostics and exceptional-value handling for malformed output.
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return;
  }
  const box = geometry.boundingBox ?? new Box3();
  box.min.set(minX, minY, minZ); box.max.set(maxX, maxY, maxZ);
  const sphere = geometry.boundingSphere ?? new Sphere();
  const center = box.getCenter(sphere.center);
  let radiusSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i]! - center.x, dy = positions[i + 1]! - center.y, dz = positions[i + 2]! - center.z;
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  geometry.boundingBox = box;
  sphere.radius = Math.sqrt(radiusSq);
  geometry.boundingSphere = sphere;
}
