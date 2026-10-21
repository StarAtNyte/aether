/**
 * From a colour to a material of the finish library: the nearest PBR finishes for a sampled colour, each with the tint to
 * give it. A tintable finish (paint, plaster, wallpaper, fabric, tile …) takes the colour exactly; a natural one (oak, brick,
 * marble, stone …) carries its own colour, so it only matches when that colour is close, and a tint only moves it a little.
 *
 * Deterministic and pure: the AI reads the answer (`query_scene {q:"finishes"}`, `sample_photo`) and picks.
 */
import type { MaterialFinish } from '@aether/core';
import { FINISHES } from './finishes';
import { hexDeltaE, parseHex } from './photo/colour';

/** What the finish is for. */
export type FinishSurface = 'wall' | 'floor' | 'ceiling' | 'any';

const WALL: readonly MaterialFinish[] = [
  'paint', 'plaster', 'wallpaper', 'wallpaper-stripe', 'wallpaper-floral', 'wallpaper-damask', 'wallpaper-geometric', 'panelling', 'wood-slats',
  'brick', 'tile', 'subway-tile', 'stone', 'limestone', 'concrete', 'cladding', 'fabric', 'velvet', 'leather', 'marble', 'ceramic',
];
const FLOOR: readonly MaterialFinish[] = ['oak', 'walnut', 'ash', 'herringbone', 'marble', 'terrazzo', 'concrete', 'tile', 'stone', 'limestone', 'carpet', 'cobble', 'decking'];
const CEILING: readonly MaterialFinish[] = ['paint', 'plaster'];

const WORDS: ReadonlyArray<readonly [RegExp, MaterialFinish]> = [
  [/stripe/, 'wallpaper-stripe'],
  [/floral|flower/, 'wallpaper-floral'],
  [/damask/, 'wallpaper-damask'],
  [/geometric/, 'wallpaper-geometric'],
  [/wallpaper/, 'wallpaper'],
  [/panel|wainscot|shaker/, 'panelling'],
  [/slat/, 'wood-slats'],
  [/subway/, 'subway-tile'],
  [/herringbone|parquet|chevron/, 'herringbone'],
  [/walnut|dark wood|espresso/, 'walnut'],
  [/oak|pine|wood|timber|plank|laminate/, 'oak'],
  [/ash|birch|maple|pale wood/, 'ash'],
  [/carpet|rug/, 'carpet'],
  [/marble/, 'marble'],
  [/terrazzo/, 'terrazzo'],
  [/brick/, 'brick'],
  [/concrete|cement/, 'concrete'],
  [/limestone/, 'limestone'],
  [/stone|slate|granite/, 'stone'],
  [/tile/, 'tile'],
  [/velvet/, 'velvet'],
  [/leather/, 'leather'],
  [/fabric|linen|upholster/, 'fabric'],
  [/plaster|render/, 'plaster'],
  [/paint|emulsion/, 'paint'],
];

/** One candidate: a finish, the colour to give it, and how far it stays from the sampled colour. */
export interface FinishMatch {
  finish: MaterialFinish;
  /** The finish takes its colour from `color` (paints, papers, fabrics). */
  tintable: boolean;
  /** The finish's own base colour. */
  base: string;
  /** CIEDE2000 between the sampled colour and what this finish shows (0 for a tintable finish). */
  deltaE: number;
  /** The `color` to set (always for a tintable finish; for a natural one only when the base is not close enough). */
  tint?: string;
  /** One line for the reader. */
  note: string;
}

/** The finish a free-text hint names ("striped wallpaper", "dark walnut floor"), if any. */
export function finishFromWords(text: string): MaterialFinish | undefined {
  const t = text.toLowerCase();
  for (const [re, f] of WORDS) if (re.test(t)) return f;
  return undefined;
}

/**
 * The nearest finishes for a colour, best first. Order: the finish the hint names; natural finishes whose own colour is within
 * ΔE 10 (no tint needed); tintable finishes tinted exactly; natural finishes that need a tint to get there.
 */
export function nearestFinishes(hex: string, opts: { surface?: FinishSurface; hint?: string; limit?: number } = {}): FinishMatch[] {
  const target = parseHex(hex) ? hex.toLowerCase() : null;
  if (!target) return [];
  const surface = opts.surface ?? 'any';
  const pool: readonly MaterialFinish[] = surface === 'wall' ? WALL : surface === 'floor' ? FLOOR : surface === 'ceiling' ? CEILING : [...new Set([...WALL, ...FLOOR])];
  const hinted = opts.hint ? finishFromWords(opts.hint) : undefined;
  const list: Array<FinishMatch & { rank: number }> = [];
  for (const finish of pool) {
    const def = FINISHES[finish];
    const de = hexDeltaE(target, def.color) ?? 99;
    if (def.tintable) {
      list.push({ finish, tintable: true, base: def.color, deltaE: 0, tint: target, note: `${finish} tinted ${target} (shows the colour exactly; ${def.pattern} texture)`, rank: finish === hinted ? 0 : 2 });
    } else if (de <= 10) {
      list.push({ finish, tintable: false, base: def.color, deltaE: Math.round(de * 10) / 10, note: `${finish} as it is (its own colour ${def.color} is ΔE ${Math.round(de)} from ${target})`, rank: finish === hinted ? 0 : 1 });
    } else {
      list.push({ finish, tintable: false, base: def.color, deltaE: Math.round(de * 10) / 10, tint: target, note: `${finish} tinted ${target} (its own colour ${def.color} is ΔE ${Math.round(de)} away; a tint only approximates)`, rank: finish === hinted ? 0 : 3 });
    }
  }
  list.sort((a, b) => a.rank - b.rank || a.deltaE - b.deltaE || (surface === 'wall' ? WALL.indexOf(a.finish) - WALL.indexOf(b.finish) : 0));
  return list.slice(0, Math.max(1, Math.min(10, opts.limit ?? 4))).map(({ rank: _rank, ...m }) => m);
}

/** The matches as text lines. */
export function finishMatchText(hex: string, matches: readonly FinishMatch[]): string {
  return matches.length === 0 ? `${hex} is not a colour (#rrggbb).` : [`Nearest finishes for ${hex}:`, ...matches.map((m) => `- ${m.note}`)].join('\n');
}
