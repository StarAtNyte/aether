/**
 * Failure classification and the once-a-minute reload after a deploy replaced the app's files. No React here: the
 * player shell (play.html) installs the reload before anything else loads, and must not pull React or the boundary
 * components into its first download.
 */
/** What went wrong, in the user's terms. */
export type FailureKind = 'offline' | 'chunk' | 'crash';

/** Classify a thrown value: a failed chunk download (offline or stale deploy) or a real crash. Pure. */
export function classifyFailure(error: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine): FailureKind {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const chunk = /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS|net::ERR_/i.test(text);
  if (chunk) return online ? 'chunk' : 'offline';
  return 'crash';
}

const STALE_KEY = 'aether:stale-reload';

/**
 * A deploy replaced the app's files while this page was open: its dynamic imports now 404. Reload once to pick up the
 * new build (not again within a minute, so a real outage shows the error instead of a reload loop). Returns whether it
 * reloads.
 */
export function reloadForStaleDeploy(error: unknown, store: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(), reload: () => void = () => location.reload(), now: number = Date.now()): boolean {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline || classifyFailure(error, true) !== 'chunk' || !store) return false;
  const last = store.getItem(STALE_KEY);
  if (last !== null && now - Number(last) < 60_000) return false;
  store.setItem(STALE_KEY, String(now));
  reload();
  return true;
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Page-wide: a failed preload or dynamic import outside a boundary (engine code, workers' loaders) reloads once too. */
export function installStaleDeployReload(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForStaleDeploy((e as Event & { payload?: unknown }).payload ?? new Error('Failed to fetch dynamically imported module'))) e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (reloadForStaleDeploy(e.reason)) e.preventDefault();
  });
}
