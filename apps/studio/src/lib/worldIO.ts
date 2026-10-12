/**
 * World import / export. Imported JSON is untrusted: size-capped, guarded
 * against prototype pollution and oversized structures, then fully
 * validated with `validateWorld` before it can reach the editor.
 */
import { inspectUntrusted, validateWorld, type WorldDoc } from '@aether/core';
import { MAX_IMPORT_BYTES } from '../config';

/** Envelope written by {@link exportWorld}. Plain `WorldDoc` JSON is accepted on import too. */
export const EXPORT_FORMAT = 'aether-world';
const EXPORT_VERSION = 1;
const MAX_REPORTED_ISSUES = 4;

/** Result of {@link parseWorldImport}. */
export type ImportResult = { ok: true; world: WorldDoc } | { ok: false; error: string };

/** UTF-8 byte length of a string (without allocating an encoded copy for ASCII-heavy input). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function unwrap(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(v, 'format') && v['format'] === EXPORT_FORMAT) return v['world'];
  }
  return value;
}

/** Validate an already-parsed value as a world (envelope or bare doc). */
export function validateImportedValue(value: unknown): ImportResult {
  const guard = inspectUntrusted(value);
  if (!guard.ok) return { ok: false, error: `Rejected: ${guard.path ? `${guard.path}: ` : ''}${guard.message}` };
  const doc = unwrap(value);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ok: false, error: 'Not an Aether world: expected a JSON object.' };
  const r = validateWorld(doc);
  if (!r.ok) {
    const shown = r.issues.slice(0, MAX_REPORTED_ISSUES).map((i) => `${i.path || '(root)'}: ${i.message}`);
    const more = r.issues.length > MAX_REPORTED_ISSUES ? ` (+${r.issues.length - MAX_REPORTED_ISSUES} more)` : '';
    return { ok: false, error: `Invalid world — ${shown.join('; ')}${more}` };
  }
  return { ok: true, world: r.world };
}

/** Parse and validate world JSON text (≤ {@link MAX_IMPORT_BYTES}). Never throws. */
export function parseWorldImport(text: string, maxBytes: number = MAX_IMPORT_BYTES): ImportResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'The file is empty.' };
  // Cheap upper bound first (≤ 3 bytes per UTF-16 unit), exact count only when needed.
  if (text.length > maxBytes || (text.length * 3 > maxBytes && utf8Length(text) > maxBytes)) {
    return { ok: false, error: `The file is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB).` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message.slice(0, 160) : 'parse error'}` };
  }
  return validateImportedValue(value);
}

/** Serialize a world for download (stable, pretty-printed envelope). */
export function exportWorld(world: WorldDoc): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, world }, null, 2);
}

/** File name for an exported world: "Cozy Camp!" → "cozy-camp.aether.json". */
export function exportFileName(world: WorldDoc): string {
  const base = world.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'world'}.aether.json`;
}
