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
import { applyAntiTile, FINISH_NODES_KEY, groundWeather, GROUND_PATTERN_FINISHES, needsAntiTile, NORMAL_STRENGTH } from './anti-tile';
import { applySplat, SPLAT_LAYERS } from './terrain-splat';
import { applyFacadeGlow, facadeGlow, nightGlow } from './facade-glow';
import { FoliageTextures } from './foliage-textures';
import { applyWater, PlanarReflection, WATER_SHADER_KEY, type WaterShader } from './water';
import { SURFACE_TILE_METRES } from './surface-textures';
import type { WaterTier } from './water-params';
import { SceneBackdrop } from './scene-backdrop';

/** Ghost preview tint (cyan, translucent). */
const GHOST_COLOR = new Color('#7fd8ff');
const GHOST_OPACITY = 0.34;
/** Proof-replay ghost tint (indigo-cyan, readable over any ground). */
const PROOF_COLOR = new Color('#8c95ff');
const PROOF_OPACITY = 0.62;

/** Marks the water materials (their look changes with the screen-space reflection mode, see {@link MaterialCache.setReflectiveWater}). */
export const WATER_KEY = 'aetherWater';
/** Colour and glow of water drawn as an opaque reflective surface, relative to its see-through look. */
export const OPAQUE_WATER_COLOR = 0.55;
export const OPAQUE_WATER_GLOW = 0.45;

/** Switch one water material between its see-through and its opaque reflective look (reversible, no new program unless blending changes). */
export function setWaterLook(m: MeshStandardMaterial, reflective: boolean): void {
  if (m.userData['aetherWaterNodes'] === true) return;
  const base = m.userData['aetherWaterBase'] as { color: Color; emissive: number; opacity: number; transparent: boolean; depthWrite: boolean } | undefined;
  if (!base) return;
  if (reflective) {
    m.color.copy(base.color).multiplyScalar(OPAQUE_WATER_COLOR);
    m.emissiveIntensity = base.emissive * OPAQUE_WATER_GLOW;
    m.opacity = 1;
    m.transparent = false;
    m.depthWrite = true;
  } else {
    m.color.copy(base.color);
    m.emissiveIntensity = base.emissive;
    m.opacity = base.opacity;
    m.transparent = base.transparent;
    m.depthWrite = base.depthWrite;
  }
  m.needsUpdate = true;
}

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
export function createMaterial(r: ResolvedMaterial, variant: MaterialVariant, surfaces?: SurfaceTextures, finishes?: FinishTextures, antiTile = false, foliage?: FoliageTextures, layered = true, waterTier: WaterTier | null = null, mirror: PlanarReflection | null = null, groundDetail = false, backdrop: SceneBackdrop | null = null): MeshStandardMaterial {
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
  // The resolved colour as linear albedo, before finish maps rescale `color` (the light volume bakes with it).
  m.userData['aetherAlbedo'] = [m.color.r, m.color.g, m.color.b];
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
    if (maps.normalMap && !(r.water && waterTier && mirror)) {
      m.normalMap = maps.normalMap;
      m.normalScale = new Vector2(WATER_NORMAL_SCALE, WATER_NORMAL_SCALE);
    }
  }
  if (!ghostLike && r.finish) applyFinish(m, r, finishes, antiTile, groundDetail);
  if (!ghostLike && r.foliage && foliage) {
    // Leaf cards: the cut-out is the alpha test; both faces are in the geometry, so the material stays single-sided.
    m.map = foliage.get(r.foliage);
    m.alphaTest = 0.5;
    m.shadowSide = DoubleSide;
    m.userData['aetherFoliage'] = r.foliage;
  }
  if (!ghostLike && r.splat && finishes && layered) {
    m.roughness = 1;
    applySplat(m, (id) => finishes.get(id), finishes.stack(SPLAT_LAYERS), groundDetail);
  }
  if (variant === 'foliage') applyWind(m);
  if (!ghostLike && r.surface === 'water' && r.water && waterTier && surfaces && mirror) {
    // The water shader: waves, ripples, depth absorption, refraction, foam (see `water.ts`). It replaces the classic maps.
    m.map = null;
    m.emissiveMap = null;
    m.transparent = true;
    m.opacity = 1;
    m.depthWrite = waterTier !== 'simple';
    const shader = applyWater(m, r.water, waterTier, { normalMap: surfaces.get('water').normalMap }, SURFACE_TILE_METRES.water, mirror, backdrop);
    m.userData[WATER_SHADER_KEY] = shader;
    m.userData['aetherWaterNodes'] = true;
  } else if (!ghostLike && r.surface === 'water') {
    m.userData[WATER_KEY] = true;
    m.userData['aetherWaterBase'] = { color: m.color.clone(), emissive: m.emissiveIntensity, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
  }
  m.name = `aether:${variant}`;
  return m;
}

/**
 * Bind a finish's maps: the albedo map holds ratios to the base colour
 * scaled into 8 bits, so the colour is multiplied back by the same scale;
 * roughness comes from the ORM map (absolute), so the factor carries only
 * the spec's deviation from the finish default.
 */
function applyFinish(m: MeshStandardMaterial, r: ResolvedMaterial, finishes: FinishTextures | undefined, antiTile: boolean, groundDetail: boolean): void {
  const id = r.finish;
  if (!id) return;
  const def = FINISHES[id];
  if (!finishes || !finishHasMaps(id)) return;
  const maps = finishes.get(id);
  m.color.multiplyScalar(finishAlbedoScale(def));
  m.roughness = Math.min(3, r.roughness / Math.max(0.01, def.roughness));
  if (antiTile && needsAntiTile(id, def.tile)) {
    // Large-tile surfaces (floors, walls, lawns): the maps are sampled twice by nodes (stochastic blend
    // that hides the repeat), so they are not bound as classic maps.
    m.userData[FINISH_NODES_KEY] = id;
    applyAntiTile(m, maps, def.bump > 0 ? (NORMAL_STRENGTH[id] ?? 1) : 0, { finish: id, stochastic: !GROUND_PATTERN_FINISHES.has(id), detail: groundDetail });
    return;
  }
  if (id === 'facade') applyFacadeGlow(m, maps.orm);
  m.map = maps.map;
  m.roughnessMap = maps.orm;
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
  /** Cut-out leaf, needle, grass and fern cards of the foliage materials. */
  readonly foliage = new FoliageTextures();
  /**
   * Hide the repeat of large textured surfaces with a second, blended texture lookup (costs extra texture
   * reads per pixel; the renderer turns it off on software rasterisers). Applies to materials created afterwards.
   */
  antiTile = true;
  /**
   * Blend the photographed terrain layers by the splat weights (about 28 texture reads per pixel; the renderer turns it
   * off on software rasterisers and in low-memory mode, where terrain keeps its vertex colours). Applies to materials
   * created afterwards.
   */
  layeredTerrain = true;
  /** Fewer photographs per terrain pixel (WebGPU's 16-sampler fragment limit; see applySplat). */
  compactSplat = false;
  /**
   * Add the close-up micro and distance macro detail lookups to ground and masonry finishes (about six extra texture
   * reads per pixel; the renderer turns it off on software rasterisers and in low-memory mode). Applies to materials created afterwards.
   */
  groundDetail = true;
  private reflectiveWater = false;
  /**
   * Water shader tier (`null` keeps the classic translucent water: tests and exports). Applies to materials created
   * afterwards; the renderer rebuilds its scene content when the tier changes.
   */
  waterTier: WaterTier | null = null;
  /** The planar reflection of this cache's renderer (high water tier). */
  readonly mirror = new PlanarReflection();
  /** The scene behind the water, drawn by the renderer (WebGPU; WebGL2 copies the frame buffer instead). */
  readonly backdrop = new SceneBackdrop();
  /** Standard and high water read {@link backdrop} instead of the frame buffer (set before water materials are created). */
  backdropWater = false;

  /** The live water materials (hidden while the planar mirror is drawn). */
  waterMaterials(): Material[] {
    const out: Material[] = [];
    this.cache.forEach((m) => {
      if (m.userData[WATER_SHADER_KEY]) out.push(m);
    });
    return out;
  }

  /** Re-derive every water shader's waves from the current wind (call after `setWind`). */
  retuneWater(): void {
    this.cache.forEach((m) => {
      (m.userData[WATER_SHADER_KEY] as WaterShader | undefined)?.retune();
    });
  }

  /**
   * Draw water as an opaque, darker, reflective surface (true) instead of see-through (false). Opaque
   * water takes part in the depth pre-pass, so screen-space reflections mirror the shore and the sky in
   * it like a real lake. Applies to existing and later water materials.
   */
  setReflectiveWater(on: boolean): void {
    if (on === this.reflectiveWater) return;
    this.reflectiveWater = on;
    this.cache.forEach((m) => {
      if (m.userData[WATER_KEY] === true) setWaterLook(m as MeshStandardMaterial, on);
    });
  }

  /** True while water is drawn as an opaque reflective surface. */
  get waterIsReflective(): boolean {
    return this.reflectiveWater;
  }

  /** Wet weather (0 dry .. 1 rain) for every ground material (darker, glossier, puddles on asphalt and paving; no recompile). */
  setWetness(wet: number): void {
    groundWeather.value = Number.isFinite(wet) ? Math.max(0, Math.min(1, wet)) : 0;
  }

  /** Light the facade windows for a sun at `elevationDeg` (shared by every facade material; no recompile). */
  setSkyElevation(elevationDeg: number): void {
    facadeGlow.value = nightGlow(elevationDeg);
  }

  /** Acquire (and retain) the material for `spec`. Pair every call with {@link release}. */
  acquire(spec: MaterialSpec | undefined, opts: ResolveOptions = {}, variant: MaterialVariant = 'standard'): MaterialHandle {
    const resolved = resolveMaterial(spec, opts);
    const tier = resolved.water ? this.waterTier : null;
    const key = materialKey(resolved, variant) + (tier ? `|water:${tier}` : '');
    const material = this.cache.acquire(key, () => {
      const m = createMaterial(resolved, variant, this.surfaces, this.finishes, this.antiTile, this.foliage, this.layeredTerrain, variant === 'standard' ? tier : null, this.mirror, this.groundDetail, this.backdropWater ? this.backdrop : null);
      if (this.reflectiveWater && m.userData[WATER_KEY] === true) setWaterLook(m, true);
      return m;
    });
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
    this.foliage.dispose();
    this.mirror.dispose();
    this.backdrop.dispose();
  }
}
