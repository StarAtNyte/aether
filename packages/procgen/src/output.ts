/**
 * Output validation (untrusted generator results), the fallback placeholder
 * and primitive shapes routed through the same GeneratorOutput path.
 * No zod here: this module also runs inside the locked-down sandbox worker.
 */
import type { MaterialSpec, PrimitiveShape } from '@aether/core';
import type { Bounds, ColliderDesc, GeneratorOutput, MeshPart } from './types';
import { createGeneratorApi } from './api';
import { boxCollider, parseCollider } from './colliders';
import { PROCGEN_LIMITS } from './limits';
import { sanitizeMaterial } from './material';
import { dim } from './kernel/primitives';

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function own(o: Rec, k: string): unknown {
  return Object.hasOwn(o, k) ? o[k] : undefined;
}

function checkFloats(a: Float32Array, what: string, limit: number): string | null {
  for (let i = 0; i < a.length; i++) {
    const v = a[i] as number;
    if (!Number.isFinite(v)) return `${what} contains NaN or Infinity`;
    if (v > limit || v < -limit) return `${what} value out of range (±${limit})`;
  }
  return null;
}

function validatePart(raw: unknown, index: number): { part: MeshPart; vertices: number; triangles: number } | string {
  const where = `parts[${index}]`;
  if (!isRecord(raw)) return `${where} must be an object`;
  const positions = own(raw, 'positions');
  const normals = own(raw, 'normals');
  const indices = own(raw, 'indices');
  const uvs = own(raw, 'uvs');
  const colors = own(raw, 'colors');
  if (!(positions instanceof Float32Array)) return `${where}.positions must be a Float32Array`;
  if (!(normals instanceof Float32Array)) return `${where}.normals must be a Float32Array`;
  if (!(indices instanceof Uint32Array)) return `${where}.indices must be a Uint32Array`;
  if (positions.length === 0 || positions.length % 3 !== 0) return `${where}.positions length must be a positive multiple of 3`;
  const n = positions.length / 3;
  if (normals.length !== positions.length) return `${where}.normals length must match positions`;
  if (indices.length === 0 || indices.length % 3 !== 0) return `${where}.indices length must be a positive multiple of 3`;
  for (let i = 0; i < indices.length; i++) if ((indices[i] as number) >= n) return `${where}.indices[${i}] out of range`;
  const errP = checkFloats(positions, `${where}.positions`, PROCGEN_LIMITS.MAX_COORDINATE);
  if (errP) return errP;
  const errN = checkFloats(normals, `${where}.normals`, 2);
  if (errN) return errN;
  const part: MeshPart = { positions, normals, indices, material: {} };
  if (uvs !== undefined) {
    if (!(uvs instanceof Float32Array) || uvs.length !== n * 2) return `${where}.uvs must be a Float32Array with 2 values per vertex`;
    const e = checkFloats(uvs, `${where}.uvs`, 1e6);
    if (e) return e;
    part.uvs = uvs;
  }
  if (colors !== undefined) {
    if (!(colors instanceof Float32Array) || colors.length !== n * 3) return `${where}.colors must be a Float32Array with 3 values per vertex`;
    const e = checkFloats(colors, `${where}.colors`, 16);
    if (e) return e;
    part.colors = colors;
  }
  try {
    part.material = sanitizeMaterial(own(raw, 'material'));
  } catch (err) {
    return `${where}.${err instanceof Error ? err.message : 'material is invalid'}`;
  }
  return { part, vertices: n, triangles: indices.length / 3 };
}

/**
 * Validate an untrusted generator result: shape, typed-array types, index
 * ranges, NaN/Infinity, coordinate magnitudes, materials, colliders and
 * size caps (≤ 2M vertices, ≤ 64 parts, ≤ 256 colliders). Bounds and the
 * triangle count are recomputed (never trusted). Typed arrays are kept
 * (zero-copy); collider data is copied.
 */
export function validateOutput(out: unknown): { ok: true; output: GeneratorOutput } | { ok: false; error: string } {
  if (!isRecord(out)) return { ok: false, error: 'generator must return the result of api.build()' };
  const partsIn = own(out, 'parts');
  if (!Array.isArray(partsIn)) return { ok: false, error: 'output.parts must be an array' };
  if (partsIn.length === 0) return { ok: false, error: 'generator produced no geometry (call api.add(mesh, material) before api.build())' };
  if (partsIn.length > PROCGEN_LIMITS.MAX_PARTS) return { ok: false, error: `too many parts (max ${PROCGEN_LIMITS.MAX_PARTS})` };
  const parts: MeshPart[] = [];
  let vertices = 0;
  let indices = 0;
  let triangles = 0;
  for (let i = 0; i < partsIn.length; i++) {
    const r = validatePart(partsIn[i], i);
    if (typeof r === 'string') return { ok: false, error: r };
    vertices += r.vertices;
    triangles += r.triangles;
    indices += r.triangles * 3;
    if (vertices > PROCGEN_LIMITS.MAX_OUTPUT_VERTICES) return { ok: false, error: `output exceeds ${PROCGEN_LIMITS.MAX_OUTPUT_VERTICES} vertices` };
    if (indices > PROCGEN_LIMITS.MAX_OUTPUT_INDICES) return { ok: false, error: `output exceeds ${PROCGEN_LIMITS.MAX_OUTPUT_INDICES} indices` };
    parts.push(r.part);
  }
  const collidersIn = own(out, 'colliders') ?? [];
  if (!Array.isArray(collidersIn)) return { ok: false, error: 'output.colliders must be an array' };
  if (collidersIn.length > PROCGEN_LIMITS.MAX_COLLIDERS) return { ok: false, error: `too many colliders (max ${PROCGEN_LIMITS.MAX_COLLIDERS})` };
  const colliders: ColliderDesc[] = [];
  for (let i = 0; i < collidersIn.length; i++) {
    try {
      colliders.push(parseCollider(collidersIn[i]));
    } catch (err) {
      return { ok: false, error: `colliders[${i}]: ${err instanceof Error ? err.message : 'invalid'}` };
    }
  }
  const statsIn = own(out, 'stats');
  const msIn = isRecord(statsIn) ? own(statsIn, 'ms') : undefined;
  const ms = typeof msIn === 'number' && Number.isFinite(msIn) && msIn >= 0 ? msIn : 0;
  const result: GeneratorOutput = { parts, colliders, bounds: partsBounds(parts), stats: { triangles, ms } };
  const warnings = own(out, 'warnings');
  if (Array.isArray(warnings)) {
    result.warnings = warnings.filter((w): w is string => typeof w === 'string').slice(0, 10).map((w) => w.slice(0, 200));
  }
  return { ok: true, output: result };
}

/** Bounds over all parts. */
export function partsBounds(parts: readonly MeshPart[]): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const part of parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] as number, y = p[i + 1] as number, z = p[i + 2] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (minX === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Visible placeholder used when a generator fails: a 1 m magenta crate with
 * dark edges, sitting on y = 0, with a box collider. `reason` is attached as
 * a warning (truncated).
 */
export function fallbackOutput(reason: string): GeneratorOutput {
  const api = createGeneratorApi(0);
  api.add(api.box(0.92, 0.92, 0.92).translate(0, 0.5, 0), { color: '#ff3dbb', emissive: '#5a0040', emissiveIntensity: 0.6, roughness: 0.6 });
  const edges = api.box(1, 0.08, 1).translate(0, 0.04, 0);
  edges.merge(api.box(1, 0.08, 1).translate(0, 0.96, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) edges.merge(api.box(0.08, 1, 0.08).translate(x * 0.46, 0.5, z * 0.46));
  edges.merge(api.box(0.08, 1.2, 0.04).rotate(0, 0, 45).translate(0, 0.5, 0.47));
  api.add(edges, { color: '#2b0a22', roughness: 0.8 });
  api.collider(boxCollider(0, 0.5, 0, 1, 1, 1));
  const out = api.build();
  out.warnings = [`fallback: ${String(reason).slice(0, 200)}`];
  return out;
}

/**
 * Primitive shapes through the same output path. Size semantics follow the
 * World IR: box = (w, h, d); sphere diameter = size[0]; cylinder/cone/capsule
 * diameter = size[0], height = size[1]; torus outer diameter = size[0], tube
 * thickness = size[1] (ring in the XY plane); plane = size[0] × size[2] in XZ.
 * Primitives are CENTERED on the origin (not base-aligned), matching physics.
 */
export function primitiveOutput(shape: PrimitiveShape, material?: MaterialSpec): GeneratorOutput {
  const size = Array.isArray(shape.size) ? shape.size : [1, 1, 1];
  const sx = dim(size[0] ?? 1, 'size[0]');
  const sy = dim(size[1] ?? 1, 'size[1]');
  const sz = dim(size[2] ?? 1, 'size[2]');
  let mat: MaterialSpec;
  try {
    mat = sanitizeMaterial(material);
  } catch {
    mat = {};
  }
  const api = createGeneratorApi(0);
  switch (shape.primitive) {
    case 'box':
      api.add(api.box(sx, sy, sz), mat);
      api.collider(boxCollider(0, 0, 0, sx, sy, sz));
      break;
    case 'sphere':
      api.add(api.sphere(sx / 2, 4), mat);
      api.collider({ kind: 'sphere', radius: sx / 2, offset: [0, 0, 0] });
      break;
    case 'cylinder':
      api.add(api.cylinder(sx / 2, sx / 2, sy, 24), mat);
      api.collider({ kind: 'cylinder', radius: sx / 2, halfHeight: sy / 2, offset: [0, 0, 0] });
      break;
    case 'cone': {
      api.add(api.cone(sx / 2, sy, 24), mat);
      const pts: number[] = [0, sy / 2, 0];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        pts.push(Math.cos(a) * (sx / 2), -sy / 2, Math.sin(a) * (sx / 2));
      }
      api.collider({ kind: 'hull', points: new Float32Array(pts), offset: [0, 0, 0] });
      break;
    }
    case 'capsule': {
      const r = sx / 2;
      const h = Math.max(sy, 2 * r);
      api.add(api.capsule(r, h), mat);
      api.collider({ kind: 'capsule', radius: r, halfHeight: Math.max(0, h / 2 - r), offset: [0, 0, 0] });
      break;
    }
    case 'torus': {
      const tube = Math.min(sy / 2, sx / 4);
      const R = Math.max(tube * 0.25, sx / 2 - tube);
      api.add(api.torus(R, tube, 16, 32), mat);
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * Math.PI * 2;
        const seg = 2 * R * Math.sin(Math.PI / n) + tube;
        api.collider({ kind: 'box', halfExtents: [tube, seg / 2, tube], offset: [Math.cos(a) * R, Math.sin(a) * R, 0], rotation: [0, 0, (a * 180) / Math.PI] });
      }
      break;
    }
    case 'plane':
      api.add(api.plane(sx, sz, 1, 1), mat);
      api.collider(boxCollider(0, -0.005, 0, sx, 0.01, sz));
      break;
  }
  return api.build({ recenter: false });
}
