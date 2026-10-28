/**
 * Background fetch of the editor's chunks. The home page ships without the editor (renderer, physics, agent); once it
 * is interactive, the browser pulls those files at low priority so "open" finds them cached. The list comes from
 * `editor-prefetch.json` (written by scripts/vite/editor-prefetch.ts); in dev, or when the file is missing, nothing happens.
 */

/** A build-relative chunk path; anything else in the list is ignored. */
const FILE = /^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/;

interface Connection { saveData?: boolean; effectiveType?: string }

/** True when the visitor asked to save data or is on a 2G link: no speculative downloads. */
export function shouldSkipPrefetch(connection: Connection | undefined): boolean {
  return connection?.saveData === true || /(^|-)2g$/.test(connection?.effectiveType ?? '');
}

/** The files to link from a parsed `editor-prefetch.json` (pure; unknown shapes give nothing). */
export function prefetchLinks(list: unknown): Array<{ rel: 'modulepreload' | 'prefetch'; href: string }> {
  if (typeof list !== 'object' || list === null) return [];
  const { js, css } = list as { js?: unknown; css?: unknown };
  const pick = (v: unknown): string[] => (Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string' && FILE.test(f)) : []);
  return [...pick(js).map((href) => ({ rel: 'modulepreload' as const, href })), ...pick(css).map((href) => ({ rel: 'prefetch' as const, href }))];
}

let started = false;

/** Start fetching the editor's files now (once). Safe to call from any event. */
export function prefetchEditor(): void {
  if (started || typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (shouldSkipPrefetch((navigator as unknown as { connection?: Connection }).connection)) return;
  started = true;
  void fetch(new URL('editor-prefetch.json', document.baseURI))
    .then((r) => (r.ok ? r.json() : null))
    .then((list: unknown) => {
      for (const { rel, href } of prefetchLinks(list)) {
        const link = document.createElement('link');
        link.rel = rel;
        link.href = new URL(href, document.baseURI).href;
        if (rel === 'modulepreload') link.setAttribute('fetchpriority', 'low');
        else link.as = 'style';
        document.head.append(link);
      }
    })
    .catch(() => undefined);
}

/** Prefetch the editor once the page has loaded and the browser is idle, or at the first sign of intent (hover, focus, touch). */
export function prefetchEditorSoon(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const intent = (): void => prefetchEditor();
  const opts = { capture: true, passive: true, once: true } as const;
  window.addEventListener('pointerover', intent, opts);
  window.addEventListener('focusin', intent, opts);
  window.addEventListener('touchstart', intent, opts);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = (): void => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    timer = setTimeout(() => (ric ? ric(prefetchEditor, { timeout: 4000 }) : prefetchEditor()), 800);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
  return () => {
    window.removeEventListener('pointerover', intent, true);
    window.removeEventListener('focusin', intent, true);
    window.removeEventListener('touchstart', intent, true);
    window.removeEventListener('load', idle);
    if (timer !== undefined) clearTimeout(timer);
  };
}
