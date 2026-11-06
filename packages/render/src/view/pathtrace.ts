/**
 * Path-traced stills: a progressive, physically based render of the scene (global illumination, soft area
 * lights, real glass, depth of field) that converges like Blender Cycles. It is an opt-in mode of "Render
 * still": the code and its dependency (`three-gpu-pathtracer`, MIT, WebGL2 — so it also runs in Firefox)
 * are only imported when a path trace is started.
 *
 * The scene the user sees is not traced directly. The renderer builds its glTF export graph (plain PBR
 * materials, baked transforms, scatter fields and static batches resolved), replaces see-through materials
 * by real transmissive glass and dark mirror water, copies the lights, and traces that on a private WebGL2
 * context of its own, so the viewport's renderer is never touched. Samples accumulate in a float target
 * (several full-frame samples per pixel, tiled into small passes so the GPU stays responsive) until the
 * requested count is reached or the caller cancels; a bilateral denoise is applied on output.
 *
 * Pure helpers (sample plan, material conversion, light copying) are separated from the GPU part so they are
 * unit-tested without a GPU.
 */
import {
  AgXToneMapping,
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  LinearToneMapping,
  NoToneMapping,
  Object3D,
  PointLight,
  RectAreaLight,
  Scene,
  SpotLight,
  Vector3,
  type Light,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type Texture,
  type ToneMapping,
} from 'three';
import type { StillImage } from './capture-session';
import { MAX_STILL_SIZE } from './still';

/** Largest scene (triangles, instances included) a path trace accepts: the BVH build must stay interactive. */
export const MAX_PATH_TRACE_TRIANGLES = 2_000_000;
/** Longest side of a path-traced image. */
export const MAX_PATH_TRACE_SIZE = Math.min(MAX_STILL_SIZE, 4096);
/** Sample counts offered by the UI (full-frame samples per pixel). */
export const PATH_TRACE_SAMPLES: readonly number[] = Object.freeze([64, 256, 1024]);
/** Hard bounds on the requested sample count. */
export const MIN_SAMPLES = 1;
export const MAX_SAMPLES = 4096;

/** What the caller wants. */
export interface PathTraceOptions {
  width: number;
  height: number;
  /** Full-frame samples per pixel to accumulate. */
  samples: number;
  /** Smooth residual noise on output (default true). */
  denoise?: boolean;
  /** Light bounces (default 5). */
  bounces?: number;
  /** Aperture f-number for depth of field (omit for a pinhole camera). */
  fStop?: number;
  /** Distance to the plane in focus (metres; default: the camera's orbit target distance). */
  focusDistance?: number;
  signal?: AbortSignal;
  /**
   * Progress: `phase` 'build' while the acceleration structure is made, 'compile' while the path-tracing
   * shader compiles (the first trace in a session can take a while), then 'sample' with `done` of `total`
   * full-frame samples.
   */
  onProgress?: (done: number, total: number, phase: 'build' | 'compile' | 'sample') => void;
}

/** Everything the tracer needs from the live renderer. */
export interface PathTraceInput {
  /** Export graph of the visible scene (see `buildExportScene`); materials are replaced in place. */
  content: Object3D;
  /** Lights of the live scene (the sun and entity lights): copied, never moved. */
  lights: readonly Light[];
  camera: PerspectiveCamera;
  /** Equirectangular environment (sky) used for lighting and as the background. */
  environment: Texture | null;
  /** Flat sky colour when there is no environment map. */
  skyColor: string;
  environmentIntensity: number;
  /** Rotation of the environment about +y (radians). */
  environmentRotationY: number;
  toneMapping: ToneMapping | 'agx' | 'aces' | 'neutral' | 'linear' | 'none';
  exposure: number;
}

/** Clamp a requested size, sample count and bounce count to what a path trace allows (pure). */
export function clampPathTrace(o: Pick<PathTraceOptions, 'width' | 'height' | 'samples' | 'bounces'>): { width: number; height: number; samples: number; bounces: number } {
  const f = (v: number, lo: number, hi: number, d: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);
  const w0 = Number.isFinite(o.width) && o.width > 0 ? o.width : 1280;
  const h0 = Number.isFinite(o.height) && o.height > 0 ? o.height : 720;
  // Shrink both sides by the same factor when the longer one is too big (the aspect is kept).
  const scale = Math.min(1, MAX_PATH_TRACE_SIZE / Math.max(w0, h0));
  return {
    width: f(w0 * scale, 16, MAX_PATH_TRACE_SIZE, 1280),
    height: f(h0 * scale, 16, MAX_PATH_TRACE_SIZE, 720),
    samples: f(o.samples, MIN_SAMPLES, MAX_SAMPLES, 128),
    bounces: f(o.bounces ?? 5, 1, 12, 5),
  };
}

/**
 * How a frame is split into tiles per sample pass: bigger frames use more, smaller passes so no single GPU
 * dispatch runs long enough to stall the display or trip a driver watchdog (pure).
 */
export function tilePlan(width: number, height: number): { x: number; y: number } {
  const px = Math.max(1, width) * Math.max(1, height);
  const n = px > 4_000_000 ? 4 : px > 1_500_000 ? 3 : px > 400_000 ? 2 : 1;
  return { x: n, y: n };
}

/** Sample progress in [0, 1]: `done` of `total` full-frame samples (pure; tolerant of bad input). */
export function sampleFraction(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) return 0;
  return Math.max(0, Math.min(1, done / total));
}

/**
 * Bilateral denoise settings for a sample count: the fewer samples, the more noise to smooth, so the edge
 * threshold (how different two pixels may be and still be averaged) and the radius shrink as the image
 * converges. Off: a one-pixel kernel (a plain tone-mapped copy). Pure.
 */
export function denoiseParams(samples: number, on: boolean): { sigma: number; kSigma: number; threshold: number } {
  if (!on) return { sigma: 0.01, kSigma: 0.01, threshold: 1 };
  const n = Number.isFinite(samples) ? samples : 128;
  if (n <= 96) return { sigma: 6, kSigma: 1.4, threshold: 0.16 };
  if (n <= 384) return { sigma: 5, kSigma: 1.2, threshold: 0.08 };
  return { sigma: 4, kSigma: 1, threshold: 0.045 };
}

/**
 * Remove isolated bright speckles ("fireflies": rare high-energy paths) from an opaque RGBA8 image, in
 * place: a pixel that is far brighter than the mean of its eight neighbours is replaced by that mean.
 * Genuine small highlights (a specular glint spans several pixels) and edges survive because their
 * neighbours are bright too. Returns the number of pixels replaced. Pure.
 */
export function despeckle(data: Uint8Array, width: number, height: number, ratio = 2.2, floor = 36): number {
  if (width < 3 || height < 3 || data.length < width * height * 4) return 0;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) luma[i] = 0.2126 * (data[i * 4] as number) + 0.7152 * (data[i * 4 + 1] as number) + 0.0722 * (data[i * 4 + 2] as number);
  const out: Array<[number, number, number, number]> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = luma[i] as number;
      if (l < floor) continue;
      let sum = 0;
      let max = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const v = luma[i + dy * width + dx] as number;
          sum += v;
          if (v > max) max = v;
        }
      }
      const mean = sum / 8;
      // Brighter than every neighbour and far above their average: an outlier, not a feature.
      if (l > max && l > mean * ratio + 12) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const o = (i + dy * width + dx) * 4;
            r += data[o] as number;
            g += data[o + 1] as number;
            b += data[o + 2] as number;
          }
        }
        out.push([i, Math.round(r / 8), Math.round(g / 8), Math.round(b / 8)]);
      }
    }
  }
  // Written after the scan, so a replaced pixel never changes the verdict on its neighbours.
  for (const [i, r, g, b] of out) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
  }
  return out.length;
}

const SPECKLE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Replaces a pixel that is far brighter than all eight neighbours by their mean (the GPU twin of {@link despeckle}). */
export const SPECKLE_FRAGMENT = `
  uniform sampler2D map;
  uniform vec2 texel;
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec4 c = texture2D(map, vUv);
    vec3 sum = vec3(0.0);
    float mx = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        vec3 n = texture2D(map, vUv + vec2(float(i), float(j)) * texel).rgb;
        sum += n;
        mx = max(mx, luma(n));
      }
    }
    vec3 mean = sum / 8.0;
    float l = luma(c.rgb);
    if (l > mx && l > luma(mean) * 2.5 + 0.04) c.rgb = mean;
    gl_FragColor = c;
  }
`;

function toneOf(t: PathTraceInput['toneMapping']): ToneMapping {
  switch (t) {
    case 'agx':
      return AgXToneMapping;
    case 'aces':
      return ACESFilmicToneMapping;
    case 'neutral':
      return NeutralToneMapping;
    case 'none':
      return NoToneMapping;
    case 'linear':
      return LinearToneMapping;
    default:
      return t;
  }
}

/** How a material takes part in a path trace. */
export type TraceKind = 'opaque' | 'glass' | 'water';

/**
 * Classify an export material: very see-through and smooth is glass, mid-opacity and smooth blue-ish water
 * (an opaque dark mirror, like the raster renderer's reflective water), everything else opaque (pure).
 */
export function traceKind(m: Pick<Material, 'transparent' | 'opacity'> & { roughness?: number; color?: Color }): TraceKind {
  if (!m.transparent || m.opacity >= 0.995) return 'opaque';
  const rough = m.roughness ?? 0.5;
  if (rough > 0.3) return 'opaque';
  if (m.opacity <= 0.5) return 'glass';
  const c = m.color;
  // Water is bluish: its blue channel leads.
  return c && c.b > c.r && c.b >= c.g * 0.8 ? 'water' : 'glass';
}

/**
 * The path-tracing material for an export material: glass becomes single-surface transmissive glass (it
 * refracts and reflects, instead of blending), water an opaque dark mirror, everything else stays as is.
 * Returns the replacement (owned by the caller) or null to keep the original.
 */
export function pathTraceMaterial(m: MeshStandardMaterial): MeshPhysicalMaterial | null {
  const kind = traceKind(m);
  if (kind === 'opaque') return null;
  const p = new MeshPhysicalMaterial({ name: `${m.name}:trace`, color: m.color, roughness: Math.min(m.roughness, 0.08), metalness: 0, side: m.side });
  if (kind === 'glass') {
    p.transmission = 1;
    p.ior = 1.45;
    p.thickness = 0.02;
    p.transparent = false;
    p.opacity = 1;
    // Tinted glass keeps its colour but stays clear: a light tint towards white.
    p.color = new Color(1, 1, 1).lerp(m.color, 0.35);
  } else {
    p.color = m.color.clone().multiplyScalar(0.5);
    p.roughness = 0.04;
    p.clearcoat = 0;
    p.ior = 1.33;
    p.transparent = false;
    p.opacity = 1;
  }
  return p;
}

const _p = new Vector3();

/**
 * Copy a live light into the trace scene with its world transform baked, or null for the kinds a path
 * tracer does not use (ambient and hemisphere light: the sky provides them). Spot lights bring a target.
 */
export function copyLight(src: Light, scene: Object3D): Light | null {
  src.updateWorldMatrix(true, false);
  if (src instanceof DirectionalLight) {
    const l = new DirectionalLight(src.color, src.intensity);
    l.position.setFromMatrixPosition(src.matrixWorld);
    src.target.updateWorldMatrix(true, false);
    l.target.position.setFromMatrixPosition(src.target.matrixWorld);
    scene.add(l, l.target);
    l.updateMatrixWorld(true);
    return l;
  }
  if (src instanceof SpotLight) {
    const l = new SpotLight(src.color, src.intensity, src.distance, src.angle, src.penumbra, src.decay);
    l.position.setFromMatrixPosition(src.matrixWorld);
    src.target.updateWorldMatrix(true, false);
    l.target.position.setFromMatrixPosition(src.target.matrixWorld);
    (l as SpotLight & { iesMap?: Texture | null }).iesMap = (src as SpotLight & { iesMap?: Texture | null }).iesMap ?? null;
    scene.add(l, l.target);
    l.updateMatrixWorld(true);
    return l;
  }
  if (src instanceof PointLight) {
    const l = new PointLight(src.color, src.intensity, src.distance, src.decay);
    l.position.setFromMatrixPosition(src.matrixWorld);
    scene.add(l);
    l.updateMatrixWorld(true);
    return l;
  }
  if (src instanceof RectAreaLight) {
    const l = new RectAreaLight(src.color, src.intensity, src.width, src.height);
    src.matrixWorld.decompose(l.position, l.quaternion, _p);
    scene.add(l);
    l.updateMatrixWorld(true);
    return l;
  }
  return null;
}

/** Build the scene the tracer renders from `input` (materials of `content` are replaced in place). Returns the scene and the replacement materials to dispose. */
export function buildTraceScene(input: PathTraceInput): { scene: Scene; replaced: MeshPhysicalMaterial[]; lights: number } {
  const scene = new Scene();
  scene.add(input.content);
  const replaced: MeshPhysicalMaterial[] = [];
  const seen = new Map<Material, Material>();
  input.content.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: Material): Material => {
      const hit = seen.get(m);
      if (hit) return hit;
      const r = pathTraceMaterial(m as MeshStandardMaterial);
      if (r) replaced.push(r);
      seen.set(m, r ?? m);
      return r ?? m;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  let lights = 0;
  for (const l of input.lights) if (copyLight(l, scene)) lights++;
  if (input.environment) {
    scene.environment = input.environment;
    scene.background = input.environment;
    scene.environmentIntensity = input.environmentIntensity;
    scene.backgroundIntensity = 1;
    scene.environmentRotation.set(0, input.environmentRotationY, 0);
    scene.backgroundRotation.set(0, input.environmentRotationY, 0);
  } else {
    scene.background = new Color(input.skyColor);
    scene.environment = null;
  }
  return { scene, replaced, lights };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Trace `input` into an opaque RGBA8 image. Uses a private WebGL2 renderer on a detached canvas and releases
 * everything (GPU context included) when it returns or throws. Throws an AbortError when cancelled.
 */
export async function runPathTrace(input: PathTraceInput, options: PathTraceOptions): Promise<StillImage> {
  const o = clampPathTrace(options);
  options.onProgress?.(0, 1, 'build');
  const [three, pt] = await Promise.all([import('three'), import('three-gpu-pathtracer')]);
  if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  if (typeof document === 'undefined') throw new Error('path tracing needs a browser');
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const renderer = new three.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const built = buildTraceScene(input);
  let tracer: InstanceType<typeof pt.WebGLPathTracer> | null = null;
  let denoiseDispose: (() => void) | null = null;
  let camera: PerspectiveCamera | InstanceType<typeof pt.PhysicalCamera> = input.camera;
  try {
    if (!renderer.capabilities.isWebGL2) throw new Error('path tracing needs WebGL2');
    renderer.setPixelRatio(1);
    renderer.setSize(o.width, o.height, false);
    renderer.toneMapping = toneOf(input.toneMapping);
    renderer.toneMappingExposure = Number.isFinite(input.exposure) ? input.exposure : 1;
    const base = input.camera;
    if (options.fStop !== undefined && Number.isFinite(options.fStop) && options.fStop > 0) {
      const cam = new pt.PhysicalCamera(base.fov, o.width / o.height, base.near, base.far);
      cam.position.copy(base.position);
      cam.quaternion.copy(base.quaternion);
      cam.fStop = options.fStop;
      cam.focusDistance = Math.max(0.1, options.focusDistance ?? 10);
      camera = cam;
    } else {
      base.aspect = o.width / o.height;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    tracer = new pt.WebGLPathTracer(renderer);
    tracer.rasterizeScene = false;
    tracer.renderDelay = 0;
    tracer.minSamples = 0;
    tracer.fadeDuration = 0;
    tracer.dynamicLowRes = false;
    tracer.renderScale = 1;
    tracer.bounces = o.bounces;
    tracer.transmissiveBounces = Math.min(12, o.bounces + 3);
    tracer.filterGlossyFactor = 0.75;
    tracer.multipleImportanceSampling = true;
    const tiles = tilePlan(o.width, o.height);
    tracer.tiles.set(tiles.x, tiles.y);
    // Output through the denoise material (it also applies the tone curve and sRGB): wide smoothing when
    // denoising, a one-pixel kernel (a plain, tone-mapped copy) when not.
    const { FullScreenQuad } = await import('three/addons/postprocessing/Pass.js');
    const dn = denoiseParams(o.samples, options.denoise !== false);
    const denoise = new FullScreenQuad(new pt.DenoiseMaterial({ sigma: dn.sigma, kSigma: dn.kSigma, threshold: dn.threshold }));
    // Fireflies first: rare very bright paths are removed on the float image, before smoothing could smear them into blobs.
    const clean = new three.WebGLRenderTarget(o.width, o.height, { type: three.FloatType, format: three.RGBAFormat, minFilter: three.NearestFilter, magFilter: three.NearestFilter, depthBuffer: false });
    const speckle = new FullScreenQuad(new three.ShaderMaterial({ uniforms: { map: { value: null }, texel: { value: new three.Vector2(1 / o.width, 1 / o.height) } }, vertexShader: SPECKLE_VERTEX, fragmentShader: SPECKLE_FRAGMENT, depthTest: false, depthWrite: false }));
    denoiseDispose = () => {
      (denoise.material as unknown as { dispose(): void }).dispose();
      denoise.dispose();
      (speckle.material as unknown as { dispose(): void }).dispose();
      speckle.dispose();
      clean.dispose();
    };
    tracer.renderToCanvasCallback = (target, r) => {
      const keep = r.autoClear;
      const keepTarget = r.getRenderTarget();
      r.autoClear = false;
      (speckle.material as unknown as { uniforms: { map: { value: Texture } } }).uniforms.map.value = target.texture;
      r.setRenderTarget(clean);
      speckle.render(r);
      r.setRenderTarget(keepTarget);
      (denoise.material as unknown as { map: Texture | null }).map = clean.texture;
      denoise.render(r);
      r.autoClear = keep;
    };
    await yieldToBrowser();
    // The acceleration structure is built on this thread (a second or two for a large scene): the UI was told first.
    tracer.setScene(built.scene, camera);
    if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    options.onProgress?.(1, 1, 'build');
    let last = 0;
    let compiling = false;
    while (tracer.samples < o.samples) {
      if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      tracer.renderSample();
      if ((tracer as unknown as { isCompiling: boolean }).isCompiling) {
        // The (very large) path-tracing shader compiles asynchronously: report it and give the browser the thread.
        if (!compiling) options.onProgress?.(0, o.samples, 'compile');
        compiling = true;
        await new Promise((resolve) => setTimeout(resolve, 40));
        continue;
      }
      compiling = false;
      const now = tracer.samples;
      if (now - last >= 1 || now >= o.samples) {
        last = now;
        options.onProgress?.(Math.min(o.samples, Math.floor(now)), o.samples, 'sample');
      }
      // One tiled pass at a time: the page stays responsive and a cancel is noticed within a pass.
      await yieldToBrowser();
    }
    // Read the finished canvas back (drawing buffer is preserved).
    const out = document.createElement('canvas');
    out.width = o.width;
    out.height = o.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(canvas, 0, 0);
    const px = ctx.getImageData(0, 0, o.width, o.height).data;
    const data = new Uint8Array(px.length);
    data.set(px);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    despeckle(data, o.width, o.height);
    return { width: o.width, height: o.height, data };
  } finally {
    denoiseDispose?.();
    tracer?.dispose();
    for (const m of built.replaced) m.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
