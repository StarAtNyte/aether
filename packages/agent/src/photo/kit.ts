/**
 * The compare kit of a round: the reference and the render from the same camera in ONE image (so differences are
 * seen side by side), zoomed crops of the same region in both, and a colour readout of those regions. The kit is
 * data for the model's eyes; nothing in it decides a round.
 */
import { hexDeltaE, sampleRegion, surfaceRegions, type RoomDescription } from '@aether/arch/photo';
import type { Raster } from './score';

export type Box = readonly [number, number, number, number];

/** A region of the picture to look at closely. */
export interface CropRegion {
  id: string;
  label: string;
  box: [number, number, number, number];
}

const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const area = (b: Box): number => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);

/** Pad a box a little (context around the piece) and keep it inside the picture. */
export function padBox(b: Box, pad = 0.04): [number, number, number, number] {
  return [clamp(Math.min(b[0], b[2]) - pad), clamp(Math.min(b[1], b[3]) - pad), clamp(Math.max(b[0], b[2]) + pad), clamp(Math.max(b[1], b[3]) + pad)];
}

/**
 * The regions worth a zoomed crop: first what failed last round (their ids), then the walls, the floor and the
 * ceiling, then the largest pieces and openings. At most `max`, no region smaller than 2% of the picture.
 */
export function cropRegions(desc: RoomDescription, opts: { max: number; priority?: ReadonlySet<string> }): CropRegion[] {
  const all: Array<CropRegion & { rank: number; a: number }> = [];
  const add = (id: string, label: string, box: Box | undefined, rank: number): void => {
    if (!box || area(box) < 0.02) return;
    all.push({ id, label, box: padBox(box), rank: opts.priority?.has(id) ? -1 : rank, a: area(box) });
  };
  for (const s of surfaceRegions(desc)) add(s.id, s.label, s.box, s.id === 'floor' || s.id === 'ceiling' ? 2 : 1);
  for (const it of desc.items) add(it.id, it.label || it.id, it.box, 3);
  for (const o of desc.openings) add(o.id, `${o.kind} ${o.id}`, o.box, 3);
  all.sort((a, b) => a.rank - b.rank || b.a - a.a);
  return all.slice(0, Math.max(0, opts.max)).map(({ id, label, box }) => ({ id, label, box }));
}

/** The colour readout of the regions in the photo and in the render: lit colour of each, and how they differ. Advisory. */
export function regionReadout(photo: Raster, render: Raster, regions: readonly CropRegion[]): string {
  const lines: string[] = [];
  for (const r of regions) {
    const a = sampleRegion(photo, r.box);
    const b = sampleRegion(render, r.box);
    if (!a || !b) continue;
    const de = hexDeltaE(a.lit, b.lit);
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    const dl = Math.round(((lum(b.lit) - lum(a.lit)) / 255) * 100);
    lines.push(`- ${r.label} (${r.id}): photo lit ${a.lit} (shadow ${a.shadow}), render lit ${b.lit}${de !== null ? `, difference ΔE ${Math.round(de)}${de < 6 ? ' (close)' : de < 15 ? ' (noticeable)' : ' (large)'}` : ''}${Math.abs(dl) >= 4 ? `, render ${dl > 0 ? 'lighter' : 'darker'} by ${Math.abs(dl)}%` : ''}`);
  }
  return lines.length === 0 ? '' : `Colour readout, photo against render at the same place (measured advice; the preview's flat light explains small differences, look at hue and relative lightness):\n${lines.join('\n')}`;
}
