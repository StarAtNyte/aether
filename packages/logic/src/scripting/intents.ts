/**
 * Validation of intents returned by untrusted scripts. Rule actions are
 * validated with the World IR `Action` zod schema; the two script-only intents
 * (`moveTo`, `setSelfState`) are checked here.
 */
import { Action, inspectUntrusted, isForbiddenKey, isPlainObject, Json } from '@aether/core';
import type { ScriptIntent } from '../types';

/** Max intents accepted from one script call. */
export const MAX_INTENTS_PER_CALL = 32;

/** Result of validating one intent. */
export type IntentCheck = { ok: true; intent: ScriptIntent } | { ok: false; error: string };

function isFiniteVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) return `unexpected field '${k.slice(0, 32)}'`;
  return undefined;
}

/** Validate one script intent (an Action, `moveTo` or `setSelfState`). */
export function checkIntent(raw: unknown): IntentCheck {
  if (!isPlainObject(raw)) return { ok: false, error: 'intent must be an object' };
  const kind = raw['do'];
  if (kind === 'moveTo') {
    const extra = onlyKeys(raw, ['do', 'target', 'speed']);
    if (extra) return { ok: false, error: extra };
    const target = raw['target'];
    const speed = raw['speed'];
    if (!isFiniteVec3(target)) return { ok: false, error: 'target must be [x, y, z] finite numbers' };
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 || speed > 1000) return { ok: false, error: 'speed must be a number in 0–1000' };
    return { ok: true, intent: { do: 'moveTo', target: [target[0], target[1], target[2]], speed } };
  }
  if (kind === 'setSelfState') {
    const extra = onlyKeys(raw, ['do', 'key', 'value']);
    if (extra) return { ok: false, error: extra };
    const key = raw['key'];
    if (typeof key !== 'string' || key.length === 0 || key.length > 64 || key.includes('.') || isForbiddenKey(key)) {
      return { ok: false, error: 'key must be a plain name (1–64 chars, no dots)' };
    }
    const value = Json.safeParse(raw['value']);
    if (!value.success) return { ok: false, error: 'value must be JSON' };
    return { ok: true, intent: { do: 'setSelfState', key, value: value.data } };
  }
  const parsed = Action.safeParse(raw);
  if (parsed.success) return { ok: true, intent: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || 'value'}: ${first.message}` : 'invalid action' };
}

/** Result of validating raw script output. */
export interface IntentValidation {
  intents: ScriptIntent[];
  problems: string[];
}

/**
 * Validate a parsed script return value: an array of intents (or a single
 * intent object). Hostile structures are rejected wholesale; invalid items are
 * dropped with a problem report; at most {@link MAX_INTENTS_PER_CALL} are kept.
 */
export function validateIntents(raw: unknown): IntentValidation {
  const problems: string[] = [];
  const intents: ScriptIntent[] = [];
  if (raw === null || raw === undefined) return { intents, problems };
  const guard = inspectUntrusted(raw, { maxDepth: 16, maxNodes: 5000, maxStringLength: 10_000 });
  if (!guard.ok) return { intents, problems: [`output rejected: ${guard.message}${guard.path ? ` at ${guard.path}` : ''}`] };
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  if (list.length > MAX_INTENTS_PER_CALL) problems.push(`returned ${list.length} intents; only the first ${MAX_INTENTS_PER_CALL} are used`);
  const n = Math.min(list.length, MAX_INTENTS_PER_CALL);
  for (let i = 0; i < n; i++) {
    const res = checkIntent(list[i]);
    if (res.ok) intents.push(res.intent);
    else {
      const item = list[i];
      const kind = isPlainObject(item) && typeof item['do'] === 'string' ? item['do'].slice(0, 32) : typeof item;
      problems.push(`intent ${i} (${kind}) rejected: ${res.error}`);
    }
  }
  return { intents, problems };
}
