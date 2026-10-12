/**
 * Turning zod failures into short, actionable messages (they are fed back to
 * the LLM in the repair loop) and detecting unknown/misspelled fields, which
 * zod would otherwise strip silently.
 */
import type { z } from 'zod';
import { closestMatch, hasOwn, isPlainObject, truncate } from './json';

/** A validation problem with a dotted path ("entities.car.physics.body"). */
export interface Issue {
  path: string;
  message: string;
}

/** Structural view of a zod v4 issue (only the fields we read). */
interface RawIssue {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  values?: ReadonlyArray<unknown>;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  origin?: string;
  errors?: ReadonlyArray<ReadonlyArray<RawIssue>>;
  discriminator?: string;
  options?: ReadonlyArray<unknown>;
  issues?: ReadonlyArray<RawIssue>;
  keys?: ReadonlyArray<string>;
}

/** Join path segments with dots ("rules.0.then.1"). */
export function joinPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((p) => String(p)).join('.');
}

function fmtValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
}

function describe(issue: RawIssue): string {
  switch (issue.code) {
    case 'invalid_value': {
      const values = issue.values ?? [];
      if (values.length === 1) return `must be ${fmtValue(values[0])}`;
      return `must be one of ${values.map(fmtValue).join('|')}`;
    }
    case 'invalid_type': {
      const received = /received (\w+)/.exec(issue.message)?.[1];
      if (received === 'undefined') return `is required (${issue.expected ?? 'value'})`;
      return `must be ${issue.expected ?? 'a valid value'}${received ? ` (received ${received})` : ''}`;
    }
    case 'too_small':
    case 'too_big': {
      const small = issue.code === 'too_small';
      const bound = String(small ? issue.minimum : issue.maximum);
      if (issue.origin === 'array' || issue.origin === 'set') return `must have ${small ? 'at least' : 'at most'} ${bound} item(s)`;
      if (issue.origin === 'string') return `must be ${small ? 'at least' : 'at most'} ${bound} character(s)`;
      const cmp = small ? (issue.inclusive === false ? '>' : '>=') : issue.inclusive === false ? '<' : '<=';
      return `must be ${cmp} ${bound}`;
    }
    case 'invalid_format':
      if (issue.message === 'ids are lowercase slugs') {
        return 'must be a lowercase slug like "red-car" (a-z, 0-9, "-", "_"; max 64 chars; starts with a letter or digit)';
      }
      if (issue.message === 'color must be #rrggbb') return 'must be a hex color "#rrggbb"';
      return issue.message.startsWith('Invalid') ? 'has an invalid format' : `is invalid: ${issue.message}`;
    case 'not_multiple_of':
      return issue.message.replace(/^Invalid number: /, 'must be ');
    case 'unrecognized_keys':
      return `has unknown field(s) ${(issue.keys ?? []).join(', ')}`;
    default:
      return issue.message.replace(/^Invalid input: /, '');
  }
}

function collect(issue: RawIssue, base: ReadonlyArray<PropertyKey>, out: Issue[]): void {
  const path = [...base, ...issue.path];
  if (issue.code === 'invalid_union') {
    if (issue.discriminator !== undefined && issue.options) {
      out.push({ path: joinPath(path), message: `must be one of ${issue.options.map(fmtValue).join('|')}` });
      return;
    }
    const branches = issue.errors ?? [];
    let best: ReadonlyArray<RawIssue> | undefined;
    for (const b of branches) if (b.length > 0 && (!best || b.length < best.length)) best = b;
    if (best) {
      for (const sub of best) collect(sub, path, out);
      return;
    }
    out.push({ path: joinPath(path), message: 'does not match any allowed form' });
    return;
  }
  if (issue.code === 'invalid_key' && issue.issues && issue.issues.length > 0) {
    const key = String(path[path.length - 1] ?? '');
    const inner = issue.issues.map(describe).join('; ');
    out.push({ path: joinPath(path.slice(0, -1)), message: `key "${truncate(key, 64)}" ${inner}` });
    return;
  }
  out.push({ path: joinPath(path), message: describe(issue) });
}

/** Convert a zod error into dotted-path issues. `base` is prepended to every path. */
export function zodIssues(error: z.ZodError, base: ReadonlyArray<PropertyKey> = []): Issue[] {
  const out: Issue[] = [];
  for (const raw of error.issues as unknown as ReadonlyArray<RawIssue>) collect(raw, base, out);
  return out;
}

/** "physics.body must be one of …" (or just the message when the path is empty). */
export function issueText(issue: Issue): string {
  return issue.path ? `${issue.path} ${issue.message}` : issue.message;
}

/** Render up to `max` issues as a single "; "-separated sentence. */
export function issuesText(issues: readonly Issue[], max = 6): string {
  const shown = issues.slice(0, max).map(issueText).join('; ');
  return issues.length > max ? `${shown}; …and ${issues.length - max} more` : shown;
}

// ---------------------------------------------------------------------------
// Unknown-field detection (zod objects strip unknown keys silently)
// ---------------------------------------------------------------------------

type Def = Record<string, unknown>;
const WRAPPERS = new Set(['default', 'optional', 'nullable', 'prefault', 'readonly', 'catch', 'nonoptional']);

function defOf(s: unknown): Def | undefined {
  const zod = (s as { _zod?: { def?: unknown } } | null)?._zod;
  return zod && isPlainObjectLike(zod.def) ? (zod.def as Def) : undefined;
}

function isPlainObjectLike(v: unknown): boolean {
  return v !== null && typeof v === 'object';
}

function unwrap(s: unknown): Def | undefined {
  let d = defOf(s);
  for (let i = 0; d && i < 16 && WRAPPERS.has(String(d['type'])); i++) d = defOf(d['innerType']);
  return d;
}

function literalValues(s: unknown): ReadonlyArray<unknown> {
  const d = unwrap(s);
  return d && d['type'] === 'literal' && Array.isArray(d['values']) ? (d['values'] as unknown[]) : [];
}

function safeParses(schema: unknown, value: unknown): boolean {
  const parse = (schema as { safeParse?: (v: unknown) => { success: boolean } } | null)?.safeParse;
  return typeof parse === 'function' ? parse.call(schema, value).success : false;
}

function unknownKeyIssue(path: readonly string[], key: string, valid: readonly string[]): Issue {
  const full = [...path, key].join('.');
  const hint = closestMatch(key, valid);
  const list = valid.length <= 24 ? ` (valid: ${valid.join(', ')})` : '';
  return { path: full, message: `is not a known field${hint ? ` — did you mean '${hint}'?` : ''}${list}` };
}

/**
 * Report keys in `value` that `schema` does not declare (recursively through
 * objects, arrays, records and unions). Returns at most `max` issues.
 * Values that do not structurally match are skipped — zod reports those.
 */
export function findUnknownKeys(value: unknown, schema: z.ZodType, path: readonly string[] = [], max = 8): Issue[] {
  const out: Issue[] = [];
  walkUnknown(value, schema, [...path], out, max);
  return out;
}

function walkUnknown(value: unknown, schema: unknown, path: string[], out: Issue[], max: number): void {
  if (out.length >= max) return;
  const d = unwrap(schema);
  if (!d) return;
  switch (d['type']) {
    case 'object': {
      if (!isPlainObject(value)) return;
      const shape = d['shape'] as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (!hasOwn(shape, key)) {
          out.push(unknownKeyIssue(path, key, Object.keys(shape)));
          if (out.length >= max) return;
          continue;
        }
        path.push(key);
        walkUnknown(value[key], shape[key], path, out, max);
        path.pop();
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) return;
      for (let i = 0; i < value.length && out.length < max; i++) {
        path.push(String(i));
        walkUnknown(value[i], d['element'], path, out, max);
        path.pop();
      }
      return;
    }
    case 'record': {
      if (!isPlainObject(value)) return;
      const valueType = d['valueType'];
      if (unwrap(valueType)?.['type'] === 'lazy') return; // free-form Json
      for (const key of Object.keys(value)) {
        path.push(key);
        walkUnknown(value[key], valueType, path, out, max);
        path.pop();
        if (out.length >= max) return;
      }
      return;
    }
    case 'union': {
      const options = Array.isArray(d['options']) ? (d['options'] as unknown[]) : [];
      const disc = d['discriminator'];
      if (typeof disc === 'string') {
        if (!isPlainObject(value)) return;
        const tag = value[disc];
        for (const opt of options) {
          const shape = unwrap(opt)?.['shape'] as Record<string, unknown> | undefined;
          if (shape && hasOwn(shape, disc) && literalValues(shape[disc]).includes(tag)) {
            walkUnknown(value, opt, path, out, max);
            return;
          }
        }
        return;
      }
      for (const opt of options) {
        if (safeParses(opt, value)) {
          walkUnknown(value, opt, path, out, max);
          return;
        }
      }
      return;
    }
    default:
      return;
  }
}
