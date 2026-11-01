/**
 * Advisory histogram evidence for the pictures a review shows: mean luminance and the share of near-white (washed, clipped)
 * and near-black (crushed) pixels. The model looks at the pictures and judges; these figures only support what it sees.
 */
export interface PictureStats {
  /** Mean luminance 0..255. */
  mean: number;
  /** Share of pixels over 247. */
  washed: number;
  /** Share of pixels under 8. */
  crushed: number;
}

/** Statistics of RGBA pixel data (sRGB display values). */
export function pictureStats(data: ArrayLike<number>): PictureStats | null {
  const n = Math.floor(data.length / 4);
  if (n === 0) return null;
  let sum = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * (data[i * 4] as number) + 0.7152 * (data[i * 4 + 1] as number) + 0.0722 * (data[i * 4 + 2] as number);
    sum += l;
    if (l > 247) hi++;
    if (l < 8) lo++;
  }
  return { mean: sum / n, washed: hi / n, crushed: lo / n };
}

/** Mean display luminance (0..1) a picture may have for a stated key: above `hi` it is over-lit for that key. */
const KEY_BANDS: Record<'dim' | 'moderate' | 'bright', { hi: number }> = { dim: { hi: 0.38 }, moderate: { hi: 0.58 }, bright: { hi: 0.68 } };

/** One advisory line per picture, plus what the intent line of the world says; empty when nothing was measured. */
export function lightEvidenceText(rows: ReadonlyArray<{ name: string; stats: PictureStats }>, intent: string | null, key?: 'dim' | 'moderate' | 'bright'): string {
  if (rows.length === 0) return '';
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const lines = rows.map((r) => `${r.name}: mean ${Math.round(r.stats.mean)}/255, washed (near white) ${pct(r.stats.washed)}, crushed (near black) ${pct(r.stats.crushed)}`);
  // The band of mean luminance each stated key allows (the same bands the exposure trim steers toward in packages/render).
  const band = key ? KEY_BANDS[key] : undefined;
  const flags = band
    ? rows
        .filter((r) => r.stats.mean / 255 > band.hi)
        .map((r) => `OVER-LIT for a ${key} intent: ${r.name} (mean ${Math.round(r.stats.mean)}/255, a ${key} picture reads at most about ${Math.round(band.hi * 255)}). Fix the light, not the exposure: lower the lamp and sconce intensities, the ambient fill and any bright emissive piece, and keep the screen or the focus the brightest thing.`)
    : [];
  return `Picture histograms (advisory, measured on the images above; you judge by looking; windows and lamp shades legitimately clip, a dim venue legitimately has dark corners). Lighting intent: ${intent ?? 'not stated (set one with tune_look {intent})'}.\n${lines.join('\n')}${flags.length ? `\n${flags.join('\n')}` : ''}`;
}

/** A frame with nothing in it: black from edge to edge (a capture that failed or a camera inside a solid), not a dark scene. */
export function isBlankFrame(s: PictureStats): boolean {
  return s.mean < 1.5 && s.crushed > 0.995;
}
