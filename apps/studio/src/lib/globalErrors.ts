/**
 * Errors nobody caught (a rejected promise in a background task, a throw in an event handler) must not vanish
 * silently and must not pile up toasts. They are logged once each, kept in a short ring (for a bug report), and
 * surface as at most one calm toast per interval.
 */
export interface CaughtError { at: number; kind: 'error' | 'rejection'; message: string }

export interface GlobalErrorTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: never) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: never) => void): void;
}

export interface GlobalErrorOptions {
  toast: (text: string) => void;
  now?: () => number;
  log?: (message: string, detail: unknown) => void;
  /** Smallest gap between toasts (ms). */
  toastEveryMs?: number;
  capacity?: number;
  /** Send each new error somewhere the operator sees it (the server's log); called once per distinct error. */
  report?: (e: CaughtError) => void;
}

/** Noise the browser raises that is not a defect: cancelled work and the harmless resize-observer notice. */
export function isBenign(reason: unknown, message: string): boolean {
  if (reason instanceof DOMException && reason.name === 'AbortError') return true;
  if (typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'AbortError') return true;
  return /ResizeObserver loop/i.test(message);
}

function describe(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) ?? String(value); } catch { return String(value); } })();
  return text.slice(0, 300);
}

/** Listen for uncaught errors. Returns the ring of recent ones and a function that removes the listeners. */
export function installGlobalErrorReporting(target: GlobalErrorTarget, opts: GlobalErrorOptions): { recent(): readonly CaughtError[]; dispose(): void } {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m, d) => console.error(m, d));
  const every = opts.toastEveryMs ?? 15000, capacity = opts.capacity ?? 20;
  const ring: CaughtError[] = [];
  const seen = new Set<string>();
  let lastToast = -Infinity;
  const record = (kind: CaughtError['kind'], reason: unknown, message: string): void => {
    if (isBenign(reason, message)) return;
    const text = describe(message || reason);
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    if (seen.size > 200) seen.clear();
    seen.add(key);
    const entry: CaughtError = { at: now(), kind, message: text };
    ring.push(entry);
    try {
      opts.report?.(entry);
    } catch {
      /* reporting must never throw from the error handler */
    }
    if (ring.length > capacity) ring.shift();
    log(`[aether] uncaught ${kind}`, reason);
    const t = now();
    if (t - lastToast >= every) { lastToast = t; opts.toast('Something went wrong in the background. Your work is safe; if it keeps happening, reload the page.'); }
  };
  const onError = (e: { error?: unknown; message?: string }): void => record('error', e.error, e.message ?? describe(e.error));
  const onRejection = (e: { reason?: unknown }): void => record('rejection', e.reason, describe(e.reason));
  target.addEventListener('error', onError as never);
  target.addEventListener('unhandledrejection', onRejection as never);
  return {
    recent: () => ring.slice(),
    dispose() { target.removeEventListener('error', onError as never); target.removeEventListener('unhandledrejection', onRejection as never); },
  };
}

/**
 * A reporter that posts errors to the Aether server's `/api/errors`, when this page is served by one (a static host has no
 * `/api`: the health probe fails once and nothing is sent). At most `max` reports per page load.
 */
export function serverErrorReporter(opts: { fetch?: typeof fetch; max?: number; page?: () => string } = {}): (e: CaughtError) => void {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const max = opts.max ?? 10;
  let sent = 0;
  let server: Promise<boolean> | null = null;
  return (e) => {
    if (sent >= max) return;
    sent++;
    server ??= f('/api/health').then((r) => r.ok, () => false);
    void server.then((ok) => {
      if (!ok) return;
      return f('/api/errors', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: e.kind, message: e.message, page: opts.page?.() ?? '' }) }).then(() => undefined, () => undefined);
    });
  };
}
