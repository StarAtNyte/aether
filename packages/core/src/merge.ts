/**
 * Merge semantics of `update`, `updateRule`, `setEnvironment` and `setPlayer`:
 *
 * - plain objects are merged recursively;
 * - arrays and primitives replace the previous value;
 * - `null` DELETES the key (the schema default then applies), except for
 *   fields the schema declares nullable (e.g. entity `parent`, environment
 *   `fog`/`ground`), where `null` is stored;
 * - when an object's discriminant changes (e.g. `shape.kind` from "primitive"
 *   to "procedural", rule `when.on`), the object is replaced, not merged.
 *
 * `diffForMerge` is the exact inverse: it produces the smallest `set` that
 * turns one value into another under these semantics.
 */
import type { Json } from './schema';
import { deepEqual, hasOwn, isPlainObject, type PlainObject } from './json';

/** Per-document-kind merge configuration (paths are dotted, relative to the merged root). */
export interface MergeConfig {
  /** Paths where `null` is a legal stored value. */
  nullable: ReadonlySet<string>;
  /** Paths of discriminated objects → discriminant key. */
  discriminants: Readonly<Record<string, string>>;
}

/** Entity merge rules. */
export const ENTITY_MERGE: MergeConfig = {
  nullable: new Set(['parent']),
  discriminants: { shape: 'kind', 'shape.of': 'kind' },
};
/** Rule merge rules. */
export const RULE_MERGE: MergeConfig = { nullable: new Set(), discriminants: { when: 'on' } };
/** Environment merge rules. */
export const ENVIRONMENT_MERGE: MergeConfig = { nullable: new Set(['fog', 'ground']), discriminants: {} };
/** Player merge rules. */
export const PLAYER_MERGE: MergeConfig = { nullable: new Set(), discriminants: {} };

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function discriminantChanged(cfg: MergeConfig, path: string, base: PlainObject, next: PlainObject): boolean {
  const disc = cfg.discriminants[path];
  return disc !== undefined && hasOwn(next, disc) && next[disc] !== base[disc];
}

/** Copy a replacement object, dropping `null` except at nullable paths. */
function stripNulls(v: unknown, cfg: MergeConfig, path: string): unknown {
  if (!isPlainObject(v)) return v;
  const out: PlainObject = {};
  for (const key of Object.keys(v)) {
    const cp = childPath(path, key);
    const cv = v[key];
    if (cv === null && !cfg.nullable.has(cp)) continue;
    out[key] = stripNulls(cv, cfg, cp);
  }
  return out;
}

/**
 * Deep-merge `patch` into `base` (never mutates either). Callers must have
 * screened `patch` with `inspectUntrusted` (no prototype keys).
 */
export function deepMerge(base: unknown, patch: Readonly<Record<string, Json>>, cfg: MergeConfig, path = ''): PlainObject {
  const out: PlainObject = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    const v = patch[key];
    const cp = childPath(path, key);
    if (v === null) {
      if (cfg.nullable.has(cp)) out[key] = null;
      else delete out[key];
    } else if (isPlainObject(v)) {
      const prev = out[key];
      out[key] =
        isPlainObject(prev) && !discriminantChanged(cfg, cp, prev, v)
          ? deepMerge(prev, v as Record<string, Json>, cfg, cp)
          : stripNulls(v, cfg, cp);
    } else if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Smallest `set` such that `deepMerge(from, set)` deep-equals `to`, or
 * `undefined` when they are already equal.
 */
export function diffForMerge(from: unknown, to: unknown, cfg: MergeConfig, path = ''): Record<string, Json> | undefined {
  const a: PlainObject = isPlainObject(from) ? from : {};
  const b: PlainObject = isPlainObject(to) ? to : {};
  const set: Record<string, Json> = {};
  let changed = false;
  for (const key of Object.keys(b)) {
    const tv = b[key];
    if (tv === undefined) continue;
    const fv = hasOwn(a, key) ? a[key] : undefined;
    if (fv === tv || deepEqual(fv, tv)) continue;
    const cp = childPath(path, key);
    if (isPlainObject(fv) && isPlainObject(tv) && !discriminantChanged(cfg, cp, fv, tv)) {
      const sub = diffForMerge(fv, tv, cfg, cp);
      if (sub) set[key] = sub;
    } else {
      set[key] = tv as Json;
    }
    changed = true;
  }
  for (const key of Object.keys(a)) {
    if (a[key] === undefined) continue;
    if (!hasOwn(b, key) || b[key] === undefined) {
      set[key] = null;
      changed = true;
    }
  }
  return changed ? set : undefined;
}
