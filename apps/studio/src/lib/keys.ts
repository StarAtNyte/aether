/** Platform-aware keyboard shortcut labels (⌘ on Apple platforms, Ctrl elsewhere). */

/** True on macOS / iOS (shortcut labels use ⌘ and ⇧). */
export function isApplePlatform(nav: { platform?: string; userAgent?: string } | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  if (!nav) return false;
  const p = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

const APPLE = isApplePlatform();

/**
 * Format a shortcut written with portable tokens: "Mod+K" → "⌘K" (Apple) or
 * "Ctrl+K"; "Shift" → "⇧" on Apple; "Alt" → "⌥" on Apple.
 */
export function shortcut(combo: string, apple: boolean = APPLE): string {
  const parts = combo.split('+').map((p) => p.trim());
  if (apple) {
    return parts
      .map((p) => (p === 'Mod' ? '⌘' : p === 'Shift' ? '⇧' : p === 'Alt' ? '⌥' : p === 'Enter' ? '↵' : p))
      .join('');
  }
  return parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)).join('+');
}
