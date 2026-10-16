/**
 * Control hints for touch screens. A world's title card lists keyboard controls ("WASD — move", "R — restart",
 * "Esc — editor"); on a phone those mean nothing, so each line is translated to the on-screen control that does the
 * same thing, or dropped when touch has no equivalent (the card's own buttons and the game-over card cover restart
 * and leaving).
 */

/** At most this many hints are shown. */
const MAX_HINTS = 5;

/** "WASD — move" → ["WASD", "move"]; null when the line has no key/description split. */
function split(line: string): [string, string] | null {
  const m = /^\s*(.{1,24}?)\s*(?:—|–|:| - )\s*(.+?)\s*$/.exec(line);
  if (m) return [m[1] as string, m[2] as string];
  const t = /^\s*(WASD|Shift|Space|Esc|[A-Z0-9])\s+to\s+(.+?)\s*$/i.exec(line);
  return t ? [t[1] as string, t[2] as string] : null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The touch version of one control line, or null when it does not apply on a touch screen. */
export function touchHint(line: string): string | null {
  const parts = split(line);
  if (!parts) return /\b(?:key|keys|keyboard|wasd|esc|mouse)\b/i.test(line) ? null : line.trim() || null;
  const [key, what] = parts;
  const k = key.toLowerCase();
  if (/^(?:wasd|arrow keys?|arrows|w ?\/ ?s|a ?\/ ?d|w|a|s|d|w ?\/ ?a ?\/ ?s ?\/ ?d)$/.test(k)) return /steer/i.test(what) ? 'Left stick — steer' : `Left stick — ${what}`;
  if (k === 'space') return /jump|bound|hop|leap/i.test(what) ? 'Jump button — jump' : /start/i.test(what) ? 'Tap — start' : `Jump button — ${what}`;
  if (k === 'e' || k === 'f') return `Hand button — ${what}`;
  if (/^(?:drag|swipe)$/.test(k)) return `Drag — ${what}`;
  if (/^(?:click|tap|left click)$/.test(k)) return `Tap — ${what}`;
  if (/^(?:scroll|mouse wheel|wheel)$/.test(k)) return `Pinch — ${what}`;
  if (/^(?:mouse|move mouse|look)$/.test(k)) return `Drag — ${what}`;
  // Escape, restart, number rows, right click, shift, tab …: no touch equivalent.
  return null;
}

/** Touch hints for a world's control lines (deduplicated, capped). A world with none gets the standard three. */
export function touchHints(controls: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of controls) {
    const hint = touchHint(line);
    if (hint && !out.includes(hint)) out.push(hint);
  }
  if (out.length === 0) return [...STANDARD_TOUCH_HINTS];
  return out.slice(0, MAX_HINTS).map(cap);
}

/** The standard touch hints. */
export const STANDARD_TOUCH_HINTS: readonly string[] = ['Left stick — move', 'Jump button — jump', 'Hand button — use'];

/** True on a touch screen (coarse primary pointer). Safe where `matchMedia` is missing. */
export function isTouchScreen(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** A one-line controls text (" · " separated, as published games carry it) for touch screens. */
export function touchControlsLine(text: string): string {
  const pieces = text.split(' · ').map((p) => p.trim()).filter(Boolean);
  const hints = pieces.some((p) => /[—–]/.test(p)) ? touchHints(pieces) : [...STANDARD_TOUCH_HINTS];
  return hints.join(' · ');
}
