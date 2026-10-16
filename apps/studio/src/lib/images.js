/**
 * Reference images attached to a prompt: type- and size-checked, their
 * header read for the real format and pixel size BEFORE the browser decodes
 * them (a few-KB PNG can declare 60000 × 60000 pixels, gigabytes once
 * decoded), then decoded by the browser, downscaled to ≤ 1024 px and
 * re-encoded as JPEG so the payload sent to the model stays small.
 */
import { validateImage } from '@aether/assets';
/** Most images attached to one prompt. */
export const MAX_REFERENCE_IMAGES = 4;
/** Largest accepted source file (bytes). */
export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
/** Longest edge after downscaling (px). */
export const REFERENCE_MAX_EDGE = 1024;
/** Longest accepted source side (px), checked from the header before decoding. */
export const MAX_REFERENCE_SIDE = 12_000;
/** Most source pixels (a 48 MP phone photo fits), checked before decoding. */
export const MAX_REFERENCE_PIXELS = 50_000_000;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Validate a picked file's type and size (pure). */
export function checkReferenceFile(file) {
    if (!TYPES.has(file.type))
        return 'Attach a PNG, JPEG or WebP image.';
    if (file.size <= 0)
        return 'That image is empty.';
    if (file.size > MAX_REFERENCE_BYTES)
        return `That image is too large (limit ${MAX_REFERENCE_BYTES / 1024 / 1024} MB).`;
    return null;
}
/**
 * Check a picked image's real format and pixel size from its bytes (pure;
 * nothing is decoded). Returns an error message, or null when it is safe to
 * hand to the browser's decoder.
 */
export function checkReferenceBytes(bytes) {
    const r = validateImage(bytes, { maxBytes: MAX_REFERENCE_BYTES, maxSide: MAX_REFERENCE_SIDE });
    if (!r.ok)
        return /too big/.test(r.error) ? `That image is too large (limit ${MAX_REFERENCE_SIDE.toLocaleString('en-US')} px per side).` : 'Attach a PNG, JPEG or WebP image.';
    if (r.info.width * r.info.height > MAX_REFERENCE_PIXELS)
        return `That image has too many pixels (limit ${MAX_REFERENCE_PIXELS / 1_000_000} megapixels).`;
    return null;
}
/** Target size that fits within `maxEdge` keeping the aspect ratio (never upscales). */
export function fitWithin(width, height, maxEdge = REFERENCE_MAX_EDGE) {
    if (!(width > 0) || !(height > 0))
        return { width: 0, height: 0 };
    const s = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}
/** Decode, downscale and re-encode a picked image. */
export async function prepareReferenceImage(file) {
    const err = checkReferenceFile(file);
    if (err)
        return { ok: false, error: err };
    let bytes;
    try {
        bytes = new Uint8Array(await file.arrayBuffer());
    }
    catch {
        return { ok: false, error: 'That image could not be read.' };
    }
    const headerErr = checkReferenceBytes(bytes);
    if (headerErr)
        return { ok: false, error: headerErr };
    let bitmap;
    try {
        bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }));
    }
    catch {
        return { ok: false, error: 'That image could not be read.' };
    }
    try {
        const { width, height } = fitWithin(bitmap.width, bitmap.height);
        if (width === 0)
            return { ok: false, error: 'That image could not be read.' };
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return { ok: false, error: 'Images are not supported in this browser.' };
        ctx.drawImage(bitmap, 0, 0, width, height);
        return { ok: true, dataUrl: canvas.toDataURL('image/jpeg', 0.85) };
    }
    finally {
        bitmap.close();
    }
}
