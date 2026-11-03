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
import { staticShadowAlpha } from '../gpu/shadow-alpha';
import { abs, attribute, Fn, If, cameraPosition, float, int, materialColor, max, mix, modelWorldMatrix, mx_noise_float, normalLocal, normalMap, positionWorld, pow, smoothstep, texture, transformDirection, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Material } from 'three';
import type { MaterialFinish } from '@aether/core';
import type { FinishMaps } from './finish-textures';
import type { SplatArrays } from './splat-arrays';
import { DETAIL_MICRO_SCALE, DETAIL_NEAR, FINISH_MAPS_KEY, leanShading } from './anti-tile';

/** The four layers, in the order of the `splat` weights, and the finish whose photograph each one uses. */
export const SPLAT_LAYERS: readonly MaterialFinish[] = Object.freeze(['grass', 'rock', 'soil', 'snow']) as readonly MaterialFinish[];

/** Normal-map strength of each layer. */
const NORMAL_STRENGTH: readonly number[] = Object.freeze([0.55, 1, 0.7, 0.35]);
/** Scale of the second, larger lookup and the world-space size (1/m) of the noise that blends the two. */
const MACRO_SCALE = 1 / 4.3;
const BLEND_NOISE = 0.045;
/** How much a layer's brightness shifts its weight at the seams (0 = plain linear fade). */
const HEIGHT_BIAS = 0.22;
type Vec4N = ReturnType<typeof vec4>;
/** Assign inside a branch (the node typings do not describe `toVar` results). */
const set = (variable: unknown, value: unknown): void => (variable as { assign(v: unknown): void }).assign(value);
/** A layer with at most this weight is not sampled. */
const ACTIVE_WEIGHT = 0.001;
/** Beyond this distance (m) only the large-scale lookup is taken. */
export const FAR_METRES = 90;
/** Weights below this vanish, so a layer never leaves a faint haze where it is not. */
const SHARPEN = 2.4;

/**
 * Macro colour variation (world-space, so it is seamless across tiles and independent of the photographs'
 * repeat): broad sun-dried and lush patches (about 90 m across) with a finer mottling (about 11 m), and a
 * warm-cool hue drift. Strengths are the multiplier's deviation from 1.
 */
export const MACRO_VARIATION = Object.freeze({ patchScale: 1 / 90, mottleScale: 1 / 11, patch: 0.2, mottle: 0.1, hue: 0.12 });
/** Grass gives way to bare earth between these slopes (1 − normal.y), up to this share of its weight. */
export const SLOPE_DIRT = Object.freeze({ from: 0.05, to: 0.22, amount: 0.6 });

/** `userData` key marking a layered terrain material. */
export const SPLAT_KEY = 'aetherSplat';

/**
 * Attach the layered-terrain nodes to `material` (a classic material the node renderer converts). The
 * geometry must have a `splat` attribute (4 floats) and metre UVs. `maps` returns the textures of a
 * layer's finish.
 */
export function applySplat(material: Material, maps: (id: MaterialFinish) => FinishMaps, stack: SplatArrays, detail = false): void {
  const w4 = attribute('splat', 'vec4');
  // Grass thins to bare earth where the ground tilts (worn banks, the shoulders of a hill), before the generator's rock takes
  // over on the steep parts: part of the grass weight moves to the dry-ground layer by the slope of the surface.
  const dirt = () => {
    const n = transformDirection(normalLocal, modelWorldMatrix);
    return smoothstep(float(SLOPE_DIRT.from), float(SLOPE_DIRT.to), float(1).sub(n.y)).mul(SLOPE_DIRT.amount);
  };
  const weight = (i: number) => (i === 0 ? w4.x.mul(float(1).sub(dirt())) : i === 2 ? w4.z.add(w4.x.mul(dirt())) : i === 1 ? w4.y : w4.w);
  const weights = [weight(0), weight(1), weight(2), weight(3)];
  const layerMaps = SPLAT_LAYERS.map((id) => maps(id));
  // A node used twice becomes a variable declared where it is first built; inside a branch that would leave it unset
  // outside it. Everything a branch needs is therefore built fresh at each use, from varyings and uniforms only.
  const dist = () => positionWorld.sub(cameraPosition).length();

  // The per-pixel lookups of a layer are skipped where the layer has no weight (the usual case for three of the four)
  // and, beyond FAR_METRES, taken at the large scale only: the fine scale is below a pixel there, so the second lookup,
  // the blend noise and the rock's side planes would only be averaged away. Each lookup builds its own small nodes (the
  // blend noise, the rotated coordinates) inside its branch: a node first built inside one branch cannot be shared with
  // another. The results are variables the blend below reads; a skipped layer reads as a neutral photograph.
  const active = (i: number) => weight(i).greaterThan(ACTIVE_WEIGHT);
  // A moving view (lean shading) takes the large-scale lookup everywhere: at the scale it moves at, the fine one is below a pixel.
  const far = () => dist().greaterThan(FAR_METRES).or(leanShading.greaterThan(0.5));
  const sampleAt = (kind: 'map' | 'orm' | 'normal', i: number, macro: boolean) => {
    const base = uv();
    const rot = vec2(base.x.mul(0.8).sub(base.y.mul(0.6)), base.x.mul(0.6).add(base.y.mul(0.8)));
    const repeat = uniform((layerMaps[i] as FinishMaps)[kind].repeat);
    return texture(stack.of(kind), macro ? rot.mul(repeat).mul(MACRO_SCALE) : base.mul(repeat)).depth(int(i));
  };
  const blendWeight = () => smoothstep(float(0.35), float(0.65), mx_noise_float(positionWorld.mul(BLEND_NOISE)).mul(0.5).add(0.5));
  // Rock leans over cliffs: its colour and roughness are sampled from three planes (top-down, along x, along z)
  // weighted by the world normal, so a vertical face shows rock grain instead of a smeared top-down stretch.
  const triplanar = (kind: 'map' | 'orm', i: number) => {
    const n = transformDirection(normalLocal, modelWorldMatrix);
    const ny4 = pow(abs(n.y), 4);
    const nx4 = pow(abs(n.x), 4);
    const nz4 = pow(abs(n.z), 4);
    const triSum = ny4.add(nx4).add(nz4).add(1e-4);
    const r = uniform((layerMaps[i] as FinishMaps)[kind].repeat);
    const arr = stack.of(kind);
    const top = mix(sampleAt(kind, i, false), sampleAt(kind, i, true), blendWeight());
    const sx = texture(arr, vec2(positionWorld.z, positionWorld.y).mul(r)).depth(int(i));
    const sz = texture(arr, vec2(positionWorld.x, positionWorld.y).mul(r)).depth(int(i));
    return top.mul(ny4.div(triSum)).add(sx.mul(nx4.div(triSum))).add(sz.mul(nz4.div(triSum)));
  };
  const near = (kind: 'map' | 'orm' | 'normal', i: number) => (i === 1 && kind !== 'normal' ? triplanar(kind, i) : mix(sampleAt(kind, i, false), sampleAt(kind, i, true), blendWeight()));
  // Fresh nodes on every call: a variable is named after the node it starts from, so a shared start node would be one variable.
  const neutral = (kind: 'map' | 'orm' | 'normal') => (kind === 'map' ? vec4(1, 1, 1, 1) : kind === 'orm' ? vec4(1, 0.9, 0, 1) : vec4(0.5, 0.5, 1, 1));
  const lookup = (kind: 'map' | 'orm' | 'normal', i: number) =>
    Fn(() => {
      const r = neutral(kind).toVar();
      If(active(i), () => {
        If(far(), () => {
          set(r, sampleAt(kind, i, true));
        }).Else(() => {
          set(r, near(kind, i));
        });
      });
      return r;
    })() as unknown as Vec4N;
  const layer = (kind: 'map' | 'orm' | 'normal') => [lookup(kind, 0), lookup(kind, 1), lookup(kind, 2), lookup(kind, 3)];

  const albedo = layer('map');
  const orm = layer('orm');
  const lum = (c: Vec4N) => c.r.add(c.g).add(c.b).mul(1 / 3);

  // Height blend: weight + brightness bias, then everything more than a hair below the best layer drops out.
  const heights = weights.map((w, i) => w.mul(float(SHARPEN)).add(lum(albedo[i] as Vec4N).sub(1).mul(HEIGHT_BIAS)).mul(w.greaterThan(ACTIVE_WEIGHT).select(float(1), float(0))));
  const top = max(max(heights[0] as typeof w4.x, heights[1] as typeof w4.x), max(heights[2] as typeof w4.x, heights[3] as typeof w4.x));
  const blended = heights.map((h) => max(h.sub(top).add(0.45), float(0)));
  const sum = (blended[0] as typeof w4.x).add(blended[1] as typeof w4.x).add(blended[2] as typeof w4.x).add(blended[3] as typeof w4.x).add(1e-4);
  const wn = blended.map((b) => b.div(sum));

  const mixLayers = (values: readonly Vec4N[]): Vec4N => {
    let acc = values[0]!.mul(wn[0] as typeof w4.x) as unknown as Vec4N;
    for (let i = 1; i < values.length; i++) acc = acc.add((values[i] as Vec4N).mul(wn[i] as typeof w4.x)) as unknown as Vec4N;
    return acc;
  };

  const rgbLayers = mixLayers(albedo);
  const ormMix = mixLayers(orm);
  const nrmLayers = mixLayers(layer('normal'));
  // Close-up detail: a lawn underfoot would otherwise show the magnified 1.6 m photograph (blurry). Past a few metres
  // a finer lookup of the grass photograph (and its normals) adds blades and grain, weighted by how grassy the pixel is.
  const nearFade = float(1).sub(smoothstep(float(DETAIL_NEAR[0]), float(DETAIL_NEAR[1]), dist())).mul(wn[0] as typeof w4.x);
  const grassMaps = layerMaps[0] as FinishMaps;
  const micro = (kind: 'map' | 'normal') =>
    Fn(() => {
      const r = neutral(kind).toVar();
      If(dist().lessThan(DETAIL_NEAR[1]).and(leanShading.lessThan(0.5)), () => {
        set(r, texture(stack[kind], uv().mul(uniform(grassMaps.map.repeat)).mul(DETAIL_MICRO_SCALE)).depth(int(0)));
      });
      return r;
    })() as unknown as Vec4N;
  const rgb = detail ? mix(rgbLayers, rgbLayers.mul(micro('map')), nearFade.mul(0.6)) : rgbLayers;
  const nrm = detail ? nrmLayers.add(micro('normal').sub(vec4(0.5, 0.5, 0, 0)).mul(nearFade.mul(0.9))) : nrmLayers;
  const strength = (wn[0] as typeof w4.x).mul(NORMAL_STRENGTH[0] as number).add((wn[1] as typeof w4.x).mul(NORMAL_STRENGTH[1] as number)).add((wn[2] as typeof w4.x).mul(NORMAL_STRENGTH[2] as number)).add((wn[3] as typeof w4.x).mul(NORMAL_STRENGTH[3] as number));

  material.userData[SPLAT_KEY] = true;
  // The photographs' own maps stay reachable for exporters that read classic maps.
  material.userData[FINISH_MAPS_KEY] = layerMaps[0];
  const m = material as Material & { colorNode?: unknown; roughnessNode?: unknown; aoNode?: unknown; normalNode?: unknown };
  const patch = mx_noise_float(positionWorld.mul(MACRO_VARIATION.patchScale).add(vec3(7.3, 0, 2.1)));
  // The finer mottling and the hue drift (two more 3D noises) are left out of a moving view; the broad patches stay.
  const finer = Fn(() => {
    const out = vec4(1, 1, 1, 1).toVar();
    If(leanShading.lessThan(0.5), () => {
      const mottle = mx_noise_float(positionWorld.mul(MACRO_VARIATION.mottleScale));
      const hue = mx_noise_float(positionWorld.mul(MACRO_VARIATION.patchScale * 1.7).add(vec3(31.7, 0, 11.9)));
      out.assign(vec4(float(1).add(hue.mul(MACRO_VARIATION.hue)), float(1).add(hue.mul(MACRO_VARIATION.hue * 0.25)), float(1).sub(hue.mul(MACRO_VARIATION.hue)), float(1).add(mottle.mul(MACRO_VARIATION.mottle))));
    });
    return out;
  })();
  const vary = float(1).add(patch.mul(MACRO_VARIATION.patch)).add(finer.w.sub(1));
  const tint = vec3(finer.x, finer.y, finer.z);
  m.colorNode = staticShadowAlpha(vec4(materialColor.rgb.mul(vec3(rgb.r, rgb.g, rgb.b)).mul(tint).mul(vary), 1));
  m.roughnessNode = ormMix.g;
  m.aoNode = ormMix.r;
  m.normalNode = normalMap(nrm, vec2(strength, strength));
}
