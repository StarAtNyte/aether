/**
 * Cut-out textures of the foliage materials (`material.foliage`): one RGBA atlas of 2 × 2 card variants per kind,
 * synthesised on first use by `@aether/procgen` (`foliagePixels`, a few milliseconds each) and shared by every
 * material of the cache. Colour is stored linear (vertex colours multiply it), alpha is the cut-out.
 *
 * When photographed leaves are enabled ({@link usePhotos}), the atlases of the kinds that have them (trees, shrubs,
 * ferns, grass) are recomposed from the leaf sprite sheet once it has loaded (`foliage-photo.ts`), in place: the
 * texture object and its size stay, so no material is rebuilt.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, ClampToEdgeWrapping, type Texture } from 'three';
import { FOLIAGE_TEXTURE_SIZE, foliageAtlasSize, foliagePixelsJob, type FoliageKind } from '@aether/procgen';
import { textureWork } from '../gpu/task-queue';
import { loadLeafPhotos, photoAtlasJob, PHOTO_KINDS, type LeafPhotos } from './foliage-photo';
import { TEXTURE_ANISOTROPY } from './anisotropy';

/** Lazily created, shared foliage card textures. */
export class FoliageTextures {
  private readonly textures = new Map<FoliageKind, DataTexture>();
  private size = FOLIAGE_TEXTURE_SIZE;
  private photoBase: string | null = null;
  private photos: Promise<LeafPhotos | null> | null = null;
  private upgrading = 0;
  private disposed = false;
  /** Called when a texture's pixels were replaced (the owner redraws). */
  onChange: (() => void) | null = null;

  /** Atlas edge length for textures created from now on (power of two; existing ones keep theirs). */
  configure(size: number): void {
    if (this.textures.size === 0) this.size = Math.max(64, Math.min(1024, 2 ** Math.round(Math.log2(size))));
  }

  /**
   * Compose the cards of trees, shrubs, ferns and grass from photographed leaves served at `baseUrl` (null: keep the
   * procedural cards). Textures already created are upgraded too.
   */
  usePhotos(baseUrl: string | null): void {
    if (baseUrl === this.photoBase) return;
    this.photoBase = baseUrl;
    this.photos = null;
    if (baseUrl) for (const [kind, tex] of this.textures) this.upgrade(kind, tex);
  }

  /** Photographed cards are still being composed. */
  get pending(): boolean {
    return this.upgrading > 0;
  }

  /**
   * The texture of a card kind (created on first use). It starts empty (every card transparent) and is filled in
   * a task of its own: from the photographed leaves when those are on, else (and when they fail) from the
   * procedural card. Synthesising an atlas is tens to hundreds of milliseconds, a foliage-heavy world asks for
   * half a dozen at once, and done here, in the middle of building materials, they were one long stall.
   */
  get(kind: FoliageKind): Texture {
    const hit = this.textures.get(kind);
    if (hit) return hit;
    // Grass blades are hair-fine: the atlas gets twice the resolution so they survive the mip chain.
    const size = foliageAtlasSize(kind === 'grass' ? this.size * 2 : this.size);
    const tex = new DataTexture(new Uint8Array(size * size * 4), size, size, RGBAFormat);
    // Linear ratios and a hard alpha: no colour-space conversion, clamped edges, trilinear mips.
    tex.colorSpace = NoColorSpace;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = TEXTURE_ANISOTROPY;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.textures.set(kind, tex);
    if (this.photoBase && PHOTO_KINDS.has(kind)) this.upgrade(kind, tex);
    else this.synthesise(kind, tex);
    return tex;
  }

  /** Atlases that already hold their final pixels (a photographed one was composed). */
  private readonly composed = new WeakSet<Texture>();

  /** Fill `tex` with the procedural card of `kind`, in its own task, unless a photographed atlas got there first. */
  private synthesise(kind: FoliageKind, tex: DataTexture): void {
    this.upgrading++;
    const img = tex.image as { data: Uint8Array; width: number };
    const job = foliagePixelsJob(kind, img.width);
    const stale = (): boolean => this.disposed || this.textures.get(kind) !== tex || this.composed.has(tex);
    void (async () => {
      // A card variant per task.
      for (const step of job.steps) {
        await textureWork.run(step, `leaf ${kind} procedural`);
        if (stale()) return;
      }
      if (job.rgba.length !== img.data.length) return;
      img.data.set(job.rgba);
      tex.needsUpdate = true;
      this.onChange?.();
    })()
      .catch(() => undefined)
      .finally(() => {
        this.upgrading = Math.max(0, this.upgrading - 1);
      });
  }

  private upgrade(kind: FoliageKind, tex: DataTexture): void {
    const base = this.photoBase;
    if (!base || !PHOTO_KINDS.has(kind)) return;
    this.photos ??= loadLeafPhotos(base);
    const photos = this.photos;
    this.upgrading++;
    const stale = (): boolean => this.disposed || this.photoBase !== base || this.textures.get(kind) !== tex;
    void photos
      .then(async (p) => {
        if (stale()) return true;
        const img = tex.image as { data: Uint8Array; width: number; height: number };
        const job = p ? photoAtlasJob(kind, img.width, p.sheet, p.image) : null;
        if (!job) return false;
        // Every kind's atlas is ready at once and each is a few hundred milliseconds of drawing: a card variant per task.
        for (const step of job.steps) {
          await textureWork.run(step, `leaf ${kind} step`);
          if (stale()) return true;
        }
        const px = await textureWork.run(() => job.finish(), `leaf ${kind} finish`);
        if (stale()) return true;
        if (px.length !== img.data.length) return false;
        img.data.set(px);
        tex.needsUpdate = true;
        this.composed.add(tex);
        this.onChange?.();
        return true;
      })
      // No sheet, no canvas, or a failed load: the procedural card stands in.
      .then((done) => {
        if (!done && !this.disposed && this.textures.get(kind) === tex) this.synthesise(kind, tex);
      })
      .catch(() => {
        if (!this.disposed && this.textures.get(kind) === tex) this.synthesise(kind, tex);
      })
      .finally(() => {
        this.upgrading = Math.max(0, this.upgrading - 1);
      });
  }

  /** Number of textures created. */
  get count(): number {
    return this.textures.size;
  }

  /** Release every texture. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    void this.photos?.then((p) => p?.image.close()).catch(() => undefined);
    this.photos = null;
  }
}
