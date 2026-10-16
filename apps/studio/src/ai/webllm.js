/** Check WebGPU + shader-f16 without creating a device. */
export async function webGpuSupport(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
    const gpu = nav?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function')
        return { ok: false, reason: 'This browser has no WebGPU (on-device models need it; Firefox on Linux, for example, does not offer it yet).' };
    try {
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter)
            return { ok: false, reason: 'No WebGPU adapter is available on this device.' };
        if (!adapter.features.has('shader-f16'))
            return { ok: false, reason: 'This GPU lacks 16-bit float shaders (shader-f16), which the on-device models need.' };
        return { ok: true, reason: '' };
    }
    catch {
        return { ok: false, reason: 'WebGPU could not be initialized.' };
    }
}
function isEngine(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const chat = v.chat;
    return typeof chat?.completions?.create === 'function';
}
/**
 * Download (or load from the browser cache) and initialize `model`.
 * `onProgress` receives 0–1 and a short status text.
 */
export async function loadWebLlmEngine(model, onProgress) {
    const webllm = await import('@mlc-ai/web-llm');
    const engine = await webllm.CreateMLCEngine(model, {
        initProgressCallback: (r) => onProgress(Math.max(0, Math.min(1, r.progress)), String(r.text).slice(0, 160)),
    });
    if (!isEngine(engine))
        throw new Error('the on-device engine has an unexpected shape');
    return engine;
}
