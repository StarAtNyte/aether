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
  if (opts.preferWebGPU && hasWebGPU()) {
    opts.onProgress?.('Initializing WebGPU…');
    try {
      renderer = await attempt(false);
    } catch (e) {
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
