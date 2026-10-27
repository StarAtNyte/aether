/**
 * Pixel size of a PNG, JPEG or WebP image data URL, read from its header (no decoding). The photo flow needs the
 * photo's aspect ratio to render the room through a camera of the same shape, also when the host cannot decode.
 */

function decodeBase64Head(dataUrl: string, bytes: number): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1, comma + 1 + Math.ceil((bytes * 4) / 3) + 4);
  try {
    const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Size of a JPEG: scans the markers for a start-of-frame segment (it can follow a large EXIF block). */
function jpegSize(dataUrl: string): { width: number; height: number } | null {
  // Walk the whole file in base64 chunks; EXIF thumbnails make the SOF marker land far from the start.
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  let bin: string;
  try {
    const b64 = dataUrl.slice(comma + 1);
    bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
  } catch {
    return null;
  }
  let i = 2;
  while (i + 9 < bin.length) {
    if (bin.charCodeAt(i) !== 0xff) {
      i++;
      continue;
    }
    const marker = bin.charCodeAt(i + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3);
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6);
      const width = (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** Width and height in pixels of an image data URL, or null when the header cannot be read. */
export function imageSize(dataUrl: string): { width: number; height: number } | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  if (dataUrl.startsWith('data:image/jpeg')) return jpegSize(dataUrl);
  const head = decodeBase64Head(dataUrl, 64);
  if (!head) return null;
  if (dataUrl.startsWith('data:image/png') && head.length >= 24) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (dataUrl.startsWith('data:image/webp') && head.length >= 30) {
    const tag = String.fromCharCode(head[12] as number, head[13] as number, head[14] as number, head[15] as number);
    if (tag === 'VP8 ') {
      const width = ((head[26] as number) | ((head[27] as number) << 8)) & 0x3fff;
      const height = ((head[28] as number) | ((head[29] as number) << 8)) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (tag === 'VP8L') {
      const b = head.subarray(21, 25);
      const bits = (b[0] as number) | ((b[1] as number) << 8) | ((b[2] as number) << 16) | ((b[3] as number) << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (tag === 'VP8X') {
      const width = 1 + ((head[24] as number) | ((head[25] as number) << 8) | ((head[26] as number) << 16));
      const height = 1 + ((head[27] as number) | ((head[28] as number) << 8) | ((head[29] as number) << 16));
      return { width, height };
    }
  }
  return null;
}

/**
 * Horizontal field of view in degrees from the EXIF "focal length in 35 mm film" tag of a JPEG data URL, or null (no EXIF, no
 * such tag, not a JPEG). A square-on view of a room carries no vanishing-point evidence for the focal length, so a phone photo's
 * own EXIF is the only exact source there is. 35 mm equivalent focal length is defined on the 43.27 mm film diagonal.
 */
export function exifFovDeg(dataUrl: string): number | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg')) return null;
  const size = imageSize(dataUrl);
  const comma = dataUrl.indexOf(',');
  if (!size || comma < 0) return null;
  let bin: string;
  try {
    // the EXIF block sits in the first APP1 segment, within the first 64 kB
    const b64 = dataUrl.slice(comma + 1, comma + 1 + 90000);
    bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
  } catch { return null; }
  const b = (i: number): number => bin.charCodeAt(i);
  let i = 2;
  while (i + 4 < bin.length && b(i) === 0xff) {
    const marker = b(i + 1);
    const len = (b(i + 2) << 8) | b(i + 3);
    if (marker === 0xe1 && bin.slice(i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10;
      const le = bin.slice(t, t + 2) === 'II';
      const u16 = (o: number): number => (le ? b(t + o) | (b(t + o + 1) << 8) : (b(t + o) << 8) | b(t + o + 1));
      const u32 = (o: number): number => (le ? (b(t + o) | (b(t + o + 1) << 8) | (b(t + o + 2) << 16) | (b(t + o + 3) << 24)) >>> 0 : ((b(t + o) << 24) | (b(t + o + 1) << 16) | (b(t + o + 2) << 8) | b(t + o + 3)) >>> 0);
      const find = (ifd: number, tag: number): number | null => {
        if (ifd <= 0 || ifd + 2 > len) return null;
        const n = u16(ifd);
        for (let k = 0; k < n && k < 200; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === tag) return u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);
        }
        return null;
      };
      const exifIfd = find(u32(4), 0x8769);
      const f35 = exifIfd === null ? null : find(exifIfd, 0xa405);
      if (f35 === null || f35 < 8 || f35 > 400) return null;
      const diag = 2 * Math.atan(21.635 / f35);
      const hyp = Math.hypot(size.width, size.height);
      const hfov = 2 * Math.atan(Math.tan(diag / 2) * (size.width / hyp));
      return Math.round(((hfov * 180) / Math.PI) * 10) / 10;
    }
    if (marker === 0xda || len < 2) break;
    i += 2 + len;
  }
  return null;
}
