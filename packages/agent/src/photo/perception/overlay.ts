/**
 * The annotated picture for `look_closer`-style inspection: the photo with each perceived object's mask tinted, its box,
 * a numbered label and a chip of its measured colour. Drawn with a built-in 5 x 7 bitmap font so it needs no canvas and
 * runs the same in Node and a browser. The PNG is deflate-compressed when the platform has `CompressionStream`.
 */
import { encodePng } from '../depth-model';

const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0], '%': [24, 25, 2, 4, 8, 19, 3], '/': [1, 1, 2, 4, 8, 16, 16], '?': [14, 17, 1, 2, 4, 0, 4],
};

export interface OverlayItem {
  /** [x0, y0, x1, y1] in 0..1. */
  box: readonly [number, number, number, number];
  label: string;
  /** Mask at any size (0/1), tinted when given. */
  mask?: { width: number; height: number; data: ArrayLike<number> };
  /** Measured colour chip. */
  rgb?: readonly [number, number, number];
}

const PALETTE: [number, number, number][] = [[230, 25, 75], [60, 180, 75], [255, 200, 20], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128], [170, 110, 40]];
export const itemColour = (i: number): [number, number, number] => PALETTE[i % PALETTE.length] as [number, number, number];

/** Draw items on an RGBA raster (resized to at most `maxSide`), returning RGB pixels. */
export function drawOverlay(raster: { width: number; height: number; data: ArrayLike<number> }, items: OverlayItem[], maxSide = 800): { width: number; height: number; rgb: Uint8Array } {
  const s = Math.min(1, maxSide / Math.max(raster.width, raster.height));
  const W = Math.max(1, Math.round(raster.width * s));
  const H = Math.max(1, Math.round(raster.height * s));
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(raster.height - 1, Math.floor((y + 0.5) / s));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(raster.width - 1, Math.floor((x + 0.5) / s));
      const o = (sy * raster.width + sx) * 4;
      const k = (y * W + x) * 3;
      rgb[k] = raster.data[o] as number; rgb[k + 1] = raster.data[o + 1] as number; rgb[k + 2] = raster.data[o + 2] as number;
    }
  }
  const put = (x: number, y: number, c: readonly [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = (y * W + x) * 3;
    rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2];
  };
  items.forEach((it, i) => {
    const c = itemColour(i);
    if (it.mask) {
      const m = it.mask;
      for (let y = 0; y < H; y++) {
        const my = Math.min(m.height - 1, Math.floor(((y + 0.5) / H) * m.height));
        for (let x = 0; x < W; x++) {
          const mx = Math.min(m.width - 1, Math.floor(((x + 0.5) / W) * m.width));
          if (!m.data[my * m.width + mx]) continue;
          const k = (y * W + x) * 3;
          rgb[k] = Math.round((rgb[k] as number) * 0.62 + c[0] * 0.38); rgb[k + 1] = Math.round((rgb[k + 1] as number) * 0.62 + c[1] * 0.38); rgb[k + 2] = Math.round((rgb[k + 2] as number) * 0.62 + c[2] * 0.38);
        }
      }
    }
  });
  items.forEach((it, i) => {
    const c = itemColour(i);
    const x0 = Math.round(it.box[0] * (W - 1));
    const y0 = Math.round(it.box[1] * (H - 1));
    const x1 = Math.round(it.box[2] * (W - 1));
    const y1 = Math.round(it.box[3] * (H - 1));
    for (let t = 0; t < 2; t++) for (let x = x0; x <= x1; x++) { put(x, y0 + t, c); put(x, y1 - t, c); }
    for (let t = 0; t < 2; t++) for (let y = y0; y <= y1; y++) { put(x0 + t, y, c); put(x1 - t, y, c); }
    const text = it.label.toUpperCase().slice(0, 22);
    const sc = 2;
    const tw = text.length * 6 * sc + 4 + (it.rgb ? 14 : 0);
    const th = 7 * sc + 4;
    const bx = Math.max(0, Math.min(W - tw, x0));
    const by = y0 - th >= 0 ? y0 - th : Math.min(H - th, y0);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) put(bx + x, by + y, c);
    let px = bx + 2;
    if (it.rgb) {
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) put(px + x, by + 2 + y - (y > 9 ? 0 : 0), x === 0 || y === 0 || x === 11 || y === 11 ? [255, 255, 255] : it.rgb);
      px += 14;
    }
    for (const ch of text) {
      const g = GLYPHS[ch] ?? GLYPHS['?'] as number[];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (((g[r] as number) >> (4 - q)) & 1) for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) put(px + q * sc + a, by + 2 + r * sc + b, [0, 0, 0]);
      px += 6 * sc;
    }
  });
  return { width: W, height: H, rgb };
}

/** PNG data URL of the overlay (deflate when available, stored blocks otherwise). */
export async function overlayDataUrl(o: { width: number; height: number; rgb: Uint8Array }): Promise<string> {
  const png = await encodePngCompressed(o.width, o.height, o.rgb);
  let s = '';
  for (let i = 0; i < png.length; i += 0x8000) s += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc = (b: Uint8Array): number => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = (crcTable[(c ^ (b[i] as number)) & 255] as number) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** RGB PNG with a zlib stream from `CompressionStream('deflate')`; falls back to the stored-block encoder. */
export async function encodePngCompressed(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return encodePng(width, height, rgb);
  try {
    const raw = new Uint8Array((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
    const cs = new CompressionStream('deflate');
    const w = cs.writable.getWriter();
    void w.write(raw as unknown as BufferSource).then(() => w.close());
    const z = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const chunk = (type: string, data: Uint8Array): Uint8Array => {
      const c = new Uint8Array(12 + data.length);
      const dv = new DataView(c.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
      c.set(data, 8);
      dv.setUint32(8 + data.length, crc(c.subarray(4, 8 + data.length)));
      return c;
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let k = 0;
    for (const p of parts) { out.set(p, k); k += p.length; }
    return out;
  } catch {
    return encodePng(width, height, rgb);
  }
}
