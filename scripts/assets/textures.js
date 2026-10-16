/**
 * Re-encode realistic-model textures (Poly Haven 1k JPEGs at very high
 * quality, ~0.3–1.1 MB each) to JPEG quality 0.8 at ≤ 1024 px with the
 * browser's encoder — about a third of the bytes, visually identical at
 * scene scale. Results are cached next to the sources.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { withBrowserPage } from './browser';
import { SOURCE_DIR } from './fetch';
const CACHE = join(SOURCE_DIR, 'polyhaven', 'tex-q80');
const MAX_SIDE = 1024;
const QUALITY = 0.8;
/** Cached re-encoded bytes for each source image (by basename), encoding missing ones first. */
export async function reencodedTextures(files) {
    mkdirSync(CACHE, { recursive: true });
    const missing = files.filter((f) => !existsSync(join(CACHE, basename(f))));
    if (missing.length > 0) {
        await withBrowserPage(async (page) => {
            for (const f of missing) {
                const b64 = readFileSync(f).toString('base64');
                const mime = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
                const out = await page.evaluate(async ({ b64, mime, maxSide, quality }) => {
                    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
                    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
                    const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
                    const ctx = c.getContext('2d', { colorSpace: 'srgb' });
                    if (!ctx)
                        throw new Error('no 2d context');
                    ctx.drawImage(bmp, 0, 0, c.width, c.height);
                    const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
                    const buf = new Uint8Array(await blob.arrayBuffer());
                    let bin = '';
                    for (let i = 0; i < buf.length; i += 0x8000)
                        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                    return btoa(bin);
                }, { b64, mime, maxSide: MAX_SIDE, quality: QUALITY });
                writeFileSync(join(CACHE, basename(f)), Buffer.from(out, 'base64'));
            }
        });
    }
    const map = new Map();
    for (const f of files)
        map.set(basename(f), readFileSync(join(CACHE, basename(f))));
    return map;
}
