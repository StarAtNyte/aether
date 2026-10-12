/**
 * Minimal leveled logger for the render package. Debug output is off by
 * default; warnings and errors go to the console with a stable prefix so they
 * are easy to filter in the studio's devtools.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
let threshold: LogLevel = 'warn';

/** Change the minimum level that is printed (default `'warn'`). */
export function setRenderLogLevel(level: LogLevel): void {
  threshold = level;
}

function emit(level: Exclude<LogLevel, 'silent'>, message: string, detail?: unknown): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = `[aether/render] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  if (detail === undefined) sink(line);
  else sink(line, detail);
}

/** Package logger. */
export const log = {
  debug: (message: string, detail?: unknown): void => emit('debug', message, detail),
  info: (message: string, detail?: unknown): void => emit('info', message, detail),
  warn: (message: string, detail?: unknown): void => emit('warn', message, detail),
  error: (message: string, detail?: unknown): void => emit('error', message, detail),
};

/** Human-readable message of an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'unknown error';
}
