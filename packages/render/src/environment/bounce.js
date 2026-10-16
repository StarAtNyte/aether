/** Albedo of the typical lit floor the bounce comes from (mid-light timber, tile and stone). */
export const BOUNCE_FLOOR_ALBEDO = 0.62;
/** Intensity of the bounce without any sun (sky light alone coming through the windows). */
export const BOUNCE_BASE = 0.6;
/** Intensity added per unit of key-light intensity at full daylight. */
export const BOUNCE_PER_SUN = 0.16;
/** Strength of the neutral ambient fill relative to the bounce intensity (a rendered room is never lit by the sky alone). */
export const INTERIOR_FILL = 0.9;
/** Share of the bounce kept under the moon (lamps carry the night). */
export const BOUNCE_MOON_SHARE = 0.18;
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    const v = m ? parseInt(m[1], 16) : 0xffffff;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(c) {
    return `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
}
/**
 * The bounce of a sky state. Warm sun lands on a warm floor: the colour is the key light mixed toward
 * warm white and darkened by the floor albedo; a low sun bounces less than a high one.
 */
export function interiorBounce(sky) {
    const light = hexToRgb(sky.lightColor);
    const warm = hexToRgb('#ffe9d0');
    const mixed = light.map((c, i) => (c * 0.5 + warm[i] * 0.5) * BOUNCE_FLOOR_ALBEDO);
    const elevation = Number.isFinite(sky.elevation) ? sky.elevation : 0;
    const day = Math.max(0, Math.min(1, Math.sin((elevation * Math.PI) / 180)));
    const sun = Math.max(0, Math.min(4, Number.isFinite(sky.lightIntensity) ? sky.lightIntensity : 0));
    let intensity = BOUNCE_BASE + BOUNCE_PER_SUN * sun * (0.35 + 0.65 * day);
    if (sky.moon || sky.preset === 'space')
        intensity *= BOUNCE_MOON_SHARE;
    return { color: rgbToHex(mixed), intensity };
}
