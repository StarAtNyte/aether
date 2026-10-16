/**
 * The photographs of the terrain layers packed as texture arrays.
 *
 * A layered terrain pixel blends four photographed surfaces, each with an albedo, a roughness/occlusion and a normal map:
 * twelve textures, and in the node renderer each one takes a sampler binding of its own. WebGPU allows 16 sampler bindings
 * per fragment stage and a lit terrain already spends about five on shadows and the environment, so the twelve do not fit.
 * Packed as three arrays (one per map kind, one layer per surface) the terrain needs three textures and three samplers,
 * on WebGPU and WebGL2 alike, and none of the maps has to be dropped.
 *
 * The arrays are copies: the per-finish textures stay the source (exporters and other materials read them), and
 * {@link SplatArrays.refreshSource} re-copies a layer whenever its finish gets its real pixels.
 */
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';
import type { FinishMaps } from './finish-textures';

/** Which of the three maps of a finish an array holds. */
export type MapKind = 'map' | 'orm' | 'normal';

function makeArray(size: number, layers: number): DataArrayTexture {
  const tex = new DataArrayTexture(new Uint8Array(size * size * 4 * layers), size, size, layers);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  // Albedo holds linear ratios (see finishPixels); no colour-space conversion anywhere.
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Albedo, ORM and normal arrays of a set of finishes (layer i is `sources[i]`). */
export class SplatArrays {
  readonly map: DataArrayTexture;
  readonly orm: DataArrayTexture;
  readonly normal: DataArrayTexture;
  private readonly sources: readonly FinishMaps[];
  private readonly size: number;

  /** Pack the maps of `sources` (all `size`x`size`, RGBA8). */
  constructor(sources: readonly FinishMaps[], size: number) {
    this.sources = sources;
    this.size = size;
    this.map = makeArray(size, sources.length);
    this.orm = makeArray(size, sources.length);
    this.normal = makeArray(size, sources.length);
    for (let i = 0; i < sources.length; i++) this.copyLayer(i);
  }

  /** Number of layers. */
  get layers(): number {
    return this.sources.length;
  }

  /** The array of one map kind. */
  of(kind: MapKind): DataArrayTexture {
    return kind === 'map' ? this.map : kind === 'orm' ? this.orm : this.normal;
  }

  /** Re-copy the pixels of every layer whose source is `maps` (its finish got new pixels). */
  refreshSource(maps: FinishMaps): void {
    let changed = false;
    this.sources.forEach((s, i) => {
      if (s !== maps) return;
      this.copyLayer(i);
      changed = true;
    });
    if (!changed) return;
    this.map.needsUpdate = true;
    this.orm.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  private copyLayer(i: number): void {
    const src = this.sources[i] as FinishMaps;
    const stride = this.size * this.size * 4;
    for (const kind of ['map', 'orm', 'normal'] as const) {
      const from = (src[kind].image as { data?: Uint8Array }).data;
      const to = this.of(kind).image.data as Uint8Array;
      if (from && from.length === stride) to.set(from, i * stride);
    }
  }

  /** Release the arrays. */
  dispose(): void {
    this.map.dispose();
    this.orm.dispose();
    this.normal.dispose();
  }
}
