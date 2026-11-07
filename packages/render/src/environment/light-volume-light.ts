/**
 * The scene object that carries a baked light volume (see `light-volume.ts`) and the baked lightmap (`lightmap.ts`) to the
 * GPU: a `Light`, so the node renderer gives every lit material its light node (`gpu/light-volume-node.ts`), which multiplies
 * the material's ambient (sky hemisphere and image light) by the baked sky visibility and adds the baked bounce. Both are
 * re-lightable (`relight.ts`): the volume is combined for the live light on the CPU, the lightmap's parts are weighted in the
 * shader from uniforms ({@link relight}). Pure three.js core: no renderer access.
 *
 * The 3D texture is allocated once at {@link VOLUME_ALLOC} probes per axis and keeps its object for the light's
 * lifetime; a new bake rewrites its pixels, so neither the GPU texture nor any material is rebuilt for a
 * rebake. With no bake ({@link strength} 0) the light changes nothing.
 */
import { ClampToEdgeWrapping, Data3DTexture, DataArrayTexture, HalfFloatType, Light, LinearFilter, RGBAFormat, UnsignedByteType, Vector3, Vector4 } from 'three';
import { atlasDepth, packVolumeAtlas, VOLUME_ALLOC, type V3, type VolumeGrid } from './light-volume';
import { LAYER_SUN0, lightmapLayers, PART_LAMP, PART_SKY0, PART_SKY1, relightCoefficients, scaleCount, sunKeyWeights, type RelightLighting } from './relight';

/** Metres over which the volume's effect fades out beyond its box. */
export const VOLUME_FADE = 1.2;
/** Lowest sky visibility applied (a sealed room keeps a trace of the ambient instead of turning black). */
export const VOLUME_VIS_FLOOR = 0.05;

/** Name of the vertex attribute that carries a mesh's lightmap coordinates (see `lightmap.ts`). */
export const LIGHTMAP_ATTRIBUTE = 'aetherLM';

/** A light that applies a baked volume to every lit material (see the module comment). */
export class LightVolume extends Light {
  readonly isLightVolume = true;
  readonly texture: Data3DTexture;
  /** World position of probe (0, 0, 0). */
  readonly gridMin = new Vector3();
  /** World extent covered by the probes: `spacing * (n - 1)` per axis. */
  readonly gridExtent = new Vector3(1, 1, 1);
  /** Probes per axis in use. */
  readonly gridResolution = new Vector3(2, 2, 2);
  /** Probes per axis allocated in the texture. */
  readonly allocResolution = new Vector3(VOLUME_ALLOC.nx, VOLUME_ALLOC.ny, VOLUME_ALLOC.nz);
  spacing = 1;
  fade = VOLUME_FADE;
  visFloor = VOLUME_VIS_FLOOR;
  /** 0 with no bake, 1 with one (scales the whole effect, so a volume can be faded in). */
  strength = 0;
  /** Bumped by every upload. */
  bakeVersion = 0;
  private readonly atlas: Uint16Array;
  /**
   * The baked lightmap: `relight.ts` `lightmapLayers` layers of `size × size` RGBA8 (the sky's two parts, the lamps, the sun keys'
   * chroma and luminance), the sky visibility in a. Allocated by {@link setLightmap} for the atlas' size and layer count.
   */
  lightmap: DataArrayTexture | null = null;
  /** 0 with no lightmap, 1 with one. */
  lightmapStrength = 0;
  /** Bumped by every lightmap upload. */
  lightmapVersion = 0;
  /**
   * What the shader weights the layers with (rgb: the part's live weight times its stored scale): the sky's constant and
   * gradient parts and the lamps; the sun's irradiance (rgb), and the two sun keys around the sun (x: weight times the key's
   * scale, w: its layer; `lmSelA`/`lmSelB`: its channel in that layer, one-hot). Set by {@link relight}.
   */
  readonly lmSky0 = new Vector4();
  readonly lmSky1 = new Vector4();
  readonly lmLamp = new Vector4();
  readonly lmSun = new Vector4();
  readonly lmKeyA = new Vector4(0, 0, 0, LAYER_SUN0);
  readonly lmKeyB = new Vector4(0, 0, 0, LAYER_SUN0);
  readonly lmSelA = new Vector4(1, 0, 0, 0);
  readonly lmSelB = new Vector4(1, 0, 0, 0);
  private lmScales: Float32Array = new Float32Array(0);
  private lmKeys: V3[] = [];
  private lmLight: RelightLighting | null = null;
  private lmCoeffs: Float32Array = new Float32Array(0);

  constructor() {
    super(0xffffff, 1);
    (this as { type: string }).type = 'LightVolume';
    this.name = 'aether:light-volume';
    this.castShadow = false;
    const depth = atlasDepth(VOLUME_ALLOC);
    this.atlas = new Uint16Array(VOLUME_ALLOC.nx * VOLUME_ALLOC.ny * depth * 4);
    const t = new Data3DTexture(this.atlas, VOLUME_ALLOC.nx, VOLUME_ALLOC.ny, depth);
    t.format = RGBAFormat;
    t.type = HalfFloatType;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    this.texture = t;
  }

  /** Upload a finished bake (grids larger than the allocation are cropped; the planner never makes one). */
  setBake(grid: VolumeGrid, data: Float32Array): void {
    packVolumeAtlas(grid, data, VOLUME_ALLOC, this.atlas);
    this.texture.needsUpdate = true;
    const nx = Math.min(grid.nx, VOLUME_ALLOC.nx);
    const ny = Math.min(grid.ny, VOLUME_ALLOC.ny);
    const nz = Math.min(grid.nz, VOLUME_ALLOC.nz);
    this.gridMin.set(grid.min[0], grid.min[1], grid.min[2]);
    this.gridExtent.set(grid.spacing * (nx - 1), grid.spacing * (ny - 1), grid.spacing * (nz - 1));
    this.gridResolution.set(nx, ny, nz);
    this.spacing = grid.spacing;
    this.strength = 1;
    this.bakeVersion++;
  }

  /**
   * The same building's volume for another light (`combineVolume`): only the bounce sub-volumes are rewritten (the visibility and
   * the free distances do not change with the light). A no-op without a bake of this grid on the GPU.
   */
  setBakeLight(grid: VolumeGrid, data: Float32Array): void {
    if (this.strength === 0) return;
    packVolumeAtlas(grid, data, VOLUME_ALLOC, this.atlas, [1, 4]);
    this.texture.needsUpdate = true;
  }

  /**
   * Upload a baked lightmap (`layers`: `relight.ts` `lightmapLayers(keys.length)` layers of `size × size` RGBA8, see
   * `LightmapResult`), its scales and the sun keys it was baked for. The texture is reallocated only when the size or the
   * layer count changes (no program changes: the shader reads the texture it is given).
   */
  setLightmap(layers: Uint8Array, size: number, scales: ArrayLike<number>, keys: readonly V3[]): void {
    const L = lightmapLayers(keys.length);
    if (layers.length !== size * size * 4 * L || scales.length !== scaleCount(keys.length)) return;
    const t = this.lightmap;
    if (!t || t.image.width !== size || t.image.depth !== L) {
      t?.dispose();
      const n = new DataArrayTexture(new Uint8Array(size * size * 4 * L), size, size, L);
      n.format = RGBAFormat;
      n.type = UnsignedByteType;
      n.minFilter = LinearFilter;
      n.magFilter = LinearFilter;
      n.wrapS = n.wrapT = ClampToEdgeWrapping;
      n.generateMipmaps = false;
      n.unpackAlignment = 1;
      this.lightmap = n;
    }
    const tex = this.lightmap as DataArrayTexture;
    (tex.image.data as Uint8Array).set(layers);
    tex.needsUpdate = true;
    this.lmScales = Float32Array.from(scales);
    this.lmKeys = keys.map((k) => [k[0], k[1], k[2]] as V3);
    this.lightmapStrength = 1;
    this.lightmapVersion++;
    if (this.lmLight) this.relight(this.lmLight);
  }

  /** Weight the lightmap's parts for the live light (a uniform update: the hour, the sun, the sky, the lamps' daylight scale). */
  relight(l: RelightLighting): void {
    this.lmLight = l;
    const keys = this.lmKeys;
    if (keys.length === 0) return;
    const c = (this.lmCoeffs = relightCoefficients(keys, l, this.lmCoeffs));
    const sc = this.lmScales;
    const put = (v: Vector4, p: number): void => {
      const k = sc[p] ?? 0;
      v.x = (c[p * 3] as number) * k;
      v.y = (c[p * 3 + 1] as number) * k;
      v.z = (c[p * 3 + 2] as number) * k;
    };
    put(this.lmSky0, PART_SKY0);
    put(this.lmSky1, PART_SKY1);
    put(this.lmLamp, PART_LAMP);
    this.lmSun.set(0, 0, 0, 0);
    this.lmKeyA.set(0, 0, 0, LAYER_SUN0);
    this.lmKeyB.set(0, 0, 0, LAYER_SUN0);
    if (!l.sun) return;
    const irr = l.sun.irradiance;
    this.lmSun.set(Math.max(0, irr[0]), Math.max(0, irr[1]), Math.max(0, irr[2]), 0);
    const w = sunKeyWeights(keys, l.sun.direction);
    const key = (v: Vector4, sel: Vector4, k: number, wk: number): void => {
      v.set(wk * (sc[LAYER_SUN0 + k] ?? 0), 0, 0, LAYER_SUN0 + Math.floor(k / 3));
      sel.set(k % 3 === 0 ? 1 : 0, k % 3 === 1 ? 1 : 0, k % 3 === 2 ? 1 : 0, 0);
    };
    key(this.lmKeyA, this.lmSelA, w.i, w.wi);
    if (w.wj > 0 && w.j !== w.i) key(this.lmKeyB, this.lmSelB, w.j, w.wj);
  }

  /** The lightmap no longer applies (meshes that carried coordinates must have been restored). */
  clearLightmap(): void {
    this.lightmapStrength = 0;
  }

  /** Back to no effect (the building went away). */
  clearBake(): void {
    this.strength = 0;
  }

  override dispose(): void {
    this.texture.dispose();
    this.lightmap?.dispose();
    super.dispose();
  }
}
