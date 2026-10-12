/**
 * Safe "set a property by dotted path" on an entity for runtime overrides
 * (`LogicHost.setProperty`, e.g. "material.color", "visible",
 * "light.intensity"). Inputs are untrusted: paths are length/depth limited,
 * prototype-polluting keys are rejected and the result is re-validated with
 * the World IR schema.
 */
import { Entity, isForbiddenKey, type Json } from '@aether/core';

/** Max path length in characters. */
export const MAX_PATH_LENGTH = 128;
/** Max path depth (segments). */
export const MAX_PATH_DEPTH = 6;

/** Root fields a runtime override may touch (identity and hierarchy are immutable at runtime). */
const MUTABLE_ROOTS: ReadonlySet<string> = new Set([
  'name', 'description', 'tags', 'transform', 'shape', 'material', 'light', 'state', 'visible', 'castShadow', 'receiveShadow', 'behaviors',
]);

/** Shorthands accepted in addition to full paths. */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  position: 'transform.position',
  rotation: 'transform.rotation',
  scale: 'transform.scale',
  color: 'material.color',
  emissive: 'material.emissive',
  opacity: 'material.opacity',
  intensity: 'light.intensity',
});

/** Parse and validate a property path. Returns its segments or an error message. */
export function parsePropertyPath(path: string): { ok: true; segments: string[] } | { ok: false; error: string } {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return { ok: false, error: 'invalid path' };
  const full = Object.hasOwn(ALIASES, path) ? (ALIASES[path] as string) : path;
  const segments = full.split('.');
  if (segments.length > MAX_PATH_DEPTH) return { ok: false, error: 'path too deep' };
  for (const s of segments) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) return { ok: false, error: `invalid path segment "${s.slice(0, 32)}"` };
    if (isForbiddenKey(s)) return { ok: false, error: 'forbidden path segment' };
  }
  if (!MUTABLE_ROOTS.has(segments[0] as string)) return { ok: false, error: `"${segments[0]}" cannot be changed at runtime` };
  return { ok: true, segments };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Return a NEW validated entity with `path` set to `value`, or an error.
 * Intermediate objects are created as needed; array elements can be
 * addressed by numeric segments ("transform.position.1").
 */
export function setEntityPath(entity: Entity, path: string, value: Json): { ok: true; entity: Entity } | { ok: false; error: string } {
  const parsed = parsePropertyPath(path);
  if (!parsed.ok) return parsed;
  const draft: unknown = structuredClone(entity);
  if (!isRecord(draft)) return { ok: false, error: 'invalid entity' };
  let cur: Record<string, unknown> | unknown[] = draft;
  const segs = parsed.segments;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i] as string;
    let next: unknown;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { ok: false, error: `index ${seg} out of range` };
      next = cur[idx];
    } else {
      next = Object.hasOwn(cur, seg) ? cur[seg] : undefined;
      if (next === undefined) {
        next = {};
        cur[seg] = next;
      }
    }
    if (!isRecord(next) && !Array.isArray(next)) return { ok: false, error: `"${segs.slice(0, i + 1).join('.')}" is not an object` };
    cur = next;
  }
  const last = segs[segs.length - 1] as string;
  const copy: unknown = structuredClone(value);
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { ok: false, error: `index ${last} out of range` };
    cur[idx] = copy;
  } else {
    cur[last] = copy;
  }
  const result = Entity.safeParse(draft);
  if (!result.success) return { ok: false, error: result.error.issues[0]?.message ?? 'invalid value' };
  return { ok: true, entity: result.data };
}
