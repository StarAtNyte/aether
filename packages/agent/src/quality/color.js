/**
 * Palette analysis for the materials criterion: hue families, saturation and
 * a simple harmony measure over the colours a world actually uses.
 */
/** HSL of a `#rrggbb` colour (h in degrees, s/l in 0–1); null when unparsable. */
export function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m?.[1])
        return null;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 1e-6)
        return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r)
        h = ((g - b) / d) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: Math.min(1, s), l };
}
/** Analyse a list of `#rrggbb` colours. */
export function paletteStats(hexes) {
    const hsl = hexes.map(hexToHsl).filter((c) => c !== null);
    if (hsl.length === 0)
        return { colors: 0, hueFamilies: 0, meanSaturation: 0, greyShare: 1, harmony: 0 };
    const families = new Map();
    let sat = 0;
    let grey = 0;
    for (const c of hsl) {
        sat += c.s;
        if (c.s < 0.12 || c.l < 0.06 || c.l > 0.95)
            grey++;
        else {
            const f = Math.floor(c.h / 30) % 12;
            families.set(f, (families.get(f) ?? 0) + 1);
        }
    }
    const saturated = hsl.length - grey;
    // Harmony: share of saturated colours inside the 3 most used hue families.
    const top = [...families.values()].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
    const harmony = saturated === 0 ? 0.5 : top / saturated;
    return { colors: hsl.length, hueFamilies: families.size, meanSaturation: sat / hsl.length, greyShare: grey / hsl.length, harmony };
}
