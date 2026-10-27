/**
 * Colour guard for the studio chrome (`npm run check:ui-colour`):
 *  1. WCAG AA contrast of the token pairs, light and dark;
 *  2. no blue (or purple) hue left in the studio stylesheets, tokens included.
 * Tokens are OKLCH in `apps/studio/src/styles/tokens.css`; this script reads them, so there is one source of truth.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STYLES = 'apps/studio/src/styles';
const css = readFileSync(join(STYLES, 'tokens.css'), 'utf8');

type Rgba = [number, number, number, number];

function oklchToRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
  return lin.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

function parse(v: string): Rgba | null {
  const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/.exec(v);
  if (!m) return null;
  const [r, g, b] = oklchToRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
  return [r, g, b, m[4] === undefined ? 1 : Number(m[4])];
}

function block(sel: string): Map<string, string> {
  const start = css.indexOf(sel);
  const end = css.indexOf('\n}', start);
  const map = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
}

const lum = (c: Rgba): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (fg: Rgba, bg: Rgba): Rgba => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
const ratio = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground token, background token, minimum ratio, what]. 4.5 text, 3 UI component. */
const PAIRS: ReadonlyArray<readonly [string, string, number, string]> = [
  ['text', 'bg', 4.5, 'body text'],
  ['text', 'surface', 4.5, 'text on panels'],
  ['text-2', 'surface', 4.5, 'secondary text'],
  ['text-2', 'surface-3', 4.5, 'secondary text on hover fill'],
  ['text-3', 'surface', 4.5, 'tertiary text'],
  ['text-3', 'bg', 4.5, 'tertiary text on page'],
  ['on-accent', 'accent', 4.5, 'primary button label'],
  ['on-accent', 'accent-hover', 4.5, 'primary button label, hover'],
  ['accent-text', 'surface', 4.5, 'selected label'],
  ['focus-ring', 'surface', 3, 'focus ring on panel'],
  ['focus-ring', 'bg', 3, 'focus ring on page'],
  ['accent', 'surface', 3, 'slider fill, checked switch'],
  ['border-strong', 'surface', 1.4, 'hairline (decorative)'],
  ['success-text', 'surface', 4.5, 'success text'],
  ['danger-text', 'surface', 4.5, 'danger text'],
  ['warning-text', 'surface', 4.5, 'warning text'],
  ['tooltip-text', 'tooltip-bg', 4.5, 'tooltip'],
];

let failed = 0;
const light = block(':root {');
const dark = new Map([...light, ...block(":root[data-theme='dark']")]);
for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
  for (const [fg, bg, min, what] of PAIRS) {
    const f = parse(tokens.get(fg) ?? '');
    const b = parse(tokens.get(bg) ?? '');
    if (!f || !b) { console.log(`MISSING ${name}: ${fg} / ${bg}`); failed++; continue; }
    const base = parse(tokens.get('surface') ?? '') as Rgba;
    const r = ratio(mix(f, mix(b, base)), mix(b, base));
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${r.toFixed(2).padStart(5)} >= ${min}  ${what} (${fg} on ${bg})`);
  }
}

// No blue/purple hues: OKLCH hue 195..335 with real chroma, hex/rgb blues, in any studio stylesheet.
const files = [...readdirSync(STYLES).filter((f) => f.endsWith('.css')).map((f) => join(STYLES, f)), 'apps/studio/src/player/player.css', 'apps/studio/public/loading.css'];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/oklch\(\s*[\d.]+%\s+([\d.]+)\s+([\d.]+)/g)) {
      if (Number(m[1]) > 0.025 && Number(m[2]) >= 195 && Number(m[2]) <= 335) { console.log(`BLUE ${file}:${i + 1} ${m[0]}`); failed++; }
    }
    for (const m of line.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
      const [r, g, b] = [0, 2, 4].map((o) => parseInt(m[1]!.slice(o, o + 2), 16));
      if (b! > r! + 24 && b! >= g!) { console.log(`BLUE ${file}:${i + 1} #${m[1]}`); failed++; }
    }
  });
}
console.log(failed === 0 ? 'ui colour: ok' : `ui colour: ${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
