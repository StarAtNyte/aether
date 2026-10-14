/**
 * Pixel-art icons for the non-block items (tools, ingots, gems, food …),
 * painted procedurally into one RGBA strip (16 × 16 per icon) — no image
 * assets. Blocks use the terrain atlas instead (drawn as small isometric
 * cubes by the HUD).
 */

/** Icon edge in pixels. */
export const ICON = 16;

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = /^#[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex.slice(1), 16) : 0x999999;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(c: RGB, f: number): RGB {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

const WOOD: RGB = [138, 106, 62];
const WOOD_DARK: RGB = [96, 70, 38];
const OUTLINE: RGB = [34, 28, 24];

type Plot = (x: number, y: number, c: RGB) => void;

function line(p: Plot, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) p(Math.round(x0 + ((x1 - x0) * i) / Math.max(1, n)), Math.round(y0 + ((y1 - y0) * i) / Math.max(1, n)), c);
}

function handle(p: Plot): void {
  // Diagonal handle from the bottom-left to the centre.
  for (let i = 0; i < 9; i++) {
    p(2 + i, 13 - i, i % 3 === 0 ? WOOD_DARK : WOOD);
    p(3 + i, 13 - i, WOOD_DARK);
  }
}

function disc(p: Plot, cx: number, cy: number, r: number, c: RGB, hi: RGB, lo: RGB): void {
  for (let y = 0; y < ICON; y++) {
    for (let x = 0; x < ICON; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const light = x + y < cx + cy - r * 0.6 ? hi : x + y > cx + cy + r * 0.5 ? lo : c;
      p(x, y, d > r - 1 ? OUTLINE : light);
    }
  }
}

/** Draw the icon of `item` with main colour `color`. */
function paint(item: string, color: string, p: Plot): void {
  const c = rgb(color);
  const hi = shade(c, 1.25);
  const lo = shade(c, 0.7);
  if (item.endsWith('_pickaxe')) {
    handle(p);
    for (let x = 4; x <= 13; x++) {
      const y = 3 + Math.round(Math.abs(x - 8.5) * 0.45);
      p(x, y, x < 7 ? hi : c);
      p(x, y + 1, lo);
    }
    return;
  }
  if (item.endsWith('_axe')) {
    handle(p);
    for (let y = 2; y <= 8; y++) for (let x = 8; x <= 13 - Math.abs(y - 5) * 0.5; x++) p(x, y, y === 2 || x === 8 ? hi : c);
    line(p, 9, 8, 13, 8, lo);
    return;
  }
  if (item.endsWith('_shovel')) {
    handle(p);
    for (let y = 2; y <= 6; y++) for (let x = 9; x <= 13; x++) if (Math.hypot(x - 11, y - 4) < 2.6) p(x, y, y < 4 ? hi : c);
    return;
  }
  if (item.endsWith('_sword')) {
    // Blade from the top-right down to the guard, handle below.
    for (let i = 0; i < 9; i++) {
      p(13 - i, 2 + i, hi);
      p(12 - i, 2 + i, c);
      p(13 - i, 3 + i, lo);
    }
    line(p, 2, 9, 7, 14, WOOD_DARK);
    line(p, 3, 13, 2, 14, WOOD);
    line(p, 2, 13, 3, 14, WOOD);
    return;
  }
  switch (item) {
    case 'stick':
      for (let i = 0; i < 11; i++) {
        p(3 + i, 13 - i, WOOD);
        p(4 + i, 13 - i, WOOD_DARK);
      }
      return;
    case 'iron_ingot':
    case 'gold_ingot':
      for (let y = 6; y <= 11; y++) for (let x = 2 + (11 - y) / 2; x <= 13 - (11 - y) / 2; x++) p(Math.round(x), y, y === 6 ? hi : y === 11 ? lo : c);
      return;
    case 'diamond':
      for (let y = 3; y <= 13; y++) {
        const w = y <= 6 ? 3 + (y - 3) * 1.4 : 7 - (y - 6) * 1.0;
        for (let x = Math.round(8 - w); x <= Math.round(7 + w); x++) p(x, y, y <= 5 ? hi : x < 8 ? c : lo);
      }
      return;
    case 'coal':
      disc(p, 8, 9, 5.2, c, [80, 80, 84], [16, 16, 18]);
      p(6, 7, [110, 110, 116]);
      return;
    case 'apple':
      disc(p, 8, 9.5, 5, c, hi, lo);
      line(p, 8, 2, 8, 5, WOOD_DARK);
      p(9, 3, [90, 160, 60]);
      p(10, 3, [90, 160, 60]);
      return;
    case 'bread':
      for (let y = 6; y <= 12; y++) for (let x = 2; x <= 13; x++) if (((x - 7.5) / 6) ** 2 + ((y - 9) / 3.6) ** 2 < 1) p(x, y, y < 8 ? hi : y > 11 ? lo : c);
      for (const x of [5, 8, 11]) p(x, 7, lo);
      return;
    case 'feather':
      for (let i = 0; i < 11; i++) {
        p(3 + i, 13 - i, [200, 200, 200]);
        p(4 + i, 13 - i, i > 2 ? c : [200, 200, 200]);
        if (i > 2) p(5 + i, 13 - i, c);
      }
      return;
    case 'string':
      for (let x = 2; x <= 13; x++) p(x, 8 + Math.round(Math.sin(x * 0.9) * 2), c);
      return;
    case 'wheat':
      for (const x of [5, 8, 11]) {
        line(p, x, 14, x, 6, [170, 140, 60]);
        for (let y = 2; y <= 6; y++) p(x + (y % 2 === 0 ? 1 : -1), y, c);
        p(x, 3, hi);
      }
      return;
    default: {
      // Food (meat) and other items: a rounded chunk with a bone for meat.
      const meat = item.startsWith('raw_') || item.startsWith('cooked_') || item === 'rotten_flesh';
      disc(p, 7, 8.5, 5.3, c, hi, lo);
      if (meat) {
        line(p, 11, 11, 13, 13, [236, 230, 214]);
        p(14, 13, [236, 230, 214]);
        p(13, 14, [236, 230, 214]);
      }
    }
  }
}

/** Paint every listed item into a strip (`items.length` icons, left to right). */
export function paintItemIcons(items: ReadonlyArray<{ id: string; color: string }>): Uint8ClampedArray {
  const width = ICON * Math.max(1, items.length);
  const out = new Uint8ClampedArray(width * ICON * 4);
  items.forEach((it, i) => {
    const ox = i * ICON;
    paint(it.id, it.color, (x, y, c) => {
      if (x < 0 || y < 0 || x >= ICON || y >= ICON) return;
      const o = (y * width + ox + x) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    });
  });
  return out;
}

/** RGBA pixels → PNG data URL (browser only; empty string when no canvas is available). */
export function pixelsToDataUrl(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const copy = new Uint8ClampedArray(width * height * 4);
    copy.set(pixels.subarray(0, width * height * 4));
    const data = new ImageData(copy, width, height);
    ctx.putImageData(data, 0, 0);
    const url = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return url;
  } catch {
    return '';
  }
}
