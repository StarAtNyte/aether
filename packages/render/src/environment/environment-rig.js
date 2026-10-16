/**
 * Environment rig: procedural sky, sun (directional, shadow-casting, fitted
 * to the content), hemisphere ambient, sky reflections (image-based light),
 * fog scaled to the content, ground plane plus a horizon skirt, and weather —
 * all driven by `world.environment`. Pure three.js core (no renderer access).
 */
import { BufferAttribute, Color, DataTexture, DirectionalLight, EquirectangularReflectionMapping, FogExp2, Group, HemisphereLight, LinearFilter, Mesh, PlaneGeometry, RGBAFormat, RingGeometry, SRGBColorSpace, } from 'three';
import { stableStringify } from '@aether/core';
import { resolveMaterial } from '../materials/presets';
import { computeSkyState } from './sky-state';
import { SkyDome, SKY_RADIUS } from './sky-dome';
import { WeatherSystem } from './weather';
import { fitShadowCamera } from './shadow-fit';
import { INTERIOR_FILL, interiorBounce } from './bounce';
import { resolveFog, MAX_FOG_DENSITY } from './fog';
import { ENV_MAP_HEIGHT, ENV_MAP_WIDTH, skyEnvironmentPixels } from './env-map';
import { createHdriSource, HdriController, hdriRotationFor } from './hdri';
export { MAX_FOG_DENSITY };
const GROUND_SEGMENTS = 64;
/** Outer radius of the decorative horizon skirt around the physical ground (inside the camera far plane). */
export const GROUND_SKIRT_RADIUS = SKY_RADIUS * 2;
/** The skirt sits slightly below the ground so the two never z-fight where they overlap. */
const SKIRT_DROP = 0.04;
/**
 * Share of the hemisphere light kept once sky reflections (image-based
 * lighting) also contribute ambient light.
 */
export const HEMI_SHARE_WITH_IBL = 0.6;
/**
 * Photographed skies used for image-based light (reflections and ambient colour) by the high and ultra
 * tiers when a world names none: one bundled Poly Haven HDRI per sky preset. Space has none.
 */
export const AUTO_HDRI = Object.freeze({
    day: 'sky-partly-cloudy',
    overcast: 'sky-partly-cloudy',
    dawn: 'sky-venice-sunset',
    sunset: 'sky-venice-sunset',
    night: 'sky-moonlit',
    studio: 'sky-photo-studio',
});
/** Content radius assumed before the first content bounds arrive. */
const DEFAULT_CONTENT_RADIUS = 20;
/** Deterministic, cheap ground tint variation in [0.86, 1.08] (large soft patches plus finer mottling). */
export function groundTint(x, z) {
    const a = Math.sin(x * 0.043 + z * 0.021) * 0.5 + Math.sin(x * 0.011 - z * 0.037 + 1.7) * 0.5;
    const b = Math.sin(x * 0.17 + 2.3) * Math.sin(z * 0.13 + 0.7);
    return 0.97 + a * 0.075 + b * 0.035;
}
/**
 * Deterministic warm/cool hue drift of the ground in [-1, 1] (independent of
 * {@link groundTint}): sun-dried warmer patches and lusher cooler ones, so a
 * 400 m lawn is not one flat color.
 */
export function groundHue(x, z) {
    const v = Math.sin(x * 0.027 - z * 0.019 + 0.6) * 0.6 + Math.sin(x * 0.083 + z * 0.061 + 2.1) * 0.4;
    return Math.max(-1, Math.min(1, v));
}
/** Per-channel multipliers of the hue drift at full strength (warm = +, cool = −). */
const HUE_DRIFT = [0.11, 0.04, -0.14];
/**
 * Per-vertex tint (macro variation) and metre UVs (u = x, v = −z) so the
 * ground detail texture covers the same real-world area on the plane and the
 * skirt, whatever the ground size.
 */
function tintVertices(g) {
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        uvs[i * 2] = x;
        uvs[i * 2 + 1] = -z;
        const t = groundTint(x, z);
        const w = groundHue(x, z);
        colors[i * 3] = t * (1 + HUE_DRIFT[0] * w);
        colors[i * 3 + 1] = t * (1 + HUE_DRIFT[1] * w);
        colors[i * 3 + 2] = t * (1 + HUE_DRIFT[2] * w);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
}
function createGroundGeometry(size) {
    const g = new PlaneGeometry(size, size, GROUND_SEGMENTS, GROUND_SEGMENTS);
    g.rotateX(-Math.PI / 2);
    tintVertices(g);
    return g;
}
/** Annulus from just inside the physical ground's edge to the horizon (no collider: purely visual). */
function createSkirtGeometry(size) {
    const inner = Math.max(1, size * 0.48);
    const g = new RingGeometry(inner, Math.max(inner + 10, GROUND_SKIRT_RADIUS), 72, 6);
    g.rotateX(-Math.PI / 2);
    g.translate(0, -SKIRT_DROP, 0);
    tintVertices(g);
    return g;
}
/**
 * Scene `FogExp2` density × view distance in view-distance mode: ≈ 58 % fog
 * at 0.8 of the distance, close to the terrain's own linear fade there, so
 * mobs and props fade like the blocks around them.
 */
const VIEW_FOG_K = 1.2;
/** Share of the view distance where the terrain's linear fog starts. */
const TERRAIN_FOG_START = 0.5;
/** Image-based light of a photographed HDRI relative to the analytic sky's (HDR skies are far brighter). */
const HDRI_ENV_SCALE = 0.6;
/** Hemisphere ambient kept while an HDRI lights the scene. */
const HDRI_HEMI_SCALE = 0.2;
/** Owns every environment object; add {@link group} to the scene. */
export class EnvironmentRig {
    materials;
    group = new Group();
    sun = new DirectionalLight('#ffffff', 2.5);
    hemi = new HemisphereLight('#bcd4f0', '#3b3326', 0.8);
    /** Floor-bounce fill of buildings (black sky half, warm ground half); off until {@link setInteriorBounce}. */
    bounce = new HemisphereLight('#000000', '#b08a66', 0);
    /** Neutral warm ambient fill of buildings, strongest when the eye is under a ceiling (see `view/eye-adapt.ts`). */
    fill = new HemisphereLight('#fff0e0', '#fff0e0', 0);
    fillLevel = 0;
    bounceOn = false;
    /** Image-light intensity before the eye-adaptation scale, and that scale (1 outdoors). */
    envBase = 1;
    envScale = 1;
    sky = new SkyDome();
    weather;
    fog = new FogExp2('#c4def4', 0);
    ground = null;
    skirt = null;
    groundKey = '';
    groundMaterialKey = '';
    state;
    env = null;
    scene = null;
    envMap = null;
    contentRadius = DEFAULT_CONTENT_RADIUS;
    fogParams = null;
    /**
     * Fog of block terrain (its materials fog themselves, see
     * `voxel/terrain-material.ts`): colour, the linear fade over horizontal
     * distance (`near` → `far`, metres; far = the view distance) and the
     * environment's explicit fog density. Updated in place.
     */
    terrainFog = { color: new Color('#c4def4'), near: 1e5, far: 2e5, density: 0 };
    mapCap = 2048;
    /** Upper bound on the sun shadow map resolution (the GPU budget's cap). Lowering it shrinks the current map right away. */
    get shadowMapCap() {
        return this.mapCap;
    }
    set shadowMapCap(cap) {
        if (!Number.isFinite(cap) || cap < 64)
            return;
        this.mapCap = Math.floor(cap);
        if (this.sun.shadow.mapSize.x > this.mapCap)
            this.setShadowMapSize(this.mapCap);
    }
    setShadowMapSize(size) {
        // The node renderer's shadow node owns the map and resizes it (reallocating its textures) the next
        // time it draws; `shadow.map` must stay in place because effects such as the sun shafts read it.
        this.sun.shadow.mapSize.set(size, size);
    }
    autoHdri = false;
    /**
     * Use a photographed sky for image-based light when the world names no HDRI (the renderer turns this on for the
     * high and ultra tiers). Rebuilds the environment lighting at once.
     */
    setAutoHdri(on) {
        if (on === this.autoHdri)
            return;
        this.autoHdri = on;
        if (this.env && this.scene)
            this.apply(this.env, this.scene);
    }
    /** HDR environment map (`environment.hdri`), when the world asks for one. */
    hdri;
    /** Called when asynchronous environment content (an HDRI) arrives: the owner redraws. */
    onAsyncChange = null;
    constructor(materials, shadows, hdriSource = createHdriSource()) {
        this.materials = materials;
        this.hdri = new HdriController(hdriSource, () => {
            if (this.scene)
                this.updateEnvironmentMap(this.scene, this.fogParams?.color ?? this.state.horizon);
            this.onAsyncChange?.();
        });
        this.group.name = 'aether:environment';
        this.sun.name = 'sun';
        this.sun.castShadow = shadows;
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.03;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.group.add(this.sun, this.sun.target, this.hemi, this.bounce, this.fill, this.sky.group);
        this.weather = new WeatherSystem(this.group);
        this.state = computeSkyState({ sky: 'day', sunIntensity: 2.5, ambientIntensity: 0.4 });
    }
    /** Scale the image-based light (eye adaptation: a room is not lit by the open sky). 1 restores it. */
    setEnvScale(scale) {
        const s = Number.isFinite(scale) ? Math.max(0, Math.min(2, scale)) : 1;
        if (Math.abs(s - this.envScale) < 1e-4)
            return;
        this.envScale = s;
        if (this.scene)
            this.scene.environmentIntensity = this.envBase * s;
    }
    /** Turn the interior floor-bounce fill on for worlds with buildings (see `bounce.ts`). */
    setInteriorBounce(on) {
        if (on === this.bounceOn)
            return;
        this.bounceOn = on;
        this.applyBounce();
    }
    applyBounce() {
        const b = interiorBounce(this.state);
        this.bounce.groundColor.set(b.color);
        this.bounce.intensity = this.bounceOn ? b.intensity : 0;
        this.bounce.visible = this.bounceOn;
        this.applyFill();
    }
    /**
     * How much of the interior fill shows: 0 (eye outdoors) to 1 (under a ceiling). Buildings keep a third of it
     * outdoors so a cutaway or an exterior shot through the glass is not a black box.
     */
    setInteriorFill(level) {
        const l = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
        if (Math.abs(l - this.fillLevel) < 1e-4)
            return;
        this.fillLevel = l;
        this.applyFill();
    }
    applyFill() {
        const b = interiorBounce(this.state);
        this.fill.intensity = this.bounceOn ? Math.min(1.1, b.intensity) * INTERIOR_FILL * (0.35 + 0.65 * this.fillLevel) : 0;
        this.fill.visible = this.bounceOn;
    }
    /** Current computed sky state. */
    get skyState() {
        return this.state;
    }
    /** The ground mesh (null when hidden/absent). */
    get groundMesh() {
        return this.ground;
    }
    /** The decorative horizon skirt around the ground (null when there is no ground). */
    get skirtMesh() {
        return this.skirt;
    }
    /** Fog currently applied (null when none). */
    get fogState() {
        return this.fogParams;
    }
    /** Sky reflection texture bound as `scene.environment` (null before the first apply). */
    get environmentMap() {
        return this.envMap;
    }
    /** Apply an environment (sky, lights, reflections, fog on `scene`, ground, weather). */
    apply(env, scene) {
        this.env = env;
        this.scene = scene;
        const s = computeSkyState(env);
        this.state = s;
        this.sun.color.set(s.lightColor);
        this.sun.intensity = s.lightIntensity;
        this.hemi.color.set(s.hemiSky);
        this.hemi.groundColor.set(s.hemiGround);
        this.hemi.intensity = s.hemiIntensity * HEMI_SHARE_WITH_IBL;
        this.applyBounce();
        this.syncGround(s.showGround ? env.ground : null);
        const explicit = env.hdri;
        const id = explicit ?? (this.autoHdri ? AUTO_HDRI[s.preset] : undefined);
        // An automatic HDRI only lights and reflects (the dome and clouds stay the background) and loses its sun.
        this.hdri.set(id, { intensity: env.hdriIntensity, background: explicit ? env.hdriBackground : false, lightOnly: !explicit });
        this.applyFog();
        this.weather.set(env.weather);
    }
    /**
     * Tell the rig how large the meaningful content is (framing radius, metres).
     * Fog density follows it so small and large worlds both read clearly. Only
     * the density uniform changes (no shader or texture rebuild).
     */
    setContentRadius(radius) {
        if (!Number.isFinite(radius) || radius <= 0 || Math.abs(radius - this.contentRadius) < 0.5)
            return;
        this.contentRadius = radius;
        // A view-distance fog does not follow the content.
        if (this.fogDistance !== null)
            return;
        const env = this.env;
        const scene = this.scene;
        if (!env || !scene)
            return;
        const fog = resolveFog(env, this.state, radius);
        // The fog color does not depend on the radius; only presence and density can change.
        if (fog && this.fogParams) {
            this.fogParams = fog;
            this.fog.density = fog.density;
        }
        else if (fog || this.fogParams) {
            this.applyFog();
        }
    }
    /** Distance (metres) at which terrain fades fully into the fog (voxel view distance), or null. */
    fogDistance = null;
    /**
     * Fog that ends at `distance` metres (≈ 95 % at that range), whatever the
     * environment says, and a horizon that melts into it: streamed terrain
     * then fades out instead of ending at a hard edge. Null restores the
     * environment's own fog.
     */
    setFogDistance(distance) {
        const d = distance !== null && Number.isFinite(distance) && distance > 1 ? distance : null;
        if (d === this.fogDistance)
            return;
        this.fogDistance = d;
        this.applyFog();
    }
    /** Fog, dome colors and sky reflections (they share the horizon color). */
    applyFog() {
        const env = this.env;
        const scene = this.scene;
        if (!env || !scene)
            return;
        const s = this.state;
        const own = resolveFog(env, s, this.contentRadius);
        const view = this.fogDistance;
        // View-distance mode: only fog the document asks for (not the ground haze) adds to the fade.
        const explicit = view === null ? null : resolveFog({ fog: env.fog, ground: null }, s, view);
        const fog = view === null ? own : { color: explicit?.color ?? s.fogColor, density: Math.max(explicit?.density ?? 0, VIEW_FOG_K / view) };
        this.fogParams = fog;
        const tf = this.terrainFog;
        if (view === null) {
            tf.near = 1e5;
            tf.far = 2e5;
            tf.density = 0;
        }
        else {
            tf.near = view * TERRAIN_FOG_START;
            tf.far = view;
            tf.density = explicit?.density ?? 0;
            tf.color.set(fog?.color ?? s.fogColor);
        }
        if (fog) {
            this.fog.color.set(fog.color);
            this.fog.density = fog.density;
            scene.fog = this.fog;
        }
        else {
            scene.fog = null;
        }
        // Only a visible horizon (ground or terrain worlds) blends into the fog; space keeps its black.
        const horizon = fog && (s.showGround || this.fogDistance !== null) ? fog.color : undefined;
        this.sky.apply(s, horizon);
        this.updateEnvironmentMap(scene, horizon ?? s.horizon);
    }
    /**
     * Upload the sky reflection image. One texture lives for the rig's
     * lifetime and is updated in place (`needsPMREMUpdate`), so materials keep
     * their compiled programs and only the small PMREM is regenerated.
     */
    updateEnvironmentMap(scene, horizon) {
        // A loaded HDRI owns lighting (and, by default, the background); the analytic sky hides behind it.
        if (this.hdri.bind(scene, this.state.envIntensity * HDRI_ENV_SCALE)) {
            this.alignHdriSun(scene);
            this.envBase = scene.environmentIntensity;
            scene.environmentIntensity = this.envBase * this.envScale;
            this.sky.group.visible = !this.hdri.showsBackground;
            // The photographed sky already lights every surface: the analytic ambient would double it (and tint it blue).
            this.hemi.intensity = this.state.hemiIntensity * HEMI_SHARE_WITH_IBL * HDRI_HEMI_SCALE;
            return;
        }
        scene.environmentRotation.set(0, 0, 0);
        scene.backgroundRotation.set(0, 0, 0);
        this.sky.group.visible = true;
        this.hemi.intensity = this.state.hemiIntensity * HEMI_SHARE_WITH_IBL;
        const groundSpec = this.state.showGround ? this.env?.ground : null;
        const groundColor = groundSpec ? resolveMaterial(groundSpec.material).color : null;
        const pixels = skyEnvironmentPixels(this.state, groundColor, horizon);
        let tex = this.envMap;
        if (!tex) {
            tex = new DataTexture(pixels, ENV_MAP_WIDTH, ENV_MAP_HEIGHT, RGBAFormat);
            tex.colorSpace = SRGBColorSpace;
            tex.mapping = EquirectangularReflectionMapping;
            tex.magFilter = LinearFilter;
            tex.minFilter = LinearFilter;
            tex.generateMipmaps = false;
            this.envMap = tex;
        }
        else {
            tex.image.data.set(pixels);
        }
        tex.needsUpdate = true;
        tex.needsPMREMUpdate = true;
        scene.environment = tex;
        this.envBase = this.state.envIntensity;
        scene.environmentIntensity = this.envBase * this.envScale;
    }
    /** Turn the HDRI around the vertical axis so its sun sits where the sun light is (reflections agree with the shadows). */
    alignHdriSun(scene) {
        const sun = this.hdri.sun;
        const l = this.state.lightDirection;
        const turn = sun ? hdriRotationFor(sun.azimuth, l[0], l[2]) : 0;
        scene.environmentRotation.set(0, turn, 0);
        scene.backgroundRotation.set(0, turn, 0);
    }
    syncGround(spec) {
        const key = spec ? stableStringify(spec) : '';
        if (key === this.groundKey)
            return;
        this.groundKey = key;
        if (this.ground) {
            this.ground.removeFromParent();
            this.ground.geometry.dispose();
            this.ground = null;
        }
        if (this.skirt) {
            this.skirt.removeFromParent();
            this.skirt.geometry.dispose();
            this.skirt = null;
        }
        if (this.groundMaterialKey) {
            this.materials.release(this.groundMaterialKey);
            this.groundMaterialKey = '';
        }
        if (!spec)
            return;
        const size = Math.max(1, Math.min(20_000, Number.isFinite(spec.size) ? spec.size : 400));
        const handle = this.materials.acquire(spec.material, { hasVertexColors: true, surface: 'ground' });
        this.groundMaterialKey = handle.key;
        const ground = new Mesh(createGroundGeometry(size), handle.material);
        ground.name = 'aether:ground';
        ground.receiveShadow = true;
        ground.castShadow = false;
        ground.matrixAutoUpdate = false;
        this.ground = ground;
        this.group.add(ground);
        if (size / 2 < GROUND_SKIRT_RADIUS) {
            const skirt = new Mesh(createSkirtGeometry(size), handle.material);
            skirt.name = 'aether:ground-skirt';
            skirt.receiveShadow = false;
            skirt.castShadow = false;
            skirt.matrixAutoUpdate = false;
            this.skirt = skirt;
            this.group.add(skirt);
        }
    }
    /** Fit the sun's shadow frustum to world-space content bounds (call when the world changes). */
    fitShadows(bounds) {
        const empty = bounds.isEmpty();
        const fit = fitShadowCamera(empty ? null : { min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] }, this.state.lightDirection);
        this.sun.target.position.set(fit.center[0], fit.center[1], fit.center[2]);
        this.sun.target.updateMatrixWorld();
        this.sun.position.set(fit.position[0], fit.position[1], fit.position[2]);
        const cam = this.sun.shadow.camera;
        cam.left = -fit.halfSize;
        cam.right = fit.halfSize;
        cam.top = fit.halfSize;
        cam.bottom = -fit.halfSize;
        cam.near = fit.near;
        cam.far = fit.far;
        cam.updateProjectionMatrix();
        const mapSize = Math.min(fit.mapSize, this.mapCap);
        if (this.sun.shadow.mapSize.x !== mapSize)
            this.setShadowMapSize(mapSize);
    }
    /** Per-frame update (sky follows the camera, weather animates). Zero allocations. */
    underFog = new FogExp2('#1f5a66', 0.1);
    under = false;
    underBackground = new Color('#1f5a66');
    /**
     * The eye below a water surface: everything fades into the water's colour with the water's clarity and the sky
     * disappears. `null` restores the world's own fog and sky. Cheap (a fog swap), reversible.
     */
    setUnderwater(look) {
        const scene = this.scene;
        if (!scene)
            return;
        if (!look) {
            if (!this.under)
                return;
            this.under = false;
            scene.background = null;
            this.applyFog();
            return;
        }
        this.underFog.color.set(look.color);
        this.underFog.density = Math.max(0.01, Math.min(1, look.density));
        this.underBackground.set(look.color);
        if (!this.under) {
            this.under = true;
            scene.background = this.underBackground;
        }
        scene.fog = this.underFog;
        this.sky.group.visible = false;
    }
    /** True while the eye is under water. */
    get isUnderwater() {
        return this.under;
    }
    update(dt, camera) {
        this.sky.update(camera);
        this.weather.update(dt, camera);
    }
    /** True when the environment animates by itself (weather particles) and needs continuous frames. */
    get animating() {
        return this.weather.animating;
    }
    /** Bloom strength requested by the environment. */
    get bloom() {
        return this.env?.bloom ?? 0.4;
    }
    /** Tone-mapping exposure: `environment.exposure` × the sky preset's exposure. */
    get exposure() {
        return (this.env?.exposure ?? 1) * this.state.exposure;
    }
    /** Release everything. */
    dispose() {
        this.syncGround(null);
        if (this.scene && this.scene.environment === this.envMap)
            this.scene.environment = null;
        this.hdri.dispose();
        this.envMap?.dispose();
        this.envMap = null;
        this.sky.dispose();
        this.weather.dispose();
        this.sun.shadow.map?.dispose();
        this.sun.dispose();
        this.hemi.dispose();
        this.bounce.dispose();
        this.fill.dispose();
        this.group.removeFromParent();
    }
}
