/** Minimal PNG encoder (8-bit RGBA, no interlace) on node:zlib. */
import { deflateSync } from 'node:zlib';
let crcTable = null;
function crc32(buf) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}
/** Encode RGBA8 pixels (row-major, top row first) as a PNG file. */
export function encodePng(rgba, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4)
        throw new RangeError('encodePng: bad dimensions');
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
