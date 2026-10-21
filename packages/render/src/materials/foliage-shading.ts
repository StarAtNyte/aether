/**
 * Shading of leaf, needle, grass and fern cards beyond what a standard material gives them:
 *
 * - *Translucency.* A leaf between the eye and the sun glows: some of the sunlight passes through it,
 *   tinted by the leaf. The term is added as emission (it is light, but not reflected light), grows as
 *   the view lines up with the sun and is scaled by the card's own colour, so the shaded inside of a
 *   crown (darker vertex colours) glows far less than its sunlit rim.
 * - *Colour variation.* Two octaves of world-space noise shift the hue between warmer and cooler
 *   greens and the value by a few percent, from plant to plant (metres) and from cluster to cluster
 *   (decimetres), so a hedge, a lawn or a forest is not one tint repeated.
 *
 * The sun the translucency reads is a pair of shared uniforms the environment updates when the sky
 * changes ({@link setFoliageSun}); nothing runs per frame on the CPU. The same nodes serve WebGPU and
 * WebGL2.
 */
import { Color, Vector3, type MeshStandardMaterial } from 'three';
import { T, type Nd } from './tsl-lite';

/** Direction toward the sun (unit). */
const sunDirection = new Vector3(0.35, 0.8, 0.3).normalize();
/** Sun irradiance (linear colour × intensity); black at night. */
const sunIrradiance = new Color(2.5, 2.4, 2.2);
const uSunDirection = T.uniform(sunDirection);
const uSunIrradiance = T.uniform(sunIrradiance);

/** Share of the sunlight a leaf passes on, seen straight against the sun. */
export const FOLIAGE_TRANSMISSION = 0.32;
/** Sharpness of the forward-scattering lobe (higher: only near the sun). */
export const FOLIAGE_LOBE = 3;
/** Hue swing of the plant-scale colour variation (warm/cool, linear multipliers at full noise). */
export const FOLIAGE_HUE: readonly [number, number, number] = [0.17, 0.06, -0.16];
/** Value swing of the cluster-scale variation. */
export const FOLIAGE_VALUE = 0.16;

/** Point the translucency at the current sun (`direction` toward it). Non-finite input is ignored. */
export function setFoliageSun(direction: readonly [number, number, number], color: Color, intensity: number, up = true): void {
  const [x, y, z] = direction;
  const l = Math.hypot(x, y, z);
  if (!(l > 1e-6) || !Number.isFinite(l) || !Number.isFinite(intensity)) return;
  sunDirection.set(x / l, y / l, z / l);
  const k = up ? Math.max(0, intensity) : 0;
  sunIrradiance.setRGB(color.r * k, color.g * k, color.b * k);
}

/** The current translucency sun (tests and diagnostics). */
export function foliageSun(): { direction: [number, number, number]; irradiance: [number, number, number] } {
  return { direction: [sunDirection.x, sunDirection.y, sunDirection.z], irradiance: [sunIrradiance.r, sunIrradiance.g, sunIrradiance.b] };
}

let colorNode: Nd | null = null;
let emissiveNode: Nd | null = null;

function nodes(): { color: Nd; emissive: Nd } {
  if (colorNode && emissiveNode) return { color: colorNode, emissive: emissiveNode };
  const p = T.positionWorld;
  const plant = T.mx_noise_float(p.mul(0.23));
  const cluster = T.mx_noise_float(p.mul(1.9).add(T.vec3(13.1, 7.7, 3.3)));
  const tint = T.vec3(T.float(1).add(plant.mul(FOLIAGE_HUE[0])), T.float(1).add(plant.mul(FOLIAGE_HUE[1])), T.float(1).add(plant.mul(FOLIAGE_HUE[2]))).mul(T.float(1).add(cluster.mul(FOLIAGE_VALUE)));
  const base = T.materialColor;
  colorNode = T.vec4(base.rgb.mul(tint), base.w);
  const view = T.normalize(p.sub(T.cameraPosition));
  const forward = T.pow(T.clamp(T.dot(view, uSunDirection), 0, 1), FOLIAGE_LOBE);
  emissiveNode = T.diffuseColor.rgb.mul(uSunIrradiance).mul(forward.mul(FOLIAGE_TRANSMISSION / Math.PI));
  return { color: colorNode, emissive: emissiveNode };
}

/** Give a foliage card material translucency and colour variation (see the module comment). */
export function applyFoliageShading(m: MeshStandardMaterial): void {
  const n = nodes();
  const nm = m as unknown as { colorNode: unknown; emissiveNode: unknown };
  nm.colorNode = n.color;
  nm.emissiveNode = n.emissive;
}
