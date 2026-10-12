/**
 * Keyboard key normalization so rules can say "e", "space" or "ArrowUp" and
 * hosts can report either `KeyboardEvent.key` or `KeyboardEvent.code`.
 */

const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  shiftleft: 'shift',
  shiftright: 'shift',
  controlleft: 'control',
  controlright: 'control',
  ctrl: 'control',
  altleft: 'alt',
  altright: 'alt',
});

/** Normalize a key name: lower-case, "KeyE" → "e", "Digit1" → "1", aliases ("Space", " ") → "space". */
export function normalizeKey(key: string): string {
  if (key === ' ') return 'space';
  const k = key.trim().toLowerCase();
  if (k.length === 4 && k.startsWith('key')) return k.slice(3);
  if (k.length === 6 && k.startsWith('digit')) return k.slice(5);
  if (k.length === 7 && k.startsWith('numpad') && k[6] !== undefined && k[6] >= '0' && k[6] <= '9') return k.slice(6);
  return Object.prototype.hasOwnProperty.call(ALIASES, k) ? (ALIASES[k] as string) : k;
}

/** Tracks held keys between ticks and yields the keys that went down this tick. */
export class KeyEdges {
  private held = new Set<string>();
  private next = new Set<string>();
  /** Keys pressed this tick (normalized). Reused between ticks. */
  readonly pressed = new Set<string>();

  /** Update from the raw held-key set of this tick. */
  update(keys: ReadonlySet<string>): void {
    this.pressed.clear();
    this.next.clear();
    let n = 0;
    for (const raw of keys) {
      if (++n > 64) break; // bound work on hostile input
      if (typeof raw !== 'string' || raw.length === 0 || raw.length > 32) continue;
      const k = normalizeKey(raw);
      this.next.add(k);
      if (!this.held.has(k)) this.pressed.add(k);
    }
    const t = this.held;
    this.held = this.next;
    this.next = t;
  }

  /** Forget held keys (e.g. after a reset). */
  clear(): void {
    this.held.clear();
    this.next.clear();
    this.pressed.clear();
  }
}
