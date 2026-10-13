/**
 * Responsive editor layout. Four modes by viewport width:
 *
 *  - wide   (≥ 1280): icon rail + left panel | viewport | inspector, both resizable
 *  - medium (1024–1279): one side panel at a time; the other collapses to its rail
 *  - tablet (768–1023): full-width viewport, panels as slide-over drawers
 *  - phone  (< 768): viewport on top, bottom sheet with tabs
 *
 * The CSS mirrors these breakpoints (`styles/editor.css`). Pure helpers so
 * the rules are testable without a browser.
 */

/** Editor layout mode. */
export type LayoutMode = 'wide' | 'medium' | 'tablet' | 'phone';

/** Smallest width of each mode (px). */
export const BREAKPOINTS = { medium: 1024, wide: 1280, tablet: 768 } as const;

/** Side panel width limits (px). */
export const PANEL_WIDTH = { min: 240, max: 440, left: 272, right: 304 } as const;

/** Media query of the compact (phone) layout. */
export const COMPACT_QUERY = `(max-width: ${BREAKPOINTS.tablet - 1}px)`;

/** Layout mode for a viewport width (CSS pixels). */
export function layoutModeFor(width: number): LayoutMode {
  if (!Number.isFinite(width) || width >= BREAKPOINTS.wide) return 'wide';
  if (width >= BREAKPOINTS.medium) return 'medium';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  return 'phone';
}

/** True when the phone layout is active (false outside a browser). */
export function isCompactLayout(match: ((query: string) => boolean) | null = defaultMatch()): boolean {
  if (!match) return false;
  try {
    return match(COMPACT_QUERY);
  } catch {
    return false;
  }
}

/** Initial panel visibility for a layout mode. */
export function panelsFor(mode: LayoutMode): { left: boolean; right: boolean } {
  switch (mode) {
    case 'wide':
      return { left: true, right: true };
    case 'medium':
      return { left: true, right: false };
    default:
      return { left: false, right: false };
  }
}

/**
 * Initial panel visibility from the current viewport (both open outside a
 * browser). Kept for callers that only know a media matcher.
 */
export function initialPanels(match: ((query: string) => boolean) | null = defaultMatch(), width: number | null = defaultWidth()): { left: boolean; right: boolean } {
  if (width !== null) return panelsFor(layoutModeFor(width));
  return isCompactLayout(match) ? { left: true, right: false } : { left: true, right: true };
}

/**
 * Apply a panel toggle under the rules of a layout mode: in `medium` (and
 * the drawer modes) opening one side closes the other.
 */
export function togglePanels(mode: LayoutMode, panels: { left: boolean; right: boolean }, side: 'left' | 'right'): { left: boolean; right: boolean } {
  const open = !panels[side];
  if (mode === 'wide') return { ...panels, [side]: open };
  const other = side === 'left' ? 'right' : 'left';
  return { [side]: open, [other]: open ? false : panels[other] } as { left: boolean; right: boolean };
}

/** Panels made valid for a mode (e.g. after a resize into `medium`, only one stays open). */
export function constrainPanels(mode: LayoutMode, panels: { left: boolean; right: boolean }): { left: boolean; right: boolean } {
  if (mode === 'wide') return panels;
  if (mode === 'medium') return panels.left && panels.right ? { left: true, right: false } : panels;
  return { left: false, right: false };
}

/** Clamp a stored panel width. */
export function clampPanelWidth(w: unknown, fallback: number): number {
  return typeof w === 'number' && Number.isFinite(w) ? Math.round(Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, w))) : fallback;
}

function defaultMatch(): ((query: string) => boolean) | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return (q) => window.matchMedia(q).matches;
}

function defaultWidth(): number | null {
  return typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : null;
}
