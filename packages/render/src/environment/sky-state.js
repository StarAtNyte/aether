import { skyKeys, sunTransmittance } from './atmosphere';
/**
 * Hours each natural preset may use (inclusive). Day/overcast keep the sun
 * at least ~25° high, dawn/sunset keep it ~7–17° above the horizon on the
 * correct side of noon, night keeps it well below the horizon (the moon is
 * the key light). Outside the window the hour is clamped to the nearest edge.
 */
export const PRESET_WINDOWS = Object.freeze({
    day: [7.6, 16.4],
    overcast: [7.6, 16.4],
    dawn: [6.38, 7],
    sunset: [17, 17.62],
});
/** Night hours run from {@link NIGHT_WINDOW}[0] through midnight to [1]. */
export const NIGHT_WINDOW = Object.freeze([20.5, 3.5]);
/** Exposure multiplier per preset (dim presets are lifted so they stay readable). */
export const PRESET_EXPOSURE = Object.freeze({
    day: 1,
    dawn: 1,
    sunset: 1.02,
    night: 1.6,
    overcast: 1.05,
    space: 1.05,
    studio: 1.02,
});
/**
 * Clamp an hour into the window of `preset` (see {@link PRESET_WINDOWS}).
 * Space and studio ignore the hour; they return it normalized.
 */
export function presetHour(preset, hour) {
    const h = normalizeHour(hour);
    if (preset === 'night') {
        const [from, to] = NIGHT_WINDOW;
        if (h >= from || h <= to)
            return h;
        return h < 12 ? to : from;
    }
    if (preset === 'space' || preset === 'studio')
        return h;
    const [lo, hi] = PRESET_WINDOWS[preset];
    return Math.min(hi, Math.max(lo, h));
}
/** Default hour for each preset when `timeOfDay` is not set. */
export const PRESET_HOURS = Object.freeze({
    day: 13,
    dawn: 6.5,
    sunset: 17.5,
    night: 23,
    overcast: 12,
    space: 10,
    studio: 11,
});
/** Peak sun elevation at noon in degrees. */
const MAX_ELEVATION = 70;
/**
 * Horizontal direction (degrees) of the default framing camera as seen from
 * the content (0 = camera on +Z). Mirrors `DEFAULT_FRAMING_AZIMUTH` of the
 * view module; sun bearings are chosen relative to it.
 */
export const VIEW_AZIMUTH = 28;
/** Bearing of the noon sun relative to the view (degrees, negative = from the camera's left). */
const NOON_BEARING = -60;
/** Bearing of the rising sun at 06:00 (from the right, slightly behind the content). */
const SUNRISE_BEARING = 92;
/** Bearing of the setting sun at 18:00 (from the left, slightly behind the content). */
const SUNSET_BEARING = -108;
/** Bearing of the moon at night (from the right, behind the content: silver rim light). */
export const MOON_BEARING = 105;
/** Moon elevation in degrees. */
const MOON_ELEVATION = 38;
/** Exponent of the dome's horizon → zenith gradient (lower = the zenith color reaches further down). */
export const SKY_GRADIENT_POWER = 0.42;
/** Dawn/sunset skies are sampled this many degrees below the light elevation (deeper colors). */
export const GOLDEN_SKY_DROP = 6;
function parseHex(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(c) {
    const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}
/** Linear interpolation between two "#rrggbb" colors (sRGB space). */
export function mixHex(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    const ca = parseHex(a);
    const cb = parseHex(b);
    return toHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}
function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}
/** Natural sky keyframes by sun elevation (degrees). */
const NATURAL = [
    { at: -90, zenith: '#060b1f', horizon: '#1a2650', sun: '#9db4ff' },
    { at: -14, zenith: '#0a1430', horizon: '#22305c', sun: '#9db4ff' },
    { at: -6, zenith: '#1b2a5c', horizon: '#5a4670', sun: '#ff5a2a' },
    { at: 0, zenith: '#34508e', horizon: '#ff9459', sun: '#ff8340' },
    { at: 8, zenith: '#5582c6', horizon: '#ffc792', sun: '#ffc48a' },
    { at: 25, zenith: '#3f82db', horizon: '#b3d3f0', sun: '#fff1dc' },
    { at: 90, zenith: '#336fd0', horizon: '#bcd9f2', sun: '#ffffff' },
];
function sampleKeys(elevation) {
    const first = NATURAL[0];
    if (elevation <= first.at)
        return first;
    for (let i = 1; i < NATURAL.length; i++) {
        const b = NATURAL[i];
        if (elevation <= b.at) {
            const a = NATURAL[i - 1];
            const t = (elevation - a.at) / (b.at - a.at);
            return { zenith: mixHex(a.zenith, b.zenith, t), horizon: mixHex(a.horizon, b.horizon, t), sun: mixHex(a.sun, b.sun, t) };
        }
    }
    return NATURAL[NATURAL.length - 1];
}
/** Linear [0, 1] RGB to "#rrggbb" (sRGB encoded). */
function linearToHex(c) {
    const enc = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
    return toHex([enc(c[0]), enc(c[1]), enc(c[2])]);
}
/** Sky turbidity (aerosol amount) of the physical sky model. */
const TURBIDITY = 1.6;
/**
 * Sky colours for a sun elevation: the physical single-scattering model ({@link skyKeys}) takes over from the
 * art-directed night keyframes as the sun rises through the twilight belt (-9° to -2°), so dawn, noon and
 * dusk skies come out of the same model as the dome's per-direction colours.
 */
function sampleSky(elevation) {
    const legacy = sampleKeys(elevation);
    const w = smoothstep(-9, -2, elevation);
    if (w <= 0)
        return legacy;
    const phys = skyKeys(elevation, TURBIDITY);
    const t = sunTransmittance(elevation, [0, 0, 0]);
    // Direct sun: the physical transmittance, softened toward the keyed colour (keeps a warm white at noon).
    const sunPhys = linearToHex([Math.pow(t[0], 0.9), Math.pow(t[1], 1.15), Math.pow(t[2], 1.5)]);
    return {
        zenith: mixHex(legacy.zenith, linearToHex(phys.zenith), w),
        horizon: mixHex(legacy.horizon, linearToHex(phys.horizon), w),
        sun: mixHex(legacy.sun, mixHex(legacy.sun, sunPhys, 0.55), w),
    };
}
/** Normalize an hour into [0, 24). Non-finite → 12. */
export function normalizeHour(h) {
    if (!Number.isFinite(h))
        return 12;
    if (h >= 0 && h < 24)
        return h;
    return ((h % 24) + 24) % 24;
}
/**
 * Bearing of the sun relative to the default view (degrees, 0 = behind the
 * camera, ±90 = from the side, ±180 = straight into the camera) for an hour.
 * Morning light comes from the right, afternoon light from the left; the
 * bearing stays within ±110° so the camera never stares into a low sun.
 */
export function sunBearing(hour) {
    const h = normalizeHour(hour);
    if (h <= 12)
        return NOON_BEARING + ((12 - Math.max(6, h)) / 6) * (SUNRISE_BEARING - NOON_BEARING);
    return NOON_BEARING + ((Math.min(18, h) - 12) / 6) * (SUNSET_BEARING - NOON_BEARING);
}
/** Unit vector toward a light at `bearing` (relative to the view) and `elevation` (degrees). */
export function bearingDirection(bearing, elevation) {
    const phi = ((VIEW_AZIMUTH + bearing) * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    const c = Math.cos(e);
    return [Math.sin(phi) * c, Math.sin(e), Math.cos(phi) * c];
}
/** Sun elevation (degrees) and unit direction toward the sun for an hour. */
export function sunPosition(hour) {
    const h = normalizeHour(hour);
    const elevation = MAX_ELEVATION * Math.sin(((h - 6) / 12) * Math.PI);
    return { elevation, direction: bearingDirection(sunBearing(h), elevation) };
}
/** Moonlight key intensity for a world `sunIntensity` (bright enough to read the scene, never daylight). */
function moonIntensity(sunIntensity) {
    return Math.min(1, 0.52 + sunIntensity * 0.14);
}
/** Compute the full sky state for an environment. */
export function computeSkyState(env) {
    const preset = Object.hasOwn(PRESET_HOURS, env.sky) ? env.sky : 'day';
    const hour = presetHour(preset, env.timeOfDay ?? PRESET_HOURS[preset]);
    const sunIntensity = Number.isFinite(env.sunIntensity) ? Math.max(0, env.sunIntensity) : 2.5;
    const ambient = Number.isFinite(env.ambientIntensity) ? Math.max(0, env.ambientIntensity) : 0.4;
    const { elevation, direction } = sunPosition(hour);
    const golden = preset === 'dawn' || preset === 'sunset';
    // Golden-hour presets paint the sky (and tint the light) as if the sun sat a little lower.
    const skyElevation = golden ? elevation - GOLDEN_SKY_DROP : elevation;
    const day = smoothstep(-4, 10, elevation);
    const keys = sampleSky(skyElevation);
    const moon = elevation < -4;
    const lightDirection = moon ? bearingDirection(MOON_BEARING, MOON_ELEVATION) : direction;
    normalize(lightDirection);
    const glow = 1 - smoothstep(4, 30, skyElevation);
    const state = {
        hour,
        elevation,
        lightDirection,
        lightColor: moon ? '#a9bcff' : golden ? mixHex(keys.sun, '#ffb070', 0.25) : keys.sun,
        lightIntensity: moon ? moonIntensity(sunIntensity) : sunIntensity * Math.max(0.05, day) * (golden ? 1.15 : 1),
        moon,
        zenith: keys.zenith,
        horizon: keys.horizon,
        nadir: mixHex(keys.horizon, '#20242c', 0.6),
        sunGlow: keys.sun,
        sunGlowStrength: moon ? 0 : 0.25 + 0.75 * glow,
        // Skylight is bluish but not the zenith's saturated blue: shaded white walls read pale blue-grey.
        hemiSky: moon ? '#4d5a80' : mixHex(mixHex(keys.zenith, keys.horizon, 0.45), '#dcdad6', 0.62),
        hemiGround: moon ? '#1c1f2a' : mixHex('#4a3f2e', keys.sun, 0.12 + 0.2 * glow),
        hemiIntensity: ambient * 2 * (moon ? 0.75 : 0.4 + 0.6 * day),
        stars: smoothstep(-2, -12, elevation),
        nebula: 0.3 * smoothstep(-8, -20, elevation),
        // Fog is the horizon haze: pale at noon, tinted by the sunlight (gold, rose) as the sun gets low.
        fogColor: mixHex(mixHex(keys.horizon, '#e4e2de', 0.32 * day), keys.sun, 0.28 * glow * day),
        hazeDensity: moon ? 0.5 : 0.4 + 0.25 * glow,
        showGround: true,
        exposure: PRESET_EXPOSURE[preset],
        envIntensity: moon ? 0.35 : 0.45 + 0.15 * glow,
        preset,
        clouds: moon ? 0.28 : golden ? 0.5 : 0.42,
    };
    if (preset === 'day' || preset === 'dawn' || preset === 'sunset' || preset === 'night') {
        const weight = smoothstep(-9, -2, skyElevation);
        if (weight > 0)
            state.physical = { sunDirection: normalize(bearingDirection(sunBearing(hour), skyElevation)), elevation: skyElevation, weight, turbidity: TURBIDITY };
    }
    switch (preset) {
        case 'dawn':
            // Softer and pinker than a sunset at the same elevation.
            return {
                ...state,
                zenith: mixHex(state.zenith, '#5d78c9', 0.35),
                horizon: mixHex(state.horizon, '#ffb48c', 0.4),
                fogColor: mixHex(state.horizon, '#f2b9a2', 0.4),
                sunGlow: mixHex(state.sunGlow, '#ffd0b8', 0.4),
                lightColor: mixHex(state.lightColor, '#ffd6c2', 0.3),
            };
        case 'overcast':
            return {
                ...state,
                // Moody grey-blue cloud deck: diffuse, almost shadowless light.
                zenith: mixHex('#66717f', keys.zenith, 0.1),
                horizon: mixHex('#a7afb9', keys.horizon, 0.08),
                nadir: '#7d848c',
                lightColor: '#dfe6ee',
                lightIntensity: moon ? moonIntensity(sunIntensity) * 0.5 : sunIntensity * 0.2 * Math.max(0.1, day),
                sunGlowStrength: 0,
                hemiSky: '#bcc5d0',
                hemiGround: '#55534d',
                hemiIntensity: ambient * 3.4 * (0.3 + 0.7 * day),
                stars: 0,
                nebula: 0,
                fogColor: '#9ea7b2',
                hazeDensity: 0.9,
                envIntensity: 0.55,
                clouds: 0.9,
            };
        case 'space':
            return {
                ...state,
                lightDirection: normalize([0.45, 0.6, 0.35]),
                lightColor: '#ffffff',
                lightIntensity: sunIntensity,
                moon: false,
                zenith: '#000003',
                horizon: '#04050c',
                nadir: '#000002',
                sunGlow: '#fff6e0',
                sunGlowStrength: 0.4,
                hemiSky: '#3a4060',
                hemiGround: '#0a0a12',
                hemiIntensity: ambient * 0.8,
                stars: 1,
                nebula: 1,
                fogColor: '#000003',
                hazeDensity: 0,
                showGround: false,
                envIntensity: 0.25,
                clouds: 0,
            };
        case 'studio':
            return {
                ...state,
                lightDirection: normalize([0.5, 0.8, 0.45]),
                lightColor: '#fff8f0',
                lightIntensity: sunIntensity,
                moon: false,
                zenith: '#b9bec6',
                horizon: '#e9ebee',
                nadir: '#d4d7dc',
                sunGlow: '#ffffff',
                sunGlowStrength: 0,
                hemiSky: '#ffffff',
                hemiGround: '#8a8d93',
                hemiIntensity: ambient * 3,
                stars: 0,
                nebula: 0,
                fogColor: '#e9ebee',
                hazeDensity: 0,
                envIntensity: 0.6,
                clouds: 0,
            };
        default:
            return state;
    }
}
function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    v[0] /= l;
    v[1] /= l;
    v[2] /= l;
    return v;
}
