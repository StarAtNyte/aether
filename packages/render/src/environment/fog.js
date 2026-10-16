import { mixHex } from './sky-state';
/** Absolute density cap honored for any world (higher values are a wall). */
export const MAX_FOG_DENSITY = 0.25;
/** Content radii are clamped into this range (metres) before scaling the fog. */
export const FOG_RADIUS_RANGE = Object.freeze([6, 150]);
/** How strongly a world fog color is pulled toward the sky horizon (0 = untouched). */
export const FOG_HORIZON_PULL = 0.65;
/**
 * World fog densities up to this value are read as "aerial perspective"
 * and never exceed the content cap; above it the world explicitly asks for a
 * foggy mood and may thicken up to {@link FOGGY_BOOST} × the cap.
 */
export const FOGGY_THRESHOLD = 0.02;
/** Largest multiple of the content cap a foggy world may reach. */
export const FOGGY_BOOST = 2;
/** World fog density at which the foggy boost is fully reached. */
const FOGGY_FULL = 0.05;
/**
 * Typical distance from the content center to backdrop scenery (mountain
 * rings sit ~110 m out) used to aim the preset haze.
 */
const BACKDROP_DISTANCE = 110;
/** Framing distance ≈ this many content radii (55° FOV, portrait-ish viewport). */
const VIEW_DISTANCE_RADII = 2.5;
function clampRadius(radius) {
    const [lo, hi] = FOG_RADIUS_RANGE;
    return Number.isFinite(radius) ? Math.min(hi, Math.max(lo, radius)) : lo;
}
/** Share of light lost to `FogExp2` with `density` at `distance` (0 = clear, 1 = fully fogged). */
export function fogAmount(density, distance) {
    const d = Math.max(0, density) * Math.max(0, distance);
    return 1 - Math.exp(-d * d);
}
/**
 * Density of the preset haze for a content radius (`amount` = {@link SkyState.hazeDensity}).
 * At amount 1 backdrop scenery seen from the framing distance is ~32 % hazed.
 */
export function hazeDensity(amount, radius) {
    if (!(amount > 0))
        return 0;
    const r = clampRadius(radius);
    return (0.62 * amount) / (VIEW_DISTANCE_RADII * r + BACKDROP_DISTANCE);
}
/**
 * Largest aerial-perspective density that keeps content of `radius`
 * readable: its far edge, seen from the framing distance, stays under ~5 % fog.
 */
export function maxContentFogDensity(radius) {
    return 0.22 / ((VIEW_DISTANCE_RADII + 1) * clampRadius(radius));
}
/** Effective density of a world fog request `wanted` for content of `radius` (see {@link FOGGY_THRESHOLD}). */
export function worldFogDensity(wanted, radius) {
    const cap = maxContentFogDensity(radius);
    const w = Math.min(MAX_FOG_DENSITY, Math.max(0, wanted));
    if (w <= FOGGY_THRESHOLD)
        return Math.min(w, cap);
    const boost = 1 + (FOGGY_BOOST - 1) * Math.min(1, (w - FOGGY_THRESHOLD) / (FOGGY_FULL - FOGGY_THRESHOLD));
    return Math.min(w, cap * boost);
}
/**
 * Fog for an environment, its computed sky and the radius of the meaningful
 * content (see `contentFraming`). Null when there is no fog at all (space,
 * studio without a world fog).
 */
export function resolveFog(env, sky, contentRadius) {
    const haze = sky.showGround && env.ground ? hazeDensity(sky.hazeDensity, contentRadius) : 0;
    const fog = env.fog;
    if (fog && Number.isFinite(fog.density) && fog.density > 0) {
        // `visibility` is aerial perspective by distance (63 % haze at that range), independent of the content-size policy.
        const aerial = fog.visibility !== undefined && fog.visibility > 0 ? Math.min(MAX_FOG_DENSITY, 1 / fog.visibility) : 0;
        const density = Math.max(haze, aerial, worldFogDensity(fog.density, contentRadius));
        return { color: mixHex(fog.color, sky.fogColor, FOG_HORIZON_PULL), density };
    }
    return haze > 0 ? { color: sky.fogColor, density: haze } : null;
}
