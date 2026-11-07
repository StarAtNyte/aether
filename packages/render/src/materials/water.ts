/**
 * The water shader (TSL, so one description runs on WebGPU and on WebGL2).
 *
 * What a viewer sees of real water is a handful of effects, each of which is here:
 *
 *  - **Waves**: four crossing directional waves summed as slopes (analytic normals, no vertex work), their heading and
 *    steepness set by the scale class (stream, river, lake, sea) and by the wind; a scrolling detail normal map adds the
 *    small ripples; waves fade out with distance so the far surface does not shimmer. Rivers carry their pattern along
 *    the current.
 *  - **Ripples**: expanding rings from the shared ripple field, added to the same slope sum.
 *  - **Refraction and absorption**: the picture behind the surface is sampled through the wave normals and then
 *    attenuated per colour channel by the path length of the water (red dies first), so the bed fades from visible to
 *    the deep colour and shallow edges are clear. The depth comes from the scene depth buffer, so any shore works.
 *  - **Fresnel reflection**: the PBR environment sky (always) and, on the high tier, a planar reflection of the scene.
 *  - **Foam**: along every shore (measured by the depth, not painted), on steep crests under wind and in flowing
 *    water, moving with the current.
 *  - **Caustics**: bright net-like light on the bed in shallow water.
 *
 * The three tiers (see `water-params.ts`) trade texture reads for looks: `simple` has waves, ripples and the sky
 * (no scene-colour or depth reads, so software rasterisers and weak machines stay fast), `standard` adds depth
 * absorption, refraction, foam and caustics, `high` adds the planar reflection.
 *
 * The nodes are attached to a classic `MeshStandardMaterial` (`normalNode`, `colorNode`, `emissiveNode`, `opacityNode`),
 * which the node renderer copies when it converts the material, like the wind sway and the anti-tiling do.
 */
import { Color, Vector2, Vector4, type Material, type Texture } from 'three';
import { T, type Nd } from './tsl-lite';
import { PlanarMirror } from './planar-mirror';
import type { SceneBackdrop } from './scene-backdrop';
import { RIPPLE, WATER_CLASSES, waveSet, type WaterTier } from './water-params';
import type { ResolvedWater } from './presets';
import { currentWind, reflectionOn, reflectionY, rippleSlots, skyHorizon, skyZenith, waterClock, windSpeed } from './water-state';
import { takeStableIds } from '../gpu/stable-node-ids';

/** Handle on the shader of one water material: wind changes call {@link WaterShader.retune}. */
export interface WaterShader {
  kind: ResolvedWater['kind'];
  tier: WaterTier;
  /** Re-derive the waves from the current wind (cheap: writes uniforms only). */
  retune(): void;
  /** True when the shader samples the planar mirror (high tier). */
  mirrored: boolean;
}

/** `userData` key of a material's {@link WaterShader}. */
export const WATER_SHADER_KEY = 'aetherWaterShader';

/** Strength of the analytic sky mirror of the simple tier (added to the faint image-light reflection). */
const SIMPLE_SKY_MIRROR = 1;
/** Absorption of the three colour channels relative to green (red goes first, blue lasts). */
const ABSORB = Object.freeze([3.1, 1, 0.62]) as readonly [number, number, number];
/** Strength of the sun's caustic net on the bed (relative to the bed's brightness). */
const CAUSTIC_GAIN = 0.9;

/**
 * The planar reflection of one renderer: a mirrored render of the scene about the dominant water's height, drawn at
 * half size by the renderer before each frame (see planar-mirror.ts). It belongs to a material cache (so to one
 * renderer and one GPU device).
 */
export class PlanarReflection {
  readonly mirror = new PlanarMirror();
  /** True once a high-tier water material sampled it (the renderer then draws the mirror each frame). */
  used = false;

  /** The mirror's colour texture, marking it as used. */
  texture(): Texture {
    this.used = true;
    return this.mirror.target.texture;
  }

  /** Release the target. */
  dispose(): void {
    this.mirror.dispose();
    this.used = false;
  }
}

/** The node slots of a classic material that the water shader fills. */
interface MaterialNodes {
  normalNode?: unknown;
  colorNode?: unknown;
  emissiveNode?: unknown;
  roughnessNode?: unknown;
  opacityNode?: unknown;
}

/**
 * Attach the water shader to `material` (a classic standard material that keeps its colour and roughness as the
 * fallback). `maps.normalMap` is the shared procedural ripple normal map (its tile size is `tileMetres`).
 */
export function applyWater(material: Material, water: ResolvedWater, tier: WaterTier, maps: { normalMap: Texture | null }, tileMetres: number, mirror: PlanarReflection, backdrop: SceneBackdrop | null = null): WaterShader {
  const { float, vec2, vec3, vec4, mix, smoothstep, step, saturate, dot, normalize, exp, sin, cos, pow, abs, max } = T;
  const cls = WATER_CLASSES[water.kind];
  const waves = T.uniformArray([new Vector4(), new Vector4(), new Vector4(), new Vector4()], 'vec4');
  // Its block name comes from its node id: an id of its own keeps it the same in every load (gpu/stable-node-ids.ts).
  takeStableIds('water', [waves]);
  const slopes = T.uniform(new Vector4());
  const flow = T.uniform(new Vector2(water.flow[0], water.flow[1]));
  const t = waterClock as unknown as Nd;
  const wind = windSpeed as unknown as Nd;

  const p = T.positionWorld.xz;
  const toCamera = T.cameraPosition.sub(T.positionWorld);
  const distance = toCamera.length();
  const viewDir = toCamera.div(max(distance, 1e-3));
  // The pattern is carried by the current (the rivers' look), advected at the surface speed.
  const advected = p.sub(flow.mul(t));

  // ---- Wave slopes --------------------------------------------------------------------------------------------------
  let gx: Nd = float(0);
  let gz: Nd = float(0);
  let height: Nd = float(0);
  const slopeOf = [slopes.x, slopes.y, slopes.z, slopes.w];
  for (let i = 0; i < 4; i++) {
    const w = waves.element(i);
    // Straight parallel crests read as stripes from a distance: wander each wave front sideways by a slow, wavy offset
    // (a domain warp, in radians of this wave's phase), so crests bend, break and merge as on a real surface.
    const across = dot(vec2(w.y.negate(), w.x), advected);
    const warp = sin(across.mul(w.z.mul(0.33)).add(i * 1.9).add(t.mul(0.21))).mul(1.5).add(sin(across.mul(w.z.mul(0.81)).sub(t.mul(0.37)).add(i * 0.7)).mul(0.65));
    const phase = w.z.mul(dot(w.xy, advected)).sub(w.w.mul(t)).add(warp);
    // Waves shorter than a few pixels alias into shimmer: fade each out beyond ~35 of its wavelengths.
    const fade = float(1).sub(smoothstep(14, 55, distance.mul(w.z).div(Math.PI * 2)));
    const s = (slopeOf[i] as Nd).mul(fade);
    const c = cos(phase).mul(s);
    gx = gx.add(w.x.mul(c));
    gz = gz.add(w.y.mul(c));
    height = height.add(sin(phase).mul(s).div(w.z));
  }

  // The broad waves alone bend the reflection (the fine detail would shear it into noise).
  const swellX = gx;
  const swellZ = gz;

  // ---- Ripple rings -------------------------------------------------------------------------------------------------
  for (let i = 0; i < RIPPLE.max; i++) {
    const r = (rippleSlots as unknown as Nd).element(i);
    const age = t.sub(r.z);
    const delta = p.sub(r.xy);
    const dist = max(delta.length(), 0.001);
    const d = dist.sub(age.mul(RIPPLE.speed));
    const env = exp(d.mul(d).negate().div(RIPPLE.width * RIPPLE.width))
      .mul(r.w)
      .mul(exp(age.negate().div(1.4)))
      .div(dist.mul(0.9).add(1))
      .mul(step(0, age));
    const slope = cos(d.mul(19)).mul(env).mul(1.1);
    gx = gx.add(delta.x.div(dist).mul(slope));
    gz = gz.add(delta.y.div(dist).mul(slope));
  }

  // ---- Small detail: the shared ripple normal map, scrolled two ways and along the current ---------------------------
  if (maps.normalMap && cls.detail > 0.01) {
    const inv = 1 / tileMetres;
    const uvA = p.mul(inv).add(vec2(t.mul(0.011), t.mul(-0.007))).sub(flow.mul(t).mul(inv));
    const uvB = p.mul(inv * 2.7).add(vec2(t.mul(-0.016), t.mul(0.012))).sub(flow.mul(t).mul(inv * 2.7));
    const nA = T.texture(maps.normalMap, uvA).xy.mul(2).sub(1);
    const nB = T.texture(maps.normalMap, uvB).xy.mul(2).sub(1);
    const nearness = float(1).sub(smoothstep(10, 90, distance));
    const k = nearness.mul(cls.detail * 0.55);
    gx = gx.add(nA.x.add(nB.x).mul(k));
    gz = gz.add(nA.y.add(nB.y).mul(k));
  }
  // Distance flattening of the whole surface toward the horizon avoids glittering noise.
  const flat = float(1).sub(smoothstep(160, 900, distance).mul(0.6));
  const worldNormal = normalize(vec3(gx.negate().mul(flat), float(1), gz.negate().mul(flat)));
  const viewNormal = normalize(T.transformDirection(worldNormal, T.cameraViewMatrix));
  (material as MaterialNodes).normalNode = viewNormal;

  const ndv = saturate(dot(worldNormal, viewDir));
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(ndv), 5)));

  // ---- Colour and body ----------------------------------------------------------------------------------------------
  const shallow = vec3(new Color(cls.shallow));
  const deep = vec3(new Color(cls.deep));
  const tint = T.materialColor.rgb;
  const bodyShallow = mix(shallow, tint, 0.45);
  const bodyDeep = mix(deep, tint.mul(0.35), 0.4);

  let transmitted: Nd = bodyDeep;
  let scatter: Nd = float(0.85);
  let edge: Nd = float(1);
  let foam: Nd = float(0);
  let depthMix: Nd = float(1);

  if (tier === 'simple') {
    // No scene reads: the body is mostly the deep colour with a little of the shallow, the sky does the rest.
    transmitted = mix(bodyShallow, bodyDeep, 0.82);
    scatter = float(0.9);
    edge = float(0.8);
    const crestH = height.mul(1 / Math.max(0.005, cls.wavelength * 0.018)).mul(0.5).add(0.5);
    foam = smoothstep(0.7, 1.0, crestH).mul(cls.crestFoam * 0.6).mul(saturate(wind.div(8)));
  } else {
    // Scene depth behind the surface (view space), then back to world height for the vertical water depth.
    // WebGL2 copies the frame buffer; WebGPU reads the scene the renderer drew without the water (see scene-backdrop.ts).
    const depthAt = (uv: Nd): Nd => (backdrop ? T.texture(backdrop.depthTexture(), uv).r : T.viewportDepthTexture(uv).r);
    const raw = depthAt(T.screenUV);
    const viewPos = T.getViewPosition(T.screenUV, raw, T.cameraProjectionMatrixInverse);
    const sceneWorld = T.cameraWorldMatrix.mul(vec4(viewPos, 1)).xyz;
    const waterViewZ = T.positionView.z;
    // The surface survived the depth test, so whatever the buffer holds under this pixel is behind it.
    const vertical = max(T.positionWorld.y.sub(sceneWorld.y), 0);
    // Depth of an open view of deep water: treat the sky (no geometry) as bottomless.
    const bottomless = step(0.99999, raw);
    const depth = mix(vertical, float(1000), bottomless);
    // A body laid on flat ground reads as deep as its class (see WaterClass.basin); measured basins keep their depth.
    const apparent = depth.add(float(cls.basin).mul(smoothstep(0, 0.12, depth)).mul(float(1).sub(smoothstep(0.12, 0.45, depth))));
    const path = apparent.div(max(viewDir.y, 0.25));

    // Refraction: bend the lookup by the wave slope, scaled so that shallow water bends less; reject samples that land on
    // something nearer than the water.
    const bend = vec2(gx, gz).mul(cls.refraction).mul(saturate(depth.mul(1.5))).mul(float(1).sub(smoothstep(20, 120, distance)));
    const uvR = T.screenUV.add(bend.mul(vec2(1, -1)));
    const rawR = depthAt(uvR);
    const nearerR = step(waterViewZ.sub(0.02), T.perspectiveDepthToViewZ(rawR, T.cameraNear, T.cameraFar));
    const uvOk = mix(uvR, T.screenUV, nearerR);
    const bg = (backdrop ? T.texture(backdrop.colorTexture(), uvOk) : T.viewportSharedTexture(uvOk)).rgb;

    // Beer-Lambert absorption per channel.
    const sigma = 1 / cls.clarity;
    const absorb = vec3(sigma * ABSORB[0], sigma * ABSORB[1], sigma * ABSORB[2]);
    const trans = exp(absorb.mul(path).negate());
    scatter = float(1).sub(trans.y);
    depthMix = float(1).sub(exp(path.mul(sigma * 0.55).negate()));

    // Caustics on a shallow bed: a drifting net of bright lines (two warped sine layers).
    let lit: Nd = bg.mul(trans);
    if (cls.clarity > 0.4) {
      let q = p.mul(1.9).add(vec2(t.mul(0.21), t.mul(-0.17)));
      q = q.add(vec2(sin(q.y.mul(1.35).add(t.mul(0.8))), cos(q.x.mul(1.15).add(t.mul(0.7)))).mul(0.85));
      const a = sin(q.x.mul(2.3).add(sin(q.y.mul(1.7)))).mul(sin(q.y.mul(2.1).add(cos(q.x.mul(1.9)))));
      const net = pow(float(1).sub(abs(a)), 5);
      const window = smoothstep(0.02, 0.25, depth).mul(float(1).sub(smoothstep(0.6, 2.2 * cls.clarity, depth)));
      lit = lit.mul(float(1).add(net.mul(window).mul(CAUSTIC_GAIN)));
    }
    transmitted = lit;
    edge = smoothstep(0, 0.03, depth);

    // Foam: the shore, measured by the depth, with breaking noise that moves with the current; crests under wind.
    const noiseP = T.vec3(p.mul(2.6).sub(flow.mul(t).mul(2.6)).x, p.mul(2.6).sub(flow.mul(t).mul(2.6)).y, t.mul(0.35));
    const n = T.mx_noise_float(noiseP).mul(0.5).add(0.5);
    const n2 = T.mx_noise_float(noiseP.mul(2.7).add(vec3(7.3, 1.1, 4.7))).mul(0.5).add(0.5);
    const grain = n.mul(0.65).add(n2.mul(0.35));
    const shore = float(1).sub(smoothstep(0, cls.foamWidth, depth));
    // The band pulses in and out like swash.
    const swash = sin(t.mul(1.1).add(grain.mul(6))).mul(0.25).add(0.75);
    const shoreFoam = smoothstep(0.38, 0.62, grain.add(shore.mul(0.5)).sub(0.12)).mul(shore).mul(swash).mul(cls.shoreFoam);
    const crestH = height.mul(1 / Math.max(0.005, cls.wavelength * 0.018)).mul(0.5).add(0.5);
    const gale = saturate(wind.div(7));
    const crest = smoothstep(0.66, 0.96, crestH.add(grain.mul(0.25)).sub(0.1)).mul(cls.crestFoam).mul(mix(float(0.35), float(1), gale));
    foam = saturate(shoreFoam.add(crest));
  }

  // ---- Planar reflection (high tier): measured against the sky the PBR environment already supplies ------------------
  let reflectionTerm: Nd = vec3(0, 0, 0);
  let mirrored = false;
  if (tier === 'high') {
    const tex = mirror.texture();
    mirrored = true;
    const distort = vec2(swellX, swellZ).mul(0.022).mul(float(1).sub(smoothstep(25, 140, distance)));
    const refl = T.texture(tex, vec2(float(1).sub(T.screenUV.x).add(distort.x.negate()), T.screenUV.y.add(distort.y)));
    const sky = mix(vec3(skyHorizon as unknown as Nd), vec3(skyZenith as unknown as Nd), pow(saturate(worldNormal.y.mul(0.9).add(viewDir.y.negate().mul(0.1))), 0.6));
    // Where the mirror shows something else than the sky (trees, hills, the bank) it replaces the sky term.
    const onPlane = float(1).sub(smoothstep(0.05, 0.4, abs(T.positionWorld.y.sub(reflectionY as unknown as Nd))));
    const weight = (reflectionOn as unknown as Nd).mul(onPlane);
    // Gentle: the mirror is half size and unfiltered, so it adds what the sky reflection lacks (banks, trees) without taking over.
    reflectionTerm = T.min(refl.rgb, 2.5).sub(sky).mul(fresnel).mul(weight).mul(0.5);
  }

  if (tier === 'simple') {
    // Software rasterisers and low-memory mode: the image light there is a tiny, flat sky map, so a calm surface came out
    // grey. An analytic sky gradient (the same horizon and zenith colours the dome uses) is mirrored by the Fresnel term,
    // with a lighter streak of horizon toward grazing views: water reads as water at the cost of a few ALU.
    const up = saturate(worldNormal.y.mul(0.9).add(viewDir.y.negate().mul(0.1)));
    const sky = mix(vec3(skyHorizon as unknown as Nd), vec3(skyZenith as unknown as Nd), pow(up, 0.6));
    reflectionTerm = sky.mul(fresnel).mul(SIMPLE_SKY_MIRROR);
  }

  // ---- Output -------------------------------------------------------------------------------------------------------
  const body = mix(bodyShallow, bodyDeep, depthMix);
  const foamColour = vec3(0.86, 0.9, 0.92);
  const m = material as MaterialNodes;
  // Diffuse albedo: the in-scattered body colour (lit by the sun and sky) and the white of the foam.
  // Seen from below (the eye under the surface) the plane is a bright ceiling of water colour, not a lit surface.
  const front = step(0, T.faceDirection);
  const ceiling = mix(bodyShallow, vec3(skyHorizon as unknown as Nd), 0.35).mul(0.7);
  m.colorNode = vec4(mix(body.mul(scatter), foamColour, foam).mul(front), 1);
  // What comes through the surface (already lit, so emissive) loses the share the Fresnel term reflects.
  const through = transmitted.mul(float(1).sub(fresnel)).mul(float(1).sub(foam)).mul(tier === 'simple' ? scatter.mul(0.55) : float(1));
  m.emissiveNode = mix(ceiling, through.add(reflectionTerm), front);
  m.roughnessNode = mix(float(0.04), float(0.85), foam);
  m.opacityNode = mix(float(1), edge, front);

  const shader: WaterShader = {
    kind: water.kind,
    tier,
    mirrored,
    retune(): void {
      const w = currentWind();
      const heading = (Math.atan2(-w.x, -w.z) * 180) / Math.PI;
      const set = waveSet(water.kind, w.speed, heading, water.flow);
      const arr = (waves as unknown as { array: Vector4[] }).array;
      const s = (slopes as unknown as { value: Vector4 }).value;
      for (let i = 0; i < 4; i++) {
        const wave = set[i];
        if (!wave) continue;
        (arr[i] as Vector4).set(wave.dx, wave.dz, wave.k, wave.omega);
        s.setComponent(i, wave.slope);
      }
    },
  };
  shader.retune();
  return shader;
}
