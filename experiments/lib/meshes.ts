/**
 * Test meshes for the experiments: subdivided icospheres with optional
 * value-noise displacement (closed, manifold, smooth: the worst case for
 * cluster counts and the best case for simplification quality checks).
 */

/** Indexed triangle mesh. */
export interface TestMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Icosphere with `subdivisions` (20·4^s triangles), optionally displaced by `bumps` × noise. */
export function icosphere(subdivisions: number, radius = 1, bumps = 0): TestMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[] = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let faces: number[] = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const i = verts.length / 3;
      verts.push(((verts[a * 3] as number) + (verts[b * 3] as number)) / 2, ((verts[a * 3 + 1] as number) + (verts[b * 3 + 1] as number)) / 2, ((verts[a * 3 + 2] as number) + (verts[b * 3 + 2] as number)) / 2);
      cache.set(key, i);
      return i;
    };
    const next: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] as number, b = faces[f + 1] as number, c = faces[f + 2] as number;
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i] as number, y = verts[i + 1] as number, z = verts[i + 2] as number;
    const l = Math.hypot(x, y, z);
    const nx = x / l, ny = y / l, nz = z / l;
    const r = radius * (1 + bumps * (Math.sin(nx * 7.1 + ny * 3.3) * Math.cos(nz * 5.7 - nx * 2.1) * 0.6 + Math.sin(ny * 23.0 + nz * 17.0) * 0.15));
    positions[i] = nx * r;
    positions[i + 1] = ny * r;
    positions[i + 2] = nz * r;
  }
  return { positions, indices: Uint32Array.from(faces) };
}

/** Median of a numeric sample. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
