/**
 * Shared toolkit for built-in generators: ParamSpec builders, a definition
 * helper that resolves params, vertex painting helpers and common materials.
 */
import type { Json, MaterialSpec, ParamSpec, Vec3 } from '@aether/core';
import type { BuiltinGenerator, ColliderDesc, GeneratorCategory, GeneratorOutput } from '../types';
import { createGeneratorApi, isInternalApi, type InternalApi } from '../api';
import { hexToLinear, mixHex, mixLinear, type RGB } from '../color';
import { paramReader, resolveParams, type ParamReader } from '../params';
import { Mesh } from '../kernel/mesh';
import { mat3AlignY, mat3ToEulerDeg } from '../kernel/math3';
import { hullSupportPoints } from '../colliders';

/** Number param spec. */
export function pNum(def: number, min: number, max: number, description: string): ParamSpec {
  return { type: 'number', default: def, min, max, description };
}

/** Integer param spec. */
export function pInt(def: number, min: number, max: number, description: string): ParamSpec {
  return { type: 'int', default: def, min, max, description };
}

/** Color param spec. */
export function pColor(def: string, description: string): ParamSpec {
  return { type: 'color', default: def, description };
}

/** Boolean param spec. */
export function pBool(def: boolean, description: string): ParamSpec {
  return { type: 'boolean', default: def, description };
}

/** Enum param spec. */
export function pEnum(options: string[], def: string, description: string): ParamSpec {
  return { type: 'enum', default: def, options, description };
}

/** Standard "variant" param (style selector; combine with seed for variety). */
export function pVariant(max: number, description = 'style variant'): ParamSpec {
  return pInt(0, 0, max, description);
}

/** Definition of a built-in generator. */
export interface GeneratorDefinition {
  id: string;
  description: string;
  category: GeneratorCategory;
  params: Record<string, ParamSpec>;
  run(p: ParamReader, api: InternalApi): GeneratorOutput;
}

/** Wrap a definition into a {@link BuiltinGenerator} that resolves its params. */
export function defineGenerator(def: GeneratorDefinition): BuiltinGenerator {
  return {
    id: def.id,
    description: def.description,
    category: def.category,
    params: def.params,
    generate(params: Record<string, Json>, api) {
      const internal = isInternalApi(api) ? api : createGeneratorApi(api.seed);
      return def.run(paramReader(resolveParams(def.params, params)), internal);
    },
  };
}

/** Hex → linear RGB. */
export function lin(hex: string): RGB {
  return hexToLinear(hex, [0, 0, 0]);
}

/** Lighten (amount > 0) or darken (amount < 0) a hex color. */
export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#000000', -amount);
}

/** Randomly lighten/darken a color by up to ±amount (seeded). */
export function jitter(api: InternalApi, hex: string, amount: number): string {
  return shade(hex, (api.rng() * 2 - 1) * amount);
}

/** Paint a solid color. */
export function paintSolid(m: Mesh, hex: string): Mesh {
  return m.paint(lin(hex));
}

/** Paint a mix of two colors driven by 3D noise at the given spatial frequency. */
export function paintNoise(m: Mesh, api: InternalApi, a: string, b: string, freq: number, bias = 0): Mesh {
  const ca = lin(a);
  const cb = lin(b);
  const n = api.noise;
  return m.paintFn((x, y, z, _nx, _ny, _nz, out) => {
    mixLinear(ca, cb, 0.5 + 0.5 * n.noise3(x * freq, y * freq, z * freq) + bias, out);
  });
}

/** Vertical gradient from `a` (at y0) to `b` (at y1) with optional noise wobble. */
export function paintGradientY(m: Mesh, api: InternalApi, a: string, b: string, y0: number, y1: number, wobble = 0): Mesh {
  const ca = lin(a);
  const cb = lin(b);
  const span = Math.abs(y1 - y0) > 1e-6 ? y1 - y0 : 1;
  const n = api.noise;
  return m.paintFn((x, y, z, _nx, _ny, _nz, out) => {
    const w = wobble > 0 ? wobble * n.noise3(x * 2.1, y * 2.1, z * 2.1) : 0;
    mixLinear(ca, cb, (y - y0) / span + w, out);
  });
}

/** Append a mirrored copy with flipped winding and normals (double-sided thin surfaces). */
export function doubleSided(m: Mesh): Mesh {
  const back = m.clone().flipWinding();
  const n = back.normals;
  for (let i = 0; i < n.length; i++) n[i] = -(n[i] as number);
  return m.merge(back);
}

/** Box collider oriented along the segment a→b with radius r (for trunks, beams). */
export function segmentBox(a: Vec3, b: Vec3, r: number): ColliderDesc {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
  return {
    kind: 'box',
    halfExtents: [Math.max(1e-3, r), len / 2, Math.max(1e-3, r)],
    offset: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rotation: mat3ToEulerDeg(mat3AlignY(dx, dy, dz)),
  };
}

/** Convex hull collider from a mesh's support points. */
export function hullOf(m: Mesh): ColliderDesc {
  return { kind: 'hull', points: hullSupportPoints(m.positions), offset: [0, 0, 0] };
}

/** Common art-directed materials (vertex colored, stylized). */
export const MAT = {
  wood: { preset: 'wood', vertexColors: true, roughness: 0.85, flatShading: true },
  bark: { preset: 'bark', vertexColors: true, roughness: 0.95, flatShading: true },
  leaf: { preset: 'leaf', vertexColors: true, roughness: 0.8, flatShading: true },
  stone: { preset: 'stone', vertexColors: true, roughness: 0.92, flatShading: true },
  brick: { preset: 'brick', vertexColors: true, roughness: 0.9, flatShading: true },
  metal: { preset: 'metal', vertexColors: true, roughness: 0.45, metalness: 0.8 },
  fabric: { preset: 'fabric', vertexColors: true, roughness: 0.95, flatShading: true },
  plastic: { preset: 'plastic', vertexColors: true, roughness: 0.55 },
  paint: { preset: 'plastic', vertexColors: true, roughness: 0.35, metalness: 0.25 },
  glass: { preset: 'glass', color: '#9fd3ff', roughness: 0.08, metalness: 0.1, opacity: 0.55 },
  rubber: { preset: 'rubber', color: '#2a2a2e', roughness: 0.95 },
  ground: { preset: 'dirt', vertexColors: true, roughness: 0.96, flatShading: true },
} as const satisfies Record<string, MaterialSpec>;

/** Emissive glow material. */
export function glow(color: string, intensity = 2): MaterialSpec {
  return { preset: 'emissive', color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 };
}
