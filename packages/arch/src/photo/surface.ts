/**
 * Colours of the photograph's surfaces, sampled from its pixels.
 *
 * A vision model names colours roughly ("a purple-grey wall"); the pixels know better. This module reads a region of the picture
 * (the box the description gives for a wall, the floor, the ceiling, a piece) and reports the colour the surface shows in its
 * well-lit part, its shadow colour and mean, then the nearest finishes of the library with the tint to give them (`finish-match.ts`).
 * The AI compares the numbers with what it described and chooses; nothing here edits the room.
 *
 * Pure functions on RGBA rasters (any decoder), bounded work, deterministic.
 */
import { nearestFinishes, type FinishMatch, type FinishSurface } from '../finish-match';
import { hexDeltaE } from './colour';
import type { RoomDescription } from './description';
import { wallFinishOf } from './derive';

/** An RGBA image (row-major, top row first); structurally the host's decoded raster. */
export interface RasterLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** [x0, y0, x1, y1] in 0..1 of the image. */
export type Region = readonly [number, number, number, number];

/** The colours of one region. */
export interface RegionColours {
  /** The colour of the well-lit part (60th to 90th percentile of luminance): what a paint tin would match. */
  lit: string;
  /** The mean colour. */
  mean: string;
  /** The colour of the shaded part (5th to 25th percentile). */
  shadow: string;
  /** Pixels read. */
  pixels: number;
}

const MAX_SAMPLES = 6000;

const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Whether `r` is a usable raster (positive integer size, enough data). */
function usable(r: RasterLike): boolean {
  return Number.isInteger(r.width) && Number.isInteger(r.height) && r.width > 0 && r.height > 0 && r.width * r.height <= 4_000_000 && r.data.length >= r.width * r.height * 4;
}

/** The colours inside a region of the picture (null for an empty or malformed region). */
export function sampleRegion(r: RasterLike, box: Region): RegionColours | null {
  if (!usable(r)) return null;
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  const x0 = Math.floor(clamp(Math.min(box[0], box[2])) * r.width);
  const x1 = Math.max(x0 + 1, Math.ceil(clamp(Math.max(box[0], box[2])) * r.width));
  const y0 = Math.floor(clamp(Math.min(box[1], box[3])) * r.height);
  const y1 = Math.max(y0 + 1, Math.ceil(clamp(Math.max(box[1], box[3])) * r.height));
  const area = (x1 - x0) * (y1 - y0);
  const stride = Math.max(1, Math.ceil(Math.sqrt(area / MAX_SAMPLES)));
  const px: Array<[number, number, number, number]> = [];
  for (let y = y0; y < Math.min(y1, r.height); y += stride) {
    for (let x = x0; x < Math.min(x1, r.width); x += stride) {
      const i = (y * r.width + x) * 4;
      const R = r.data[i] as number;
      const G = r.data[i + 1] as number;
      const B = r.data[i + 2] as number;
      px.push([lum(R, G, B), R, G, B]);
    }
  }
  if (px.length < 4) return null;
  px.sort((a, b) => a[0] - b[0]);
  const band = (lo: number, hi: number): [number, number, number] => {
    const a = Math.floor(px.length * lo);
    const b = Math.max(a + 1, Math.ceil(px.length * hi));
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let k = a; k < b; k++) {
      const p = px[k] as [number, number, number, number];
      sr += p[1];
      sg += p[2];
      sb += p[3];
    }
    const n = b - a;
    return [sr / n, sg / n, sb / n];
  };
  const lit = band(0.6, 0.9);
  const mean = band(0, 1);
  const shadow = band(0.05, 0.25);
  return { lit: hex(...lit), mean: hex(...mean), shadow: hex(...shadow), pixels: px.length };
}

/** One sampled surface with what the description says about it. */
export interface SurfaceSample {
  /** `wall-north`, `floor`, `ceiling`, or a piece id. */
  id: string;
  label: string;
  box: Region;
  colours: RegionColours;
  /** The colour the description gives this surface, and its distance to the lit colour (CIEDE2000). */
  described?: string;
  deltaE?: number;
  /** The finish the description names (walls). */
  describedFinish?: string;
  /** Nearest library finishes for the lit colour. */
  finishes: FinishMatch[];
}

/** The photo regions of a description's surfaces: each visible wall, the floor, the ceiling (the boxes the model gave). */
export function surfaceRegions(d: RoomDescription): Array<{ id: string; label: string; box: Region; surface: FinishSurface; described?: string; hint: string; finish?: string }> {
  const out: Array<{ id: string; label: string; box: Region; surface: FinishSurface; described?: string; hint: string; finish?: string }> = [];
  for (const w of ['north', 'east', 'south', 'west'] as const) {
    const f = d.walls[w];
    if (f?.box && f.visible !== false) out.push({ id: `wall-${w}`, label: `${w} wall`, box: f.box, surface: 'wall', ...(f.color ? { described: f.color } : {}), hint: `${f.finish ?? ''} ${f.material ?? ''}`, finish: wallFinishOf(f) });
  }
  if (d.floor.box) out.push({ id: 'floor', label: 'floor', box: d.floor.box, surface: 'floor', ...(d.floor.color ? { described: d.floor.color } : {}), hint: `${d.floor.finish ?? ''} ${d.floor.material} ${d.floor.note}`, finish: d.floor.finish ?? d.floor.material });
  if (d.ceiling.box) out.push({ id: 'ceiling', label: 'ceiling', box: d.ceiling.box, surface: 'ceiling', ...(d.ceiling.color ? { described: d.ceiling.color } : {}), hint: 'paint' });
  return out;
}

/** Sample every surface region of a description from the photo. */
export function sampleSurfaces(r: RasterLike, d: RoomDescription): SurfaceSample[] {
  const out: SurfaceSample[] = [];
  for (const s of surfaceRegions(d)) {
    const colours = sampleRegion(r, s.box);
    if (!colours) continue;
    const de = s.described ? hexDeltaE(s.described, colours.lit) : null;
    out.push({
      id: s.id,
      label: s.label,
      box: s.box,
      colours,
      ...(s.described ? { described: s.described } : {}),
      ...(de !== null ? { deltaE: Math.round(de * 10) / 10 } : {}),
      ...(s.finish ? { describedFinish: s.finish } : {}),
      finishes: nearestFinishes(colours.lit, { surface: s.surface, hint: s.hint, limit: 3 }),
    });
  }
  return out;
}

/** The samples as text for the model (what the pixels show, what was described, the nearest finishes). */
export function surfaceColourText(samples: readonly SurfaceSample[]): string {
  if (samples.length === 0) return '';
  return [
    'Colours sampled from the photo (lit part of each region; the pixels, not a guess; compare with what you described and fix the surfaces that differ with design_plan walls/floor/finish colours):',
    ...samples.map((s) => {
      const cmp = s.described ? `; described ${s.described}${s.deltaE !== undefined ? ` (ΔE ${Math.round(s.deltaE)}${s.deltaE > 8 ? ': off' : ': close'})` : ''}` : '';
      const fin = s.finishes[0] ? `; nearest ${s.finishes[0].tintable ? `${s.finishes[0].finish} tinted ${s.finishes[0].tint}` : s.finishes[0].tint ? `${s.finishes[0].finish} tinted ${s.finishes[0].tint}` : s.finishes[0].finish}` : '';
      return `- ${s.label}: lit ${s.colours.lit}, mean ${s.colours.mean}, shadow ${s.colours.shadow}${cmp}${s.describedFinish ? `; described finish ${s.describedFinish}` : ''}${fin}`;
    }),
  ].join('\n');
}
