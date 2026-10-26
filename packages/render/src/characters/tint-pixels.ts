/** Pure pixel kernel shared by synchronous tinting and worker baking. */
import type { TintMasks } from './tint';

/** sRGB byte to linear (256 entries) and linear to sRGB byte (4096 entries). */
const TO_LINEAR = new Float32Array(256);
const TO_SRGB = new Uint8Array(4096);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < 4096; i++) {
  const l = i / 4095;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(c * 255)));
}

const LUM_CLAMP_LO = 0.3;
const LUM_CLAMP_HI = 2.4;

/**
 * Recolour RGBA pixels in place toward `target` (linear RGB), keeping each
 * texel's own shading: `ref` is the region's mean luminance and `weight(x, y)`
 * the 0..1 strength of the recolour at that texel.
 */
export function recolorPixels(rgba: Uint8ClampedArray, width: number, height: number, target: readonly [number, number, number], ref: number, weight: (x: number, y: number) => number): void {
  const inv = 1 / Math.max(1e-4, ref);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = weight(x, y);
      if (w <= 0.004) continue;
      const i = (y * width + x) * 4;
      const r = TO_LINEAR[rgba[i] as number] as number;
      const g = TO_LINEAR[rgba[i + 1] as number] as number;
      const b = TO_LINEAR[rgba[i + 2] as number] as number;
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const k = Math.max(LUM_CLAMP_LO, Math.min(LUM_CLAMP_HI, lum * inv));
      const nr = r + (target[0] * k - r) * w;
      const ng = g + (target[1] * k - g) * w;
      const nb = b + (target[2] * k - b) * w;
      rgba[i] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(nr * 4095)))] as number;
      rgba[i + 1] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(ng * 4095)))] as number;
      rgba[i + 2] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(nb * 4095)))] as number;
    }
  }
}

/** Weight function reading one mask channel of one half (0 = body, 1 = head) of the mask image. */
export function maskWeight(masks: TintMasks, half: 0 | 1, channel: 0 | 1, width: number, height: number): (x: number, y: number) => number {
  const halfW = masks.width >> 1;
  const sx = halfW / width;
  const sy = masks.height / height;
  return (x, y) => {
    const mx = Math.min(halfW - 1, Math.floor(x * sx)) + half * halfW;
    const my = Math.min(masks.height - 1, Math.floor(y * sy));
    return (masks.data[(my * masks.width + mx) * 4 + channel] as number) / 255;
  };
}
