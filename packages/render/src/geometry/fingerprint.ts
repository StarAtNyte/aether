/**
 * Geometry fingerprint of a generator output: 16 hex that change when what it draws or collides with changes, and stay put
 * across machines and browsers for the same output. A cooked package stores one per entry (manifest `fingerprints`); the
 * generation lanes regenerate a few package entries live and compare (gen.worker.ts, the spot check), which backs the
 * generator code version (`__AETHER_GEN_VERSION__`, scripts/vite/gen-version.ts) against a version that missed an input.
 *
 * Every typed array counts by its place in the output, its type, its length and its values: floats rounded to 1/256 (4 mm
 * for positions, so a last-bit difference between engines' Math functions does not count; stored positions are already on
 * a 2^-11 m grid), integers as they are. Everything else (materials, bounds, collider shapes) counts as stable JSON with
 * numbers rounded the same way. The generation time (`stats.ms`) and warnings do not count.
 */
import type { GeneratorOutput } from '../types';

const Q = 256;

/** 32-bit FNV-1a step over one 32-bit value. */
function mix(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
  return Math.imul(h ^ (v >>> 24), 0x01000193);
}

function mixString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h;
}

/** A float rounded to the fingerprint grid, as a 32-bit value (non-finite values get fixed codes). */
function quant(v: number): number {
  if (Number.isNaN(v)) return 0x7fc00000;
  if (!Number.isFinite(v)) return v > 0 ? 0x7f800000 : 0xff800000;
  const r = Math.round(v * Q);
  // Two words for values past 32 bits (8 million metres): folded, still exact for the same input.
  return (r | 0) ^ Math.floor(r / 4294967296);
}

function arrayTag(a: ArrayBufferView): string {
  return a.constructor.name;
}

/** Fingerprint of a generator output (see the module comment). */
export function geometryFingerprint(out: GeneratorOutput): string {
  // Two independent 32-bit lanes (different seeds and walk orders) make 64 bits.
  let a = 0x811c9dc5;
  let b = 0x01234567;
  const walk = (v: unknown, path: string): unknown => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const arr = v as unknown as ArrayLike<number> & ArrayBufferView;
      a = mixString(a, `${path}:${arrayTag(arr)}:${arr.length}`);
      b = mix(b, arr.length);
      const float = arr instanceof Float32Array || arr instanceof Float64Array;
      for (let i = 0; i < arr.length; i++) {
        const q = float ? quant(arr[i]!) : arr[i]! | 0;
        a = mix(a, q);
        b = mix(b, q + i);
      }
      return '$a';
    }
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * Q) / Q : String(v);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}.${i}`));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        if (path === '' && (k === 'stats' || k === 'warnings')) continue;
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) o[k] = walk(x, `${path}.${k}`);
      }
      return o;
    }
    return v;
  };
  const rest = JSON.stringify(walk(out, ''));
  a = mixString(a, rest);
  b = mixString(b, rest);
  b = mix(b, out.parts.length);
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
