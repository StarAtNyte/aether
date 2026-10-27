/**
 * Appearance of a region of a photo, measured from its pixels (a mask): median colour in CIELAB that ignores glare, a
 * three-colour palette, average luminance, a stripe/check/plain hint and a matte/gloss hint. Pure arithmetic on RGBA
 * rasters and 0/1 masks; no model. The numbers are evidence for a model that looks at the same photo, never a verdict.
 */
import { rgbToLab, type Lab } from './colour';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: ArrayLike<number>;
}
export interface MaskRaster {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface Swatch {
  hex: string;
  lab: [number, number, number];
  /** Share of the region's pixels, 0..1. */
  share: number;
  name: string;
}
export interface Appearance {
  /** Robust median colour (glare removed, 10 percent tails trimmed). */
  colour: Swatch;
  /** Three dominant colours, largest first. */
  palette: Swatch[];
  /** Mean relative luminance 0..1 (linear light) of the region. */
  luminance: number;
  /** stripe-h: stripes run left-right (the pattern changes down the region), stripe-v: they run up-down, check, plain. */
  pattern: { kind: 'plain' | 'stripe-h' | 'stripe-v' | 'check'; strength: number; periodPx?: number };
  /** Share of pixels that are glare (bright, nearly colourless, far above the median): a gloss hint. */
  glareShare: number;
  finish: 'matte' | 'satin' | 'glossy';
  pixels: number;
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  return lin.map((v) => {
    const c = Math.max(0, Math.min(1, v));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  }) as [number, number, number];
}

export const labHex = (L: number, a: number, b: number): string => `#${labToRgb(L, a, b).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** A plain-words colour name from CIELAB: "dark blue", "light warm grey", "dark teal". Hue bands are from the a/b angle. */
export function colourName(lab: Lab | readonly [number, number, number]): string {
  const [L, a, b] = Array.isArray(lab) ? (lab as [number, number, number]) : [(lab as Lab).L, (lab as Lab).a, (lab as Lab).b];
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const light = L < 14 ? 'very dark' : L < 35 ? 'dark' : L < 65 ? '' : L < 85 ? 'light' : 'very light';
  const pre = (s: string): string => (light ? `${light} ${s}` : s);
  if (C < 6) return L < 12 ? 'black' : L > 92 ? 'white' : pre('grey');
  // Hue bands of the CIELAB angle (sRGB red is about 36 degrees, orange 61, yellow 93, green 143, teal 185-213, blue 250-300, purple 315, magenta 333).
  const hue = h >= 348 || h < 48 ? (L > 65 ? 'pink' : 'red') : h < 80 ? 'orange' : h < 105 ? 'yellow' : h < 130 ? 'yellow-green' : h < 170 ? 'green' : h < 205 ? 'teal' : h < 250 ? 'cyan-blue' : h < 306 ? 'blue' : h < 326 ? 'purple' : 'magenta';
  const name = h >= 20 && h < 100 && L < 55 && C < 45 ? 'brown' : h >= 20 && h < 100 && C < 18 ? (L > 70 ? 'cream' : 'tan') : hue;
  const soft = C < 14 && name !== 'brown' && name !== 'cream' && name !== 'tan' ? `greyish ${name}` : name;
  return pre(soft);
}

const swatch = (lab: [number, number, number], share: number): Swatch => ({ hex: labHex(...lab), lab: lab.map((v) => Math.round(v * 10) / 10) as [number, number, number], share: Math.round(share * 1000) / 1000, name: colourName(lab) });

/** The mask's pixels (RGB, Lab, luminance), subsampled to at most `cap` pixels. Pixels with alpha 0 are skipped. */
function collect(r: Raster, m: MaskRaster, cap = 6000): { x: number[]; y: number[]; rgb: number[][]; lab: [number, number, number][]; lum: number[] } {
  const out = { x: [] as number[], y: [] as number[], rgb: [] as number[][], lab: [] as [number, number, number][], lum: [] as number[] };
  let total = 0;
  for (let i = 0; i < m.width * m.height; i++) if (m.data[i]) total++;
  const step = Math.max(1, Math.round(Math.sqrt(total / cap)));
  const sx = r.width / m.width;
  const sy = r.height / m.height;
  for (let y = 0; y < m.height; y += step) {
    for (let x = 0; x < m.width; x += step) {
      if (!m.data[y * m.width + x]) continue;
      const px = Math.min(r.width - 1, Math.floor((x + 0.5) * sx));
      const py = Math.min(r.height - 1, Math.floor((y + 0.5) * sy));
      const o = (py * r.width + px) * 4;
      if ((r.data[o + 3] as number) === 0) continue;
      const R = r.data[o] as number;
      const G = r.data[o + 1] as number;
      const B = r.data[o + 2] as number;
      const l = rgbToLab(R, G, B);
      out.x.push(x / m.width);
      out.y.push(y / m.height);
      out.rgb.push([R, G, B]);
      out.lab.push([l.L, l.a, l.b]);
      out.lum.push(l.L > 8 ? ((l.L + 16) / 116) ** 3 : l.L / 903.3);
    }
  }
  return out;
}

const sorted = (v: number[]): number[] => v.slice().sort((a, b) => a - b);
const pct = (s: number[], p: number): number => (s.length === 0 ? Number.NaN : (s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] as number));

/** Trimmed median of one channel: sort, drop `trim` of each tail, take the middle. */
function trimmedMedian(v: number[], trim: number): number {
  const s = sorted(v);
  const lo = Math.floor(s.length * trim);
  const hi = Math.ceil(s.length * (1 - trim));
  return pct(s.slice(lo, Math.max(lo + 1, hi)), 0.5);
}

/** k-means (k small) in Lab with a deterministic start (spread over lightness). Returns centres and the member counts. */
export function kmeansLab(pts: [number, number, number][], k = 3, iters = 12): { centre: [number, number, number]; n: number }[] {
  if (pts.length === 0) return [];
  const order = pts.map((_, i) => i).sort((i, j) => (pts[i] as number[])[0]! - (pts[j] as number[])[0]!);
  let c = Array.from({ length: Math.min(k, pts.length) }, (_, i) => pts[order[Math.floor(((i + 0.5) * order.length) / Math.min(k, pts.length))] as number] as [number, number, number]);
  let count = new Array(c.length).fill(0) as number[];
  for (let it = 0; it < iters; it++) {
    const sum = c.map(() => [0, 0, 0]);
    count = new Array(c.length).fill(0);
    for (const p of pts) {
      let bi = 0;
      let bd = Infinity;
      c.forEach((q, i) => {
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      (count[bi] as number); count[bi] = (count[bi] as number) + 1;
      const s = sum[bi] as number[];
      s[0] = (s[0] as number) + p[0]; s[1] = (s[1] as number) + p[1]; s[2] = (s[2] as number) + p[2];
    }
    c = c.map((q, i) => ((count[i] as number) > 0 ? ((sum[i] as number[]).map((v) => v / (count[i] as number)) as [number, number, number]) : q));
  }
  return c.map((centre, i) => ({ centre, n: count[i] as number })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
}

/**
 * Stripe / check / plain from the luminance of the region: remove the slow shading (mean of each row and column profile
 * minus its linear trend), then compare the strength and the periodicity of the row and the column profiles.
 */
export function patternHint(r: Raster, m: MaskRaster, box: readonly [number, number, number, number]): Appearance['pattern'] {
  const N = 48;
  const grid = new Float32Array(N * N);
  const cnt = new Float32Array(N * N);
  const [x0, y0, x1, y1] = box;
  const bw = Math.max(1e-6, x1 - x0);
  const bh = Math.max(1e-6, y1 - y0);
  const step = Math.max(1, Math.floor(Math.max(m.width, m.height) / 256));
  for (let y = Math.floor(y0 * m.height); y < Math.ceil(y1 * m.height); y += step) {
    for (let x = Math.floor(x0 * m.width); x < Math.ceil(x1 * m.width); x += step) {
      if (x < 0 || y < 0 || x >= m.width || y >= m.height || !m.data[y * m.width + x]) continue;
      const px = Math.min(r.width - 1, Math.floor(((x + 0.5) / m.width) * r.width));
      const py = Math.min(r.height - 1, Math.floor(((y + 0.5) / m.height) * r.height));
      const o = (py * r.width + px) * 4;
      const lum = 0.2126 * (r.data[o] as number) + 0.7152 * (r.data[o + 1] as number) + 0.0722 * (r.data[o + 2] as number);
      const gx = Math.min(N - 1, Math.floor(((x / m.width - x0) / bw) * N));
      const gy = Math.min(N - 1, Math.floor(((y / m.height - y0) / bh) * N));
      grid[gy * N + gx] = (grid[gy * N + gx] as number) + lum;
      cnt[gy * N + gx] = (cnt[gy * N + gx] as number) + 1;
    }
  }
  const prof = (axis: 'row' | 'col'): number[] => {
    const v: number[] = [];
    for (let i = 0; i < N; i++) {
      let s = 0;
      let n = 0;
      for (let j = 0; j < N; j++) {
        const k = axis === 'row' ? i * N + j : j * N + i;
        if ((cnt[k] as number) > 0) { s += (grid[k] as number) / (cnt[k] as number); n++; }
      }
      v.push(n >= N * 0.3 ? s / n : Number.NaN);
    }
    return v;
  };
  const detrend = (v: number[]): number[] => {
    const idx = v.map((x, i) => (Number.isNaN(x) ? -1 : i)).filter((i) => i >= 0);
    if (idx.length < 12) return [];
    const n = idx.length;
    const mx = idx.reduce((s, i) => s + i, 0) / n;
    const my = idx.reduce((s, i) => s + (v[i] as number), 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const i of idx) { sxy += (i - mx) * ((v[i] as number) - my); sxx += (i - mx) ** 2; }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const res = idx.map((i) => (v[i] as number) - my - slope * (i - mx));
    // remove the slow bow as well: subtract a 5-sample moving mean
    return res.map((x, i) => x - (res.slice(Math.max(0, i - 2), i + 3).reduce((s, q) => s + q, 0) / Math.min(5, res.slice(Math.max(0, i - 2), i + 3).length)));
  };
  const analyse = (p: number[]): { sd: number; period: number; periodic: number } => {
    const d = detrend(p);
    if (d.length === 0) return { sd: 0, period: 0, periodic: 0 };
    const sd = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    const var0 = d.reduce((s, x) => s + x * x, 0) || 1;
    let best = 0;
    let bp = 0;
    for (let lag = 2; lag <= Math.floor(d.length / 2); lag++) {
      let s = 0;
      for (let i = 0; i + lag < d.length; i++) s += (d[i] as number) * (d[i + lag] as number);
      const ac = s / var0;
      if (ac > best) { best = ac; bp = lag; }
    }
    return { sd, period: bp, periodic: best };
  };
  const rows = analyse(prof('row'));
  const cols = analyse(prof('col'));
  // Check: what is left after removing the row and column means still repeats along a row (averaging a check away hides it from the profiles).
  const resid = ((): { sd: number; periodic: number; period: number } => {
    const mean = (k: number[]): number => k.reduce((q, v) => q + v, 0) / Math.max(1, k.length);
    const cellv = (i: number, j: number): number => ((cnt[i * N + j] as number) > 0 ? (grid[i * N + j] as number) / (cnt[i * N + j] as number) : Number.NaN);
    const rm: number[] = [];
    const cm: number[] = [];
    for (let i = 0; i < N; i++) rm.push(mean(Array.from({ length: N }, (_, j) => cellv(i, j)).filter((v) => !Number.isNaN(v))));
    for (let j = 0; j < N; j++) cm.push(mean(Array.from({ length: N }, (_, i) => cellv(i, j)).filter((v) => !Number.isNaN(v))));
    const all = mean(rm.filter((v) => !Number.isNaN(v)));
    let ss = 0;
    let n = 0;
    const lagAc: number[] = new Array(Math.floor(N / 2) + 1).fill(0) as number[];
    for (let i = 0; i < N; i++) {
      const row = Array.from({ length: N }, (_, j) => { const v = cellv(i, j); return Number.isNaN(v) ? Number.NaN : v - (rm[i] as number) - (cm[j] as number) + all; });
      for (let j = 0; j < N; j++) if (!Number.isNaN(row[j] as number)) { ss += (row[j] as number) ** 2; n++; }
      for (let lag = 2; lag < lagAc.length; lag++) for (let j = 0; j + lag < N; j++) if (!Number.isNaN(row[j] as number) && !Number.isNaN(row[j + lag] as number)) lagAc[lag] = (lagAc[lag] as number) + (row[j] as number) * (row[j + lag] as number);
    }
    let best = 0;
    let bp = 0;
    for (let lag = 2; lag < lagAc.length; lag++) if ((lagAc[lag] as number) / (ss || 1) > best) { best = (lagAc[lag] as number) / (ss || 1); bp = lag; }
    return { sd: n > 0 ? Math.sqrt(ss / n) : 0, periodic: best, period: bp };
  })();
  const strongR = rows.sd > 3 && rows.periodic > 0.35;
  const strongC = cols.sd > 3 && cols.periodic > 0.35;
  const strength = Math.round(Math.max(rows.sd, cols.sd) * 10) / 10;
  // luminance changes down the region (rows differ) = stripes that run left-right.
  if (!strongR && !strongC && resid.sd > 3 && resid.periodic > 0.3) return { kind: 'check', strength: Math.round(resid.sd * 10) / 10, periodPx: Math.round((resid.period / N) * bw * m.width) };
  if (strongR && strongC) return { kind: 'check', strength, periodPx: Math.round((rows.period / N) * bh * m.height) };
  if (strongR) return { kind: 'stripe-h', strength, periodPx: Math.round((rows.period / N) * bh * m.height) };
  if (strongC) return { kind: 'stripe-v', strength, periodPx: Math.round((cols.period / N) * bw * m.width) };
  return { kind: 'plain', strength };
}

/** Everything measured for a region. `box` is the mask's bounding box in 0..1 (used for the pattern grid). Null when the region has too few pixels. */
export function measureAppearance(r: Raster, m: MaskRaster, box: readonly [number, number, number, number]): Appearance | null {
  const p = collect(r, m);
  if (p.lab.length < 12) return null;
  const Ls = sorted(p.lab.map((l) => l[0]));
  const medL = pct(Ls, 0.5);
  const p95 = pct(Ls, 0.95);
  // Glare: far above the median lightness and almost colourless (a highlight, a window reflection), or blown out.
  const isGlare = (l: [number, number, number]): boolean => (l[0] > medL + 22 && Math.hypot(l[1], l[2]) < 12) || l[0] > 97;
  const keep = p.lab.filter((l) => !isGlare(l) && l[0] <= Math.max(p95, medL + 30));
  const base = keep.length >= 12 ? keep : p.lab;
  const colour = swatch([trimmedMedian(base.map((l) => l[0]), 0.1), trimmedMedian(base.map((l) => l[1]), 0.1), trimmedMedian(base.map((l) => l[2]), 0.1)], 1);
  const km = kmeansLab(base, 3);
  const tot = km.reduce((s, c) => s + c.n, 0) || 1;
  const palette = km.map((c) => swatch(c.centre, c.n / tot));
  const glareShare = p.lab.filter(isGlare).length / p.lab.length;
  const lumMean = p.lum.reduce((s, v) => s + v, 0) / p.lum.length;
  return {
    colour,
    palette,
    luminance: Math.round(lumMean * 1000) / 1000,
    pattern: patternHint(r, m, box),
    glareShare: Math.round(glareShare * 1000) / 1000,
    finish: glareShare > 0.12 ? 'glossy' : glareShare > 0.04 ? 'satin' : 'matte',
    pixels: p.lab.length,
  };
}
