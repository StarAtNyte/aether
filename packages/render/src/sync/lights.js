/**
 * Entity lights (`entity.light`). Spot and directional lights shine along the
 * entity's local −Y axis (a lamp points down until the entity is rotated).
 */
import { AmbientLight, Color, DataTexture, DirectionalLight, HemisphereLight, LinearFilter, NoColorSpace, Object3D, PointLight, RectAreaLight, RedFormat, SpotLight, UnsignedByteType, } from 'three';
/**
 * three.js uses physical units (candela) for point/spot lights; World IR
 * intensities are "artist" units where 1 is a pleasant lamp. This factor maps
 * one to the other.
 */
export const LOCAL_LIGHT_SCALE = 20;
/**
 * Area lights use luminance-style units: a 1 × 1 m panel at intensity 1 lights a surface a few metres
 * away about as much as a point light of intensity 1 does.
 */
export const LOCAL_AREA_SCALE = 14;
const support = { ies: null, loadArea: null, areaReady: false, areaLoading: null };
/**
 * Register what only the GPU renderer can provide: the IES spot light class and the loader of the
 * rectangular-light lookup tables (a lazily imported ~100 KB addon). Without them (Node tests) spot
 * profiles fall back to the plain cone and area lights wait forever.
 */
export function registerLightSupport(s) {
    if (s.ies)
        support.ies = s.ies;
    if (s.loadArea) {
        support.loadArea = s.loadArea;
        support.areaReady = false;
        support.areaLoading = null;
    }
}
/** True once rectangular lights can be built (the lookup tables are loaded). */
export function areaLightsReady() {
    return support.areaReady;
}
/** Load the rectangular-light tables (once); resolves when {@link areaLightsReady}. Rejects when unsupported. */
export function loadAreaLights() {
    if (support.areaReady)
        return Promise.resolve();
    if (!support.loadArea)
        return Promise.reject(new Error('area lights are not supported by this renderer'));
    support.areaLoading ??= support.loadArea().then(() => {
        support.areaReady = true;
    });
    return support.areaLoading;
}
/**
 * Falloff of a photometric profile at `theta` radians off the axis, for a cone of half-angle `alpha`
 * (radians): 1 on the brightest ring, 0 at and beyond the cone edge. Pure.
 */
export function profileIntensity(profile, theta, alpha) {
    if (!(alpha > 0) || theta >= alpha)
        return 0;
    const t = Math.max(0, theta) / alpha;
    const smooth = (e0, e1, x) => {
        const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
        return k * k * (3 - 2 * k);
    };
    switch (profile) {
        case 'soft':
            return Math.cos((Math.PI / 2) * t);
        case 'narrow':
            return Math.cos((Math.PI / 2) * t) ** 4;
        case 'downlight':
            return smooth(1, 0.55, t);
        case 'wash':
            return 0.35 + 0.65 * smooth(1, 0.45, t);
        case 'batwing':
            return smooth(1, 0.8, t) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    }
}
/** Texels of the 1-D profile texture (angle 0…π). */
export const PROFILE_TEXELS = 180;
/** The profile as 8-bit texels over 0…π off the axis (what the IES spot light samples). */
export function profilePixels(profile, angleDeg) {
    const alpha = (Math.max(1, Math.min(89, angleDeg)) * Math.PI) / 180;
    const out = new Uint8Array(PROFILE_TEXELS);
    for (let i = 0; i < PROFILE_TEXELS; i++)
        out[i] = Math.round(255 * profileIntensity(profile, ((i + 0.5) / PROFILE_TEXELS) * Math.PI, alpha));
    return out;
}
const profileTextures = new Map();
function profileTexture(profile, angleDeg) {
    const deg = Math.round(Math.max(1, Math.min(89, angleDeg)));
    const key = `${profile}|${deg}`;
    let tex = profileTextures.get(key);
    if (!tex) {
        tex = new DataTexture(profilePixels(profile, deg), PROFILE_TEXELS, 1, RedFormat, UnsignedByteType);
        tex.colorSpace = NoColorSpace;
        tex.magFilter = LinearFilter;
        tex.minFilter = LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        profileTextures.set(key, tex);
    }
    return tex;
}
/** Release the shared profile textures (renderer disposal). */
export function disposeProfileTextures() {
    for (const t of profileTextures.values())
        t.dispose();
    profileTextures.clear();
}
/** Max shadow-casting entity lights (shadows are expensive, especially point lights). */
export const MAX_SHADOW_LIGHTS = 2;
const _ground = new Color();
/** Factor of architectural lights in full daylight (lamps read dim next to the sun, as to the eye). */
export const DAYLIGHT_LAMP_FACTOR = 0.14;
/** Below this daylight factor architectural lamps are switched off entirely (no per-pixel cost). */
export const LAMP_CUTOFF = 0.2;
/** Sun elevations (degrees) between which lamps fade from full (night) to the daylight factor. */
export const DAYLIGHT_FADE = Object.freeze([-3, 22]);
/**
 * Intensity factor of architectural lamps (`arch.role` "light") for a sun
 * elevation in degrees: 1 at night, {@link DAYLIGHT_LAMP_FACTOR} in full
 * daylight, smooth in between. Interior lamps tuned for the evening would
 * otherwise blow out white walls next to a sunlit room (the renderer has
 * no eye adaptation). Non-finite input counts as night.
 */
export function daylightLampFactor(sunElevationDeg) {
    if (!Number.isFinite(sunElevationDeg))
        return 1;
    const [lo, hi] = DAYLIGHT_FADE;
    const t = Math.max(0, Math.min(1, (sunElevationDeg - lo) / (hi - lo)));
    const s = t * t * (3 - 2 * t);
    return 1 + (DAYLIGHT_LAMP_FACTOR - 1) * s;
}
/** Create a three.js light for a spec. Shadows start disabled (see {@link enforceShadowCap}). `scale` multiplies the intensity. */
export function createEntityLight(spec, scale = 1) {
    const color = spec.color;
    let light;
    let target = null;
    switch (spec.type) {
        case 'point': {
            const l = new PointLight(color, spec.intensity * LOCAL_LIGHT_SCALE * scale, spec.range, 2);
            l.shadow.mapSize.set(512, 512);
            l.shadow.bias = -0.002;
            light = l;
            break;
        }
        case 'spot': {
            const args = [color, spec.intensity * LOCAL_LIGHT_SCALE * scale, spec.range, (spec.angle * Math.PI) / 180, 0.35, 2];
            let l;
            if (spec.profile && support.ies) {
                const ies = new support.ies(...args);
                ies.iesMap = profileTexture(spec.profile, spec.angle);
                l = ies;
            }
            else
                l = new SpotLight(...args);
            l.shadow.mapSize.set(1024, 1024);
            l.shadow.bias = -0.0008;
            target = new Object3D();
            target.position.set(0, -1, 0);
            l.target = target;
            light = l;
            break;
        }
        case 'directional': {
            const l = new DirectionalLight(color, spec.intensity);
            l.shadow.mapSize.set(1024, 1024);
            const cam = l.shadow.camera;
            cam.left = -20;
            cam.right = 20;
            cam.top = 20;
            cam.bottom = -20;
            cam.near = 0.5;
            cam.far = 120;
            target = new Object3D();
            target.position.set(0, -1, 0);
            l.target = target;
            light = l;
            break;
        }
        case 'area': {
            const [w, h] = spec.size ?? [1, 1];
            const l = new RectAreaLight(color, spec.intensity * LOCAL_AREA_SCALE * scale, w, h);
            // The panel shines along the entity's local −Y axis like a spot light does.
            l.rotation.x = -Math.PI / 2;
            light = l;
            break;
        }
        case 'hemisphere': {
            _ground.set(color).multiplyScalar(0.35);
            light = new HemisphereLight(color, _ground.getHex(), spec.intensity);
            break;
        }
        default:
            light = new AmbientLight(color, spec.intensity);
    }
    light.castShadow = false;
    light.name = `light:${spec.type}`;
    return { light, target };
}
/** Update intensity and color in place (cheap path for pulsing/animated lights). */
export function updateLightParams(light, spec, scale = 1) {
    const local = spec.type === 'point' || spec.type === 'spot';
    light.intensity = Math.max(0, spec.intensity) * (local ? LOCAL_LIGHT_SCALE * scale : spec.type === 'area' ? LOCAL_AREA_SCALE * scale : 1);
    light.color.set(spec.color);
    if (light instanceof HemisphereLight)
        light.groundColor.set(spec.color).multiplyScalar(0.35);
}
/** True when the light type supports shadows. */
export function canCastShadow(light) {
    return light instanceof PointLight || light instanceof SpotLight || light instanceof DirectionalLight;
}
/** Release a light's shadow map. */
export function disposeEntityLight(l) {
    l.light.dispose();
    l.light.removeFromParent();
    l.target?.removeFromParent();
}
/**
 * Enable shadows on at most {@link MAX_SHADOW_LIGHTS} lights that request
 * them, chosen deterministically by id order. Returns the ids that got shadows.
 */
export function enforceShadowCap(candidates, cap = MAX_SHADOW_LIGHTS) {
    const wanting = candidates.filter((c) => c.wants && canCastShadow(c.light)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const enabled = new Set(wanting.slice(0, Math.max(0, cap)).map((c) => c.id));
    for (const c of candidates)
        c.light.castShadow = enabled.has(c.id);
    return [...enabled];
}
