/**
 * Lenient-but-bounded JSON extraction from model text. Headless CLIs and small
 * on-device models sometimes wrap the requested JSON object in prose or a
 * Markdown fence; this finds the first complete top-level object without ever
 * evaluating anything.
 */

/** Largest model reply we try to parse (characters). */
export const MAX_REPLY_CHARS = 1_500_000;

/**
 * Parse `text` as JSON, or extract the first balanced `{…}` object from it
 * (Markdown fences and surrounding prose are ignored). Returns `undefined`
 * when no valid JSON object is found.
 */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_REPLY_CHARS) return undefined;
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (isObject(direct)) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1].trim());
    if (isObject(inner)) return inner;
  }
  const start = trimmed.indexOf('{');
  if (start < 0) return undefined;
  const end = matchingBrace(trimmed, start);
  if (end < 0) return undefined;
  const candidate = tryParse(trimmed.slice(start, end + 1));
  return isObject(candidate) ? candidate : undefined;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Index of the brace closing the object opened at `start`, honouring strings; -1 if unbalanced. */
function matchingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === 92 /* \\ */) escaped = true;
      else if (ch === 34 /* " */) inString = false;
      continue;
    }
    if (ch === 34) inString = true;
    else if (ch === 123 /* { */) depth++;
    else if (ch === 125 /* } */) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
