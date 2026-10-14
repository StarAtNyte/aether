/**
 * Entity lights (`entity.light`). Spot and directional lights shine along the
 * entity's local −Y axis (a lamp points down until the entity is rotated).
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PointLight,
  SpotLight,
  type Light,
} from 'three';
import type { LightSpec } from '@aether/core';

/**
 * three.js uses physical units (candela) for point/spot lights; World IR
 * intensities are "artist" units where 1 is a pleasant lamp. This factor maps
 * one to the other.
 */
export const LOCAL_LIGHT_SCALE = 20;
/** Max shadow-casting entity lights (shadows are expensive, especially point lights). */
export const MAX_SHADOW_LIGHTS = 2;

const _ground = new Color();

/** Light object plus the target it aims at (spot/directional only). */
export interface EntityLight {
  light: Light;
  target: Object3D | null;
}

/** Factor of architectural lights in full daylight (lamps read dim next to the sun, as to the eye). */
export const DAYLIGHT_LAMP_FACTOR = 0.14;
/** Sun elevations (degrees) between which lamps fade from full (night) to the daylight factor. */
export const DAYLIGHT_FADE: readonly [number, number] = Object.freeze([-3, 22]) as readonly [number, number];

/**
 * Intensity factor of architectural lamps (`arch.role` "light") for a sun
 * elevation in degrees: 1 at night, {@link DAYLIGHT_LAMP_FACTOR} in full
 * daylight, smooth in between. Interior lamps tuned for the evening would
 * otherwise blow out white walls next to a sunlit room (the renderer has
 * no eye adaptation). Non-finite input counts as night.
 */
export function daylightLampFactor(sunElevationDeg: number): number {
  if (!Number.isFinite(sunElevationDeg)) return 1;
  const [lo, hi] = DAYLIGHT_FADE;
  const t = Math.max(0, Math.min(1, (sunElevationDeg - lo) / (hi - lo)));
  const s = t * t * (3 - 2 * t);
  return 1 + (DAYLIGHT_LAMP_FACTOR - 1) * s;
}

/** Create a three.js light for a spec. Shadows start disabled (see {@link enforceShadowCap}). `scale` multiplies the intensity. */
export function createEntityLight(spec: LightSpec, scale = 1): EntityLight {
  const color = spec.color;
  let light: Light;
  let target: Object3D | null = null;
  switch (spec.type) {
    case 'point': {
      const l = new PointLight(color, spec.intensity * LOCAL_LIGHT_SCALE * scale, spec.range, 2);
      l.shadow.mapSize.set(512, 512);
      l.shadow.bias = -0.002;
      light = l;
      break;
    }
    case 'spot': {
      const l = new SpotLight(color, spec.intensity * LOCAL_LIGHT_SCALE * scale, spec.range, (spec.angle * Math.PI) / 180, 0.35, 2);
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
export function updateLightParams(light: Light, spec: Pick<LightSpec, 'type' | 'intensity' | 'color'>, scale = 1): void {
  const local = spec.type === 'point' || spec.type === 'spot';
  light.intensity = Math.max(0, spec.intensity) * (local ? LOCAL_LIGHT_SCALE * scale : 1);
  light.color.set(spec.color);
  if (light instanceof HemisphereLight) light.groundColor.set(spec.color).multiplyScalar(0.35);
}

/** True when the light type supports shadows. */
export function canCastShadow(light: Light): boolean {
  return light instanceof PointLight || light instanceof SpotLight || light instanceof DirectionalLight;
}

/** Release a light's shadow map. */
export function disposeEntityLight(l: EntityLight): void {
  l.light.dispose();
  l.light.removeFromParent();
  l.target?.removeFromParent();
}

/**
 * Enable shadows on at most {@link MAX_SHADOW_LIGHTS} lights that request
 * them, chosen deterministically by id order. Returns the ids that got shadows.
 */
export function enforceShadowCap(candidates: ReadonlyArray<{ id: string; light: Light; wants: boolean }>, cap = MAX_SHADOW_LIGHTS): string[] {
  const wanting = candidates.filter((c) => c.wants && canCastShadow(c.light)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const enabled = new Set(wanting.slice(0, Math.max(0, cap)).map((c) => c.id));
  for (const c of candidates) c.light.castShadow = enabled.has(c.id);
  return [...enabled];
}
