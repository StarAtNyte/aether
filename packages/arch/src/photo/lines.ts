/**
 * Line segments from a photo (an LSD-style detector, simplified): gradient orientation field, region growing over pixels whose
 * gradient directions agree, a rectangle (principal axis) per region, and a length and straightness filter. Pure arithmetic on an
 * RGBA raster, no model. Feeds the vanishing-point solve (manhattan.ts): a room is made of lines along three perpendicular
 * directions, and where they converge gives the camera's field of view and tilt.
 */
import type { Raster } from './appearance';

export interface Segment {
  /** End points in pixels of the raster the detector ran on (x right, y down). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  /** Mean gradient magnitude along the segment (a contrast weight). */
  contrast: number;
}

function gray(r: Raster, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * r.height) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * r.height) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * r.width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * r.width) / w));
      let s = 0;
      let n = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const o = (yy * r.width + xx) * 4;
        s += 0.299 * (r.data[o] as number) + 0.587 * (r.data[o + 1] as number) + 0.114 * (r.data[o + 2] as number);
        n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function blur(src: Float32Array, w: number, h: number): Float32Array {
  const k = [0.0625, 0.25, 0.375, 0.25, 0.0625];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -2; i <= 2; i++) s += (k[i + 2] as number) * (src[y * w + Math.min(w - 1, Math.max(0, x + i))] as number);
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -2; i <= 2; i++) s += (k[i + 2] as number) * (tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] as number);
    out[y * w + x] = s;
  }
  return out;
}

/** Detect straight segments of at least `minLength` pixels on a raster resampled to `width` pixels wide (default 640). */
export function detectSegments(r: Raster, opt: { width?: number; minLength?: number; angleTolDeg?: number; maskOut?: ArrayLike<number> } = {}): { segments: Segment[]; width: number; height: number } {
  const w = Math.min(opt.width ?? 640, r.width);
  const h = Math.max(16, Math.round((r.height * w) / r.width));
  const minLen = opt.minLength ?? Math.max(18, w * 0.04);
  const tol = ((opt.angleTolDeg ?? 20) * Math.PI) / 180;
  const g = blur(gray(r, w, h), w, h);
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (g[i + 1] as number) - (g[i - 1] as number) + 0.5 * ((g[i - w + 1] as number) - (g[i - w - 1] as number) + (g[i + w + 1] as number) - (g[i + w - 1] as number));
    const gy = (g[i + w] as number) - (g[i - w] as number) + 0.5 * ((g[i + w + 1] as number) - (g[i - w + 1] as number) + (g[i + w - 1] as number) - (g[i - w - 1] as number));
    mag[i] = Math.hypot(gx, gy);
    ang[i] = Math.atan2(gy, gx); // gradient direction; the line runs perpendicular to it
  }
  // Threshold from the magnitude distribution (a quantile), never below a floor that is noise at 8 bit.
  const sorted = Float32Array.from(mag).sort();
  const thr = Math.max(8, (sorted[Math.floor(sorted.length * 0.8)] as number) * 1.0);
  const used = new Uint8Array(w * h);
  const order: number[] = [];
  for (let i = 0; i < w * h; i++) if ((mag[i] as number) > thr) order.push(i);
  order.sort((a, b) => (mag[b] as number) - (mag[a] as number));
  const masked = (i: number): boolean => !!opt.maskOut && opt.maskOut.length === w * h && !!opt.maskOut[i];
  const segs: Segment[] = [];
  const angDiff = (a: number, b: number): number => {
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  };
  for (const seed of order) {
    if (used[seed] || masked(seed)) continue;
    const region: number[] = [seed];
    used[seed] = 1;
    let sx = Math.cos(ang[seed] as number);
    let sy = Math.sin(ang[seed] as number);
    let theta = ang[seed] as number;
    for (let k = 0; k < region.length; k++) {
      const p = region[k] as number;
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const q = ny * w + nx;
        if (used[q] || (mag[q] as number) <= thr || masked(q)) continue;
        if (angDiff(ang[q] as number, theta) > tol) continue;
        used[q] = 1;
        region.push(q);
        sx += Math.cos(ang[q] as number);
        sy += Math.sin(ang[q] as number);
        theta = Math.atan2(sy, sx);
      }
    }
    if (region.length < minLen * 0.8) continue;
    // principal axis of the region, weighted by magnitude
    let wsum = 0, mx = 0, my = 0;
    for (const p of region) { const m = mag[p] as number; wsum += m; mx += m * (p % w); my += m * Math.floor(p / w); }
    mx /= wsum; my /= wsum;
    let cxx = 0, cyy = 0, cxy = 0;
    for (const p of region) { const m = mag[p] as number; const dx = (p % w) - mx; const dy = Math.floor(p / w) - my; cxx += m * dx * dx; cyy += m * dy * dy; cxy += m * dx * dy; }
    const phi = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(phi), uy = Math.sin(phi);
    let tmin = Infinity, tmax = -Infinity, wmax = 0;
    for (const p of region) {
      const dx = (p % w) - mx, dy = Math.floor(p / w) - my;
      const t = dx * ux + dy * uy;
      const s = Math.abs(-dx * uy + dy * ux);
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
      if (s > wmax) wmax = s;
    }
    const len = tmax - tmin;
    if (len < minLen || wmax * 2 + 1 > len / 4) continue; // thin and long only
    segs.push({ x1: mx + tmin * ux, y1: my + tmin * uy, x2: mx + tmax * ux, y2: my + tmax * uy, length: len, contrast: wsum / region.length });
  }
  return { segments: segs, width: w, height: h };
}
