/**
 * GPU texture compression: one shared three.js `KTX2Loader` per renderer, set up on first use.
 *
 * Library files with KTX2 / Basis Universal twins (see @aether/assets `textureVariantUrl`) are loaded
 * through it, so their textures stay block-compressed on the GPU (BC7 / BC1 on desktop, ETC or ASTC on
 * mobile) instead of being decoded to RGBA8. The Basis transcoder (`basis_transcoder.{js,wasm}`, from
 * three's `examples/jsm/libs/basis`) is served next to the studio (`public/basis/`) and runs in the static
 * worker `ktx2-worker.js` (KTX2Loader's own worker body, served with its own Content-Security-Policy
 * because the transcoder's glue needs `new Function`, which the page forbids).
 *
 * The loader is only handed out after a self-test: the transcoder is fetched and a tiny embedded KTX2
 * file is transcoded. Without workers or WebAssembly, when the transcoder files are missing, when the
 * GPU offers no compressed format the transcoder can target (it would fall back to RGBA8, which saves
 * nothing and costs a larger download) or when the self-test fails, {@link TextureCompression.loader}
 * resolves null and every caller loads the original WebP / JPEG / PNG files instead.
 */
import type { CompressedTexture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { gateWorker } from '@aether/core';
import { errorMessage, log } from '../log';
import { installedTextureCap } from './texture-cap';

/** Where the transcoder is served by default (relative to the page, so published builds in a sub-folder work). */
export const DEFAULT_TRANSCODER_PATH = 'basis/';

/** A 4 × 4 ETC1S (Basis LZ) KTX2 file, made with KTX-Software v4.4.2: the transcoder self-test. */
const PROBE_KTX2 =
  'q0tUWCAyMLsNChoKAAAAAAEAAAAEAAAABAAAAAAAAAAAAAAAAQAAAAEAAAABAAAAaAAAACwAAACUAAAAYAAAAPgAAAAAAAAAgAAAAAAAAAB4AQAAAAAAAAEAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAIAKACjAQIAAwMAAAgAAAAAAAAAAAA/AAAAAAAAAAAA/////ywAAABLVFh3cml0ZXIAa3R4IGNyZWF0ZSB2NC40LjIgLyBsaWJrdHggdjQuNC4yACkAAABLVFh3cml0ZXJTY1BhcmFtcwAtLWNsZXZlbCAxIC0tcWxldmVsIDMyAAAAAAAAAAABAAEAKAAAAAUAAAArAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAcAEAAAAAAAAAgSYCAAAAAAAQFIEABMAAAAAAAAIAWACQAAAAAAAMVRVVVUFAMFEAAAAAAAA8l8tAJgAAAAAAABACAATAAIAAAAAiAHABAAAAAAAAAIIAAA=';

/** Compressed formats the transcoder can target on this GPU (from `KTX2Loader.detectSupport`). */
export interface CompressionSupport {
  astc: boolean;
  bptc: boolean;
  s3tc: boolean;
  etc2: boolean;
  etc1: boolean;
  pvrtc: boolean;
}

/** True when at least one block format is available (otherwise KTX2 would be transcoded to RGBA8). Pure. */
export function anyCompressedFormat(s: CompressionSupport): boolean {
  return s.astc || s.bptc || s.s3tc || s.etc2 || s.etc1 || s.pvrtc;
}

/**
 * Where the GPU has BC formats (every desktop GPU), use only those: desktop drivers that also advertise ASTC
 * or ETC (NVIDIA's OpenGL driver under WebGL2, for one) decompress them to RGBA8 in the driver, which would
 * keep the download cost and lose the memory saving; KTX2Loader would pick ASTC first for UASTC and ETC first
 * for ETC1S. Mobile GPUs have no BC and keep ASTC / ETC. Mutates `config`.
 */
export function preferNativeBlockFormats(config: { astcSupported: boolean; etc1Supported: boolean; etc2Supported: boolean; pvrtcSupported: boolean; bptcSupported: boolean; dxtSupported: boolean }): void {
  if (!config.bptcSupported && !config.dxtSupported) return;
  config.astcSupported = false;
  config.etc1Supported = false;
  config.etc2Supported = false;
  config.pvrtcSupported = false;
}

/** Short label of the formats (diagnostics). Pure. */
export function supportLabel(s: CompressionSupport): string {
  const names = (Object.keys(s) as Array<keyof CompressionSupport>).filter((k) => s[k]);
  return names.length > 0 ? names.join(' ') : 'none';
}

/** State of {@link TextureCompression}. */
export type CompressionState = 'idle' | 'pending' | 'on' | 'off';

/** Lazily initialised, self-tested KTX2 support of one renderer. */
export class TextureCompression {
  private pending: Promise<KTX2Loader | null> | null = null;
  private ktx2: KTX2Loader | null = null;
  private disposed = false;
  /** Current state; `off` comes with a {@link reason}. */
  state: CompressionState = 'idle';
  /** Why compression is off (null while on or not yet tried). */
  reason: string | null = null;
  /** Formats the transcoder targets (after the loader is set up). */
  support: CompressionSupport | null = null;
  /** Milliseconds the set-up and self-test took (null before it finished). */
  setupMs: number | null = null;

  /**
   * @param renderer the renderer textures are made for (null: compression off)
   * @param transcoderPath directory of `basis_transcoder.{js,wasm}` (null: compression off)
   */
  constructor(
    private readonly renderer: WebGPURenderer | null,
    private readonly transcoderPath: string | null = DEFAULT_TRANSCODER_PATH,
  ) {}

  /** The ready loader, or null when KTX2 cannot be used here (callers then load the original files). Never rejects. */
  loader(): Promise<KTX2Loader | null> {
    const t0 = performance.now();
    this.pending ??= this.setup().then(
      (l) => {
        this.setupMs = Math.round(performance.now() - t0);
        if (this.disposed) {
          l?.dispose();
          return null;
        }
        this.ktx2 = l;
        this.state = l ? 'on' : 'off';
        return l;
      },
      (e: unknown) => this.off(`set-up failed: ${errorMessage(e)}`),
    );
    return this.pending;
  }

  /** Turn compression off from now on (e.g. a variant failed to load); later calls resolve null. */
  disable(reason: string): void {
    if (this.state === 'off') return;
    log.warn(`compressed textures off: ${reason}`);
    this.state = 'off';
    this.reason = reason;
    this.pending = Promise.resolve(null);
  }

  private off(reason: string): null {
    this.state = 'off';
    this.reason = reason;
    log.info(`compressed textures off (original images are used): ${reason}`);
    return null;
  }

  private async setup(): Promise<KTX2Loader | null> {
    this.state = 'pending';
    const r = this.renderer;
    if (!r || !this.transcoderPath) return this.off('disabled');
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined' || typeof URL.createObjectURL !== 'function') return this.off('no workers or WebAssembly');
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    const loader = new KTX2Loader().setTranscoderPath(this.transcoderPath).setWorkerLimit(2);
    loader.detectSupport(r);
    await useStaticWorker(loader, this.transcoderPath);
    const c = loader.workerConfig;
    preferNativeBlockFormats(c);
    const support: CompressionSupport = { astc: c.astcSupported, bptc: c.bptcSupported, s3tc: c.dxtSupported, etc2: c.etc2Supported, etc1: c.etc1Supported, pvrtc: c.pvrtcSupported };
    this.support = support;
    if (!anyCompressedFormat(support)) {
      loader.dispose();
      return this.off('the GPU offers no compressed texture format');
    }
    try {
      await withTimeout(probe(loader), 15_000);
    } catch (e) {
      loader.dispose();
      return this.off(`transcoder self-test failed: ${errorMessage(e)}`);
    }
    log.debug(`compressed textures on (${supportLabel(support)})`);
    return loader;
  }

  /** Largest texture edge the renderer uploads (512 on integrated GPUs and in low-memory mode, 0: no cap). */
  textureCap(): number {
    return installedTextureCap(this.renderer);
  }

  /** Release the transcoder workers. */
  dispose(): void {
    this.disposed = true;
    this.ktx2?.dispose();
    this.ktx2 = null;
    this.pending = Promise.resolve(null);
  }
}

/** File name of the transcoder worker next to the transcoder (made by `scripts/assets/basis-worker.ts`). */
export const TRANSCODER_WORKER = 'ktx2-worker.js';

/**
 * Point the loader's workers at the static transcoder worker instead of the `blob:` worker KTX2Loader builds:
 * a blob worker inherits the page's Content-Security-Policy, under which the transcoder's embind glue cannot
 * compile its bindings (`new Function`); the static script is served with its own sealed policy (see
 * `scripts/assets/basis-worker.ts`). The worker protocol (`init` with the format config and the WebAssembly
 * binary) is KTX2Loader's own.
 */
async function useStaticWorker(loader: KTX2Loader, path: string): Promise<void> {
  const base = typeof document !== 'undefined' ? document.baseURI : globalThis.location?.href;
  const workerUrl = new URL(`${path}${TRANSCODER_WORKER}`, base).href;
  const res = await fetch(new URL(`${path}basis_transcoder.wasm`, base).href);
  if (!res.ok) throw new Error(`transcoder: HTTP ${res.status}`);
  const binary = await res.arrayBuffer();
  if (binary.byteLength < 1024 || binary.byteLength > 8 * 1024 * 1024) throw new Error('transcoder: unexpected size');
  loader.transcoderBinary = binary;
  loader.workerSourceURL = workerUrl;
  loader.workerPool.setWorkerCreator(() => {
    const worker = new Worker(workerUrl);
    const copy = binary.slice(0);
    worker.postMessage({ type: 'init', config: loader.workerConfig, transcoderBinary: copy }, [copy]);
    // Transcodes take a slot of the page's worker budget (the `init` above has no reply, so it goes around the gate).
    return gateWorker(worker, 'load');
  });
  // KTX2Loader.init() only builds its own blob worker while nothing is pending.
  loader.transcoderPending = Promise.resolve();
}

function probe(loader: KTX2Loader): Promise<void> {
  const bytes = Uint8Array.from(atob(PROBE_KTX2), (ch) => ch.charCodeAt(0));
  return new Promise<void>((resolve, reject) => {
    loader.parse(
      bytes.buffer,
      (t: CompressedTexture) => {
        const ok = t.mipmaps !== undefined && t.mipmaps.length > 0;
        t.dispose();
        if (ok) resolve();
        else reject(new Error('no mip levels'));
      },
      (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))),
    );
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
