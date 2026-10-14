import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng, MAX_PNG_EDGE, scanlines } from '../src/voxel/png';

describe('encodePng', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid RGBA PNG whose pixels round-trip', async () => {
    const w = 5;
    const h = 3;
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) & 255);
    const png = await encodePng(px, w, h);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const v = new DataView(png.buffer, png.byteOffset);
    // IHDR
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(v.getUint32(16)).toBe(w);
    expect(v.getUint32(20)).toBe(h);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    expect(v.getUint32(29)).toBe(crc32(png, 12, 29));
    // IDAT
    const len = v.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + len));
    expect(new Uint8Array(raw)).toEqual(scanlines(px, w, h));
    expect(v.getUint32(41 + len)).toBe(crc32(png, 37, 41 + len));
    // IEND closes the file.
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  it('rejects bad sizes and short buffers', async () => {
    await expect(encodePng(new Uint8Array(4), 0, 1)).rejects.toThrow(RangeError);
    await expect(encodePng(new Uint8Array(4), MAX_PNG_EDGE + 1, 1)).rejects.toThrow(RangeError);
    await expect(encodePng(new Uint8Array(4), 2, 2)).rejects.toThrow(/too short/);
  });
});
