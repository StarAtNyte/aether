/**
 * Renderer creation: `WebGPURenderer` on the WebGPU backend when available,
 * otherwise (or when initialization fails) the same renderer forced onto its
 * WebGL2 backend. Browser-only; kept thin on purpose.
 */
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';

/** Active GPU backend. */
export type BackendKind = 'webgpu' | 'webgl2';

/** Options of {@link createGpuRenderer}. */
export interface BackendOptions {
  preferWebGPU: boolean;
  antialias: boolean;
  shadows: boolean;
  pixelRatioCap: number;
  onProgress?: (msg: string) => void;
}

function hasWebGPU(): boolean {
  const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator;
  return typeof nav === 'object' && nav !== null && 'gpu' in nav && Boolean((nav as { gpu?: unknown }).gpu);
}

/** localStorage key set while WebGPU initializes; still present on the next load means the browser died mid-init. */
const GPU_INIT_PENDING_KEY = 'aether.webgpuInitPending';
/** localStorage key that permanently disables WebGPU after a crash was detected. */
const GPU_DISABLED_KEY = 'aether.webgpuDisabled';
function storageGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode / quota): the guard simply becomes a no-op.
  }
}

function webgpuAllowed(): boolean {
  if (storageGet(GPU_DISABLED_KEY) === '1') return false;
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
export function detectBackend(renderer: WebGPURenderer): BackendKind {
  const backend: unknown = renderer.backend;
  return typeof backend === 'object' && backend !== null && (backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}

/** Create and initialize the renderer with the project-wide color/shadow settings. */
export async function createGpuRenderer(canvas: HTMLCanvasElement, opts: BackendOptions): Promise<{ renderer: WebGPURenderer; backend: BackendKind }> {
  const { WebGPURenderer } = await import('three/webgpu');
  const attempt = async (forceWebGL: boolean): Promise<WebGPURenderer> => {
    const r = new WebGPURenderer({ canvas, antialias: opts.antialias, forceWebGL, powerPreference: 'high-performance', alpha: false });
    // No dispose() on failure: nothing was allocated, and three's dispose() would re-run the
    // failed init through an un-awaited setAnimationLoop(), causing an unhandled rejection.
    await r.init();
    return r;
  };
  let renderer: WebGPURenderer;
  if (opts.preferWebGPU && hasWebGPU() && webgpuAllowed()) {
    opts.onProgress?.('Initializing WebGPU…');
    try {
      storageSet(GPU_INIT_PENDING_KEY, '1');
      renderer = await attempt(false);
      storageSet(GPU_INIT_PENDING_KEY, null);
    } catch (e) {
      storageSet(GPU_INIT_PENDING_KEY, null);
      log.warn(`WebGPU init failed (${errorMessage(e)}); falling back to WebGL2`);
      opts.onProgress?.('WebGPU unavailable, falling back to WebGL2…');
      renderer = await attempt(true);
    }
  } else {
    opts.onProgress?.('Initializing WebGL2…');
    renderer = await attempt(true);
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  // PCFSoftShadowMap was removed in r186; PCF with a blur radius gives the same soft look.
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, Math.max(0.5, opts.pixelRatioCap)));
  return { renderer, backend: detectBackend(renderer) };
}
