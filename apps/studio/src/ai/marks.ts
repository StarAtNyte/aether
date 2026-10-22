/**
 * Set-of-marks overlay for the review images: a coloured outline and a
 * numbered badge on every piece, so the model can say "item 14". The layout is
 * pure (tested); drawing uses a 2D canvas.
 */
import { dataUrlToBlob } from './quality';
import { createLogger } from '../lib/log';

const log = createLogger('marks');

/** A mark in normalised image coordinates (box centre and half size). */
export interface NormMark {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A mark placed in pixels. */
export interface PlacedMark {
  n: number;
  /** Outline rectangle. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Badge rectangle (kept inside the image). */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  hue: number;
}

/** Most marks drawn on one image (the biggest win; clutter helps nobody). */
export const MAX_DRAWN_MARKS = 40;

/** Pixel layout of the marks of an image of `width`×`height`. */
export function layoutMarks(marks: readonly NormMark[], width: number, height: number): PlacedMark[] {
  const unit = Math.max(12, Math.round(Math.min(width, height) / 38));
  const kept = marks
    .filter((m) => [m.n, m.x, m.y, m.w, m.h].every(Number.isFinite) && m.n > 0)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, MAX_DRAWN_MARKS);
  const out: PlacedMark[] = [];
  const taken: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const m of kept.sort((a, b) => a.n - b.n)) {
    const x = Math.max(0, (m.x - m.w) * width);
    const y = Math.max(0, (m.y - m.h) * height);
    const w = Math.min(width - x, m.w * 2 * width);
    const h = Math.min(height - y, m.h * 2 * height);
    const digits = String(m.n).length;
    const bw = Math.round(unit * (0.7 + 0.55 * digits));
    const bh = Math.round(unit * 1.15);
    let bx = Math.min(Math.max(0, x), width - bw);
    let by = Math.min(Math.max(0, y), height - bh);
    // Nudge the badge down-right until it does not sit on another badge.
    for (let tries = 0; tries < 8 && taken.some((t) => bx < t.x + t.w && bx + bw > t.x && by < t.y + t.h && by + bh > t.y); tries++) {
      bx = Math.min(width - bw, bx + bw);
      if (tries % 2 === 1) by = Math.min(height - bh, by + bh);
    }
    taken.push({ x: bx, y: by, w: bw, h: bh });
    out.push({ n: m.n, x, y, w, h, bx, by, bw, bh, hue: (m.n * 47) % 360 });
  }
  return out;
}

/** An advisory shape in normalised image coordinates (door arc, approach zone, walking path, blocked piece). */
export interface NormOverlay {
  kind: 'swing' | 'approach' | 'path' | 'blocked';
  closed: boolean;
  label: string;
  pts: ReadonlyArray<readonly [number, number]>;
}

const OVERLAY_STYLE: Record<NormOverlay['kind'], { stroke: string; fill: string }> = {
  swing: { stroke: '#18c24a', fill: 'rgba(24,194,74,0.22)' },
  approach: { stroke: '#f0a30a', fill: 'rgba(240,163,10,0.20)' },
  path: { stroke: '#2f7bff', fill: 'rgba(47,123,255,0)' },
  blocked: { stroke: '#ff2d2d', fill: 'rgba(255,45,45,0.30)' },
};

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function drawOverlays(ctx: Ctx, overlays: readonly NormOverlay[], w: number, h: number): void {
  for (const o of overlays) {
    if (o.pts.length < 2 || !o.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
    const st = OVERLAY_STYLE[o.kind];
    ctx.beginPath();
    o.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0] * w, p[1] * h) : ctx.lineTo(p[0] * w, p[1] * h)));
    if (o.closed) ctx.closePath();
    ctx.fillStyle = st.fill;
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = o.kind === 'path' ? 4 : 2;
    if (o.kind === 'path') ctx.setLineDash([10, 6]);
    if (o.closed) ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Draw the marks onto an image data URL; returns the original on any failure. */
export async function drawMarks(dataUrl: string, marks: readonly NormMark[], overlays: readonly NormOverlay[] = []): Promise<string> {
  if (marks.length === 0 && overlays.length === 0) return dataUrl;
  try {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return dataUrl;
    const bitmap = await createImageBitmap(blob);
    try {
      const w = bitmap.width;
      const h = bitmap.height;
      const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d') as Ctx | null;
      if (!ctx) return dataUrl;
      ctx.drawImage(bitmap, 0, 0);
      const unit = Math.max(12, Math.round(Math.min(w, h) / 38));
      ctx.lineWidth = Math.max(2, Math.round(unit / 5));
      ctx.font = `700 ${Math.round(unit * 0.95)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      drawOverlays(ctx, overlays, w, h);
      for (const p of layoutMarks(marks, w, h)) {
        ctx.strokeStyle = `hsl(${p.hue} 95% 52%)`;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = `hsl(${p.hue} 90% 38%)`;
        ctx.fillRect(p.bx, p.by, p.bw, p.bh);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.bx, p.by, p.bw, p.bh);
        ctx.lineWidth = Math.max(2, Math.round(unit / 5));
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(p.n), p.bx + p.bw / 2, p.by + p.bh / 2 + 1);
      }
      if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/jpeg', 0.85);
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      return await blobToDataUrl(out);
    } finally {
      bitmap.close();
    }
  } catch (err) {
    log.warn('could not draw review marks', err);
    return dataUrl;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (): void => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = (): void => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}
