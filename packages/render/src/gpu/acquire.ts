/**
 * Getting a WebGPU adapter and device, robustly.
 *
 * `navigator.gpu.requestAdapter()` resolves to `null` now and then on a machine whose GPU is perfectly fine (a driver
 * that is still initializing, another process holding the device, a hybrid laptop waking its discrete GPU). Asking once
 * and giving up silently makes the default Chrome path look worse than WebGL2 on one run in four. So:
 *
 * - the request is retried a few times with a short back-off, each time over a short list of option sets (a discrete
 *   GPU first, then the browser's own choice, then the compatibility feature level);
 * - every request has a time limit, so a hung driver cannot hold up start-up;
 * - the software adapter (`forceFallbackAdapter`) is only asked for when WebGPU was explicitly requested;
 * - the device is requested with every feature the adapter has that the renderer can use and with the limits raised to
 *   what the adapter offers (more sampled textures, bigger buffers), then again with defaults if that is refused;
 * - everything that happened is returned as a list of lines, shown in Settings and logged.
 *
 * Pure with respect to the browser: the GPU object is injected, so every path is unit-tested.
 */

/** The parts of `GPUAdapter` the acquisition uses. */
export interface AdapterLike {
  readonly features?: ReadonlySet<string>;
  readonly limits?: Readonly<Record<string, unknown>>;
  readonly info?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean };
  readonly isFallbackAdapter?: boolean;
  requestDevice(descriptor?: { requiredFeatures?: string[]; requiredLimits?: Record<string, number> }): Promise<DeviceLike>;
}

/** The parts of `GPUDevice` the acquisition returns. */
export interface DeviceLike {
  readonly features?: ReadonlySet<string>;
  readonly lost?: Promise<{ reason?: string; message?: string }>;
}

/** The parts of `navigator.gpu` the acquisition uses. */
export interface GpuLike {
  requestAdapter(options?: Record<string, unknown>): Promise<AdapterLike | null>;
}

/** What {@link acquireAdapter} tries, in order, in every round. */
export const ADAPTER_REQUESTS: readonly Readonly<Record<string, unknown>>[] = Object.freeze([{ powerPreference: 'high-performance' }, {}, { featureLevel: 'compatibility' }]);

/** Options of the acquisition (all injectable for tests). */
export interface AcquireOptions {
  /** Rounds over {@link ADAPTER_REQUESTS} (default 3). */
  rounds?: number;
  /** Pause before round 2, 3, … in ms (default 120 then 350). */
  delaysMs?: readonly number[];
  /** Give up on one request after this long (default 4000 ms). */
  requestTimeoutMs?: number;
  /** Also ask for the software adapter as a last resort (only when WebGPU was explicitly requested). */
  allowSoftwareAdapter?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Result of {@link acquireAdapter}. */
export interface AdapterResult {
  adapter: AdapterLike | null;
  /** Requests made until the adapter came (or all of them). */
  attempts: number;
  /** The options of the request that succeeded. */
  options: Readonly<Record<string, unknown>> | null;
  /** What happened, one line per request. */
  events: string[];
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => void (timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)))]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 160);
}

/** Request an adapter with retries; never throws. */
export async function acquireAdapter(gpu: GpuLike, opts: AcquireOptions = {}): Promise<AdapterResult> {
  const rounds = Math.max(1, Math.min(6, Math.floor(opts.rounds ?? 3)));
  const delays = opts.delaysMs ?? [120, 350];
  const timeout = Math.max(100, opts.requestTimeoutMs ?? 4000);
  const sleep = opts.sleep ?? defaultSleep;
  const events: string[] = [];
  let attempts = 0;
  const ask = async (options: Readonly<Record<string, unknown>>): Promise<AdapterLike | null> => {
    attempts++;
    const label = JSON.stringify(options);
    try {
      const adapter = await withTimeout(Promise.resolve(gpu.requestAdapter({ ...options })), timeout);
      events.push(adapter ? `adapter ${label}: ok` : `adapter ${label}: none`);
      return adapter;
    } catch (e) {
      events.push(`adapter ${label}: ${message(e)}`);
      return null;
    }
  };
  for (let round = 0; round < rounds; round++) {
    if (round > 0) await sleep(delays[Math.min(round - 1, delays.length - 1)] ?? 200);
    for (const options of ADAPTER_REQUESTS) {
      const adapter = await ask(options);
      if (adapter) return { adapter, attempts, options, events };
    }
  }
  if (opts.allowSoftwareAdapter === true) {
    const options = { forceFallbackAdapter: true };
    const adapter = await ask(options);
    if (adapter) return { adapter, attempts, options, events };
  }
  return { adapter: null, attempts, options: null, events };
}

/** Features the renderer can use (the set three.js asks for); only those the adapter has are requested. */
export const WANTED_FEATURES: readonly string[] = Object.freeze([
  'core-features-and-limits',
  'depth-clip-control',
  'depth32float-stencil8',
  'texture-compression-bc',
  'texture-compression-bc-sliced-3d',
  'texture-compression-etc2',
  'texture-compression-astc',
  'texture-compression-astc-sliced-3d',
  'timestamp-query',
  'indirect-first-instance',
  'shader-f16',
  'rg11b10ufloat-renderable',
  'bgra8unorm-storage',
  'float32-filterable',
  'float32-blendable',
  'clip-distances',
  'dual-source-blending',
  'subgroups',
  'texture-formats-tier1',
  'texture-formats-tier2',
]);

/** Limits worth raising to what the adapter offers (headroom for the post chain and wide materials). */
export const RAISED_LIMITS: readonly string[] = Object.freeze([
  'maxTextureDimension2D',
  'maxTextureArrayLayers',
  'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage',
  'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxUniformBuffersPerShaderStage',
  'maxBindGroups',
  'maxBindingsPerBindGroup',
  'maxColorAttachments',
  'maxColorAttachmentBytesPerSample',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxUniformBufferBindingSize',
  'maxVertexBuffers',
  'maxVertexAttributes',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
]);

/** The features and limits to request from `adapter`. */
export function deviceRequest(adapter: AdapterLike): { requiredFeatures: string[]; requiredLimits: Record<string, number> } {
  const have = adapter.features ?? new Set<string>();
  const requiredFeatures = WANTED_FEATURES.filter((f) => have.has(f));
  const requiredLimits: Record<string, number> = {};
  const limits = adapter.limits ?? {};
  for (const name of RAISED_LIMITS) {
    const v = limits[name];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) requiredLimits[name] = v;
  }
  return { requiredFeatures, requiredLimits };
}

/** Result of {@link acquireDevice}. */
export interface DeviceResult {
  device: DeviceLike | null;
  /** Which request produced it. */
  level: 'raised' | 'features' | 'default' | 'none';
  events: string[];
}

/** Request a device: raised limits and all features, then features only, then defaults; never throws. */
export async function acquireDevice(adapter: AdapterLike, timeoutMs = 8000): Promise<DeviceResult> {
  const events: string[] = [];
  const req = deviceRequest(adapter);
  const steps: Array<{ level: 'raised' | 'features' | 'default'; descriptor?: { requiredFeatures: string[]; requiredLimits?: Record<string, number> } }> = [
    { level: 'raised', descriptor: req },
    { level: 'features', descriptor: { requiredFeatures: req.requiredFeatures } },
    { level: 'default' },
  ];
  for (const step of steps) {
    try {
      const device = await withTimeout(Promise.resolve(adapter.requestDevice(step.descriptor)), timeoutMs);
      events.push(`device (${step.level}): ok`);
      return { device, level: step.level, events };
    } catch (e) {
      events.push(`device (${step.level}): ${message(e)}`);
    }
  }
  return { device: null, level: 'none', events };
}
