/** Display formatting helpers (pure). */

/** Compact count: 950 → "950", 12_400 → "12.4k", 3_200_000 → "3.2M". */
export function compactCount(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  if (a < 1_000_000) return `${trimZero((n / 1000).toFixed(a < 10_000 ? 1 : 0))}k`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

/** Number shown in numeric fields: up to `digits` decimals, no trailing zeros, no "-0". */
export function fieldNumber(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '0';
  const s = trimZero(n.toFixed(digits));
  return s === '-0' ? '0' : s;
}

/** Milliseconds with sensible precision. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Render any JSON-ish state value for the HUD. */
export function formatStateValue(v: unknown): string {
  if (v === undefined || v === null) return '–';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 39)}…` : s;
  } catch {
    return '–';
  }
}

/** Clip long text with an ellipsis. */
export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function trimZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Clip text at a word boundary, adding an ellipsis when shortened. */
export function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,:;—-]+$/, '')}…`;
}
