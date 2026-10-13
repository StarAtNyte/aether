/**
 * Reference images attached to a prompt: type- and size-checked, decoded by
 * the browser (never parsed by us), downscaled to ≤ 1024 px and re-encoded
 * as JPEG so the payload sent to the model stays small.
 */

/** Most images attached to one prompt. */
export const MAX_REFERENCE_IMAGES = 4;
/** Largest accepted source file (bytes). */
export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
/** Longest edge after downscaling (px). */
export const REFERENCE_MAX_EDGE = 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Result of {@link prepareReferenceImage}. */
export type ImageResult = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Validate a picked file's type and size (pure). */
export function checkReferenceFile(file: { type: string; size: number }): string | null {
  if (!TYPES.has(file.type)) return 'Attach a PNG, JPEG or WebP image.';
  if (file.size <= 0) return 'That image is empty.';
  if (file.size > MAX_REFERENCE_BYTES) return `That image is too large (limit ${MAX_REFERENCE_BYTES / 1024 / 1024} MB).`;
  return null;
}

/** Target size that fits within `maxEdge` keeping the aspect ratio (never upscales). */
export function fitWithin(width: number, height: number, maxEdge: number = REFERENCE_MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const s = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Decode, downscale and re-encode a picked image. */
export async function prepareReferenceImage(file: File): Promise<ImageResult> {
  const err = checkReferenceFile(file);
  if (err) return { ok: false, error: err };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'That image could not be read.' };
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (width === 0) return { ok: false, error: 'That image could not be read.' };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'Images are not supported in this browser.' };
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { ok: true, dataUrl: canvas.toDataURL('image/jpeg', 0.85) };
  } finally {
    bitmap.close();
  }
}
