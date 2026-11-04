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
import { ACESFilmicToneMapping, BasicShadowMap, PCFShadowMap, SRGBColorSpace } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';
import { acquireAdapter, acquireDevice, type AdapterLike, type DeviceLike, type GpuLike } from './acquire';
import { geckoSafePath } from './gecko-safe';

/** Active GPU backend. */
export type BackendKind = 'webgpu' | 'webgl2';

/** Requested backend: automatic policy, or forced. */
export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';

/** Options of {@link createGpuRenderer}. */
export interface BackendOptions {
  /** Backend policy (default 'auto'). */
  preference?: BackendPreference;
  /** @deprecated use `preference`; `false` means 'webgl2'. */
  preferWebGPU?: boolean;
  /** Recorded as the reason when WebGL2 was forced by the caller (default 'requested'). */
  forcedReason?: BackendReason;
  antialias: boolean;
  shadows: boolean;
  pixelRatioCap: number;
  onProgress?: (msg: string) => void;
}

/** What the GPU reported about itself (best effort; strings may be empty). */
export interface GpuInfo {
  /** Human-readable GPU description, e.g. "Mesa Intel(R) UHD Graphics 620". */
  description: string;
  /** How the backend was chosen and why (shown in Settings, asserted by the e2e suites). */
  report: BackendReport;
}

/** Why a renderer runs on the backend it runs on. */
export type BackendReason =
  | 'webgpu'
  /** The user (or a test) asked for WebGL2. */
  | 'requested'
  /** The browser has no `navigator.gpu`. */
  | 'no-webgpu'
  /** A previous WebGPU start never finished (the browser died), so WebGPU is off for this origin. */
  | 'blocked-after-crash'
  /** Firefox on Linux, or a Firefox GPU that is not trusted: WebGL2 is the mature path there. */
  | 'firefox-policy'
  /** No WebGPU adapter after every retry. */
  | 'no-adapter'
  /** An adapter came but no device could be created from it. */
  | 'no-device'
  /** The renderer failed to initialize on WebGPU. */
  | 'init-failed'
  /** The WebGPU device was lost while running and the viewport was recreated on WebGL2. */
  | 'device-lost';

/** The record of one backend decision. */
export interface BackendReport {
  /** What was asked for. */
  requested: BackendPreference;
  /** What runs. */
  active: BackendKind;
  reason: BackendReason;
  /** WebGPU adapter requests made. */
  adapterAttempts: number;
  /** The adapter is the browser's software one (slow). */
  softwareAdapter: boolean;
  /** Request level that produced the device ('raised' limits, 'features', 'default'), or null off WebGPU. */
  deviceLevel: string | null;
  /** What happened, oldest first (capped). */
  events: string[];
}

/** Environment facts the policy needs (injectable for tests). */
export interface BackendEnvironment {
  webgpuAvailable: boolean;
  /** WebGPU disabled for this origin by the crash guard. */
  webgpuBlocked: boolean;
  /** Firefox or a Firefox fork (Gecko). */
  firefox: boolean;
  /** Desktop Linux (not Android). */
  linux: boolean;
}

/** Decision of {@link pickBackend}: a backend, or "ask the WebGPU adapter first". */
export type BackendDecision = BackendKind | 'probe';

/** Subset of `GPUAdapterInfo` used by the policy. */
export interface AdapterInfoLike {
  vendor?: string;
  architecture?: string;
  description?: string;
  device?: string;
  isFallbackAdapter?: boolean;
}

/** Normalize an untrusted preference value (unknown values mean 'auto'). */
export function parseBackendPreference(value: unknown): BackendPreference {
  return value === 'webgpu' || value === 'webgl2' || value === 'auto' ? value : 'auto';
}

/** Pick the backend to try first. See the module docs for the policy. */
export function pickBackend(preference: BackendPreference, env: BackendEnvironment): BackendDecision {
  if (!env.webgpuAvailable || env.webgpuBlocked || preference === 'webgl2') return 'webgl2';
  if (preference === 'webgpu') return 'webgpu';
  if (!env.firefox) return 'webgpu';
  return env.linux ? 'webgl2' : 'probe';
}

/** A WebGPU adapter that rasterises on the CPU (SwiftShader, lavapipe, llvmpipe) by its description. */
export function softwareAdapterInfo(info: AdapterInfoLike | null | undefined): boolean {
  if (!info) return false;
  return /swiftshader|lavapipe|llvmpipe|softpipe/i.test(`${info.vendor ?? ''} ${info.architecture ?? ''} ${info.device ?? ''} ${info.description ?? ''}`);
}

/** WebGL2 in this browser draws on a real GPU (not a software rasteriser). False when it cannot tell. */
export function hardwareWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name.length > 0 && !/swiftshader|llvmpipe|lavapipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}

/** Discrete / known-good GPU vendors for Firefox's WebGPU (Windows and macOS). */
const KNOWN_GOOD_VENDORS = /^(nvidia|amd|ati|apple)\b/i;

/** True when a Firefox WebGPU adapter is trusted: a real (non-fallback) discrete or Apple GPU. */
export function adapterKnownGood(info: AdapterInfoLike | null | undefined): boolean {
  if (!info || info.isFallbackAdapter === true) return false;
  const vendor = typeof info.vendor === 'string' ? info.vendor.trim() : '';
  return KNOWN_GOOD_VENDORS.test(vendor);
}

/** One-line description of an adapter for the GPU budget (vendor, architecture, description). */
export function describeAdapter(info: AdapterInfoLike | null | undefined): string {
  if (!info) return '';
  return [info.vendor, info.architecture, info.device, info.description]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .slice(0, 256);
}

/** Facts about the running browser. */
export function detectEnvironment(): BackendEnvironment {
  const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator;
  const n = typeof nav === 'object' && nav !== null ? (nav as { gpu?: unknown; userAgent?: unknown; platform?: unknown }) : {};
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

/** Ask Firefox's WebGPU adapter whether it is trusted. Never throws. */
async function probeAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<{ info?: AdapterInfoLike; isFallbackAdapter?: boolean } | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter({ powerPreference: 'high-performance' }) : null;
    if (!adapter) return false;
    const info: AdapterInfoLike = { ...(adapter.info ?? {}), ...(adapter.isFallbackAdapter === true ? { isFallbackAdapter: true } : {}) };
    const ok = adapterKnownGood(info);
    log.info(`WebGPU adapter "${describeAdapter(info) || 'unknown'}": ${ok ? 'trusted' : 'not trusted, using WebGL2'}`);
    return ok;
  } catch (e) {
    log.warn(`WebGPU adapter probe failed (${errorMessage(e)})`);
    return false;
  }
}

/** Best-effort description of the GPU the renderer runs on. Never throws. */
export function gpuInfoOf(renderer: WebGPURenderer): { description: string } {
  try {
    const backend = renderer.backend as unknown as { device?: { adapterInfo?: AdapterInfoLike }; gl?: WebGL2RenderingContext };
    if (backend.device) return { description: describeAdapter(backend.device.adapterInfo) };
    const gl = backend.gl;
    if (gl) {
      const plain = String(gl.getParameter(gl.RENDERER) ?? '');
      // Firefox returns the (sanitized) real renderer here; Chromium returns a generic name.
      if (plain && !/^webkit webgl$/i.test(plain)) return { description: plain.slice(0, 256) };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) return { description: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').slice(0, 256) };
    }
  } catch {
    // Information only.
  }
  return { description: '' };
}

const MAX_EVENTS = 24;

/** `reason` of a WebGL2 start that the policy chose (as opposed to a failed WebGPU start). */
export function policyReason(preference: BackendPreference, env: BackendEnvironment, decision: BackendDecision, forced?: BackendReason): BackendReason {
  if (decision === 'webgpu') return 'webgpu';
  if (preference === 'webgl2') return forced ?? 'requested';
  if (!env.webgpuAvailable) return 'no-webgpu';
  if (env.webgpuBlocked) return 'blocked-after-crash';
  return 'firefox-policy';
}

/**
 * Make three.js read instance matrices and skeleton bones from vertex attributes and a bone texture instead of
 * uniform blocks. A uniform block carries its array length and its node id in the shader source, so every
 * instanced mesh and every skeleton (every animal, every character) became a program of its own: a world of a
 * few hundred meshes linked well over a hundred large programs, one by one on the main thread. Through
 * attributes and a texture the source no longer names the mesh, and all meshes of a material share one program
 * (Highland Trail: 174 links down to about 110). three consults this limit in four places only (instancing,
 * skinning, `range()`), always to choose between those two paths.
 */
function shareInstancedPrograms(r: WebGPURenderer): void {
  try {
    const caps = (r as unknown as { backend?: { capabilities?: { getUniformBufferLimit?: () => number } } }).backend?.capabilities;
    if (caps && typeof caps.getUniformBufferLimit === 'function') caps.getUniformBufferLimit = () => 0;
  } catch {
    // The default paths still work, only with more programs.
  }
}

/** Create and initialize the renderer with the project-wide color/shadow settings. */
export async function createGpuRenderer(canvas: HTMLCanvasElement, opts: BackendOptions): Promise<{ renderer: WebGPURenderer; backend: BackendKind; gpu: GpuInfo }> {
  const { WebGPURenderer } = await import('three/webgpu');
  const preference = opts.preference ?? (opts.preferWebGPU === false ? 'webgl2' : 'auto');
  const events: string[] = [];
  const note = (line: string): void => {
    if (events.length < MAX_EVENTS) events.push(line);
  };
  const report = (active: BackendKind, reason: BackendReason, extra: Partial<BackendReport> = {}): BackendReport => ({
    requested: preference,
    active,
    reason,
    adapterAttempts: 0,
    softwareAdapter: false,
    deviceLevel: null,
    events: [...events],
    ...extra,
  });
  const attempt = async (forceWebGL: boolean, device?: DeviceLike): Promise<WebGPURenderer> => {
    const r = new WebGPURenderer({ canvas, antialias: opts.antialias, forceWebGL, powerPreference: 'high-performance', alpha: false, ...(device ? { device: device as unknown as GPUDevice } : {}) });
    // No dispose() on failure: nothing was allocated, and three's dispose() would re-run the
    // failed init through an un-awaited setAnimationLoop(), causing an unhandled rejection.
    await r.init();
    shareInstancedPrograms(r);
    return r;
  };
  const env = detectEnvironment();
  let decision = pickBackend(preference, env);
  const why = policyReason(preference, env, decision, opts.forcedReason);
  if (decision !== 'webgl2') {
    let failure: BackendReason = 'init-failed';
    let attempts = 0;
    try {
      // The guard covers the adapter probe too: on broken drivers requesting an adapter can already crash.
      storageSet(GPU_INIT_PENDING_KEY, '1');
      if (decision === 'probe') decision = (await probeAdapter()) ? 'webgpu' : 'webgl2';
      if (decision === 'webgpu') {
        opts.onProgress?.('Initializing WebGPU…');
        const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
        const got = gpu ? await acquireAdapter(gpu, { allowSoftwareAdapter: preference === 'webgpu' }) : null;
        attempts = got?.attempts ?? 0;
        for (const e of got?.events ?? []) note(e);
        const adapter: AdapterLike | null = got?.adapter ?? null;
        if (!adapter) {
          failure = 'no-adapter';
          throw new Error(`no WebGPU adapter after ${attempts} requests`);
        }
        const softwareAdapter = adapter.isFallbackAdapter === true || adapter.info?.isFallbackAdapter === true || softwareAdapterInfo(adapter.info);
        // Chromium on Linux without Vulkan hands WebGPU a CPU rasteriser (SwiftShader) while WebGL2 runs on the real GPU:
        // the GPU wins by an order of magnitude. Only an explicit WebGPU choice keeps the software adapter.
        if (softwareAdapter && preference !== 'webgpu' && hardwareWebGL()) {
          failure = 'no-adapter';
          throw new Error(`WebGPU adapter is a software rasteriser (${describeAdapter(adapter.info)}) while WebGL2 has a GPU`);
        }
        const dev = await acquireDevice(adapter);
        for (const e of dev.events) note(e);
        if (!dev.device) {
          failure = 'no-device';
          throw new Error('no WebGPU device could be created');
        }
        failure = 'init-failed';
        const renderer = await attempt(false, dev.device);
        storageSet(GPU_INIT_PENDING_KEY, null);
        note(`webgpu ready (${describeAdapter(adapter.info) || 'unknown adapter'}${softwareAdapter ? ', software' : ''})`);
        return finish(renderer, opts, report('webgpu', 'webgpu', { adapterAttempts: attempts, softwareAdapter, deviceLevel: dev.level }));
      }
      storageSet(GPU_INIT_PENDING_KEY, null);
    } catch (e) {
      storageSet(GPU_INIT_PENDING_KEY, null);
      log.warn(`WebGPU unavailable (${errorMessage(e)}); falling back to WebGL2`);
      note(`fell back to WebGL2: ${errorMessage(e).slice(0, 160)}`);
      opts.onProgress?.('WebGPU unavailable, falling back to WebGL2…');
      return finish(await attempt(true), opts, report('webgl2', failure, { adapterAttempts: attempts }));
    }
    note('Firefox WebGPU adapter not trusted; using WebGL2');
    opts.onProgress?.('Initializing WebGL2…');
    return finish(await attempt(true), opts, report('webgl2', 'firefox-policy'));
  }
  note(`WebGL2 (${why})`);
  opts.onProgress?.('Initializing WebGL2…');
  return finish(await attempt(true), opts, report('webgl2', why));
}

function finish(renderer: WebGPURenderer, opts: BackendOptions, report: BackendReport): { renderer: WebGPURenderer; backend: BackendKind; gpu: GpuInfo } {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  // PCFSoftShadowMap was removed in r186; PCF with a blur radius gives the same soft look.
  renderer.shadowMap.enabled = opts.shadows;
  // Firefox on WebGL2 warns that comparing a LINEAR-filtered depth texture is implementation-defined, which is what PCF
  // relies on: there the map is compared with NEAREST (Basic) and the sun's filter runs in the shader (sun-shadow-plan.ts).
  const description = gpuInfoOf(renderer).description;
  renderer.shadowMap.type = geckoSafePath(detectBackend(renderer), description) ? BasicShadowMap : PCFShadowMap;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, Math.max(0.5, opts.pixelRatioCap)));
  const backend = detectBackend(renderer);
  // three may land on WebGL2 although WebGPU was chosen (its own fallback); the report says what really runs.
  const real: BackendReport = backend === report.active ? report : { ...report, active: backend, reason: report.reason === 'webgpu' ? 'init-failed' : report.reason };
  return { renderer, backend, gpu: { ...gpuInfoOf(renderer), report: real } };
}
