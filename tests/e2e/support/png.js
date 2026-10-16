/**
 * Minimal PNG decoder for e2e pixel checks (8-bit greyscale/RGB/RGBA,
 * non-interlaced — exactly what Chromium screenshots produce), plus a
 * luminance-statistics helper used to prove the 3D canvas is not blank.
 */
import { inflateSync } from 'node:zlib';
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Bytes per pixel by PNG colour type (8-bit depth only). */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
/** Refuse absurd sizes (screenshots are a few megapixels at most). */
const MAX_PIXELS = 64 * 1024 * 1024;
function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Decode a PNG buffer. Throws on unsupported or malformed input. */
export function decodePng(buf) {
    for (let i = 0; i < SIGNATURE.length; i++)
        if (buf[i] !== SIGNATURE[i])
            throw new Error('not a PNG');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat = [];
    let off = 8;
    while (off + 8 <= buf.length) {
        const len = view.getUint32(off);
        const type = String.fromCharCode(buf[off + 4] ?? 0, buf[off + 5] ?? 0, buf[off + 6] ?? 0, buf[off + 7] ?? 0);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            width = view.getUint32(off + 8);
            height = view.getUint32(off + 12);
            const depth = body[8];
            const colorType = body[9] ?? -1;
            const interlace = body[12];
            if (depth !== 8 || interlace !== 0 || CHANNELS[colorType] === undefined)
                throw new Error('unsupported PNG format');
            if (width * height > MAX_PIXELS)
                throw new Error('PNG too large');
            channels = CHANNELS[colorType] ?? 0;
        }
        else if (type === 'IDAT')
            idat.push(body);
        else if (type === 'IEND')
            break;
        off += 12 + len;
    }
    if (width === 0 || height === 0 || channels === 0)
        throw new Error('PNG has no header');
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < height * (stride + 1))
        throw new Error('truncated PNG');
    const pixels = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        const dst = y * stride;
        for (let x = 0; x < stride; x++) {
            const v = raw[src + x] ?? 0;
            const a = x >= channels ? (pixels[dst + x - channels] ?? 0) : 0;
            const b = y > 0 ? (pixels[dst - stride + x] ?? 0) : 0;
            const c = x >= channels && y > 0 ? (pixels[dst - stride + x - channels] ?? 0) : 0;
            let out;
            switch (filter) {
                case 0:
                    out = v;
                    break;
                case 1:
                    out = v + a;
                    break;
                case 2:
                    out = v + b;
                    break;
                case 3:
                    out = v + ((a + b) >> 1);
                    break;
                case 4:
                    out = v + paeth(a, b, c);
                    break;
                default: throw new Error(`bad PNG filter ${String(filter)}`);
            }
            pixels[dst + x] = out & 0xff;
        }
    }
    const data = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += channels) {
        const g = pixels[j] ?? 0;
        if (channels === 1 || channels === 2) {
            data[i * 4] = g;
            data[i * 4 + 1] = g;
            data[i * 4 + 2] = g;
            data[i * 4 + 3] = channels === 2 ? (pixels[j + 1] ?? 255) : 255;
        }
        else {
            data[i * 4] = g;
            data[i * 4 + 1] = pixels[j + 1] ?? 0;
            data[i * 4 + 2] = pixels[j + 2] ?? 0;
            data[i * 4 + 3] = channels === 4 ? (pixels[j + 3] ?? 255) : 255;
        }
    }
    return { width, height, data };
}
/** Sample up to ~`samples` pixels on a regular grid and compute luminance stats. */
export function pixelStats(img, samples = 4096) {
    const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / samples)));
    let n = 0;
    let sum = 0;
    let sumSq = 0;
    const colors = new Set();
    for (let y = 0; y < img.height; y += step) {
        for (let x = 0; x < img.width; x += step) {
            const i = (y * img.width + x) * 4;
            const r = img.data[i] ?? 0;
            const g = img.data[i + 1] ?? 0;
            const b = img.data[i + 2] ?? 0;
            const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            sum += l;
            sumSq += l * l;
            colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
            n++;
        }
    }
    const mean = n > 0 ? sum / n : 0;
    const variance = n > 0 ? Math.max(0, sumSq / n - mean * mean) : 0;
    return { mean, stdDev: Math.sqrt(variance), distinctColors: colors.size };
}
