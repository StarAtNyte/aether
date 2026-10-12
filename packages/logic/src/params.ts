/**
 * Typed, clamped access to untrusted behavior parameters.
 *
 * Behavior params come from LLM output (validated only as JSON by the World
 * IR), so every read falls back to the declared default when the value is
 * missing, of the wrong type, non-finite or out of range.
 */
import { hasOwn, isForbiddenKey, type Json, type Vec3 } from '@aether/core';
import type { BehaviorParamSpec } from './types';
import { clamp } from './vec';

/** Maximum length of a string parameter. */
const MAX_PARAM_STRING = 2000;
/** Maximum number of items in a list parameter. */
const MAX_PARAM_LIST = 64;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' && Number.isFinite(v[0]) &&
    typeof v[1] === 'number' && Number.isFinite(v[1]) &&
    typeof v[2] === 'number' && Number.isFinite(v[2])
  );
}

/** Reads behavior parameters against their spec. Construct once per behavior instance. */
export class ParamReader {
  constructor(
    private readonly spec: Readonly<Record<string, BehaviorParamSpec>>,
    private readonly raw: Readonly<Record<string, Json>>,
  ) {}

  private value(key: string): Json | undefined {
    if (isForbiddenKey(key) || !hasOwn(this.raw, key)) return undefined;
    return this.raw[key];
  }

  private specOf(key: string): BehaviorParamSpec | undefined {
    return hasOwn(this.spec, key) ? this.spec[key] : undefined;
  }

  /** True when the caller supplied a value for `key`. */
  has(key: string): boolean {
    return this.value(key) !== undefined;
  }

  /** Number parameter clamped to the spec's min/max (int specs are rounded). */
  num(key: string): number {
    const s = this.specOf(key);
    const def = s && typeof s.default === 'number' ? s.default : 0;
    const v = this.value(key);
    let n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    if (s && (s.type === 'number' || s.type === 'int')) {
      if (s.type === 'int') n = Math.round(n);
      n = clamp(n, s.min ?? -Infinity, s.max ?? Infinity);
    }
    return n;
  }

  /** Boolean parameter. */
  bool(key: string): boolean {
    const v = this.value(key);
    if (typeof v === 'boolean') return v;
    const s = this.specOf(key);
    return s !== undefined && s.default === true;
  }

  /** String / selector / enum / color parameter (enums and colors are checked). */
  str(key: string): string {
    const s = this.specOf(key);
    const def = s && typeof s.default === 'string' ? s.default : '';
    const v = this.value(key);
    if (typeof v !== 'string' || v.length > MAX_PARAM_STRING) return def;
    if (s?.type === 'enum' && s.options && !s.options.includes(v)) return def;
    if (s?.type === 'color' && !COLOR_RE.test(v)) return def;
    return v;
  }

  /** Vec3 parameter (fresh array). */
  vec3(key: string): Vec3 {
    const v = this.value(key);
    if (isVec3(v)) return [v[0], v[1], v[2]];
    const s = this.specOf(key);
    if (s && isVec3(s.default)) return [s.default[0], s.default[1], s.default[2]];
    return [0, 0, 0];
  }

  /** Either a Vec3 or a selector string (e.g. an orbit center). */
  vec3OrSelector(key: string): Vec3 | string | undefined {
    const v = this.value(key);
    if (isVec3(v)) return [v[0], v[1], v[2]];
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) return v;
    const s = this.specOf(key);
    if (s && isVec3(s.default)) return [s.default[0], s.default[1], s.default[2]];
    if (s && typeof s.default === 'string' && s.default.length > 0) return s.default;
    return undefined;
  }

  /** List of Vec3 (invalid items dropped, capped at 64). */
  vec3List(key: string): Vec3[] {
    const v = this.value(key);
    const out: Vec3[] = [];
    if (!Array.isArray(v)) return out;
    for (const item of v) {
      if (out.length >= MAX_PARAM_LIST) break;
      if (isVec3(item)) out.push([item[0], item[1], item[2]]);
    }
    return out;
  }

  /** List of strings (non-strings dropped, capped at 64). */
  strList(key: string): string[] {
    const v = this.value(key);
    const out: string[] = [];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (out.length >= MAX_PARAM_LIST) break;
        if (typeof item === 'string' && item.length <= MAX_PARAM_STRING) out.push(item);
      }
      return out;
    }
    if (typeof v === 'string' && v.length <= MAX_PARAM_STRING) out.push(v);
    return out;
  }
}
