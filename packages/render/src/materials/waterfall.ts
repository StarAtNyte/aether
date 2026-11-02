/**
 * The falling-water shader (TSL, WebGPU and WebGL2): a waterfall sheet drawn on a strip whose UVs run u 0..1 across and
 * v in metres down from the lip (`api.ribbon` makes one).
 *
 * What makes falling water read as water and not as a painted sheet:
 *
 *  - **Advected streaks**: every point has the arrival time τ = √(2d/g) of a parcel that left the lip and fell d metres;
 *    streak noise is sampled at (across, t − τ), so features ride down with the flow, speeding up and stretching into
 *    long streaks lower down, as in a real fall. The streaks are sized for the distance a fall is seen from (ropes a
 *    metre or two wide, threads a few tens of centimetres), so they survive at 100 m instead of averaging to grey.
 *  - **Aeration**: a glassy tongue at the very lip turning white within a few metres; on a tall fall the water between
 *    lip and base thins into translucent, blue-green ropes with white streaks, and goes white again where it nears the
 *    pool and breaks up.
 *  - **Ragged translucent edges** and a sheet that **breaks up** into strands on long drops.
 *  - A little self-glow (aerated water scatters the daylight it is lit by), so the sheet never goes grey in shade.
 *
 * Optional per-vertex data (the `color` attribute, as the `waterfall-sheet` generator writes it, linear values):
 *  - r: fraction of the fall (0 at the lip, 1 at the pool): drives the white base;
 *  - g: the layer's opacity (back veils and tendrils are fainter than the core);
 *  - b: a seed that shifts the noise, so layered ribbons do not repeat each other.
 * Without it (any strip drawn with `waterKind: 'fall'`) the sheet aerates down its length as before.
 *
 * A very light colour (white water named as the colour) keeps its light tint for the foam and gets a blue-green body,
 * so the sheet still has translucent water between the white parts.
 *
 * Approach after the waterfall sheets of Athenaion by Leon Lin (MIT License, Copyright (c) 2026 Leon Lin), rewritten
 * for this renderer's node materials.
 */
import { Color, DoubleSide, type MeshStandardMaterial } from 'three';
import { T, type Nd } from './tsl-lite';
import { waterClock } from './water-state';

/** Gravity used for the parcels' arrival time (m/s²). */
const G = 9.81;
/** Metres of drop over which the water turns from glassy to fully aerated at the lip. */
const AERATION_METRES = 4.5;
/** Drop (m) where long falls start breaking into strands, and where the break-up is at its strongest. */
const BREAKUP: readonly [number, number] = [9, 45];
/** Colour of fully aerated water (lit white with a cold tint). */
const FOAM = '#eef5f6';
/** The body of a fall named only by a white colour: deep, clear blue-green water. */
const BODY = '#3d8c86';
/** Linear luminance above which the named colour is read as the foam rather than the clear water. */
const LIGHT_COLOUR = 0.35;

/** The node slots this shader fills (the node renderer copies them off a classic material). */
interface FallNodes { colorNode?: Nd; roughnessNode?: Nd; metalnessNode?: Nd; emissiveNode?: Nd; opacityNode?: Nd }

/** Clear-water and foam colours (linear) for the colour a fall is given. */
export function fallColours(c: Color): { clear: Color; foam: Color } {
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const foam = new Color(FOAM);
  if (lum <= LIGHT_COLOUR) return { clear: c.clone(), foam };
  // White water named as the colour: the foam takes its tint, the body is blue-green water nudged by its hue.
  const k = Math.min(1, (lum - LIGHT_COLOUR) / 0.3);
  const clear = c.clone().lerp(new Color(BODY), 0.55 + 0.4 * k);
  return { clear, foam: foam.lerp(c, 0.5) };
}

/** Attach the falling-water nodes to `m` (its colour is the clear water at the lip). */
export function applyWaterfall(material: MeshStandardMaterial): void {
  const m = material;
  const n = material as unknown as FallNodes;
  const { float, vec3, mix, smoothstep, saturate, min, max, sqrt } = T;
  const t = waterClock as unknown as Nd;
  const uv = T.uv();
  const across = uv.x;
  const drop = max(uv.y, 0);
  // Per-vertex layer data when the geometry carries it (read raw: the colour must not tint the albedo).
  const layered = m.vertexColors === true;
  const data = layered ? T.attribute('color', 'vec3') : vec3(-1, 1, 0);
  const frac = layered ? saturate(data.x) : float(0);
  const layerAlpha = layered ? saturate(data.y) : float(1);
  const seed = layered ? data.z.mul(37) : float(0);

  const tau = sqrt(drop.mul(2 / G));
  const phase = t.sub(tau);
  // Streaks (broad ropes, medium cords, fine threads) stretched along the fall, shifted per layer.
  const ropes = T.mx_noise_float(vec3(across.mul(3.2).add(seed), phase.mul(0.9), seed.mul(0.31)));
  const cords = T.mx_noise_float(vec3(across.mul(8.5).add(seed.mul(1.7)), phase.mul(1.8), 4.7));
  const threads = T.mx_noise_float(vec3(across.mul(23).sub(seed), phase.mul(3.4), 9.3));
  const streak = saturate(ropes.mul(0.55).add(cords.mul(0.3)).add(threads.mul(0.18)).add(0.5));

  // White at the lip (after a glassy tongue), thinning to translucent blue-green ropes, white again near the pool.
  const lipFoam = smoothstep(0.3, AERATION_METRES, drop);
  const lipFade = layered ? float(1).sub(smoothstep(0.12, 0.42, frac).mul(0.5)) : float(1);
  const baseFoam = layered ? smoothstep(0.55, 0.95, frac) : float(0);
  const aer = saturate(max(lipFoam.mul(lipFade), baseFoam));

  const { clear: clearC, foam: foamC } = fallColours(m.color);
  const clear = vec3(clearC.r, clearC.g, clearC.b);
  const foam = vec3(foamC.r, foamC.g, foamC.b);
  const whiteStreaks = smoothstep(0.38, 0.78, streak);
  const whiteness = saturate(aer.mul(0.85).add(whiteStreaks.mul(0.55)).add(aer.mul(streak).mul(0.2)).sub(float(1).sub(streak).mul(0.12)));
  const albedo = mix(clear.mul(0.7), foam, whiteness);

  // Edges: soft and ragged (the noise eats into them as the water falls, more so lower down).
  const edgeNoise = T.mx_noise_float(vec3(across.mul(6).add(seed), phase.mul(2.1), 9.1)).mul(mix(float(0.06), float(0.16), frac));
  const edge = smoothstep(0.0, 0.2, min(across, float(1).sub(across)).add(edgeNoise));
  // Long drops break into strands where the streak field is weak (the white base closes the gaps again).
  const holes = smoothstep(BREAKUP[0], BREAKUP[1], drop).mul(0.32).mul(float(1).sub(baseFoam.mul(0.6)));
  const strands = smoothstep(holes, holes.add(0.2), streak);
  // Body: dense where aerated, translucent between, the white streaks denser than the clear water around them.
  const body = mix(float(0.58), float(0.97), aer).mul(mix(float(0.7), float(1.1), streak)).add(whiteStreaks.mul(0.2));

  m.map = null;
  m.vertexColors = false;
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.opacity = 1;
  n.colorNode = albedo;
  n.roughnessNode = mix(float(0.05), float(0.6), whiteness);
  n.metalnessNode = float(0);
  n.emissiveNode = albedo.mul(mix(float(0.05), float(0.24), whiteness));
  n.opacityNode = saturate(body.mul(edge).mul(strands).mul(layerAlpha));
  m.userData['aetherWaterfall'] = true;
}
