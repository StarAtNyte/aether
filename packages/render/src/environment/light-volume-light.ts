/**
 * The scene object that carries a baked light volume (see `light-volume.ts`) to the GPU: a `Light`, so the
 * node renderer gives every lit material its light node (`gpu/light-volume-node.ts`), which multiplies the
 * material's ambient (sky hemisphere and image light) by the volume's sky visibility and adds the baked
 * bounce. Pure three.js core: no renderer access.
 *
 * The 3D texture is allocated once at {@link VOLUME_ALLOC} probes per axis and keeps its object for the light's
 * lifetime; a new bake rewrites its pixels, so neither the GPU texture nor any material is rebuilt for a
 * rebake. With no bake ({@link strength} 0) the light changes nothing.
 */
import { ClampToEdgeWrapping, Data3DTexture, HalfFloatType, Light, LinearFilter, RGBAFormat, Vector3 } from 'three';
import { atlasDepth, packVolumeAtlas, VOLUME_ALLOC, type VolumeGrid } from './light-volume';

/** Metres over which the volume's effect fades out beyond its box. */
export const VOLUME_FADE = 1.2;
/** Lowest sky visibility applied (a sealed room keeps a trace of the ambient instead of turning black). */
export const VOLUME_VIS_FLOOR = 0.05;

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

  /** Back to no effect (the building went away). */
  clearBake(): void {
    this.strength = 0;
  }

  override dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
