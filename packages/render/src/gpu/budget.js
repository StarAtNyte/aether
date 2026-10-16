/**
 * GPU memory budgets. Pure functions (no DOM, no three.js) so the policy is
 * unit-tested: which GPU class a renderer string describes, and how many
 * pixels, how large a shadow map and which post effects each class gets.
 *
 * Why pixels dominate: every drawn pixel costs a multisampled half-float
 * colour + depth target (4× MSAA), its resolve targets, the bloom chain
 * and the swap chain — measured at roughly 100–140 bytes per drawing-buffer
 * pixel. A 1700×1400 viewport at device pixel ratio 2 is 9.5 MP ≈ 1.2 GB;
 * on an integrated GPU that memory is the system RAM the browser also
 * needs. So every class gets a pixel-ratio cap AND an absolute pixel cap.
 */
/** Lowest pixel ratio the budget ever applies (keeps text-free 3D legible). */
export const MIN_PIXEL_RATIO = 0.5;
/** Measured drawing-buffer cost per pixel with MSAA + post (bytes), used for estimates. */
export const BYTES_PER_PIXEL_POST = 120;
/** Measured drawing-buffer cost per pixel without MSAA or post (bytes). */
export const BYTES_PER_PIXEL_PLAIN = 32;
const MB = 1024 * 1024;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|swrast|software|basic render|warp/i;
const DISCRETE = /nvidia|geforce|quadro|tesla|\brtx\b|\bgtx\b|radeon\s*(\(tm\)\s*)?(rx|pro|r9|r7|vii)|\bfirepro\b|\barc\s*(\(tm\))?\s*a\d|apple\s*m\d|apple\s*gpu|^apple\b/i;
const INTEGRATED = /intel|\buhd\b|\biris\b|hd graphics|mali|adreno|powervr|videocore|radeon\s*(\(tm\)\s*)?(vega\s*\d+\s*)?graphics|amd\s+radeon\s*(\(tm\)\s*)?graphics|\bapu\b|tegra/i;
/**
 * Classify a GPU from a renderer / adapter description (WebGL
 * `UNMASKED_RENDERER_WEBGL`, Firefox's sanitized `RENDERER`, or WebGPU
 * `adapter.info` vendor + architecture + description). Software
 * rasterizers win over everything; Apple silicon counts as discrete
 * (unified memory, fast); unrecognised strings are 'unknown', which gets
 * the integrated budget.
 */
export function classifyGpu(description) {
    const d = typeof description === 'string' ? description.slice(0, 512) : '';
    if (!d.trim())
        return 'unknown';
    if (SOFTWARE.test(d))
        return 'software';
    if (DISCRETE.test(d))
        return 'discrete';
    if (INTEGRATED.test(d))
        return 'integrated';
    return 'unknown';
}
/**
 * The budget of a GPU class. Low-memory mode overrides the class: DPR 1, at
 * most ~1 MP, 1024² shadows, no post pass, no MSAA, a quarter of the
 * instances and a small generator cache.
 */
export function renderBudget(tier, lowMemory) {
    if (lowMemory) {
        return { pixelRatioCap: 1, maxPixels: 1.05e6, shadowMapCap: 1024, post: false, antialias: false, maxInstances: 40_000, generatorCacheBytes: 16 * MB, fieldInstances: 300_000, fieldTriangles: 600_000, virtualTriangles: 400_000, voxelViewDistance: 6, finishTextureSize: 256 };
    }
    switch (tier) {
        case 'discrete':
            return { pixelRatioCap: 1.5, maxPixels: 3.7e6, shadowMapCap: 2048, post: true, antialias: true, maxInstances: 150_000, generatorCacheBytes: 64 * MB, fieldInstances: 2_000_000, fieldTriangles: 4_000_000, virtualTriangles: 3_000_000, voxelViewDistance: 16, finishTextureSize: 512 };
        case 'software':
            return { pixelRatioCap: 1, maxPixels: 1.4e6, shadowMapCap: 1024, post: true, antialias: true, maxInstances: 80_000, generatorCacheBytes: 32 * MB, fieldInstances: 1_000_000, fieldTriangles: 300_000, virtualTriangles: 250_000, voxelViewDistance: 8, finishTextureSize: 256 };
        case 'integrated':
        case 'unknown':
        default:
            return { pixelRatioCap: 1.25, maxPixels: 2.1e6, shadowMapCap: 2048, post: true, antialias: true, maxInstances: 120_000, generatorCacheBytes: 48 * MB, fieldInstances: 1_200_000, fieldTriangles: 2_000_000, virtualTriangles: 1_500_000, voxelViewDistance: 12, finishTextureSize: 256 };
    }
}
/**
 * Pixel ratio for a `cssWidth`×`cssHeight` canvas on a `devicePixelRatio`
 * display under `budget`: the smallest of the device ratio, the budget's
 * ratio cap and the ratio that keeps the drawing buffer within
 * `maxPixels`, never below {@link MIN_PIXEL_RATIO}. Invalid inputs give 1.
 */
export function effectivePixelRatio(devicePixelRatio, cssWidth, cssHeight, budget) {
    const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const cap = Number.isFinite(budget.pixelRatioCap) && budget.pixelRatioCap > 0 ? budget.pixelRatioCap : 1;
    let ratio = Math.min(dpr, cap);
    const area = cssWidth * cssHeight;
    if (Number.isFinite(area) && area > 0 && Number.isFinite(budget.maxPixels) && budget.maxPixels > 0) {
        ratio = Math.min(ratio, Math.sqrt(budget.maxPixels / area));
    }
    // Two decimals: avoids reallocating the drawing buffer for sub-pixel jitter on resize.
    return Math.max(MIN_PIXEL_RATIO, Math.floor(ratio * 100) / 100);
}
/** Rough drawing-buffer memory (MB) of a `width`×`height` buffer, for diagnostics. */
export function estimateFramebufferMB(width, height, post) {
    const px = Math.max(0, width) * Math.max(0, height);
    return (px * (post ? BYTES_PER_PIXEL_POST : BYTES_PER_PIXEL_PLAIN)) / MB;
}
/** Shadow map memory (MB) of an `edge`² depth map plus its colour attachment. */
export function estimateShadowMB(edge) {
    return (Math.max(0, edge) ** 2 * 8) / MB;
}
