/**
 * PNG encoder for e2e reports (side-by-side and difference images). 8-bit RGBA, unfiltered, zlib-deflated.
 */
import { deflateSync } from 'node:zlib';
import type { RgbaImage } from './png';

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encode RGBA8 pixels as a PNG. */
export function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * stride + 1);
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Two images of one size side by side with a 4 px gap, left then right. */
export function sideBySide(a: RgbaImage, b: RgbaImage): RgbaImage {
  const gap = 4;
  const width = a.width + gap + b.width;
  const height = Math.max(a.height, b.height);
  const data = new Uint8Array(width * height * 4).fill(255);
  const put = (img: RgbaImage, x0: number): void => {
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), (y * width + x0) * 4);
  };
  put(a, 0);
  put(b, a.width + gap);
  return { width, height, data };
}

/** Mean absolute difference per channel (0..255) and the share of pixels differing by more than `tolerance`. */
export function imageDiff(a: RgbaImage, b: RgbaImage, tolerance = 24): { mean: number; share: number; meanLumaA: number; meanLumaB: number } {
  if (a.width !== b.width || a.height !== b.height) return { mean: NaN, share: NaN, meanLumaA: NaN, meanLumaB: NaN };
  let sum = 0;
  let over = 0;
  let la = 0;
  let lb = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d0 = Math.abs((a.data[o] as number) - (b.data[o] as number));
    const d1 = Math.abs((a.data[o + 1] as number) - (b.data[o + 1] as number));
    const d2 = Math.abs((a.data[o + 2] as number) - (b.data[o + 2] as number));
    sum += d0 + d1 + d2;
    if (Math.max(d0, d1, d2) > tolerance) over++;
    la += 0.2126 * (a.data[o] as number) + 0.7152 * (a.data[o + 1] as number) + 0.0722 * (a.data[o + 2] as number);
    lb += 0.2126 * (b.data[o] as number) + 0.7152 * (b.data[o + 1] as number) + 0.0722 * (b.data[o + 2] as number);
  }
  return { mean: sum / (n * 3), share: over / n, meanLumaA: la / n, meanLumaB: lb / n };
}
