/**
 * HDR environment maps (`environment.hdri`): image-based lighting and an
 * optional photographic background from a library HDRI or a user import.
 * Loading is lazy (the HDR loader is only imported when a world uses one);
 * the analytic sky stays in place until the map arrives or when the id is
 * unknown, so a world never renders without a sky.
 */
import { bakeFlipY } from '../gpu/gecko-safe';
import { DataUtils, EquirectangularReflectionMapping, type Scene, type Texture } from 'three';
import { assetInfo, isLibraryRemoteUrl, loadCatalog } from '@aether/assets';

/** Loads an HDR file into an equirectangular texture. Injected so tests can fake it. */
export interface HdriSource {
  load(url: string): Promise<Texture>;
}

/** Browser loader (three's `HDRLoader`, imported on first use). Same-origin paths, `blob:` URLs and the lean build's library CDN. */
export function createHdriSource(): HdriSource {
  return {
    async load(url: string): Promise<Texture> {
      if (!(url.startsWith('blob:') || (url.startsWith('/') && !url.startsWith('//')) || isLibraryRemoteUrl(url))) throw new Error('HDRI url rejected');
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
 * Brightness of an HDRI's sky as light: the cosine-weighted mean luminance of its upper hemisphere (the irradiance
 * of an upward-facing surface divided by π), read with rows top first as the loader leaves them. Photographed skies
 * differ by several times in absolute level (a hazy sunset is brighter than a clear blue sky), so a fixed scale lights
 * one world flat and another gloomy; the rig scales the image light by this. Null without pixel data.
 */
export function hdriSkyLevel(tex: Texture): number | null {
  const raw = rawOf(tex);
  if (!raw) return null;
  const { width, height, data, half } = raw;
  const rows = Math.floor(height / 2);
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < rows; y++) {
    const alt = (0.5 - (y + 0.5) / height) * Math.PI;
    const solid = Math.cos(alt);
    const w = Math.sin(alt) * solid;
    let row = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const r = half ? DataUtils.fromHalfFloat(data[o] as number) : (data[o] as number);
      const g = half ? DataUtils.fromHalfFloat(data[o + 1] as number) : (data[o + 1] as number);
      const b = half ? DataUtils.fromHalfFloat(data[o + 2] as number) : (data[o + 2] as number);
      row += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    sum += row * w;
    weight += width * solid;
  }
  // A texel spans cosα·Δα·Δφ of solid angle and the whole sphere 4π = Σ cosα·Δα·Δφ, twice the upper half's weight, so
  // ∫ L cosθ dω / π = Σ(L sinα cosα)·Δα·Δφ / π = 2 · sum / weight (1 for a uniform sky of radiance 1).
  return weight > 0 ? (2 * sum) / weight : null;
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

/**
 * Radiance cap of every HDRI's texels once its sun has been read. The scene always has a shadow-casting sun light; the
 * photographed sun left in the map would light every surface a second time through the diffuse image light, from the
 * same side and without shadows, which fills the shade and flattens the picture (a washed, overcast look).
 */
export const HDRI_SUN_CLAMP = 12;
/**
 * Narrowest equirectangular map (texels) shown as the background. A 1k photographed sky has under three texels per
 * degree: magnified seven times across a 60° view it is a smear of clouds with no sun disc. Such a map still lights and
 * reflects; the analytic sky (which follows the hour and the sun light) is the background instead.
 */
export const HDRI_BACKDROP_MIN_WIDTH = 2048;

/** Automatic maps kept for reuse after they are unbound (with the shown one, the day, low-sun and night skies). */
export const PARK_CAP = 2;

/** Width (texels) of a texture's image, or 0. */
function imageWidth(tex: Texture): number {
  const w = (tex.image as { width?: unknown } | null | undefined)?.width;
  return typeof w === 'number' && Number.isFinite(w) ? w : 0;
}

/** The current HDRI binding of a scene. */
export class HdriController {
  private id: string | null = null;
  private tex: Texture | null = null;
  private token = 0;
  private background = true;
  private intensity = 1;
  private scene: Scene | null = null;
  /** The current request is for light alone (an automatic map: may be parked for reuse). */
  private lightOnly = false;
  private sunInfo: HdriSun | null = null;
  private skyLevel: number | null = null;
  /** The loaded map was requested light-only (its sun is clamped away). */
  private texAuto = false;
  /** The current request is for light alone, so it may be served by the library's half-resolution copy. */
  private reqLite = false;
  /**
   * The last automatic (light-only) maps, kept after they are unbound, most recent last. Switching quality tiers turns
   * automatic HDRIs off and on again, and the hour of a daylight study moves between the day, low-sun and night maps;
   * re-creating a map means loading it again and prefiltering it again (a burst of GPU objects each time). Up to
   * {@link PARK_CAP} maps are kept; the oldest is disposed when another takes its place, and all of them when a world
   * HDRI is requested and with the controller.
   */
  private parked: Array<{ id: string; tex: Texture; sun: HdriSun | null; level: number | null }> = [];
  /** Id of the map in {@link tex} (it differs from the requested id while an automatic map is held for the next one). */
  private texId: string | null = null;

  /** The id asked for last (null: none), whether or not its map has arrived. */
  get requested(): string | null {
    return this.id;
  }

  /** The loaded map's sky brightness as light ({@link hdriSkyLevel}, after its sun was cut down), when its pixels were readable. */
  get level(): number | null {
    return this.skyLevel;
  }

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

  /**
   * True when the loaded map is also the background (the analytic sky dome hides): asked for, and sharp enough to be
   * seen (a map of unknown size is trusted).
   */
  get showsBackground(): boolean {
    if (this.tex === null || !this.background) return false;
    const w = imageWidth(this.tex);
    return w === 0 || w >= HDRI_BACKDROP_MIN_WIDTH;
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
   * Request `id` (or none). Re-requesting the same id only updates intensity / background. Every map's sun is
   * cut down to the sky's level after its direction has been read (see {@link clampRadiance}, {@link HDRI_SUN_CLAMP});
   * with `lightOnly` the map is used for image-based light alone and may be fetched at half resolution.
   */
  set(id: string | undefined, opts: { intensity?: number; background?: boolean; lightOnly?: boolean }): void {
    this.intensity = opts.intensity ?? 1;
    this.background = opts.background !== false;
    const lightOnly = opts.lightOnly === true;
    this.lightOnly = lightOnly;
    const next = id ?? null;
    // A sky used for light alone is fetched at half resolution; if the same sky becomes the background, fetch it whole.
    const lite = !this.background || lightOnly;
    if (next === this.id && !(this.reqLite && !lite)) return;
    this.reqLite = lite;
    this.id = next;
    const token = ++this.token;
    this.error = null;
    const parkedAt = lightOnly && next !== null ? this.parked.findIndex((p) => p.id === next) : -1;
    // One automatic map to another (the hour moved the sky to another preset): the shown map stays until the next one is
    // ready, so the scene's environment changes once (every material follows a change of it) and never shows the
    // analytic sky's reflections for the length of a load.
    const hold = lightOnly && this.texAuto && this.tex !== null && next !== null && parkedAt < 0;
    if (hold && next === this.texId) {
      // Back to the map still shown (a load for another one was under way): keep it; the late load is discarded.
      this.onChange();
      return;
    }
    // Take a parked map out before the shown one is parked in its place (a full park would dispose the oldest).
    const p = parkedAt >= 0 ? this.parked.splice(parkedAt, 1)[0] : undefined;
    if (!hold) this.drop();
    if (next === null) {
      this.onChange();
      return;
    }
    {
      // This automatic map was shown before: it comes straight back, with no load and no new prefiltering.
      if (p) {
        this.tex = p.tex;
        this.texId = p.id;
        this.sunInfo = p.sun;
        this.skyLevel = p.level;
        this.texAuto = true;
        this.onChange();
        return;
      }
    }
    if (!lightOnly) this.releaseParked();
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
          this.drop();
          tex.mapping = EquirectangularReflectionMapping;
          this.sunInfo = hdriSun(tex);
          clampRadiance(tex, HDRI_SUN_CLAMP);
          this.skyLevel = hdriSkyLevel(tex);
          // The loader leaves flipY on; the sun above was read with rows top first. Flip the rows now so the upload sets no flag.
          bakeFlipY(tex);
          this.tex = tex;
          this.texId = next;
          this.texAuto = this.lightOnly;
          this.onChange();
        },
        (e: unknown) => {
          this.settle();
          if (token !== this.token) return;
          this.drop();
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
    scene.background = this.showsBackground ? this.tex : null;
    return true;
  }

  /** Unbind from `scene` (when the world drops its HDRI). */
  unbind(scene: Scene): void {
    if (scene.background && scene.background === this.tex) scene.background = null;
    if (scene.environment && scene.environment === this.tex) scene.environment = null;
  }

  private releaseParked(): void {
    for (const p of this.parked.splice(0)) p.tex.dispose();
  }

  /** Unbind and release the current map; an automatic one is parked for reuse instead of disposed. */
  private drop(park = true): void {
    if (this.scene) this.unbind(this.scene);
    if (this.tex) {
      if (park && this.texAuto && this.texId !== null) {
        this.parked.push({ id: this.texId, tex: this.tex, sun: this.sunInfo, level: this.skyLevel });
        while (this.parked.length > PARK_CAP) this.parked.shift()?.tex.dispose();
      } else this.tex.dispose();
    }
    this.tex = null;
    this.texId = null;
    this.sunInfo = null;
    this.skyLevel = null;
    this.texAuto = false;
  }

  dispose(): void {
    this.token++;
    this.pending = 0;
    for (const w of this.waiters.splice(0)) w();
    this.drop(false);
    this.releaseParked();
  }
}
