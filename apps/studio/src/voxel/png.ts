/**
 * Minimal PNG encoder (RGBA8, no filtering) for the procedural HUD images
 * (block atlas, item icons). The deflate runs in the browser's native
 * `CompressionStream`, which is asynchronous, so encoding never touches a
 * canvas and never blocks the main thread on a GPU process round trip
 * (a 2D canvas `getContext` / `toDataURL` took over a second on software
 * rasterisers while WebGPU was busy).
 */

/** Largest image edge accepted (pixels). */
export const MAX_PNG_EDGE = 4096;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (PNG / zlib polynomial) of `bytes[start, end)`. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (t[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Raw scanlines (filter byte 0 + RGBA row) for `pixels`. */
export function scanlines(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const row = width * 4;
  const out = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) out.set(pixels.subarray(y * row, y * row + row), y * (row + 1) + 1);
  return out;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode RGBA pixels as a PNG file. Rejects bad sizes or a short pixel
 * buffer; needs `CompressionStream` (every current browser, Node ≥ 18).
 */
export async function encodePng(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_PNG_EDGE || height > MAX_PNG_EDGE) {
    throw new RangeError(`bad PNG size ${width}×${height}`);
  }
  if (pixels.length < width * height * 4) throw new RangeError('pixel buffer too short');
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = await deflate(scanlines(pixels, width, height));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
