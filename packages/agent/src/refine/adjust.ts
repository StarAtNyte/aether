/**
 * Relative colour changes: "a bit darker", "warmer", "less saturated".
 */
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './lexicon';

/** A relative change direction. */
export type AdjustDir = 'darker' | 'lighter' | 'brighter' | 'duller' | 'warmer' | 'cooler';

function hueToward(h: number, target: number, amount: number): number {
  let d = target - h;
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  return h + d * amount;
}

/** Apply a relative change to a colour. */
export function adjustColor(hex: string, dir: AdjustDir, amount: number): string {
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  switch (dir) {
    case 'darker':
      l *= 1 - amount;
      break;
    case 'lighter':
      l += (1 - l) * amount;
      break;
    case 'brighter':
      s = Math.min(1, s * (1 + amount));
      l = Math.min(0.9, l * (1 + amount * 0.4));
      break;
    case 'duller':
      s *= 1 - amount;
      break;
    case 'warmer':
      h = hueToward(h, 0.07, amount);
      break;
    case 'cooler':
      h = hueToward(h, 0.58, amount);
      break;
  }
  h = ((h % 1) + 1) % 1;
  return rgbToHex(...hslToRgb(h, s, l));
}
