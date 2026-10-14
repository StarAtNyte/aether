/**
 * HDR environment maps (`environment.hdri`): image-based lighting and an
 * optional photographic background from a library HDRI or a user import.
 * Loading is lazy (the HDR loader is only imported when a world uses one);
 * the analytic sky stays in place until the map arrives or when the id is
 * unknown, so a world never renders without a sky.
 */
import { EquirectangularReflectionMapping, type Scene, type Texture } from 'three';
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

/** The current HDRI binding of a scene. */
export class HdriController {
  private id: string | null = null;
  private tex: Texture | null = null;
  private token = 0;
  private background = true;
  private intensity = 1;
  private scene: Scene | null = null;

  constructor(
    private readonly source: HdriSource,
    /** Called when a map finished loading or was removed (request a redraw, refresh the sky). */
    private readonly onChange: () => void,
  ) {}

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

  /** Request `id` (or none). Re-requesting the same id only updates intensity / background. */
  set(id: string | undefined, opts: { intensity?: number; background?: boolean }): void {
    this.intensity = opts.intensity ?? 1;
    this.background = opts.background !== false;
    const next = id ?? null;
    if (next === this.id) return;
    this.id = next;
    const token = ++this.token;
    this.drop();
    this.error = null;
    if (next === null) {
      this.onChange();
      return;
    }
    void loadCatalog()
      .then(() => {
        const info = assetInfo(next);
        if (!info || info.kind !== 'hdri' || !info.url) throw new Error(`"${next}" is not an HDR environment`);
        return this.source.load(info.url);
      })
      .then(
        (tex) => {
          if (token !== this.token) {
            tex.dispose();
            return;
          }
          tex.mapping = EquirectangularReflectionMapping;
          this.tex = tex;
          this.onChange();
        },
        (e: unknown) => {
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

  private drop(): void {
    if (this.scene) this.unbind(this.scene);
    this.tex?.dispose();
    this.tex = null;
  }

  dispose(): void {
    this.token++;
    this.drop();
  }
}
