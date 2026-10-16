/**
 * Layered terrain: a generator part with `material.splat` carries four per-vertex weights (grass,
 * rock, dry ground, snow) and this material blends the photographed surfaces of those four layers
 * by them, per pixel. The vertex colours stay the base tint (the generator's palette), so the
 * photographs only contribute structure: albedo variation, micro normals, ambient occlusion and a
 * roughness pattern.
 *
 * - Every lookup is taken twice, at the texture's own scale and at a rotated, 4.3x larger one, and
 *   blended by world-space noise, so a 200 m lawn shows no repeat.
 * - Layers meet through a height blend: a layer's own brightness (its stand-in for relief) shifts its
 *   weight, so rock pokes through grass and pebbles through sand instead of fading in as a mush.
 * - Pure node (TSL) code: identical on the WebGPU and WebGL2 backends. Like the anti-tiled finishes,
 *   the nodes are attached to the classic material, which the node renderer converts.
 */
import { abs, attribute, cameraPosition, float, materialColor, max, mix, mx_noise_float, normalMap, normalWorld, positionWorld, pow, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Material, Texture } from 'three';
import type { MaterialFinish } from '@aether/core';
import type { FinishMaps } from './finish-textures';
import { DETAIL_MICRO_SCALE, DETAIL_NEAR, FINISH_MAPS_KEY } from './anti-tile';

/** The four layers, in the order of the `splat` weights, and the finish whose photograph each one uses. */
export const SPLAT_LAYERS: readonly MaterialFinish[] = Object.freeze(['grass', 'rock', 'soil', 'snow']) as readonly MaterialFinish[];

/** Normal-map strength of each layer. */
const NORMAL_STRENGTH: readonly number[] = Object.freeze([0.55, 1, 0.7, 0.35]);
/** Scale of the second, larger lookup and the world-space size (1/m) of the noise that blends the two. */
const MACRO_SCALE = 1 / 4.3;
const BLEND_NOISE = 0.045;
/** How much a layer's brightness shifts its weight at the seams (0 = plain linear fade). */
const HEIGHT_BIAS = 0.22;
/** Weights below this vanish, so a layer never leaves a faint haze where it is not. */
const SHARPEN = 2.4;

/**
 * Macro colour variation (world-space, so it is seamless across tiles and independent of the photographs'
 * repeat): broad sun-dried and lush patches (about 90 m across) with a finer mottling (about 11 m), and a
 * warm-cool hue drift. Strengths are the multiplier's deviation from 1.
 */
export const MACRO_VARIATION = Object.freeze({ patchScale: 1 / 90, mottleScale: 1 / 11, patch: 0.15, mottle: 0.05, hue: 0.05 });

/** `userData` key marking a layered terrain material. */
export const SPLAT_KEY = 'aetherSplat';

/**
 * Attach the layered-terrain nodes to `material` (a classic material the node renderer converts). The
 * geometry must have a `splat` attribute (4 floats) and metre UVs. `maps` returns the textures of a
 * layer's finish.
 */
export function applySplat(material: Material, maps: (id: MaterialFinish) => FinishMaps, detail = false, compact = false): void {
  const w4 = attribute('splat', 'vec4');
  const base = uv();
  const rot = vec2(base.x.mul(0.8).sub(base.y.mul(0.6)), base.x.mul(0.6).add(base.y.mul(0.8)));
  const n = mx_noise_float(positionWorld.mul(BLEND_NOISE)).mul(0.5).add(0.5);
  const wMacro = smoothstep(float(0.35), float(0.65), n);

  const layerMaps = SPLAT_LAYERS.map((id) => maps(id));
  const sample = (tex: Texture, macro: boolean) => {
    const repeat = uniform(tex.repeat);
    return texture(tex, macro ? rot.mul(repeat).mul(MACRO_SCALE) : base.mul(repeat));
  };
  // Rock leans over cliffs: its colour and roughness are sampled from three planes (top-down, along x, along z)
  // weighted by the world normal, so a vertical face shows rock grain instead of a smeared top-down stretch.
  const ny4 = pow(abs(normalWorld.y), 4);
  const nx4 = pow(abs(normalWorld.x), 4);
  const nz4 = pow(abs(normalWorld.z), 4);
  const triSum = ny4.add(nx4).add(nz4).add(1e-4);
  const triplanar = (tex: Texture) => {
    const r = uniform(tex.repeat);
    const top = mix(texture(tex, base.mul(r)), texture(tex, rot.mul(r).mul(MACRO_SCALE)), wMacro);
    const sx = texture(tex, vec2(positionWorld.z, positionWorld.y).mul(r));
    const sz = texture(tex, vec2(positionWorld.x, positionWorld.y).mul(r));
    return top.mul(ny4.div(triSum)).add(sx.mul(nx4.div(triSum))).add(sz.mul(nz4.div(triSum)));
  };
  const albedoOf = (i: number) => {
    const m = layerMaps[i] as FinishMaps;
    return i === 1 ? triplanar(m.map) : mix(sample(m.map, false), sample(m.map, true), wMacro);
  };
  // Compact: WebGPU allows 16 samplers per fragment stage and a lit terrain already spends about five on the sun and
  // point-light shadows and the environment map. The full set is 12 photographs (map, normal, orm per layer); compact
  // drops the roughness/occlusion of the soil and snow layers and the snow's micro normals (both are near-uniform
  // surfaces), keeping 9, so the shader links with room for more lights.
  const FLAT_ORM = vec4(1, 0.85, 0, 1);
  const FLAT_NORMAL = vec4(0.5, 0.5, 1, 1);
  const ormOf = (i: number) => {
    if (compact && i >= 2) return FLAT_ORM;
    const m = layerMaps[i] as FinishMaps;
    return i === 1 ? triplanar(m.orm) : mix(sample(m.orm, false), sample(m.orm, true), wMacro);
  };
  const normalOf = (i: number) => {
    if (compact && i === 3) return FLAT_NORMAL;
    const m = layerMaps[i] as FinishMaps;
    return mix(sample(m.normal, false), sample(m.normal, true), wMacro);
  };

  const albedo = [albedoOf(0), albedoOf(1), albedoOf(2), albedoOf(3)];
  const orm = [ormOf(0), ormOf(1), ormOf(2), ormOf(3)];
  const lum = (c: ReturnType<typeof albedoOf>) => c.r.add(c.g).add(c.b).mul(1 / 3);

  // Height blend: weight + brightness bias, then everything more than a hair below the best layer drops out.
  const weights = [w4.x, w4.y, w4.z, w4.w];
  const heights = weights.map((w, i) => w.mul(float(SHARPEN)).add(lum(albedo[i] as ReturnType<typeof albedoOf>).sub(1).mul(HEIGHT_BIAS)).mul(w.greaterThan(0.001).select(float(1), float(0))));
  const top = max(max(heights[0] as typeof w4.x, heights[1] as typeof w4.x), max(heights[2] as typeof w4.x, heights[3] as typeof w4.x));
  const blended = heights.map((h) => max(h.sub(top).add(0.45), float(0)));
  const sum = (blended[0] as typeof w4.x).add(blended[1] as typeof w4.x).add(blended[2] as typeof w4.x).add(blended[3] as typeof w4.x).add(1e-4);
  const wn = blended.map((b) => b.div(sum));

  const mixLayers = <T extends ReturnType<typeof albedoOf>>(values: readonly T[]) =>
    values.reduce((acc, v, i) => (acc === null ? v.mul(wn[i] as typeof w4.x) : acc.add(v.mul(wn[i] as typeof w4.x))), null as unknown as ReturnType<typeof albedoOf>);

  const rgbLayers = mixLayers(albedo);
  const ormMix = mixLayers(orm);
  const nrmLayers = mixLayers([normalOf(0), normalOf(1), normalOf(2), normalOf(3)]);
  // Close-up detail: a lawn underfoot would otherwise show the magnified 1.6 m photograph (blurry). Past a few metres
  // a finer lookup of the grass photograph (and its normals) adds blades and grain, weighted by how grassy the pixel is.
  const dist = positionWorld.sub(cameraPosition).length();
  const nearFade = float(1).sub(smoothstep(float(DETAIL_NEAR[0]), float(DETAIL_NEAR[1]), dist)).mul(wn[0] as typeof w4.x);
  const grassMaps = layerMaps[0] as FinishMaps;
  const microUv = base.mul(uniform(grassMaps.map.repeat)).mul(DETAIL_MICRO_SCALE);
  const rgb = detail ? mix(rgbLayers, rgbLayers.mul(texture(grassMaps.map, microUv)), nearFade.mul(0.6)) : rgbLayers;
  const nrm = detail ? nrmLayers.add(texture(grassMaps.normal, microUv).sub(vec4(0.5, 0.5, 0, 0)).mul(nearFade.mul(0.9))) : nrmLayers;
  const strength = (wn[0] as typeof w4.x).mul(NORMAL_STRENGTH[0] as number).add((wn[1] as typeof w4.x).mul(NORMAL_STRENGTH[1] as number)).add((wn[2] as typeof w4.x).mul(NORMAL_STRENGTH[2] as number)).add((wn[3] as typeof w4.x).mul(NORMAL_STRENGTH[3] as number));

  material.userData[SPLAT_KEY] = true;
  // The photographs' own maps stay reachable for exporters that read classic maps.
  material.userData[FINISH_MAPS_KEY] = layerMaps[0];
  const m = material as Material & { colorNode?: unknown; roughnessNode?: unknown; aoNode?: unknown; normalNode?: unknown };
  const patch = mx_noise_float(positionWorld.mul(MACRO_VARIATION.patchScale).add(vec3(7.3, 0, 2.1)));
  const mottle = mx_noise_float(positionWorld.mul(MACRO_VARIATION.mottleScale));
  const hue = mx_noise_float(positionWorld.mul(MACRO_VARIATION.patchScale * 1.7).add(vec3(31.7, 0, 11.9)));
  const vary = float(1).add(patch.mul(MACRO_VARIATION.patch)).add(mottle.mul(MACRO_VARIATION.mottle));
  const tint = vec3(float(1).add(hue.mul(MACRO_VARIATION.hue)), float(1).add(hue.mul(MACRO_VARIATION.hue * 0.25)), float(1).sub(hue.mul(MACRO_VARIATION.hue)));
  m.colorNode = vec4(materialColor.rgb.mul(vec3(rgb.r, rgb.g, rgb.b)).mul(tint).mul(vary), 1);
  m.roughnessNode = ormMix.g;
  m.aoNode = ormMix.r;
  m.normalNode = normalMap(nrm, vec2(strength, strength));
}
