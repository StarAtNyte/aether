/**
 * Responsive layout helpers. Must stay in sync with the compact breakpoint
 * in styles/app.css (`@media (max-width: 860px)`).
 */

/** Media query of the compact (phone / narrow tablet) layout. */
export const COMPACT_QUERY = '(max-width: 860px)';

/** True when the compact layout is active (false outside a browser). */
export function isCompactLayout(match: ((query: string) => boolean) | null = defaultMatch()): boolean {
  if (!match) return false;
  try {
    return match(COMPACT_QUERY);
  } catch {
    return false;
  }
}

/**
 * Initial panel visibility: on compact screens the inspector starts closed
 * (it opens as a bottom sheet over the chat), elsewhere both panels are open.
 */
export function initialPanels(match: ((query: string) => boolean) | null = defaultMatch()): { left: boolean; right: boolean } {
  return { left: true, right: !isCompactLayout(match) };
}

function defaultMatch(): ((query: string) => boolean) | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return (q) => window.matchMedia(q).matches;
}
