/**
 * Furniture catalogue: every `furn-*` generator, lookup by id or kind, param
 * resolution (defaults, clamping, enum matching — mirrors procgen's
 * `resolveParams`, which this package cannot import) and sizing for layouts.
 */
import { isForbiddenKey, type Json, type ParamSpec } from '@aether/core';
import type { ArchOutput } from '../types';
import { reader, type FurnitureDef, type ParamReader } from './kit';
import { SEATING } from './seating';
import { TABLES } from './tables';
import { BEDROOM } from './bedroom';
import { KITCHEN_SET } from './kitchen';
import { BATH } from './bath';
import { DECOR } from './decor';
import { LIGHTING } from './lighting';

export type { FurnitureDef, Mount, ParamReader } from './kit';
export { glowMaterial } from './lighting';

/** Every furniture generator, in a stable order. */
export const FURNITURE: readonly FurnitureDef[] = Object.freeze([...SEATING, ...TABLES, ...BEDROOM, ...KITCHEN_SET, ...BATH, ...DECOR, ...LIGHTING]);

const BY_ID: ReadonlyMap<string, FurnitureDef> = new Map(FURNITURE.map((f) => [f.id, f]));
const BY_KIND: ReadonlyMap<string, FurnitureDef> = new Map(FURNITURE.map((f) => [f.kind, f]));

/** Furniture definition by generator id. */
export function furnitureById(id: string): FurnitureDef | undefined {
  return BY_ID.get(id);
}

/** Furniture definition by kind ("sofa", "bed"). */
export function furnitureByKind(kind: string): FurnitureDef | undefined {
  return BY_KIND.get(kind);
}

function coerce(spec: ParamSpec, v: unknown): Json | undefined {
  switch (spec.type) {
    case 'number':
    case 'int': {
      let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v.length < 32 ? Number(v) : Number.NaN;
      if (!Number.isFinite(n)) return undefined;
      if (spec.type === 'int') n = Math.round(n);
      if (spec.min !== undefined && n < spec.min) n = spec.min;
      if (spec.max !== undefined && n > spec.max) n = spec.max;
      return n;
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'color':
      return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
    case 'enum': {
      if (typeof v !== 'string') return undefined;
      const opts = spec.options ?? [];
      return opts.find((o) => o.toLowerCase() === v.toLowerCase());
    }
  }
}

/** Resolve untrusted params against a spec (defaults, clamping; unknown keys dropped). */
export function resolveSpec(spec: Record<string, ParamSpec>, params: Record<string, Json> | undefined): Record<string, Json> {
  const out: Record<string, Json> = {};
  const given = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  for (const key of Object.keys(spec)) {
    if (isForbiddenKey(key)) continue;
    const s = spec[key] as ParamSpec;
    const v = Object.hasOwn(given, key) ? coerce(s, given[key]) : undefined;
    out[key] = v !== undefined ? v : (coerce(s, s.default) ?? s.default);
  }
  return out;
}

/** Reader over resolved params of a furniture definition. */
export function furnitureReader(def: FurnitureDef, params: Record<string, Json> | undefined): ParamReader {
  return reader(resolveSpec(def.params, params), def.params);
}

/** Footprint (width X, height, depth Z) of a piece with the given params. */
export function furnitureSize(def: FurnitureDef, params?: Record<string, Json>): [number, number, number] {
  return def.size(furnitureReader(def, params));
}

/** Build a piece of furniture. */
export function buildFurniture(def: FurnitureDef, params: Record<string, Json> | undefined, seed: number): ArchOutput {
  return def.build(furnitureReader(def, params), seed >>> 0);
}
