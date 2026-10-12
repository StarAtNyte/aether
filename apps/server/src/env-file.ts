/**
 * Minimal, dependency-free `.env` parser.
 *
 * Supported syntax (a pragmatic subset of dotenv):
 *   KEY=value              # trailing comments after unquoted values
 *   export KEY=value
 *   KEY="double quoted with \n escapes"
 *   KEY='single quoted, literal'
 *
 * Values are never evaluated or expanded. Keys must be POSIX-style identifiers;
 * prototype-pollution keys are ignored. Existing environment variables always
 * win over values from the file so that the deployment platform stays in charge.
 */
import { readFileSync, statSync } from 'node:fs';

/** Upper bound on the size of a `.env` file we are willing to parse. */
export const MAX_ENV_FILE_BYTES = 64 * 1024;

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse `.env` text into a null-prototype record. Malformed lines are skipped.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trimStart();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key) || FORBIDDEN.has(key)) continue;
    out[key] = parseValue(line.slice(eq + 1).trim());
  }
  return out;
}

function parseValue(raw: string): string {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    const end = raw.indexOf(quote, 1);
    // Unterminated quotes: keep the literal remainder rather than guessing.
    const inner = end === -1 ? raw.slice(1) : raw.slice(1, end);
    return quote === '"' ? unescapeDouble(inner) : inner;
  }
  const hash = raw.search(/\s#/);
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

function unescapeDouble(s: string): string {
  return s.replace(/\\([nrt"\\])/g, (_m, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return ch;
    }
  });
}

/**
 * Load `path` (if it exists and is small enough) into `target` without
 * overriding keys that are already set. Returns the keys that were applied.
 */
export function loadEnvFile(path: string, target: Record<string, string | undefined> = process.env): string[] {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) return [];
    size = st.size;
  } catch {
    return [];
  }
  if (size > MAX_ENV_FILE_BYTES) {
    throw new Error(`.env file is too large (${size} bytes > ${MAX_ENV_FILE_BYTES})`);
  }
  const parsed = parseEnvFile(readFileSync(path, 'utf8'));
  const applied: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (target[key] !== undefined) continue;
    target[key] = parsed[key];
    applied.push(key);
  }
  return applied;
}
