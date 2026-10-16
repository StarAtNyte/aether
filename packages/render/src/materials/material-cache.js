/**
 * Shared, reference-counted three.js materials. Classic `MeshStandardMaterial`
 * is used on purpose: `WebGPURenderer` converts it to its node equivalent on
 * both the WebGPU and the WebGL2 backend, and it also works in Node tests.
 */
import { Color, DoubleSide, FrontSide, MeshStandardMaterial, Vector2 } from 'three';
import { RefCache } from '../refcache';
import { materialKey, resolveMaterial } from './presets';
import { SurfaceTextures, WATER_NORMAL_SCALE } from './surface-textures';
import { applyWind } from './wind';
import { FINISHES } from '@aether/arch';
import { finishAlbedoScale } from '@aether/procgen';
import { FinishTextures, finishHasMaps } from './finish-textures';
import { applyAntiTile, FINISH_NODES_KEY, needsAntiTile } from './anti-tile';
import { applySplat } from './terrain-splat';
import { FoliageTextures } from './foliage-textures';
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
export function setWaterLook(m, reflective) {
    const base = m.userData['aetherWaterBase'];
    if (!base)
        return;
    if (reflective) {
        m.color.copy(base.color).multiplyScalar(OPAQUE_WATER_COLOR);
        m.emissiveIntensity = base.emissive * OPAQUE_WATER_GLOW;
        m.opacity = 1;
        m.transparent = false;
        m.depthWrite = true;
    }
    else {
        m.color.copy(base.color);
        m.emissiveIntensity = base.emissive;
        m.opacity = base.opacity;
        m.transparent = base.transparent;
        m.depthWrite = base.depthWrite;
    }
    m.needsUpdate = true;
}
/**
 * Build a three.js material from resolved parameters. With `surfaces`,
 * lava and water (standard variant) get their procedural detail maps.
 */
export function createMaterial(r, variant, surfaces, finishes, antiTile = false, foliage, layered = true) {
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
    }
    else if (r.transparent) {
        m.transparent = true;
        m.opacity = r.opacity;
        // Sorted alpha blending without depth writes avoids self-occlusion artifacts on water/glass.
        m.depthWrite = r.opacity > 0.9;
    }
    if (!ghostLike && surfaces && r.surface) {
        const maps = surfaces.get(r.surface);
        m.map = maps.map;
        if (maps.emissiveMap && r.emissiveIntensity > 0)
            m.emissiveMap = maps.emissiveMap;
        if (maps.normalMap) {
            m.normalMap = maps.normalMap;
            m.normalScale = new Vector2(WATER_NORMAL_SCALE, WATER_NORMAL_SCALE);
        }
    }
    if (!ghostLike && r.finish)
        applyFinish(m, r, finishes, antiTile);
    if (!ghostLike && r.foliage && foliage) {
        // Leaf cards: the cut-out is the alpha test; both faces are in the geometry, so the material stays single-sided.
        m.map = foliage.get(r.foliage);
        m.alphaTest = 0.5;
        m.shadowSide = DoubleSide;
        m.userData['aetherFoliage'] = r.foliage;
    }
    if (!ghostLike && r.splat && finishes && layered) {
        m.roughness = 1;
        applySplat(m, (id) => finishes.get(id));
    }
    if (variant === 'foliage')
        applyWind(m);
    if (!ghostLike && r.surface === 'water') {
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
function applyFinish(m, r, finishes, antiTile) {
    const id = r.finish;
    if (!id)
        return;
    const def = FINISHES[id];
    if (!finishes || !finishHasMaps(id))
        return;
    const maps = finishes.get(id);
    m.color.multiplyScalar(finishAlbedoScale(def));
    m.roughness = Math.min(3, r.roughness / Math.max(0.01, def.roughness));
    if (antiTile && needsAntiTile(id, def.tile)) {
        // Large-tile surfaces (floors, walls, lawns): the maps are sampled twice by nodes (stochastic blend
        // that hides the repeat), so they are not bound as classic maps.
        m.userData[FINISH_NODES_KEY] = id;
        applyAntiTile(m, maps, def.bump > 0 ? 1 : 0);
        return;
    }
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
    cache = new RefCache((m) => m.dispose());
    /** Procedural surface textures shared by this cache's lava/water materials. */
    surfaces = new SurfaceTextures();
    /** Texture maps of the physically based finishes (architecture). */
    finishes = new FinishTextures();
    /** Cut-out leaf, needle, grass and fern cards of the foliage materials. */
    foliage = new FoliageTextures();
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
    reflectiveWater = false;
    /**
     * Draw water as an opaque, darker, reflective surface (true) instead of see-through (false). Opaque
     * water takes part in the depth pre-pass, so screen-space reflections mirror the shore and the sky in
     * it like a real lake. Applies to existing and later water materials.
     */
    setReflectiveWater(on) {
        if (on === this.reflectiveWater)
            return;
        this.reflectiveWater = on;
        this.cache.forEach((m) => {
            if (m.userData[WATER_KEY] === true)
                setWaterLook(m, on);
        });
    }
    /** True while water is drawn as an opaque reflective surface. */
    get waterIsReflective() {
        return this.reflectiveWater;
    }
    /** Acquire (and retain) the material for `spec`. Pair every call with {@link release}. */
    acquire(spec, opts = {}, variant = 'standard') {
        const resolved = resolveMaterial(spec, opts);
        const key = materialKey(resolved, variant);
        const material = this.cache.acquire(key, () => {
            const m = createMaterial(resolved, variant, this.surfaces, this.finishes, this.antiTile, this.foliage, this.layeredTerrain);
            if (this.reflectiveWater && m.userData[WATER_KEY] === true)
                setWaterLook(m, true);
            return m;
        });
        return { key, material, resolved };
    }
    /** Release one reference; the material is disposed when unused. */
    release(key) {
        this.cache.release(key);
    }
    /** Current reference count of a key (for tests/diagnostics). */
    refs(key) {
        return this.cache.refs(key);
    }
    /** Number of live materials. */
    get size() {
        return this.cache.size;
    }
    /** Dispose every material and the surface textures. */
    dispose() {
        this.cache.clear();
        this.surfaces.dispose();
        this.finishes.dispose();
        this.foliage.dispose();
    }
}
