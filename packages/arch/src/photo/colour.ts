/**
 * Colour distance as a person sees it: sRGB → CIELAB (D65) and the CIEDE2000 difference.
 *
 * ΔE00 reads roughly as: below 1 indistinguishable, 2-3 a close match, 5 clearly different shades, above 10 a different
 * colour. Pure arithmetic, deterministic, used by the fidelity measures (described colour against built colour, photo
 * region against render region).
 */

/** A CIELAB colour. */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** `#rrggbb` → [r, g, b] in 0..255, or null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m || !m[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(c: number): number {
  const v = Math.max(0, Math.min(255, c)) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function f(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116;
}

/** sRGB (0..255 per channel) → CIELAB under D65. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** `#rrggbb` → CIELAB, or null. */
export function hexToLab(hex: string): Lab | null {
  const c = parseHex(hex);
  return c ? rgbToLab(c[0], c[1], c[2]) : null;
}

const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;

/** CIEDE2000 colour difference (kL = kC = kH = 1). */
export function deltaE2000(p: Lab, q: Lab): number {
  const C1 = Math.hypot(p.a, p.b);
  const C2 = Math.hypot(q.a, q.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * p.a;
  const a2 = (1 + G) * q.a;
  const c1 = Math.hypot(a1, p.b);
  const c2 = Math.hypot(a2, q.b);
  const h1 = c1 === 0 ? 0 : (deg(Math.atan2(p.b, a1)) + 360) % 360;
  const h2 = c2 === 0 ? 0 : (deg(Math.atan2(q.b, a2)) + 360) % 360;
  const dL = q.L - p.L;
  const dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2));
  const Lm = (p.L + q.L) / 2;
  const cm = (c1 + c2) / 2;
  let hm = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) > 180) hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    else hm = (h1 + h2) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * cm;
  const Sh = 1 + 0.015 * cm * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** ΔE00 of two `#rrggbb` colours (null when either is not one). */
export function hexDeltaE(a: string, b: string): number | null {
  const p = hexToLab(a);
  const q = hexToLab(b);
  return p && q ? deltaE2000(p, q) : null;
}
