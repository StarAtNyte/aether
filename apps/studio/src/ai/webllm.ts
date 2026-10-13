/**
 * On-device model loader (experimental). `@mlc-ai/web-llm` is imported
 * lazily, only when the user opts in from Settings, so it never touches the
 * first load. Requires WebGPU with 16-bit float shaders (q4f16 models);
 * everything else reports a clear "unsupported" reason instead of failing.
 */
import type { WebLlmEngineLike } from '@aether/agent';

/** WebGPU capability for on-device models. */
export interface WebGpuSupport {
  ok: boolean;
  reason: string;
}

interface GpuAdapterLike {
  features: { has(name: string): boolean };
}
interface GpuLike {
  requestAdapter(opts?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<GpuAdapterLike | null>;
}

/** Check WebGPU + shader-f16 without creating a device. */
export async function webGpuSupport(nav: { gpu?: unknown } | undefined = typeof navigator !== 'undefined' ? (navigator as { gpu?: unknown }) : undefined): Promise<WebGpuSupport> {
  const gpu = nav?.gpu as GpuLike | undefined;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return { ok: false, reason: 'This browser has no WebGPU (on-device models need it; Firefox on Linux, for example, does not offer it yet).' };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: 'No WebGPU adapter is available on this device.' };
    if (!adapter.features.has('shader-f16')) return { ok: false, reason: 'This GPU lacks 16-bit float shaders (shader-f16), which the on-device models need.' };
    return { ok: true, reason: '' };
  } catch {
    return { ok: false, reason: 'WebGPU could not be initialized.' };
  }
}

function isEngine(v: unknown): v is WebLlmEngineLike {
  if (typeof v !== 'object' || v === null) return false;
  const chat = (v as { chat?: { completions?: { create?: unknown } } }).chat;
  return typeof chat?.completions?.create === 'function';
}

/**
 * Download (or load from the browser cache) and initialize `model`.
 * `onProgress` receives 0–1 and a short status text.
 */
export async function loadWebLlmEngine(model: string, onProgress: (progress: number, text: string) => void): Promise<WebLlmEngineLike> {
  const webllm = await import('@mlc-ai/web-llm');
  const engine: unknown = await webllm.CreateMLCEngine(model, {
    initProgressCallback: (r: { progress: number; text: string }) => onProgress(Math.max(0, Math.min(1, r.progress)), String(r.text).slice(0, 160)),
  });
  if (!isEngine(engine)) throw new Error('the on-device engine has an unexpected shape');
  return engine;
}
