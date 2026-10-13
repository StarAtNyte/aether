/**
 * Thumbnail helpers: turn a renderer capture (data URL) into a Blob for
 * IndexedDB, and check it against the stored-size budget. Data URLs are
 * parsed strictly (allowlisted image types, base64 only, size-capped).
 */
import { MAX_THUMBNAIL_BYTES } from '../projects/model';

const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;
/** Largest data URL decoded (characters) — well above any thumbnail we keep. */
const MAX_DATA_URL_CHARS = 4 * MAX_THUMBNAIL_BYTES;

/** Decode an image data URL into a Blob; null when malformed, not an allowed image type, or too large. */
export function dataUrlToBlob(url: string): Blob | null {
  if (typeof url !== 'string' || url.length > MAX_DATA_URL_CHARS) return null;
  const m = DATA_URL.exec(url);
  if (!m) return null;
  const type = m[1] as string;
  const b64 = m[2] as string;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** True when a thumbnail fits the stored-size budget. */
export function fitThumbnail(blob: Blob): boolean {
  return blob.size > 0 && blob.size <= MAX_THUMBNAIL_BYTES;
}
