/**
 * The falling-water shader (TSL, WebGPU and WebGL2): a waterfall sheet drawn on a strip whose UVs run u 0..1 across and
 * v in metres down from the lip (`api.ribbon` makes one).
 *
 * What makes falling water read as water and not as a painted sheet:
 *
 *  - **Advected streaks**: every point has the arrival time τ = √(2d/g) of a parcel that left the lip and fell d metres;
 *    streak noise is sampled at (across, t − τ), so features ride down with the flow, speeding up and stretching into
 *    long streaks lower down, as in a real fall.
 *  - **Aeration**: glassy, dark and smooth at the lip (green-teal water colour), turning white and rough as air mixes in
 *    over the first few metres.
 *  - **Ragged translucent edges** and a sheet that **breaks up** into strands on long drops.
 *  - A little self-glow (aerated water scatters the daylight it is lit by), so the sheet never goes grey in shade.
 *
 * Approach after the waterfall sheets of Athenaion by Leon Lin (MIT License, Copyright (c) 2026 Leon Lin), rewritten
 * for this renderer's node materials.
 */
import { Color, DoubleSide, type MeshStandardMaterial } from 'three';
import { T, type Nd } from './tsl-lite';
import { waterClock } from './water-state';

/** Gravity used for the parcels' arrival time (m/s²). */
const G = 9.81;
/** Metres of drop over which the water turns from glassy to fully aerated. */
const AERATION_METRES = 4.5;
/** Drop (m) where long falls start breaking into strands, and where the break-up is at its strongest. */
const BREAKUP: readonly [number, number] = [9, 45];
/** Colour of fully aerated water (lit white with a cold tint). */
const FOAM = '#eef5f6';

/** Attach the falling-water nodes to `m` (its colour is the clear water at the lip). */
/** The node slots this shader fills (the node renderer copies them off a classic material). */
interface FallNodes { colorNode?: Nd; roughnessNode?: Nd; metalnessNode?: Nd; emissiveNode?: Nd; opacityNode?: Nd }

export function applyWaterfall(material: MeshStandardMaterial): void {
  const m = material;
  const n = material as unknown as FallNodes;
  const { float, vec3, mix, smoothstep, saturate, min, max, sqrt } = T;
  const t = waterClock as unknown as Nd;
  const uv = T.uv();
  const across = uv.x;
  const drop = max(uv.y, 0);
  const tau = sqrt(drop.mul(2 / G));
  const phase = t.sub(tau);
  // Two octaves of streaks (broad ropes, fine threads), stretched along the fall.
  const ropes = T.mx_noise_float(vec3(across.mul(9), phase.mul(1.3), 0.0));
  const threads = T.mx_noise_float(vec3(across.mul(31), phase.mul(3.4), 4.7));
  const streak = saturate(ropes.mul(0.55).add(threads.mul(0.3)).add(0.5));
  const aer = smoothstep(0.2, AERATION_METRES, drop);

  const clear = vec3(m.color.r, m.color.g, m.color.b);
  const foam = vec3(new Color(FOAM).r, new Color(FOAM).g, new Color(FOAM).b);
  const whiteness = saturate(aer.mul(0.8).add(streak.sub(0.5).mul(0.6)).add(aer.mul(streak).mul(0.25)));
  const albedo = mix(clear.mul(0.55), foam, whiteness);

  // Edges: soft and ragged (the noise eats into them as the water falls).
  const edgeNoise = T.mx_noise_float(vec3(across.mul(17), phase.mul(2.1), 9.1)).mul(0.07);
  const edge = smoothstep(0.0, 0.16, min(across, float(1).sub(across)).add(edgeNoise));
  // Long drops break into strands where the streak field is weak.
  const holes = smoothstep(BREAKUP[0], BREAKUP[1], drop).mul(0.5);
  const strands = smoothstep(holes, holes.add(0.18), streak);
  const body = mix(float(0.72), float(0.97), aer).mul(mix(float(0.8), float(1), streak));

  m.map = null;
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.opacity = 1;
  n.colorNode = albedo;
  n.roughnessNode = mix(float(0.06), float(0.62), aer);
  n.metalnessNode = float(0);
  n.emissiveNode = albedo.mul(mix(float(0.06), float(0.22), whiteness));
  n.opacityNode = saturate(body.mul(edge).mul(strands));
  m.userData['aetherWaterfall'] = true;
}
