/**
 * Renderer creation: `WebGPURenderer` on the WebGPU backend when the backend
 * policy allows it, otherwise (or when initialization fails) the same
 * renderer forced onto its WebGL2 backend. Browser-only; kept thin on
 * purpose. The policy itself ({@link pickBackend}, {@link adapterKnownGood})
 * is pure and unit-tested.
 *
 * Policy (`preference: 'auto'`):
 * - Chromium / Safari: WebGPU when `navigator.gpu` exists.
 * - Firefox (and forks such as Zen): WebGL2, unless the WebGPU adapter
 *   reports a known-good discrete GPU on Windows or macOS. Firefox's
 *   WebGPU on Linux (notably hybrid Intel + NVIDIA laptops) has crashed
 *   the whole browser, and its WebGL2 path is mature.
 * - A WebGPU init that never finished (the browser died during it) disables
 *   WebGPU permanently for this origin; see the crash guard below.
 *
 * `'webgpu'` / `'webgl2'` force a backend (WebGPU still falls back when it
 * cannot start).
 */
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import { errorMessage, log } from '../log';
/** Normalize an untrusted preference value (unknown values mean 'auto'). */
export function parseBackendPreference(value) {
    return value === 'webgpu' || value === 'webgl2' || value === 'auto' ? value : 'auto';
}
/** Pick the backend to try first. See the module docs for the policy. */
export function pickBackend(preference, env) {
    if (!env.webgpuAvailable || env.webgpuBlocked || preference === 'webgl2')
        return 'webgl2';
    if (preference === 'webgpu')
        return 'webgpu';
    if (!env.firefox)
        return 'webgpu';
    return env.linux ? 'webgl2' : 'probe';
}
/** Discrete / known-good GPU vendors for Firefox's WebGPU (Windows and macOS). */
const KNOWN_GOOD_VENDORS = /^(nvidia|amd|ati|apple)\b/i;
/** True when a Firefox WebGPU adapter is trusted: a real (non-fallback) discrete or Apple GPU. */
export function adapterKnownGood(info) {
    if (!info || info.isFallbackAdapter === true)
        return false;
    const vendor = typeof info.vendor === 'string' ? info.vendor.trim() : '';
    return KNOWN_GOOD_VENDORS.test(vendor);
}
/** One-line description of an adapter for the GPU budget (vendor, architecture, description). */
export function describeAdapter(info) {
    if (!info)
        return '';
    return [info.vendor, info.architecture, info.device, info.description]
        .filter((s) => typeof s === 'string' && s.trim().length > 0)
        .join(' ')
        .slice(0, 256);
}
/** Facts about the running browser. */
export function detectEnvironment() {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const n = typeof nav === 'object' && nav !== null ? nav : {};
    const ua = typeof n.userAgent === 'string' ? n.userAgent : '';
    const platform = typeof n.platform === 'string' ? n.platform : '';
    return {
        webgpuAvailable: Boolean(n.gpu),
        webgpuBlocked: !webgpuAllowed(),
        // Gecko browsers (Firefox, Zen, LibreWolf…) send "Gecko/<date>"; Chromium and Safari only "like Gecko".
        firefox: /\bGecko\/\d|\bFirefox\/\d/.test(ua),
        linux: /Linux/i.test(platform || ua) && !/Android/i.test(ua),
    };
}
/** localStorage key set while WebGPU initializes; still present on the next load means the browser died mid-init. */
const GPU_INIT_PENDING_KEY = 'aether.webgpuInitPending';
/** localStorage key that permanently disables WebGPU after a crash was detected. */
const GPU_DISABLED_KEY = 'aether.webgpuDisabled';
function storageGet(key) {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
function storageSet(key, value) {
    try {
        if (typeof localStorage === 'undefined')
            return;
        if (value === null)
            localStorage.removeItem(key);
        else
            localStorage.setItem(key, value);
    }
    catch {
        // Storage blocked (private mode / quota): the guard simply becomes a no-op.
    }
}
function webgpuAllowed() {
    if (storageGet(GPU_DISABLED_KEY) === '1')
        return false;
    if (storageGet(GPU_INIT_PENDING_KEY) === '1') {
        // The previous WebGPU init never completed: the browser most likely crashed during it.
        storageSet(GPU_INIT_PENDING_KEY, null);
        storageSet(GPU_DISABLED_KEY, '1');
        log.warn('Previous WebGPU initialization did not finish; using WebGL2 from now on');
        return false;
    }
    return true;
}
/** True when the renderer runs on the WebGPU backend. */
export function detectBackend(renderer) {
    const backend = renderer.backend;
    return typeof backend === 'object' && backend !== null && backend.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}
/** Ask Firefox's WebGPU adapter whether it is trusted. Never throws. */
async function probeAdapter() {
    try {
        const gpu = navigator.gpu;
        const adapter = gpu ? await gpu.requestAdapter({ powerPreference: 'high-performance' }) : null;
        if (!adapter)
            return false;
        const info = { ...(adapter.info ?? {}), ...(adapter.isFallbackAdapter === true ? { isFallbackAdapter: true } : {}) };
        const ok = adapterKnownGood(info);
        log.info(`WebGPU adapter "${describeAdapter(info) || 'unknown'}": ${ok ? 'trusted' : 'not trusted, using WebGL2'}`);
        return ok;
    }
    catch (e) {
        log.warn(`WebGPU adapter probe failed (${errorMessage(e)})`);
        return false;
    }
}
/** Best-effort description of the GPU the renderer runs on. Never throws. */
export function gpuInfoOf(renderer) {
    try {
        const backend = renderer.backend;
        if (backend.device)
            return { description: describeAdapter(backend.device.adapterInfo) };
        const gl = backend.gl;
        if (gl) {
            const plain = String(gl.getParameter(gl.RENDERER) ?? '');
            // Firefox returns the (sanitized) real renderer here; Chromium returns a generic name.
            if (plain && !/^webkit webgl$/i.test(plain))
                return { description: plain.slice(0, 256) };
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext)
                return { description: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').slice(0, 256) };
        }
    }
    catch {
        // Information only.
    }
    return { description: '' };
}
/** Create and initialize the renderer with the project-wide color/shadow settings. */
export async function createGpuRenderer(canvas, opts) {
    const { WebGPURenderer } = await import('three/webgpu');
    const attempt = async (forceWebGL) => {
        const r = new WebGPURenderer({ canvas, antialias: opts.antialias, forceWebGL, powerPreference: 'high-performance', alpha: false });
        // No dispose() on failure: nothing was allocated, and three's dispose() would re-run the
        // failed init through an un-awaited setAnimationLoop(), causing an unhandled rejection.
        await r.init();
        return r;
    };
    const preference = opts.preference ?? (opts.preferWebGPU === false ? 'webgl2' : 'auto');
    let decision = pickBackend(preference, detectEnvironment());
    let renderer;
    if (decision !== 'webgl2') {
        try {
            // The guard covers the adapter probe too: on broken drivers requesting an adapter can already crash.
            storageSet(GPU_INIT_PENDING_KEY, '1');
            if (decision === 'probe')
                decision = (await probeAdapter()) ? 'webgpu' : 'webgl2';
            if (decision === 'webgpu') {
                opts.onProgress?.('Initializing WebGPU…');
                renderer = await attempt(false);
                storageSet(GPU_INIT_PENDING_KEY, null);
                return finish(renderer, opts);
            }
            storageSet(GPU_INIT_PENDING_KEY, null);
        }
        catch (e) {
            storageSet(GPU_INIT_PENDING_KEY, null);
            log.warn(`WebGPU init failed (${errorMessage(e)}); falling back to WebGL2`);
            opts.onProgress?.('WebGPU unavailable, falling back to WebGL2…');
            return finish(await attempt(true), opts);
        }
    }
    opts.onProgress?.('Initializing WebGL2…');
    renderer = await attempt(true);
    return finish(renderer, opts);
}
function finish(renderer, opts) {
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    // PCFSoftShadowMap was removed in r186; PCF with a blur radius gives the same soft look.
    renderer.shadowMap.enabled = opts.shadows;
    renderer.shadowMap.type = PCFShadowMap;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, Math.max(0.5, opts.pixelRatioCap)));
    return { renderer, backend: detectBackend(renderer), gpu: gpuInfoOf(renderer) };
}
