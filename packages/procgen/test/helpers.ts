/** Shared assertions for procgen tests. */
import { expect } from 'vitest';
import type { GeneratorOutput, MeshPart } from '../src/types';
import type { Mesh } from '../src/kernel/mesh';

/** Every normal has unit length (within tolerance). */
export function expectUnitNormals(normals: Float32Array, tol = 1e-3): void {
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i] as number, normals[i + 1] as number, normals[i + 2] as number);
    if (Math.abs(l - 1) > tol) throw new Error(`normal ${i / 3} has length ${l}`);
  }
}

/** Fraction of non-degenerate triangles whose face normal disagrees with the averaged vertex normal. */
export function windingMismatch(positions: Float32Array, normals: Float32Array, indices: Uint32Array): number {
  let bad = 0;
  let total = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = (indices[t] as number) * 3, b = (indices[t + 1] as number) * 3, c = (indices[t + 2] as number) * 3;
    const e1x = (positions[b] as number) - (positions[a] as number), e1y = (positions[b + 1] as number) - (positions[a + 1] as number), e1z = (positions[b + 2] as number) - (positions[a + 2] as number);
    const e2x = (positions[c] as number) - (positions[a] as number), e2y = (positions[c + 1] as number) - (positions[a + 1] as number), e2z = (positions[c + 2] as number) - (positions[a + 2] as number);
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    if (Math.hypot(fx, fy, fz) < 1e-9) continue;
    const nx = (normals[a] as number) + (normals[b] as number) + (normals[c] as number);
    const ny = (normals[a + 1] as number) + (normals[b + 1] as number) + (normals[c + 1] as number);
    const nz = (normals[a + 2] as number) + (normals[b + 2] as number) + (normals[c + 2] as number);
    total++;
    if (fx * nx + fy * ny + fz * nz < 0) bad++;
  }
  return total === 0 ? 0 : bad / total;
}

/** Signed volume of a closed mesh (positive when faces point outward). */
export function signedVolume(m: Pick<Mesh, 'positions' | 'indices'>): number {
  const p = m.positions;
  const idx = m.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = (idx[t] as number) * 3, b = (idx[t + 1] as number) * 3, c = (idx[t + 2] as number) * 3;
    v += ((p[a] as number) * ((p[b + 1] as number) * (p[c + 2] as number) - (p[b + 2] as number) * (p[c + 1] as number))
      - (p[a + 1] as number) * ((p[b] as number) * (p[c + 2] as number) - (p[b + 2] as number) * (p[c] as number))
      + (p[a + 2] as number) * ((p[b] as number) * (p[c + 1] as number) - (p[b + 1] as number) * (p[c] as number))) / 6;
  }
  return v;
}

/** Structural sanity of a part: lengths, index ranges, finite values. */
export function expectValidPart(part: MeshPart): void {
  const n = part.positions.length / 3;
  expect(Number.isInteger(n)).toBe(true);
  expect(part.normals.length).toBe(part.positions.length);
  expect(part.indices.length % 3).toBe(0);
  if (part.uvs) expect(part.uvs.length).toBe(n * 2);
  if (part.colors) expect(part.colors.length).toBe(n * 3);
  for (const v of part.positions) if (!Number.isFinite(v)) throw new Error('non-finite position');
  for (const v of part.normals) if (!Number.isFinite(v)) throw new Error('non-finite normal');
  for (const i of part.indices) if (i >= n) throw new Error(`index ${i} out of range ${n}`);
}

/** Deep comparison of geometry (ignores stats.ms). */
export function sameGeometry(a: GeneratorOutput, b: GeneratorOutput): boolean {
  if (a.parts.length !== b.parts.length || a.colliders.length !== b.colliders.length) return false;
  for (let i = 0; i < a.parts.length; i++) {
    const pa = a.parts[i] as MeshPart;
    const pb = b.parts[i] as MeshPart;
    if (JSON.stringify(pa.material) !== JSON.stringify(pb.material)) return false;
    for (const k of ['positions', 'normals', 'indices', 'uvs', 'colors'] as const) {
      const x = pa[k];
      const y = pb[k];
      if (!x || !y) {
        if (x !== y) return false;
        continue;
      }
      if (x.length !== y.length) return false;
      for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false;
    }
  }
  return JSON.stringify(a.colliders, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v)) ===
    JSON.stringify(b.colliders, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v));
}
