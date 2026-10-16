/**
 * Cut-out textures of the foliage materials (`material.foliage`): one RGBA card per kind, synthesised
 * on first use by `@aether/procgen` (`foliagePixels`, a few milliseconds each) and shared by every
 * material of the cache. Colour is stored linear (vertex colours multiply it), alpha is the cut-out.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, ClampToEdgeWrapping, type Texture } from 'three';
import { FOLIAGE_TEXTURE_SIZE, foliagePixels, type FoliageKind } from '@aether/procgen';

/** Lazily created, shared foliage card textures. */
export class FoliageTextures {
  private readonly textures = new Map<FoliageKind, DataTexture>();
  private size = FOLIAGE_TEXTURE_SIZE;

  /** Card edge length for textures created from now on (power of two; existing ones keep theirs). */
  configure(size: number): void {
    if (this.textures.size === 0) this.size = Math.max(64, Math.min(1024, 2 ** Math.round(Math.log2(size))));
  }

  /** The texture of a card kind (created on first use). */
  get(kind: FoliageKind): Texture {
    const hit = this.textures.get(kind);
    if (hit) return hit;
    // Grass blades are hair-fine: the card gets twice the resolution so they survive the mip chain.
    const { size, rgba } = foliagePixels(kind, kind === 'grass' ? this.size * 2 : this.size);
    const tex = new DataTexture(rgba, size, size, RGBAFormat);
    // Linear ratios and a hard alpha: no colour-space conversion, clamped edges, trilinear mips.
    tex.colorSpace = NoColorSpace;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.textures.set(kind, tex);
    return tex;
  }

  /** Number of textures created. */
  get count(): number {
    return this.textures.size;
  }

  /** Release every texture. */
  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}
