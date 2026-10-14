/**
 * Material sanitizing without zod (this code also runs inside the locked-down
 * sandbox worker). Mirrors the `MaterialSpec` schema of @aether/core: unknown
 * keys are dropped, numbers are clamped, colors normalized to "#rrggbb".
 */
import { MaterialFinish, MaterialPreset, type MaterialSpec } from '@aether/core';
import { normalizeHex } from './color';

const PRESETS: ReadonlySet<string> = new Set(MaterialPreset.options);
const FINISHES: ReadonlySet<string> = new Set(MaterialFinish.options);

function clampNumber(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`material.${what}: expected a number`);
  return v < min ? min : v > max ? max : v;
}

function color(v: unknown, what: string): string {
  const hex = normalizeHex(v);
  if (hex === null) throw new TypeError(`material.${what}: expected a "#rrggbb" color`);
  return hex;
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw new TypeError(`material.${what}: expected true or false`);
  return v;
}

/**
 * Validate an untrusted material. `undefined`/`null` → `{}`. Throws a
 * TypeError with a precise message on invalid values. Keys are emitted in a
 * fixed order so equal materials serialize identically.
 */
export function sanitizeMaterial(input: unknown): MaterialSpec {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('material: expected an object like { color: "#aa8844" }');
  const src = input as Record<string, unknown>;
  const read = (k: string): unknown => (Object.hasOwn(src, k) ? src[k] : undefined);
  const out: MaterialSpec = {};
  const preset = read('preset');
  if (preset !== undefined) {
    if (typeof preset !== 'string' || !PRESETS.has(preset)) {
      throw new TypeError(`material.preset: must be one of ${[...PRESETS].join(', ')}`);
    }
    out.preset = preset as MaterialSpec['preset'];
  }
  const fin = read('finish');
  if (fin !== undefined) {
    if (typeof fin !== 'string' || !FINISHES.has(fin)) throw new TypeError(`material.finish: must be one of ${[...FINISHES].join(', ')}`);
    out.finish = fin as MaterialSpec['finish'];
  }
  const c = read('color');
  if (c !== undefined) out.color = color(c, 'color');
  const roughness = read('roughness');
  if (roughness !== undefined) out.roughness = clampNumber(roughness, 0, 1, 'roughness');
  const metalness = read('metalness');
  if (metalness !== undefined) out.metalness = clampNumber(metalness, 0, 1, 'metalness');
  const emissive = read('emissive');
  if (emissive !== undefined) out.emissive = color(emissive, 'emissive');
  const ei = read('emissiveIntensity');
  if (ei !== undefined) out.emissiveIntensity = clampNumber(ei, 0, 50, 'emissiveIntensity');
  const opacity = read('opacity');
  if (opacity !== undefined) out.opacity = clampNumber(opacity, 0, 1, 'opacity');
  const flat = read('flatShading');
  if (flat !== undefined) out.flatShading = bool(flat, 'flatShading');
  const vc = read('vertexColors');
  if (vc !== undefined) out.vertexColors = bool(vc, 'vertexColors');
  return out;
}
