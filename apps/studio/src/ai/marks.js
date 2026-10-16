/**
 * Set-of-marks overlay for the review images: a coloured outline and a
 * numbered badge on every piece, so the model can say "item 14". The layout is
 * pure (tested); drawing uses a 2D canvas.
 */
import { dataUrlToBlob } from './quality';
import { createLogger } from '../lib/log';
const log = createLogger('marks');
/** Most marks drawn on one image (the biggest win; clutter helps nobody). */
export const MAX_DRAWN_MARKS = 40;
/** Pixel layout of the marks of an image of `width`×`height`. */
export function layoutMarks(marks, width, height) {
    const unit = Math.max(12, Math.round(Math.min(width, height) / 38));
    const kept = marks
        .filter((m) => [m.n, m.x, m.y, m.w, m.h].every(Number.isFinite) && m.n > 0)
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .slice(0, MAX_DRAWN_MARKS);
    const out = [];
    const taken = [];
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
            if (tries % 2 === 1)
                by = Math.min(height - bh, by + bh);
        }
        taken.push({ x: bx, y: by, w: bw, h: bh });
        out.push({ n: m.n, x, y, w, h, bx, by, bw, bh, hue: (m.n * 47) % 360 });
    }
    return out;
}
/** Draw the marks onto an image data URL; returns the original on any failure. */
export async function drawMarks(dataUrl, marks) {
    if (marks.length === 0)
        return dataUrl;
    try {
        const blob = dataUrlToBlob(dataUrl);
        if (!blob)
            return dataUrl;
        const bitmap = await createImageBitmap(blob);
        try {
            const w = bitmap.width;
            const h = bitmap.height;
            const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return dataUrl;
            ctx.drawImage(bitmap, 0, 0);
            const unit = Math.max(12, Math.round(Math.min(w, h) / 38));
            ctx.lineWidth = Math.max(2, Math.round(unit / 5));
            ctx.font = `700 ${Math.round(unit * 0.95)}px system-ui, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
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
            if (canvas instanceof HTMLCanvasElement)
                return canvas.toDataURL('image/jpeg', 0.85);
            const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
            return await blobToDataUrl(out);
        }
        finally {
            bitmap.close();
        }
    }
    catch (err) {
        log.warn('could not draw review marks', err);
        return dataUrl;
    }
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(blob);
    });
}
