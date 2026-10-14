/**
 * Shared, reference-counted three.js materials. Classic `MeshStandardMaterial`
 * is used on purpose: `WebGPURenderer` converts it to its node equivalent on
 * both the WebGPU and the WebGL2 backend, and it also works in Node tests.
 */
import { Color, DoubleSide, FrontSide, MeshStandardMaterial, Vector2, type Material } from 'three';
import type { MaterialSpec } from '@aether/core';
import { RefCache } from '../refcache';
import { materialKey, resolveMaterial, type MaterialVariant, type ResolveOptions, type ResolvedMaterial } from './presets';
import { SurfaceTextures, WATER_NORMAL_SCALE } from './surface-textures';
import { applyWind } from './wind';
import { FINISHES } from '@aether/arch';
import { finishAlbedoScale } from '@aether/procgen';
import { FinishTextures, finishHasMaps } from './finish-textures';

/** Ghost preview tint (cyan, translucent). */
const GHOST_COLOR = new Color('#7fd8ff');
const GHOST_OPACITY = 0.34;
/** Proof-replay ghost tint (indigo-cyan, readable over any ground). */
const PROOF_COLOR = new Color('#8c95ff');
const PROOF_OPACITY = 0.62;

/** A material handle: release it with {@link MaterialCache.release} using `key`. */
export interface MaterialHandle {
  key: string;
  material: Material;
  resolved: ResolvedMaterial;
}

/**
 * Build a three.js material from resolved parameters. With `surfaces`,
 * lava and water (standard variant) get their procedural detail maps.
 */
export function createMaterial(r: ResolvedMaterial, variant: MaterialVariant, surfaces?: SurfaceTextures, finishes?: FinishTextures): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: r.color,
    roughness: r.roughness,
    metalness: r.metalness,
    emissive: r.emissive,
    emissiveIntensity: r.emissiveIntensity,
    flatShading: r.flatShading,
    vertexColors: r.vertexColors,
    side: r.doubleSided ? DoubleSide : FrontSide,
  });
  const ghostLike = variant === 'ghost' || variant === 'proof';
  if (ghostLike) {
    const tint = variant === 'proof' ? PROOF_COLOR : GHOST_COLOR;
    m.color.lerp(tint, variant === 'proof' ? 0.55 : 0.65);
    m.emissive.copy(tint);
    m.emissiveIntensity = variant === 'proof' ? 0.45 : 0.35;
    m.transparent = true;
    m.opacity = (variant === 'proof' ? PROOF_OPACITY : GHOST_OPACITY) * (r.transparent ? r.opacity : 1);
    m.depthWrite = false;
  } else if (r.transparent) {
    m.transparent = true;
    m.opacity = r.opacity;
    // Sorted alpha blending without depth writes avoids self-occlusion artifacts on water/glass.
    m.depthWrite = r.opacity > 0.9;
  }
  if (!ghostLike && surfaces && r.surface) {
    const maps = surfaces.get(r.surface);
    m.map = maps.map;
    if (maps.emissiveMap && r.emissiveIntensity > 0) m.emissiveMap = maps.emissiveMap;
    if (maps.normalMap) {
      m.normalMap = maps.normalMap;
      m.normalScale = new Vector2(WATER_NORMAL_SCALE, WATER_NORMAL_SCALE);
    }
  }
  if (!ghostLike && r.finish) applyFinish(m, r, finishes);
  if (variant === 'foliage') applyWind(m);
  m.name = `aether:${variant}`;
  return m;
}

/**
 * Bind a finish's maps: the albedo map holds ratios to the base colour
 * scaled into 8 bits, so the colour is multiplied back by the same scale;
 * roughness comes from the ORM map (absolute), so the factor carries only
 * the spec's deviation from the finish default.
 */
function applyFinish(m: MeshStandardMaterial, r: ResolvedMaterial, finishes: FinishTextures | undefined): void {
  const id = r.finish;
  if (!id) return;
  const def = FINISHES[id];
  if (!finishes || !finishHasMaps(id)) return;
  const maps = finishes.get(id);
  m.color.multiplyScalar(finishAlbedoScale(def));
  m.map = maps.map;
  m.roughnessMap = maps.orm;
  m.roughness = Math.min(3, r.roughness / Math.max(0.01, def.roughness));
  m.aoMap = maps.orm;
  m.aoMapIntensity = 1;
  if (def.bump > 0) {
    m.normalMap = maps.normal;
    m.normalScale = new Vector2(1, 1);
  }
}

/**
 * Material cache keyed by the stable JSON of the resolved parameters, so two
 * specs that resolve identically share one GPU material (and one pipeline).
 */
export class MaterialCache {
  private readonly cache = new RefCache<Material>((m) => m.dispose());
  /** Procedural surface textures shared by this cache's lava/water materials. */
  readonly surfaces = new SurfaceTextures();
  /** Texture maps of the physically based finishes (architecture). */
  readonly finishes = new FinishTextures();

  /** Acquire (and retain) the material for `spec`. Pair every call with {@link release}. */
  acquire(spec: MaterialSpec | undefined, opts: ResolveOptions = {}, variant: MaterialVariant = 'standard'): MaterialHandle {
    const resolved = resolveMaterial(spec, opts);
    const key = materialKey(resolved, variant);
    const material = this.cache.acquire(key, () => createMaterial(resolved, variant, this.surfaces, this.finishes));
    return { key, material, resolved };
  }

  /** Release one reference; the material is disposed when unused. */
  release(key: string): void {
    this.cache.release(key);
  }

  /** Current reference count of a key (for tests/diagnostics). */
  refs(key: string): number {
    return this.cache.refs(key);
  }

  /** Number of live materials. */
  get size(): number {
    return this.cache.size;
  }

  /** Dispose every material and the surface textures. */
  dispose(): void {
    this.cache.clear();
    this.surfaces.dispose();
    this.finishes.dispose();
  }
}
