/**
 * Pure helpers of high-resolution captures (stills and video frames):
 * tile layout for images larger than the drawing buffer, pixel readback
 * normalization (WebGPU pads rows to 256 bytes; WebGL2 reads bottom-up),
 * tile compositing and the CPU vignette that replaces the screen-space one
 * when an image is assembled from tiles. No GPU, no DOM.
 */
import { vignetteFactor } from '../gpu/post';

/** Longest side of an exported still (pixels). */
export const MAX_STILL_SIZE = 8192;
/** Largest tile rendered in one draw (pixels per side). */
export const MAX_TILE_SIZE = 2048;
/** Overlap rendered around each tile and discarded (bloom and AO near tile edges). */
export const TILE_MARGIN = 48;

/** One tile: the region of the final image it fills and where it is rendered from. */
export interface StillTile {
  /** Destination region in the final image (top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Top-left of the rendered tile in full-image pixels (may be negative at the borders). */
  rx: number;
  ry: number;
}

/**
 * Tiles covering a `width`×`height` image when each draw is `tileW`×`tileH`
 * pixels with `margin` pixels of overlap on every side. A single tile
 * (no margin) when the image fits one draw.
 */
export function tileLayout(width: number, height: number, tileW: number, tileH: number, margin = TILE_MARGIN): StillTile[] {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  const tw = Math.max(16, Math.floor(tileW));
  const th = Math.max(16, Math.floor(tileH));
  if (W <= tw && H <= th) return [{ x: 0, y: 0, w: W, h: H, rx: 0, ry: 0 }];
  const m = Math.max(0, Math.min(Math.floor(margin), Math.floor((Math.min(tw, th) - 16) / 2)));
  // Overlap only along an axis that is actually split.
  const mx = W > tw ? m : 0;
  const my = H > th ? m : 0;
  const stepX = tw - 2 * mx;
  const stepY = th - 2 * my;
  const tiles: StillTile[] = [];
  for (let y = 0; y < H; y += stepY) {
    for (let x = 0; x < W; x += stepX) {
      tiles.push({ x, y, w: Math.min(stepX, W - x), h: Math.min(stepY, H - y), rx: x - mx, ry: y - my });
    }
  }
  return tiles;
}

/**
 * Normalize RGBA8 readback into tight, top-down rows in `out`
 * (`w*h*4` bytes): drops WebGPU's 256-byte row padding (the stride is
 * derived from the data length), flips WebGL2's bottom-up rows and forces
 * alpha opaque. Returns `out`.
 */
export function normalizePixels(data: Uint8Array, w: number, h: number, flipY: boolean, out: Uint8Array): Uint8Array {
  const row = w * 4;
  if (out.length < row * h) throw new Error('normalizePixels: output too small');
  const stride = h > 1 ? Math.max(row, Math.floor((data.length - row) / (h - 1))) : row;
  if (data.length < stride * (h - 1) + row) throw new Error('normalizePixels: readback too small');
  for (let y = 0; y < h; y++) {
    const src = (flipY ? h - 1 - y : y) * stride;
    out.set(data.subarray(src, src + row), y * row);
  }
  for (let i = 3; i < row * h; i += 4) out[i] = 255;
  return out;
}

/**
 * Copy the part of a rendered tile (`tw`×`th`, top-down) that belongs to
 * `tile` into the final `W`-wide image.
 */
export function blitTile(src: Uint8Array, tw: number, tile: StillTile, dst: Uint8Array, W: number): void {
  const ox = tile.x - tile.rx;
  const oy = tile.y - tile.ry;
  const rowBytes = tile.w * 4;
  for (let y = 0; y < tile.h; y++) {
    const s = ((oy + y) * tw + ox) * 4;
    dst.set(src.subarray(s, s + rowBytes), ((tile.y + y) * W + tile.x) * 4);
  }
}

/** Darken the corners of a top-down RGBA image like the screen-space vignette does. */
export function applyVignette(px: Uint8Array, W: number, H: number): void {
  // UV distance from the centre uses the same (non-square) UV space as the shader.
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H - 0.5;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const f = vignetteFactor(Math.sqrt(u * u + v * v));
      if (f >= 0.9999) continue;
      const i = (y * W + x) * 4;
      px[i] = Math.round((px[i] as number) * f);
      px[i + 1] = Math.round((px[i + 1] as number) * f);
      px[i + 2] = Math.round((px[i + 2] as number) * f);
    }
  }
}

/** Clamp a requested still size (keeps the aspect, longest side ≤ {@link MAX_STILL_SIZE}). */
export function stillSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1920;
  const h = Number.isFinite(height) && height > 0 ? height : 1080;
  const s = Math.min(1, MAX_STILL_SIZE / Math.max(w, h));
  return { width: Math.max(16, Math.round(w * s)), height: Math.max(16, Math.round(h * s)) };
}
