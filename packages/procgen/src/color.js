/**
 * Color parsing and mixing. Public colors are CSS hex strings in sRGB; mesh
 * vertex colors are stored in LINEAR space (what three.js expects for vertex
 * color attributes).
 */
const NAMED_COLORS = new Map([
    ['black', '#000000'], ['white', '#ffffff'], ['red', '#e53935'], ['green', '#43a047'], ['blue', '#1e88e5'],
    ['yellow', '#fdd835'], ['orange', '#fb8c00'], ['purple', '#8e24aa'], ['pink', '#ec407a'], ['brown', '#795548'],
    ['gray', '#9e9e9e'], ['grey', '#9e9e9e'], ['cyan', '#00bcd4'], ['magenta', '#d81b60'], ['teal', '#00897b'],
    ['navy', '#1a237e'], ['gold', '#ffc107'], ['silver', '#c0c0c0'], ['beige', '#e8dcc0'], ['maroon', '#800000'],
    ['olive', '#808000'], ['lime', '#9ccc65'], ['indigo', '#3949ab'], ['violet', '#9c6ade'], ['turquoise', '#40e0d0'],
    ['coral', '#ff7f50'], ['salmon', '#fa8072'], ['khaki', '#c3b091'], ['crimson', '#dc143c'], ['tan', '#d2b48c'],
    ['chocolate', '#7b3f00'], ['skyblue', '#87ceeb'], ['darkgreen', '#1b5e20'], ['forestgreen', '#228b22'],
    ['lightblue', '#90caf9'], ['darkblue', '#0d47a1'], ['lightgreen', '#a5d6a7'], ['darkgray', '#555555'],
    ['darkgrey', '#555555'], ['lightgray', '#d3d3d3'], ['lightgrey', '#d3d3d3'], ['stone', '#8d8a85'], ['wood', '#8b5a2b'],
    ['sand', '#e0c98f'], ['snow', '#f4f7fb'], ['water', '#3a8fc9'], ['lava', '#ff5a1f'], ['grass', '#5a9a3c'],
]);
const HEX6 = /^#([0-9a-f]{6})$/;
const HEX3 = /^#([0-9a-f]{3})$/;
/**
 * Normalize a CSS color to "#rrggbb". Accepts "#rrggbb", "#rgb" and a small set
 * of color names (case-insensitive). Returns null when not recognised.
 */
export function normalizeHex(input) {
    if (typeof input !== 'string' || input.length > 32)
        return null;
    const s = input.trim().toLowerCase();
    if (HEX6.test(s))
        return s;
    const short = HEX3.exec(s);
    if (short) {
        const h = short[1];
        return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return NAMED_COLORS.get(s.replace(/[\s_-]/g, '')) ?? null;
}
/** Parse a color into sRGB components in 0..1, or null. */
export function parseColor(input) {
    const hex = normalizeHex(input);
    if (hex === null)
        return null;
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
/** Like {@link parseColor} but throws a descriptive TypeError. */
export function requireColor(input, what = 'color') {
    const c = parseColor(input);
    if (c === null)
        throw new TypeError(`${what}: expected a "#rrggbb" color, got ${JSON.stringify(String(input)).slice(0, 40)}`);
    return c;
}
/** sRGB transfer function → linear. */
export function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** Linear → sRGB transfer function. */
export function linearToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
/** Hex color → linear RGB (for vertex colors). Throws on invalid input. */
export function hexToLinear(hex, out = [0, 0, 0]) {
    const c = requireColor(hex);
    out[0] = srgbToLinear(c[0]);
    out[1] = srgbToLinear(c[1]);
    out[2] = srgbToLinear(c[2]);
    return out;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** sRGB components in 0..1 → "#rrggbb". */
export function rgbToHex(rgb) {
    let out = '#';
    for (let i = 0; i < 3; i++) {
        const v = Math.round(clamp01(Number.isFinite(rgb[i]) ? rgb[i] : 0) * 255);
        out += v.toString(16).padStart(2, '0');
    }
    return out;
}
/** Mix two colors in sRGB space; t is clamped to 0..1. */
export function mixHex(a, b, t) {
    const ca = requireColor(a, 'mix(a)');
    const cb = requireColor(b, 'mix(b)');
    const k = clamp01(Number.isFinite(t) ? t : 0);
    return rgbToHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}
/** Lighten (amount > 0, towards white) or darken (amount < 0, towards black) a color. */
export function shadeHex(hex, amount) {
    return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#000000', -amount);
}
/** Mix two linear colors into `out`. */
export function mixLinear(a, b, t, out) {
    const k = clamp01(t);
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    out[2] = a[2] + (b[2] - a[2]) * k;
    return out;
}
