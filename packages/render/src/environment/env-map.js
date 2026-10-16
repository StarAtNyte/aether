import { mixHex, SKY_GRADIENT_POWER } from './sky-state';
/** Environment image width (pixels). PMREM filtering makes a small image enough. */
export const ENV_MAP_WIDTH = 64;
/** Environment image height (pixels). */
export const ENV_MAP_HEIGHT = 32;
function rgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function lerp3(a, b, t, out) {
    const k = Math.max(0, Math.min(1, t));
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    out[2] = a[2] + (b[2] - a[2]) * k;
    return out;
}
/**
 * RGBA8 sRGB pixels (row 0 = straight down, matching three's equirect
 * mapping with `flipY = false`) for `state`. `ground` is the ground color
 * ("#rrggbb", null when the world has none). `horizon` overrides the
 * horizon color (the renderer passes its fog color so reflections, fog and
 * dome agree).
 */
export function skyEnvironmentPixels(state, ground, horizon = state.horizon, width = ENV_MAP_WIDTH, height = ENV_MAP_HEIGHT) {
    const w = Math.max(4, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    const out = new Uint8Array(w * h * 4);
    // The zenith's deep blue is a small solid angle of what a wall or floor sees: lighten it toward the
    // horizon so shaded white surfaces read pale blue-grey, as they do outdoors, not saturated blue.
    const zen = rgb(mixHex(mixHex(state.zenith, horizon, 0.35), '#dcdad6', 0.4));
    const hor = rgb(mixHex(horizon, '#dcdad6', 0.2));
    // Light bouncing off the ground: its albedo darkened by how little light there is.
    const lit = state.moon ? 0.18 : state.showGround ? 0.42 : 0.1;
    const bottom = rgb(ground ? mixHex(mixHex(ground, '#000000', 1 - lit), state.nadir, 0.25) : state.nadir);
    const glow = rgb(state.sunGlow);
    const sun = state.lightDirection;
    const c = [0, 0, 0];
    for (let j = 0; j < h; j++) {
        const y = Math.sin(((j + 0.5) / h - 0.5) * Math.PI);
        const cosT = Math.sqrt(Math.max(0, 1 - y * y));
        for (let i = 0; i < w; i++) {
            const phi = ((i + 0.5) / w - 0.5) * Math.PI * 2;
            const dx = Math.cos(phi) * cosT;
            const dz = Math.sin(phi) * cosT;
            if (y >= 0)
                lerp3(hor, zen, Math.pow(y, SKY_GRADIENT_POWER), c);
            else
                lerp3(hor, bottom, Math.min(1, -y * 6), c);
            if (state.sunGlowStrength > 0 && y > -0.05) {
                const k = Math.max(0, dx * sun[0] + y * sun[1] + dz * sun[2]);
                const g = (Math.pow(k, 24) * 0.8 + Math.pow(k, 4) * 0.2) * state.sunGlowStrength;
                c[0] += glow[0] * g;
                c[1] += glow[1] * g;
                c[2] += glow[2] * g;
            }
            const o = (j * w + i) * 4;
            out[o] = Math.round(Math.min(1, c[0]) * 255);
            out[o + 1] = Math.round(Math.min(1, c[1]) * 255);
            out[o + 2] = Math.round(Math.min(1, c[2]) * 255);
            out[o + 3] = 255;
        }
    }
    return out;
}
