/**
 * Tiny leveled logger. Debug output is only emitted in development or with
 * `?debug=1`; warnings and errors always reach the console so production
 * problems stay diagnosable.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function detectDebug(): boolean {
  try {
    if (import.meta.env?.DEV) return true;
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

const threshold = detectDebug() ? ORDER.debug : ORDER.warn;

function emit(level: Level, scope: string, message: string, detail?: unknown): void {
  if (ORDER[level] < threshold) return;
  const line = `[aether:${scope}] ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug;
  if (detail === undefined) fn(line);
  else fn(line, detail);
}

/** Scoped logger instance. */
export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

/** Create a logger whose lines are prefixed with `scope`. */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => emit('debug', scope, m, d),
    info: (m, d) => emit('info', scope, m, d),
    warn: (m, d) => emit('warn', scope, m, d),
    error: (m, d) => emit('error', scope, m, d),
  };
}

/** Human-readable message for any thrown value (never throws itself). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
