import { computeSkyState } from '@aether/render';
const HEX = /^#?([0-9a-f]{6})$/i;
/** Parse "#rrggbb" into 0..1 channels; invalid input yields mid grey. */
export function hexToRgb(hex) {
    const m = HEX.exec(hex.trim());
    if (!m || m[1] === undefined)
        return [0.5, 0.5, 0.5];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** 0..1 channels to "#rrggbb" (clamped). */
export function rgbToHex(r, g, b) {
    const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}
function toHsl(hex) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0)
        return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r)
        h = ((g - b) / d) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    h *= 60;
    if (h < 0)
        h += 360;
    return { h, s, l };
}
function fromHsl({ h, s, l }) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return rgbToHex(r1 + m, g1 + m, b1 + m);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Shortest angular distance between two hues (degrees). */
function hueGap(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}
/** WCAG relative luminance of "#rrggbb". */
export function luminance(hex) {
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = hexToRgb(hex).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Accents at least this bright keep >= 4.5:1 contrast with dark ink and stand out on the UI. */
const MIN_ACCENT_LUMINANCE = 0.26;
/** Curated accents for presets whose sky is near-neutral or near-black. */
const CURATED = {
    space: [
        { h: 268, s: 0.82, l: 0.72 },
        { h: 188, s: 0.75, l: 0.62 },
    ],
    studio: [
        { h: 232, s: 0.85, l: 0.74 },
        { h: 176, s: 0.6, l: 0.6 },
    ],
};
/** Lift a sky color into a legible accent on a dark UI. */
function accent(hsl, minSat) {
    const out = { h: hsl.h, s: clamp(Math.max(hsl.s, minSat), 0, 0.9), l: clamp(hsl.l, 0.6, 0.76) };
    // Saturated blues/violets are dark at a given lightness: raise until legible.
    while (luminance(fromHsl(out)) < MIN_ACCENT_LUMINANCE && out.l < 0.86)
        out.l += 0.02;
    return out;
}
/**
 * The interface palette for an environment. Deterministic and cheap
 * (called only when the environment changes).
 */
export function worldChroma(env) {
    const sky = computeSkyState(env);
    const curated = CURATED[env.sky];
    let glow;
    let upper;
    if (curated) {
        [glow, upper] = curated;
    }
    else {
        const glowSrc = toHsl(sky.sunGlowStrength >= 0.5 ? sky.sunGlow : sky.horizon);
        const upperSrc = toHsl(sky.zenith);
        // Overcast skies stay moody (lower saturation) but never grey.
        const minSat = env.sky === 'overcast' ? 0.32 : 0.55;
        glow = accent(glowSrc, minSat);
        upper = accent(upperSrc, minSat);
        // Keep the two accents apart so gradients between them read as color, not mush.
        // Prefer the key light's own tint (a warm sun on a blue day), else rotate the hue.
        if (hueGap(glow.h, upper.h) < 28) {
            const light = toHsl(sky.lightColor);
            const h = light.s > 0.05 && hueGap(light.h, glow.h) >= 28 ? light.h : (upper.h + 42) % 360;
            upper = accent({ h, s: Math.max(upper.s, 0.7), l: upper.l }, minSat);
        }
    }
    const zen = toHsl(sky.zenith);
    const deepHue = curated ? (curated[0]?.h ?? zen.h) : zen.h;
    const deep = fromHsl({ h: deepHue, s: clamp(Math.max(zen.s, 0.3), 0, 0.55), l: 0.065 });
    const glowHex = fromHsl(curated ? accent(glow, 0) : glow);
    return {
        glow: glowHex,
        sky: fromHsl(curated ? accent(upper, 0) : upper),
        deep,
        ink: '#0a0b10',
        preset: env.sky,
        hour: sky.hour,
    };
}
/** "17:30"-style clock label for an hour value. */
export function formatHour(hour) {
    const h = ((hour % 24) + 24) % 24;
    let hh = Math.floor(h);
    let mm = Math.round((h - hh) * 60);
    if (mm === 60) {
        mm = 0;
        hh = (hh + 1) % 24;
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
