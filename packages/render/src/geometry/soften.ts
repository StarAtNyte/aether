/**
 * Soft shading for organic generator output. Many generators emit flat-shaded parts (three own vertices
 * and the face normal per triangle), which is right for crates and crystals but makes hills, canopies
 * and rocks read as low-poly toys. For parts whose material is an organic preset this module rewrites
 * only the vertex normals: faces that share a corner are blended when they meet at less than the
 * preset's crease angle, so a sphere or a hill shades smoothly while a box (90° edges) stays crisp.
 *
 * Positions, indices, colours and UVs are untouched (physics and the box-projected texture UVs see the
 * same mesh); the result is memoised per source part so shared generator output is softened once.
 */
import type { MaterialPreset, MaterialSpec } from '@aether/core';
import { mergeMaterial } from '../materials/presets';
import type { GeneratorOutput, KeyedOutput, MeshPart } from '../types';
import { weldPositions } from '../virtual/simplify';

/** Crease angle (degrees) per organic preset: faces meeting at less than this are shaded as one surface. */
export const CREASE_DEGREES: Readonly<Partial<Record<MaterialPreset, number>>> = Object.freeze({
  grass: 75,
  dirt: 75,
  sand: 75,
  snow: 75,
  leaf: 70,
  bark: 60,
  stone: 38,
  fabric: 60,
});

/** Parts above this many vertices keep their authored normals (the weld is O(n) but the buffers are large). */
export const MAX_SOFTEN_VERTICES = 600_000;

/** The crease angle of a part's material, or null when its normals are left alone (not organic, or flat shading was asked for). */
export function creaseFor(material: MaterialSpec | undefined): number | null {
  // `flatShading: true` survives the merge only when the entity itself asked for it (see `mergeMaterial`).
  if (!material || material.flatShading === true) return null;
  const preset = material.preset;
  if (typeof preset !== 'string' || !Object.hasOwn(CREASE_DEGREES, preset)) return null;
  return CREASE_DEGREES[preset as MaterialPreset] ?? null;
}

/** True when most vertices are duplicated per face (flat shading), i.e. neighbouring faces share no vertices. */
export function isFacetedPart(positions: Float32Array, weld: Uint32Array): boolean {
  const n = positions.length / 3;
  if (n < 6) return false;
  let unique = 0;
  for (let v = 0; v < n; v++) if (weld[v] === v) unique++;
  return unique < n * 0.6;
}

/**
 * New vertex normals for `part` with faces blended below `creaseDeg`, or null when the part is not
 * flat-shaded, too large, or malformed. Pure; allocates only the result.
 */
export function softenedNormals(part: MeshPart, creaseDeg: number): Float32Array | null {
  const { positions, indices } = part;
  const n = Math.floor(positions.length / 3);
  if (n < 6 || n > MAX_SOFTEN_VERTICES || indices.length < 3 || part.normals.length !== positions.length) return null;
  const weld = weldPositions(positions);
  if (!isFacetedPart(positions, weld)) return null;
  const faces = Math.floor(indices.length / 3);
  const fn = new Float32Array(faces * 3);
  // CSR of faces incident to each welded position group.
  const count = new Uint32Array(n + 1);
  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3] as number;
    const b = indices[f * 3 + 1] as number;
    const c = indices[f * 3 + 2] as number;
    if (a >= n || b >= n || c >= n) return null;
    const ux = (positions[b * 3] as number) - (positions[a * 3] as number);
    const uy = (positions[b * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const uz = (positions[b * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const vx = (positions[c * 3] as number) - (positions[a * 3] as number);
    const vy = (positions[c * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const vz = (positions[c * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    // Unnormalised cross product: its length is twice the area, so large faces weigh more.
    fn[f * 3] = uy * vz - uz * vy;
    fn[f * 3 + 1] = uz * vx - ux * vz;
    fn[f * 3 + 2] = ux * vy - uy * vx;
    count[(weld[a] as number) + 1] = (count[(weld[a] as number) + 1] as number) + 1;
    count[(weld[b] as number) + 1] = (count[(weld[b] as number) + 1] as number) + 1;
    count[(weld[c] as number) + 1] = (count[(weld[c] as number) + 1] as number) + 1;
  }
  for (let i = 0; i < n; i++) count[i + 1] = (count[i + 1] as number) + (count[i] as number);
  const fill = count.slice(0, n);
  const incident = new Uint32Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const g = weld[indices[f * 3 + k] as number] as number;
      incident[fill[g] as number] = f;
      fill[g] = (fill[g] as number) + 1;
    }
  }
  const cosLimit = Math.cos((Math.max(1, Math.min(89, creaseDeg)) * Math.PI) / 180);
  const out = new Float32Array(part.normals);
  const done = new Uint8Array(n);
  for (let f = 0; f < faces; f++) {
    const rx = fn[f * 3] as number;
    const ry = fn[f * 3 + 1] as number;
    const rz = fn[f * 3 + 2] as number;
    const rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-12) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k] as number;
      // A vertex shared by several faces keeps the normal computed from the first one that reaches it.
      if (done[v]) continue;
      done[v] = 1;
      const g = weld[v] as number;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = count[g] as number; i < (count[g + 1] as number); i++) {
        const o = incident[i] as number;
        const ox = fn[o * 3] as number;
        const oy = fn[o * 3 + 1] as number;
        const oz = fn[o * 3 + 2] as number;
        const ol = Math.hypot(ox, oy, oz);
        if (ol < 1e-12) continue;
        if ((rx * ox + ry * oy + rz * oz) / (rl * ol) >= cosLimit) {
          nx += ox;
          ny += oy;
          nz += oz;
        }
      }
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;
      out[v * 3] = nx / l;
      out[v * 3 + 1] = ny / l;
      out[v * 3 + 2] = nz / l;
    }
  }
  return out;
}

/** Softened copies of a part by crease angle (a part is softened once per crease it is asked for). */
const memo = new WeakMap<MeshPart, Map<number, MeshPart>>();

/**
 * `part` with soft normals for `crease` degrees (or, by default, the crease its own material asks for,
 * see {@link creaseFor}) when it is flat-shaded; otherwise `part` itself. Memoised per part object and crease.
 */
export function softenPart(part: MeshPart, crease: number | null = creaseFor(part.material)): MeshPart {
  if (crease === null) return part;
  let byCrease = memo.get(part);
  const hit = byCrease?.get(crease);
  if (hit) return hit;
  const normals = softenedNormals(part, crease);
  const result: MeshPart = normals ? { ...part, normals } : part;
  if (!byCrease) {
    byCrease = new Map();
    memo.set(part, byCrease);
  }
  byCrease.set(crease, result);
  return result;
}

/**
 * The output of an entity with soft shading applied where the entity's *effective* material (the part's
 * own merged with the entity's) is organic. Returns `keyed` itself when nothing changes; otherwise a
 * keyed output with a key of its own (the geometry cache must not mix soft and flat copies of one
 * generator output). Memoised per output, so every entity of a scatter field shares one copy.
 */
export function softenKeyed(keyed: KeyedOutput, entityMaterial: MaterialSpec | undefined): KeyedOutput {
  const parts = keyed.output.parts;
  const creases = parts.map((p) => creaseFor(mergeMaterial(p.material, entityMaterial, parts.length)));
  if (creases.every((c) => c === null)) return keyed;
  const signature = creases.map((c) => c ?? 0).join(',');
  let byOutput = keyedMemo.get(keyed.output);
  if (!byOutput) {
    byOutput = new Map();
    keyedMemo.set(keyed.output, byOutput);
  }
  let soft = byOutput.get(signature);
  if (soft === undefined) {
    const softParts = parts.map((p, i) => softenPart(p, creases[i] ?? null));
    soft = softParts.some((p, i) => p !== parts[i]) ? { ...keyed.output, parts: softParts } : null;
    byOutput.set(signature, soft);
  }
  return soft ? { key: `${keyed.key}|soft${signature}`, output: soft } : keyed;
}

/** Softened outputs by source output and crease signature (null: nothing to soften for that signature). */
const keyedMemo = new WeakMap<GeneratorOutput, Map<string, GeneratorOutput | null>>();

/** True when the vertex normals of a part clearly differ from its face normals (it was softened). */
export function normalsAreSoft(positions: Float32Array, indices: Uint32Array, normals: Float32Array): boolean {
  const faces = Math.floor(indices.length / 3);
  let soft = 0;
  let sampled = 0;
  const step = Math.max(1, Math.floor(faces / 64));
  for (let f = 0; f < faces; f += step) {
    const a = indices[f * 3] as number;
    const b = indices[f * 3 + 1] as number;
    const c = indices[f * 3 + 2] as number;
    const ux = (positions[b * 3] as number) - (positions[a * 3] as number);
    const uy = (positions[b * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const uz = (positions[b * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const vx = (positions[c * 3] as number) - (positions[a * 3] as number);
    const vy = (positions[c * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const vz = (positions[c * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    for (const v of [a, b, c]) {
      sampled++;
      const d = ((normals[v * 3] as number) * nx + (normals[v * 3 + 1] as number) * ny + (normals[v * 3 + 2] as number) * nz) / l;
      if (d < 0.99995) soft++;
    }
  }
  return sampled > 0 && soft > sampled * 0.2;
}
