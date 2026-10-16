/**
 * Pixel size of a PNG, JPEG or WebP image data URL, read from its header (no decoding). The photo flow needs the
 * photo's aspect ratio to render the room through a camera of the same shape, also when the host cannot decode.
 */
function decodeBase64Head(dataUrl, bytes) {
    const comma = dataUrl.indexOf(',');
    if (comma < 0)
        return null;
    const b64 = dataUrl.slice(comma + 1, comma + 1 + Math.ceil((bytes * 4) / 3) + 4);
    try {
        const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            out[i] = bin.charCodeAt(i);
        return out;
    }
    catch {
        return null;
    }
}
/** Size of a JPEG: scans the markers for a start-of-frame segment (it can follow a large EXIF block). */
function jpegSize(dataUrl) {
    // Walk the whole file in base64 chunks; EXIF thumbnails make the SOF marker land far from the start.
    const comma = dataUrl.indexOf(',');
    if (comma < 0)
        return null;
    let bin;
    try {
        const b64 = dataUrl.slice(comma + 1);
        bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
    }
    catch {
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
        if (len < 2)
            return null;
        i += 2 + len;
    }
    return null;
}
/** Width and height in pixels of an image data URL, or null when the header cannot be read. */
export function imageSize(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/'))
        return null;
    if (dataUrl.startsWith('data:image/jpeg'))
        return jpegSize(dataUrl);
    const head = decodeBase64Head(dataUrl, 64);
    if (!head)
        return null;
    if (dataUrl.startsWith('data:image/png') && head.length >= 24) {
        const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
        const width = dv.getUint32(16);
        const height = dv.getUint32(20);
        return width > 0 && height > 0 ? { width, height } : null;
    }
    if (dataUrl.startsWith('data:image/webp') && head.length >= 30) {
        const tag = String.fromCharCode(head[12], head[13], head[14], head[15]);
        if (tag === 'VP8 ') {
            const width = (head[26] | (head[27] << 8)) & 0x3fff;
            const height = (head[28] | (head[29] << 8)) & 0x3fff;
            return width > 0 && height > 0 ? { width, height } : null;
        }
        if (tag === 'VP8L') {
            const b = head.subarray(21, 25);
            const bits = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
            return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (tag === 'VP8X') {
            const width = 1 + (head[24] | (head[25] << 8) | (head[26] << 16));
            const height = 1 + (head[27] | (head[28] << 8) | (head[29] << 16));
            return { width, height };
        }
    }
    return null;
}
