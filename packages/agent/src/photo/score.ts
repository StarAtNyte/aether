/**
 * Cheap objective similarity between a photo and a render, used next to the vision model's item-by-item
 * judgement so a round that makes things worse can be rolled back.
 *
 * Both images are reduced to the same small grid. Three measures, each in 0..1 (1 = alike):
 * - colour: overlap of the hue / saturation histograms and of the brightness histogram;
 * - structure: SSIM of the luminance after normalising each image's mean and spread, so the exposure and
 *   grade of the photo do not count against the render;
 * - edges: normalised cross-correlation of the Sobel edge maps (where the lines of the room are).
 *
 * Pure functions on RGBA rasters: no DOM, no model.
 */

/** An RGBA image (row-major, top row first). */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Hard cap of a raster's pixel count accepted by the scoring functions (untrusted decoders). */
export const MAX_RASTER_PIXELS = 4_000_000;

/** Whether `r` is a well-formed raster of a sane size. */
export function isRaster(r: unknown): r is Raster {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Partial<Raster>;
  return (
    Number.isInteger(x.width) &&
    Number.isInteger(x.height) &&
    (x.width as number) > 0 &&
    (x.height as number) > 0 &&
    (x.width as number) * (x.height as number) <= MAX_RASTER_PIXELS &&
    (x.data instanceof Uint8ClampedArray || x.data instanceof Uint8Array) &&
    x.data.length >= (x.width as number) * (x.height as number) * 4
  );
}

/** Grid the measures run on. */
export const SCORE_GRID = Object.freeze({ width: 96, height: 64 });

/** Area-average resample of `r` to `w`×`h` (RGB floats 0..255, row-major, 3 per pixel). */
export function resampleRgb(r: Raster, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * r.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * r.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * r.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * r.width) / w));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * r.width + xx) * 4;
          sr += r.data[i] as number;
          sg += r.data[i + 1] as number;
          sb += r.data[i + 2] as number;
          n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = sr / n;
      out[o + 1] = sg / n;
      out[o + 2] = sb / n;
    }
  }
  return out;
}

function luma(rgb: Float32Array): Float32Array {
  const n = rgb.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.2126 * (rgb[i * 3] as number) + 0.7152 * (rgb[i * 3 + 1] as number) + 0.0722 * (rgb[i * 3 + 2] as number);
  return out;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, mx === 0 ? 0 : d / mx, mx / 255];
}

const HUE_BINS = 12;
const SAT_BINS = 4;
const VAL_BINS = 12;

/** Normalised hue×saturation histogram (weighted by saturation so grey pixels do not dominate hue) and value histogram. */
function colourHistograms(rgb: Float32Array): { hs: Float32Array; v: Float32Array } {
  const hs = new Float32Array(HUE_BINS * SAT_BINS);
  const v = new Float32Array(VAL_BINS);
  const n = rgb.length / 3;
  for (let i = 0; i < n; i++) {
    const [h, s, val] = rgbToHsv(rgb[i * 3] as number, rgb[i * 3 + 1] as number, rgb[i * 3 + 2] as number);
    v[Math.min(VAL_BINS - 1, Math.floor(val * VAL_BINS))] = (v[Math.min(VAL_BINS - 1, Math.floor(val * VAL_BINS))] as number) + 1;
    if (s < 0.06 || val < 0.05) continue;
    const k = Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS)) * SAT_BINS + Math.min(SAT_BINS - 1, Math.floor(s * SAT_BINS));
    hs[k] = (hs[k] as number) + s;
  }
  normalise(hs);
  normalise(v);
  return { hs, v };
}

function normalise(a: Float32Array): void {
  let s = 0;
  for (const x of a) s += x;
  if (s > 0) for (let i = 0; i < a.length; i++) a[i] = (a[i] as number) / s;
}

function overlap(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i] as number, b[i] as number);
  return s;
}

/** Colour similarity 0..1 of two RGB grids. */
export function colourSimilarity(a: Float32Array, b: Float32Array): number {
  const ha = colourHistograms(a);
  const hb = colourHistograms(b);
  const sumA = ha.hs.reduce((s, x) => s + x, 0);
  const sumB = hb.hs.reduce((s, x) => s + x, 0);
  // Two images with (almost) no colour compare on brightness alone.
  const hue = sumA > 0 && sumB > 0 ? overlap(ha.hs, hb.hs) : sumA === 0 && sumB === 0 ? 1 : 0;
  return 0.5 * hue + 0.5 * overlap(ha.v, hb.v);
}

/** Subtract the mean and divide by the spread (flat images stay flat). */
function standardise(x: Float32Array): Float32Array {
  let m = 0;
  for (const v of x) m += v;
  m /= x.length;
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  const sd = Math.sqrt(s / x.length);
  const out = new Float32Array(x.length);
  if (sd < 1e-6) return out;
  for (let i = 0; i < x.length; i++) out[i] = ((x[i] as number) - m) / sd;
  return out;
}

/** Mean SSIM over 8×8 windows (stride 4) of two equally sized luminance grids, after standardising each. */
export function ssim(a: Float32Array, b: Float32Array, w: number, h: number): number {
  const A = standardise(a);
  const B = standardise(b);
  // Standardised values have unit variance: the constants are those of SSIM for a dynamic range of about 6.
  const c1 = 0.01 * 6 * (0.01 * 6);
  const c2 = 0.03 * 6 * (0.03 * 6);
  const win = 8;
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= h; y += 4) {
    for (let x = 0; x + win <= w; x += 4) {
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          ma += A[(y + j) * w + x + i] as number;
          mb += B[(y + j) * w + x + i] as number;
        }
      }
      ma /= win * win;
      mb /= win * win;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let j = 0; j < win; j++) {
        for (let i = 0; i < win; i++) {
          const da = (A[(y + j) * w + x + i] as number) - ma;
          const db = (B[(y + j) * w + x + i] as number) - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      const n = win * win - 1;
      va /= n;
      vb /= n;
      cov /= n;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      count++;
    }
  }
  const v = count === 0 ? 0 : total / count;
  return Math.max(0, Math.min(1, v));
}

/** Sobel gradient magnitude of a luminance grid (border pixels zero). */
export function sobel(l: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (dx: number, dy: number): number => l[(y + dy) * w + x + dx] as number;
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      out[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/** Light 3×3 box blur (edges survive a little misalignment between a photo and a render). */
function blur(x: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = i + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += x[yy * w + xx] as number;
          n++;
        }
      }
      out[y * w + i] = s / n;
    }
  }
  return out;
}

/** Normalised cross-correlation of two equally sized maps, clamped to 0..1. */
export function ncc(a: Float32Array, b: Float32Array): number {
  const A = standardise(a);
  const B = standardise(b);
  let s = 0;
  for (let i = 0; i < A.length; i++) s += (A[i] as number) * (B[i] as number);
  return Math.max(0, Math.min(1, s / A.length));
}

/** The measures of one comparison. */
export interface Similarity {
  colour: number;
  structure: number;
  edges: number;
  /** Weighted blend, 0..1. */
  overall: number;
}

/** Weights of the blend. */
export const SIMILARITY_WEIGHTS = Object.freeze({ structure: 0.4, edges: 0.35, colour: 0.25 });

/**
 * Compare a photo with a render. They should show the same view; their sizes may differ (both are resampled to
 * a grid with the photo's aspect). Returns null when either raster is malformed.
 */
export function compareImages(photo: Raster, render: Raster): Similarity | null {
  if (!isRaster(photo) || !isRaster(render)) return null;
  const aspect = photo.width / photo.height;
  const w = SCORE_GRID.width;
  const h = Math.max(24, Math.min(128, Math.round(w / aspect)));
  const a = resampleRgb(photo, w, h);
  const b = resampleRgb(render, w, h);
  const colour = colourSimilarity(a, b);
  const la = luma(a);
  const lb = luma(b);
  const structure = ssim(la, lb, w, h);
  const edges = ncc(blur(sobel(la, w, h), w, h), blur(sobel(lb, w, h), w, h));
  const overall = SIMILARITY_WEIGHTS.structure * structure + SIMILARITY_WEIGHTS.edges * edges + SIMILARITY_WEIGHTS.colour * colour;
  return { colour, structure, edges, overall };
}

/** Colour summary of a picture for the offline notice: dominant colours (median cut) and overall brightness and warmth. */
export interface Palette {
  /** Up to `n` dominant colours, #rrggbb, most common first. */
  colours: string[];
  /** Mean brightness 0..1. */
  brightness: number;
  /** Mean red minus mean blue, -1..1 (positive is warm). */
  warmth: number;
}

/** Dominant colours by median cut of the resampled picture. */
export function extractPalette(r: Raster, n = 5): Palette | null {
  if (!isRaster(r)) return null;
  const w = 48;
  const h = Math.max(16, Math.min(96, Math.round((w * r.height) / r.width)));
  const px = resampleRgb(r, w, h);
  const pts: Array<[number, number, number]> = [];
  let bright = 0;
  let warm = 0;
  for (let i = 0; i < px.length / 3; i++) {
    const p: [number, number, number] = [px[i * 3] as number, px[i * 3 + 1] as number, px[i * 3 + 2] as number];
    pts.push(p);
    bright += (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    warm += (p[0] - p[2]) / 255;
  }
  const boxes: Array<Array<[number, number, number]>> = [pts];
  while (boxes.length < Math.max(1, Math.min(8, n))) {
    // Split the box with the widest channel range at the median of that channel.
    let bi = -1;
    let bc = 0;
    let br = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of b) {
          lo = Math.min(lo, p[c] as number);
          hi = Math.max(hi, p[c] as number);
        }
        if ((hi - lo) * Math.sqrt(b.length) > br) {
          br = (hi - lo) * Math.sqrt(b.length);
          bi = i;
          bc = c;
        }
      }
    });
    if (bi < 0) break;
    const box = (boxes[bi] as Array<[number, number, number]>).slice().sort((p, q) => (p[bc] as number) - (q[bc] as number));
    const mid = Math.floor(box.length / 2);
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  const colours = boxes
    .filter((b) => b.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((b) => {
      const m = [0, 0, 0];
      for (const p of b) for (let c = 0; c < 3; c++) m[c] = (m[c] as number) + (p[c] as number);
      return `#${m.map((v) => Math.round(v / b.length).toString(16).padStart(2, '0')).join('')}`;
    });
  return { colours, brightness: bright / pts.length, warmth: warm / pts.length };
}
