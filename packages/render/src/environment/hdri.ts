/**
 * HDR environment maps (`environment.hdri`): image-based lighting and an
 * optional photographic background from a library HDRI or a user import.
 * Loading is lazy (the HDR loader is only imported when a world uses one);
 * the analytic sky stays in place until the map arrives or when the id is
 * unknown, so a world never renders without a sky.
 */
import { bakeFlipY } from '../gpu/gecko-safe';
import { DataUtils, EquirectangularReflectionMapping, type Scene, type Texture } from 'three';
import { assetInfo, loadCatalog } from '@aether/assets';

/** Loads an HDR file into an equirectangular texture. Injected so tests can fake it. */
export interface HdriSource {
  load(url: string): Promise<Texture>;
}

/** Browser loader (three's `HDRLoader`, imported on first use). Same-origin paths and `blob:` URLs only. */
export function createHdriSource(): HdriSource {
  return {
    async load(url: string): Promise<Texture> {
      if (!(url.startsWith('blob:') || (url.startsWith('/') && !url.startsWith('//')))) throw new Error('HDRI url rejected');
      const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
      return new HDRLoader().loadAsync(url);
    },
  };
}

/** Where the sun is in an HDRI: azimuth and elevation of its brightest texel, and that texel's luminance. */
export interface HdriSun {
  /** Unit direction (three's equirect convention, y up). */
  direction: [number, number, number];
  /** Radians from the +x axis towards +z. */
  azimuth: number;
  /** Radians above the horizon. */
  elevation: number;
  /** Linear luminance of the brightest texel (sum of the three channels / 3). */
  peak: number;
}

interface RawHdr {
  width: number;
  height: number;
  data: Uint16Array | Float32Array;
  half: boolean;
}

/** The pixel data of an equirectangular HDR texture, or null for anything else (a blank texture, an image, bad sizes). */
function rawOf(tex: Texture): RawHdr | null {
  const img = tex.image as { width?: unknown; height?: unknown; data?: unknown } | null | undefined;
  const data = img?.data;
  const width = img?.width;
  const height = img?.height;
  if (!(data instanceof Uint16Array || data instanceof Float32Array) || typeof width !== 'number' || typeof height !== 'number') return null;
  if (width < 4 || height < 2 || data.length < width * height * 4) return null;
  return { width, height, data, half: data instanceof Uint16Array };
}

/**
 * The sun of an HDRI: its brightest texel. Rows are stored top first (the loader sets `flipY`), so the
 * elevation is `(0.5 − row/height)·π`; `u = atan2(z, x)/2π + 0.5` gives the azimuth. Null when the texture
 * holds no pixel data.
 */
export function hdriSun(tex: Texture): HdriSun | null {
  const raw = rawOf(tex);
  if (!raw) return null;
  const { width, height, data, half } = raw;
  let best = -1;
  let bi = 0;
  const px = width * height;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const l = half ? DataUtils.fromHalfFloat(data[o] as number) + DataUtils.fromHalfFloat(data[o + 1] as number) + DataUtils.fromHalfFloat(data[o + 2] as number) : (data[o] as number) + (data[o + 1] as number) + (data[o + 2] as number);
    if (l > best) {
      best = l;
      bi = i;
    }
  }
  if (!(best > 0)) return null;
  const x = bi % width;
  const y = Math.floor(bi / width);
  const azimuth = ((x + 0.5) / width - 0.5) * Math.PI * 2;
  const elevation = (0.5 - (y + 0.5) / height) * Math.PI;
  const c = Math.cos(elevation);
  return { direction: [c * Math.cos(azimuth), Math.sin(elevation), c * Math.sin(azimuth)], azimuth, elevation, peak: best / 3 };
}

/**
 * Cap the radiance of every texel at `max` (keeping its colour), in place. The sun disc of a photographed sky is
 * thousands of times brighter than the sky around it: left in, it would light every surface through the
 * diffuse image-based light a second time and without shadows, next to the shadow-casting sun light.
 * Returns the number of texels changed (0 for a texture without pixel data).
 */
export function clampRadiance(tex: Texture, max: number): number {
  const raw = rawOf(tex);
  if (!raw || !(max > 0)) return 0;
  const { width, height, data, half } = raw;
  let changed = 0;
  const px = width * height;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    let r: number, g: number, b: number;
    if (half) {
      r = DataUtils.fromHalfFloat(data[o] as number);
      g = DataUtils.fromHalfFloat(data[o + 1] as number);
      b = DataUtils.fromHalfFloat(data[o + 2] as number);
    } else {
      r = data[o] as number;
      g = data[o + 1] as number;
      b = data[o + 2] as number;
    }
    const m = Math.max(r, g, b);
    if (m <= max) continue;
    const k = max / m;
    changed++;
    if (half) {
      data[o] = DataUtils.toHalfFloat(r * k);
      data[o + 1] = DataUtils.toHalfFloat(g * k);
      data[o + 2] = DataUtils.toHalfFloat(b * k);
    } else {
      data[o] = r * k;
      data[o + 1] = g * k;
      data[o + 2] = b * k;
    }
  }
  if (changed > 0) tex.needsUpdate = true;
  return changed;
}

/**
 * Rotation about the vertical axis (radians, for `scene.environmentRotation.y`) that moves an HDRI's sun from
 * azimuth `hdriAzimuth` to the direction (`lx`, `lz`) of the sun light. Zero for a vertical light. The
 * rotation turns the image like an object: a right-handed turn by `a` about +y moves azimuth `atan2(z, x)`
 * by −a, so the turn needed is `hdriAzimuth − lightAzimuth`.
 */
export function hdriRotationFor(hdriAzimuth: number, lx: number, lz: number): number {
  if (!Number.isFinite(hdriAzimuth) || Math.hypot(lx, lz) < 1e-6) return 0;
  const turn = hdriAzimuth - Math.atan2(lz, lx);
  // Wrap into (−π, π].
  return Math.atan2(Math.sin(turn), Math.cos(turn));
}

/** Radiance cap applied to an HDRI used only for image-based light (sun removed; the sun light casts the shadows). */
export const HDRI_SUN_CLAMP = 12;

/** The current HDRI binding of a scene. */
export class HdriController {
  private id: string | null = null;
  private tex: Texture | null = null;
  private token = 0;
  private background = true;
  private intensity = 1;
  private scene: Scene | null = null;
  private clampSun = false;
  private sunInfo: HdriSun | null = null;
  /** The loaded map was requested light-only (its sun is clamped away). */
  private texAuto = false;
  /** The current request is for light alone, so it may be served by the library's half-resolution copy. */
  private reqLite = false;
  /**
   * The last automatic (light-only) map, kept after it is unbound. Switching quality tiers turns automatic
   * HDRIs off and on again; re-creating a map means loading it again and prefiltering it again (a burst
   * of GPU objects each time). One map is kept; it is disposed when another map takes its place, when a
   * world HDRI is requested, and with the controller.
   */
  private parked: { id: string; tex: Texture; sun: HdriSun | null } | null = null;

  /** The loaded map's sun (azimuth, elevation), when its pixels were readable. */
  get sun(): HdriSun | null {
    return this.sunInfo;
  }

  constructor(
    private readonly source: HdriSource,
    /** Called when a map finished loading or was removed (request a redraw, refresh the sky). */
    private readonly onChange: () => void,
  ) {}

  /** Loads in flight (the map requested last has neither arrived nor failed). */
  private pending = 0;
  private waiters: Array<() => void> = [];

  /**
   * Resolves when no map is being fetched (the requested one arrived, failed, or none was asked for), or after
   * `timeoutMs`. The load screen waits for it: every material is compiled against the scene's environment, and a
   * map that arrives after the first frames changes the environment, which compiles every material again.
   */
  settled(timeoutMs: number): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.waiters.push(finish);
    });
  }

  private settle(): void {
    if (this.pending > 0) this.pending--;
    if (this.pending === 0) for (const w of this.waiters.splice(0)) w();
  }

  /** The loaded map, or null (none requested, still loading, or failed). */
  get texture(): Texture | null {
    return this.tex;
  }

  /** True when the loaded map is also the background (the analytic sky dome hides). */
  get showsBackground(): boolean {
    return this.tex !== null && this.background;
  }

  /** Last load error (for diagnostics), or null. */
  error: string | null = null;

  /** Load the current id again (a user HDRI registered after the world loaded). */
  reload(): void {
    const id = this.id;
    if (id === null || this.tex) return;
    this.id = null;
    this.set(id, { intensity: this.intensity, background: this.background });
  }

  /**
   * Request `id` (or none). Re-requesting the same id only updates intensity / background. With
   * `lightOnly` the map is used for image-based light alone: its sun is cut down to the sky's level
   * after the sun's direction has been read (see {@link clampRadiance}).
   */
  set(id: string | undefined, opts: { intensity?: number; background?: boolean; lightOnly?: boolean }): void {
    this.intensity = opts.intensity ?? 1;
    this.background = opts.background !== false;
    const lightOnly = opts.lightOnly === true;
    this.clampSun = lightOnly;
    const next = id ?? null;
    // A sky used for light alone is fetched at half resolution; if the same sky becomes the background, fetch it whole.
    const lite = !this.background || lightOnly;
    if (next === this.id && !(this.reqLite && !lite)) return;
    this.reqLite = lite;
    const previous = this.id;
    this.id = next;
    const token = ++this.token;
    this.drop(previous);
    this.error = null;
    if (next === null) {
      this.onChange();
      return;
    }
    if (this.parked) {
      if (lightOnly && this.parked.id === next) {
        // The automatic map of this tier comes straight back: no load, no new prefiltering.
        this.tex = this.parked.tex;
        this.sunInfo = this.parked.sun;
        this.texAuto = true;
        this.parked = null;
        this.onChange();
        return;
      }
      this.releaseParked();
    }
    this.pending++;
    void loadCatalog()
      .then(() => {
        const info = assetInfo(next);
        if (!info || info.kind !== 'hdri' || !info.url) throw new Error(`"${next}" is not an HDR environment`);
        return this.source.load(lite && info.liteUrl ? info.liteUrl : info.url);
      })
      .then(
        (tex) => {
          this.settle();
          if (token !== this.token) {
            tex.dispose();
            return;
          }
          tex.mapping = EquirectangularReflectionMapping;
          this.sunInfo = hdriSun(tex);
          if (this.clampSun) clampRadiance(tex, HDRI_SUN_CLAMP);
          // The loader leaves flipY on; the sun above was read with rows top first. Flip the rows now so the upload sets no flag.
          bakeFlipY(tex);
          this.tex = tex;
          this.texAuto = this.clampSun;
          this.onChange();
        },
        (e: unknown) => {
          this.settle();
          if (token !== this.token) return;
          this.error = e instanceof Error ? e.message.slice(0, 160) : 'HDRI failed to load';
          this.onChange();
        },
      );
  }

  /**
   * Bind to `scene` when loaded: environment lighting (scaled by the world's
   * `hdriIntensity`) and, unless disabled, the background. Returns true when
   * the HDRI owns `scene.environment`.
   */
  bind(scene: Scene, baseIntensity: number): boolean {
    this.scene = scene;
    if (!this.tex) return false;
    scene.environment = this.tex;
    scene.environmentIntensity = baseIntensity * this.intensity;
    scene.background = this.background ? this.tex : null;
    return true;
  }

  /** Unbind from `scene` (when the world drops its HDRI). */
  unbind(scene: Scene): void {
    if (scene.background && scene.background === this.tex) scene.background = null;
    if (scene.environment && scene.environment === this.tex) scene.environment = null;
  }

  private releaseParked(): void {
    this.parked?.tex.dispose();
    this.parked = null;
  }

  /** Unbind and release the current map; an automatic one (`previous` is its id) is parked for reuse instead of disposed. */
  private drop(previous: string | null): void {
    if (this.scene) this.unbind(this.scene);
    if (this.tex) {
      if (this.texAuto && previous !== null) {
        this.releaseParked();
        this.parked = { id: previous, tex: this.tex, sun: this.sunInfo };
      } else this.tex.dispose();
    }
    this.tex = null;
    this.sunInfo = null;
    this.texAuto = false;
  }

  dispose(): void {
    this.token++;
    this.pending = 0;
    for (const w of this.waiters.splice(0)) w();
    this.drop(null);
    this.releaseParked();
  }
}
