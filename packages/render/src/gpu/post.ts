/**
 * The cinematic finishing chain, built from three's TSL post nodes so one implementation serves the
 * WebGPU backend and the WebGL2 fallback (Firefox looks like Chromium). Tone mapping and colour-space
 * conversion happen in the chain's own output transform; any failure (missing feature, shader compile
 * error) is reported to the caller, which drops the failing effect and rebuilds (see `finishing.ts`).
 *
 * Chain order, all in linear HDR until the output transform:
 *
 *   scene pass (+ ground-truth AO on the indirect light only)
 *     → screen-space reflections → sun shafts → bloom + warm halation → depth of field
 *     → chromatic aberration → exposure / white balance / split-tone / saturation / contrast / vignette
 *     → temporal anti-aliasing → tone curve + sRGB → film grain (display space, also dithers banding)
 *
 * The AO, reflections, shafts, DOF and TAA read a half-resolution-capable normal / velocity / material
 * pre-pass of the opaque scene, so the effects only cost what they are switched on for.
 */
import type { Camera, DirectionalLight, PerspectiveCamera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';
import { ABERRATION_STRENGTH, GRAIN_AMPLITUDE, effectsKey, needsPrePass, type PostEffects } from './finishing';
import { NEUTRAL_GRADE, type Grade } from './grade';

/** Post pipeline variant: composite only, or with the opaque pre-pass (AO, TAA, reflections, shafts, DOF). */
export type PostQuality = 'standard' | 'studio';

/** Ambient occlusion tuning of the pre-pass pipeline (metres / unitless). */
export const STUDIO_AO = Object.freeze({ radius: 0.9, thickness: 1.2, distanceExponent: 1.2, scale: 2.0, samples: 16, resolutionScale: 1 });

/**
 * Screen-space global illumination (one diffuse bounce of what is lit on screen, sampled in half
 * resolution and cleaned by the temporal AA): `intensity` scales the bounce, `radius` is the reach in
 * metres (room scale), `slices` and `steps` the sample budget per pixel.
 */
export const GI_TUNING = Object.freeze({ intensity: 3.2, radius: 4.5, slices: 1, steps: 10, thickness: 0.7 });

/** Screen-space reflection tuning: reach in metres, thickness, intensity. */
export const SSR_TUNING = Object.freeze({ maxDistance: 40, thickness: 0.35, intensity: 0.85, resolutionScale: 0.5, quality: 0.5 });

/** Screen-space contact shadows: ray length (m), depth tolerance (m), darkness, march quality, resolution. */
export const CONTACT_TUNING = Object.freeze({ maxDistance: 0.4, thickness: 0.06, intensity: 0.92, quality: 0.5, resolutionScale: 0.5 });
/** Sun shaft tuning: ray-march steps, density, maximum opacity and the resolution scale of the pass. */
export const SHAFT_TUNING = Object.freeze({ steps: 28, density: 0.1, maxDensity: 0.06, distanceAttenuation: 2, resolutionScale: 0.5, brightness: 1.2 });

/** Halation: strength and radius of the wide warm bloom around bright lights. */
export const HALATION_TUNING = Object.freeze({ strength: 0.12, radius: 0.8, threshold: 1.1 });

/** A running post pipeline. */
export interface PostPipeline {
  readonly quality: PostQuality;
  /** The effects this pipeline was built with. */
  readonly effects: Readonly<PostEffects>;
  /** Stable key of {@link effects} (rebuild when it differs from what is wanted). */
  readonly key: string;
  render(): void;
  /**
   * Draw the scene pass at `scale` of the frame (width and height in pixels of the full frame) and upsample it with a
   * sharpening step in the composite: a cheap way to hold the frame rate while the view moves without a blurred picture.
   * Only the chains without a depth pre-pass can (see {@link sceneScalable}); 1 is the plain composite.
   */
  setSceneScale(scale: number, width: number, height: number): void;
  /** True when {@link setSceneScale} has an effect. */
  readonly sceneScalable: boolean;
  setBloom(strength: number): void;
  /** Apply a colour grade (uniform updates only; no shader rebuild). */
  setGrade(grade: Grade): void;
  /**
   * Vignette strength (0 = none, default {@link VIGNETTE_STRENGTH}). Tiled
   * captures switch it off and apply {@link vignetteFactor} to the assembled
   * image instead (a screen-space vignette per tile would darken every tile).
   */
  setVignette(strength: number): void;
  /** Retune the ambient occlusion live (radius in metres, scale = strength); no-op without AO. */
  setAo(tuning: { radius?: number; scale?: number; thickness?: number; resolutionScale?: number; samples?: number }): void;
  /** Focus the depth of field on `distance` metres in front of the camera (no-op without DOF). */
  setFocus(distance: number): void;
  dispose(): void;
}

/**
 * Bloom tuning. The threshold sits above the brightest diffusely lit
 * surface (white albedo under a full sun ≈ 0.8 linear), so only emissive
 * materials, the sun disc and sharp specular glints bloom.
 */
const BLOOM_RADIUS = 0.35;
/** Strength of the sharpening that follows a scene pass drawn below the frame resolution. */
export const SCENE_SHARPEN = 0.9;
export const BLOOM_THRESHOLD = 1.05;
/** `environment.bloom` (0–3) is scaled by this into the bloom node strength (subtle by default). */
export const BLOOM_SCALE = 0.42;
/** Upper bound of the bloom node strength. */
export const MAX_BLOOM_STRENGTH = 1.1;

/** Darkening at the frame corners (0 = none). Subtle: frames the subject without looking filtered. */
export const VIGNETTE_STRENGTH = 0.22;
/** Distance from the screen center (UV units) where the vignette starts / reaches full strength. */
export const VIGNETTE_RANGE: readonly [number, number] = Object.freeze([0.42, 0.85]) as readonly [number, number];

/** Vignette multiplier at a distance `d` (UV units) from the screen center — the CPU twin of the shader. */
export function vignetteFactor(d: number, strength: number = VIGNETTE_STRENGTH): number {
  const [lo, hi] = VIGNETTE_RANGE;
  const t = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
  return 1 - strength * t * t * (3 - 2 * t);
}

/** Bloom node strength for an `environment.bloom` value. */
export function bloomStrength(bloom: number): number {
  return Math.max(0, Math.min(MAX_BLOOM_STRENGTH, (Number.isFinite(bloom) ? bloom : 0) * BLOOM_SCALE));
}

/** Depth-of-field parameters for a focus distance: focal range (metres) and the bokeh scale. */
export function dofParams(distance: number): { focus: number; range: number; bokeh: number } {
  const d = Number.isFinite(distance) ? Math.max(0.3, Math.min(2000, distance)) : 10;
  return { focus: d, range: Math.max(1.5, d * 0.55), bokeh: 2.2 };
}

/**
 * Textures the TRAA node owns but does not release in its own `dispose`
 * (three r186): the placeholder previous-depth texture and the history
 * target's depth texture. Without this, every studio-render toggle leaked
 * three GPU textures.
 */
function disposeTraaTextures(node: unknown, placeholder: { dispose?: () => void } | undefined): void {
  const n = node as { _previousDepthNode?: { value?: { dispose?: () => void } }; _historyRenderTarget?: { depthTexture?: { dispose?: () => void } | null } };
  placeholder?.dispose?.();
  n._previousDepthNode?.value?.dispose?.();
  n._historyRenderTarget?.depthTexture?.dispose?.();
}

/** Every texture of a pass's render target (MRT attachments and depth), which the target's own dispose may not release. */
function disposeTargetTextures(pass: unknown): void {
  const rt = (pass as { renderTarget?: { textures?: Array<{ dispose(): void }>; depthTexture?: { dispose(): void } | null } }).renderTarget;
  for (const t of rt?.textures ?? []) t.dispose();
  rt?.depthTexture?.dispose();
}

/** Extra inputs of the chain. */
export interface PostOptions {
  /** The effects to build (default: composite only). */
  effects?: PostEffects;
  /** The shadow-casting sun, or the light whose shadow map the sun shafts march (the outermost cascade). */
  sun?: DirectionalLight | null;
  /** Resolution of the ambient occlusion pass relative to the frame (default {@link STUDIO_AO}`.resolutionScale`; half on integrated GPUs, whose studio chain refines at rest). */
  aoScale?: number;
  /** The sun itself: screen-space contact shadows are traced toward it and darken its direct light only. */
  contactLight?: DirectionalLight | null;
}

const COMPOSITE_ONLY: PostEffects = Object.freeze({ composite: true, ao: false, gi: false, taa: false, contact: false, ssr: false, shafts: false, halation: false, aberration: false, grain: false, dof: false });

/** Build the pipeline, or null when unsupported. */
export async function createPostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, strength: number, quality: PostQuality = 'standard', opts: PostOptions = {}): Promise<PostPipeline | null> {
  const effects: PostEffects = opts.effects ?? (quality === 'studio' ? { ...COMPOSITE_ONLY, ao: true, taa: true } : COMPOSITE_ONLY);
  try {
    const prepass = needsPrePass(effects);
    const sun = effects.shafts && opts.sun?.castShadow ? opts.sun : null;
    const contactLight = effects.contact && opts.contactLight?.castShadow ? opts.contactLight : null;
    const [three, tsl, bloomMod, gtao, ssgiMod, traaMod, ssrMod, godMod, blendMod, dofMod, caMod, sssMod] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
      effects.ao ? import('three/addons/tsl/display/GTAONode.js') : Promise.resolve(null),
      effects.gi ? import('three/addons/tsl/display/SSGINode.js') : Promise.resolve(null),
      effects.taa ? import('three/addons/tsl/display/TRAANode.js') : Promise.resolve(null),
      effects.ssr ? import('three/addons/tsl/display/SSRNode.js') : Promise.resolve(null),
      sun ? import('three/addons/tsl/display/GodraysNode.js') : Promise.resolve(null),
      sun ? import('three/addons/tsl/display/depthAwareBlend.js') : Promise.resolve(null),
      effects.dof ? import('three/addons/tsl/display/DepthOfFieldNode.js') : Promise.resolve(null),
      effects.aberration ? import('three/addons/tsl/display/ChromaticAberrationNode.js') : Promise.resolve(null),
      contactLight ? import('three/addons/tsl/display/SSSNode.js') : Promise.resolve(null),
    ]);
    const { RenderPipeline, Vector3, UnsignedByteType, Color } = three;
    const { pass, screenUV, screenCoordinate, smoothstep, float, uniform, vec2, vec3, vec4, dot, mix, pow, max, min, clamp, mrt, packNormalToRGB, unpackRGBToNormal, normalView, velocity, sample, context, diffuseColor, convertToTexture, renderOutput, interleavedGradientNoise, metalness, roughness } = tsl;
    const { bloom } = bloomMod;
    const disposables: Array<{ dispose(): void }> = [];
    // Temporal AA replaces MSAA (its history needs single-sampled targets); without it the scene pass keeps MSAA.
    const scenePass = effects.taa ? pass(scene, camera, { samples: 0 }) : pass(scene, camera);
    disposables.push(scenePass);
    type Value = ReturnType<typeof float>;
    let aoValue: Value | null = null;
    let contactValue: Value | null = null;
    let setAo = (_t: { radius?: number; scale?: number; thickness?: number; resolutionScale?: number; samples?: number }): void => undefined;
    let prePass: ReturnType<typeof pass> | null = null;
    let prePassDepth: ReturnType<typeof scenePass.getTextureNode> | null = null;
    let prePassVelocity: ReturnType<typeof scenePass.getTextureNode> | null = null;
    let prePassNormal: ReturnType<typeof sample> | null = null;
    if (prepass) {
      // Opaque pre-pass: view normals (8-bit), velocity (TAA) and metalness / roughness (reflections), plus depth.
      prePass = pass(scene, camera, { samples: 0 });
      prePass.transparent = false;
      const attachments: Record<string, unknown> = { output: packNormalToRGB(normalView) };
      if (effects.taa) attachments['velocity'] = velocity;
      if (effects.gi) attachments['diffuse'] = vec4(diffuseColor.rgb, 1);
      if (effects.ssr) attachments['material'] = vec4(metalness, roughness, 0, 1);
      prePass.setMRT(mrt(attachments as Parameters<typeof mrt>[0]));
      const normalTexture = prePass.getTexture('output');
      normalTexture.type = UnsignedByteType;
      const pp = prePass;
      prePassNormal = sample((uv) => unpackRGBToNormal(pp.getTextureNode().sample(uv)));
      prePassDepth = prePass.getTextureNode('depth');
      if (effects.taa) prePassVelocity = prePass.getTextureNode('velocity');
      disposables.push(prePass, { dispose: () => disposeTargetTextures(pp) }, { dispose: () => disposeTargetTextures(scenePass) });
    }
    if (effects.ao && gtao && prePassDepth && prePassNormal) {
      const aoPass = gtao.ao(prePassDepth, prePassNormal, camera);
      aoPass.resolutionScale = opts.aoScale ?? STUDIO_AO.resolutionScale;
      aoPass.useTemporalFiltering = effects.taa;
      aoPass.radius.value = STUDIO_AO.radius;
      aoPass.thickness.value = STUDIO_AO.thickness;
      aoPass.distanceExponent.value = STUDIO_AO.distanceExponent;
      aoPass.scale.value = STUDIO_AO.scale;
      aoPass.samples.value = STUDIO_AO.samples;
      setAo = (t) => {
        if (t.radius !== undefined && Number.isFinite(t.radius)) aoPass.radius.value = Math.max(0.05, Math.min(8, t.radius));
        if (t.scale !== undefined && Number.isFinite(t.scale)) aoPass.scale.value = Math.max(0, Math.min(8, t.scale));
        if (t.resolutionScale !== undefined && Number.isFinite(t.resolutionScale)) aoPass.resolutionScale = Math.max(0.25, Math.min(1, t.resolutionScale));
        if (t.samples !== undefined && Number.isFinite(t.samples)) aoPass.samples.value = Math.max(4, Math.min(48, Math.round(t.samples)));
        if (t.thickness !== undefined && Number.isFinite(t.thickness)) aoPass.thickness.value = Math.max(0.05, Math.min(8, t.thickness));
      };
      aoValue = aoPass.getTextureNode().sample(screenUV).r as unknown as Value;
      disposables.push(aoPass);
    }
    // Screen-space contact shadows: a short march toward the sun through the pre-pass depth, multiplied into the
    // sun's direct light (feet, chair legs and small props get the shadow the shadow map is too coarse to hold).
    if (contactLight && sssMod && prePassDepth) {
      const contactPass = sssMod.sss(prePassDepth, camera, contactLight);
      contactPass.maxDistance.value = CONTACT_TUNING.maxDistance;
      contactPass.thickness.value = CONTACT_TUNING.thickness;
      contactPass.shadowIntensity.value = CONTACT_TUNING.intensity;
      contactPass.quality.value = CONTACT_TUNING.quality;
      contactPass.resolutionScale = CONTACT_TUNING.resolutionScale;
      contactPass.useTemporalFiltering = effects.taa;
      contactValue = contactPass.getTextureNode().sample(screenUV).r as unknown as Value;
      disposables.push(contactPass);
    }
    if (aoValue || contactValue) {
      // One context for both (three's built-in AO and shadow contexts, merged).
      const ao = aoValue;
      const contact = contactValue;
      const value: Record<string, unknown> = {};
      if (ao) value['getAO'] = (input: Value | null, { material }: { material: { transparent: boolean } }) => (material.transparent === true ? input : input !== null ? input.mul(ao) : ao);
      if (contact && contactLight) value['getShadow'] = ({ light, shadowColorNode }: { light: unknown; shadowColorNode: Value }) => (light === contactLight ? shadowColorNode.mul(contact) : shadowColorNode);
      scenePass.contextNode = (context as unknown as (v: Record<string, unknown>) => typeof scenePass.contextNode)(value);
    }
    const color = scenePass.getTextureNode('output');
    // Scene pass at a lower resolution than the frame (motion only): upsampled bilinearly, then sharpened against the four
    // neighbours, limited to their range so a bright edge does not ring (contrast adaptive sharpening on the linear image).
    const uSharp = uniform(0);
    const uTexel = uniform(new three.Vector2(0, 0));
    let hdr = color.rgb;
    if (!prepass) {
      const c = color.rgb;
      const up = color.sample(screenUV.add(vec2(0, uTexel.y))).rgb;
      const down = color.sample(screenUV.sub(vec2(0, uTexel.y))).rgb;
      const right = color.sample(screenUV.add(vec2(uTexel.x, 0))).rgb;
      const left = color.sample(screenUV.sub(vec2(uTexel.x, 0))).rgb;
      const lo = min(min(min(up, down), min(left, right)), c);
      const hi = max(max(max(up, down), max(left, right)), c);
      const blur = up.add(down).add(left).add(right).mul(0.25);
      hdr = clamp(c.add(c.sub(blur).mul(uSharp)), lo, hi);
    }
    // One bounce of the lit scene: the sunlit floor patch lights the walls and the ceiling above it, a
    // bright wall tints its neighbours. The bounce is the lit colour gathered around each pixel times the
    // surface's own albedo (so a white ceiling takes the floor's warmth and a dark one stays dark).
    if (effects.gi && ssgiMod && prePass && prePassDepth && prePassNormal) {
      const giPass = ssgiMod.ssgi(color, prePassDepth, prePassNormal as unknown as Parameters<typeof ssgiMod.ssgi>[2], camera as PerspectiveCamera);
      giPass.sliceCount.value = GI_TUNING.slices;
      giPass.stepCount.value = GI_TUNING.steps;
      giPass.radius.value = GI_TUNING.radius;
      giPass.thickness.value = GI_TUNING.thickness;
      giPass.giIntensity.value = GI_TUNING.intensity * ((globalThis as { __GI?: number }).__GI ?? 1);
      giPass.radius.value = GI_TUNING.radius * ((globalThis as { __GIR?: number }).__GIR ?? 1);
      giPass.aoIntensity.value = 0;
      giPass.useTemporalFiltering = effects.taa;
      const albedo = prePass.getTextureNode('diffuse');
      hdr = hdr.add(albedo.rgb.mul(giPass.getGINode().rgb));
      disposables.push(giPass);
    }
    // Screen-space reflections of the opaque scene (glass, polished floors, water, metals).
    if (effects.ssr && ssrMod && prePass && prePassDepth && prePassNormal) {
      const materialTex = prePass.getTextureNode('material');
      const ssrPass = ssrMod.ssr(color, prePassDepth, prePassNormal as unknown as Parameters<typeof ssrMod.ssr>[2], { metalnessNode: materialTex.r, roughnessNode: materialTex.g, reflectNonMetals: true, camera });
      ssrPass.resolutionScale = SSR_TUNING.resolutionScale;
      ssrPass.maxDistance.value = SSR_TUNING.maxDistance;
      ssrPass.thickness.value = SSR_TUNING.thickness;
      ssrPass.intensity.value = SSR_TUNING.intensity;
      ssrPass.quality.value = SSR_TUNING.quality;
      hdr = hdr.add(ssrPass.getTextureNode().rgb);
      disposables.push(ssrPass);
    }
    // Sun shafts ray-marched through the sun's shadow map, blended depth-aware (no halos on edges).
    if (sun && godMod && blendMod && prePassDepth) {
      const shafts = godMod.godrays(prePassDepth, camera, sun);
      shafts.raymarchSteps.value = SHAFT_TUNING.steps;
      shafts.density.value = SHAFT_TUNING.density;
      shafts.maxDensity.value = SHAFT_TUNING.maxDensity;
      shafts.distanceAttenuation.value = SHAFT_TUNING.distanceAttenuation;
      shafts.resolutionScale = SHAFT_TUNING.resolutionScale;
      const shaftColor = new Color(sun.color).multiplyScalar(SHAFT_TUNING.brightness);
      const blendInput = convertToTexture(vec4(hdr, 1));
      const blended = blendMod.depthAwareBlend(blendInput, shafts.getTextureNode(), prePassDepth, camera, { blendColor: vec3(shaftColor.r, shaftColor.g, shaftColor.b), edgeRadius: 2, edgeStrength: 2 });
      hdr = blended.rgb;
      // The render-to-texture node owns a target of its own: release it with the chain.
      disposables.push(shafts, blendInput);
    }
    const bloomNode = bloom(color, bloomStrength(strength), BLOOM_RADIUS, BLOOM_THRESHOLD);
    disposables.push(bloomNode);
    hdr = hdr.add(bloomNode.rgb);
    if (effects.halation) {
      const halo = bloom(color, HALATION_TUNING.strength, HALATION_TUNING.radius, HALATION_TUNING.threshold);
      disposables.push(halo);
      // Film halation is red-orange: the wide glow bleeds through the emulsion.
      hdr = hdr.add(halo.rgb.mul(vec3(1.0, 0.55, 0.32)));
    }
    let image = vec4(hdr, color.a);
    // Depth of field around the orbit target (final stills).
    const uFocus = uniform(10);
    const uRange = uniform(6);
    const uBokeh = uniform(2.2);
    if (effects.dof && dofMod && prePass) {
      const viewZ = prePass.getViewZNode('depth');
      // The node's own render-to-texture input is not released by the node's dispose: keep a handle to free it.
      const dofInput = convertToTexture(image);
      const blurred = dofMod.dof(dofInput, viewZ, uFocus, uRange, uBokeh);
      image = vec4((blurred as unknown as { rgb: typeof hdr }).rgb, color.a);
      disposables.push(blurred, dofInput);
    }
    if (effects.aberration && caMod) {
      const strengthNode = uniform(ABERRATION_STRENGTH * 10);
      const caCentre = vec2(0.5, 0.5);
      const caInput = convertToTexture(image);
      const ca = caMod.chromaticAberration(caInput, strengthNode, caCentre, float(1.1));
      image = vec4((ca as unknown as { rgb: typeof hdr }).rgb, color.a);
      disposables.push(ca, caInput);
    }
    const uVignette = uniform(VIGNETTE_STRENGTH);
    const vignette = float(1).sub(smoothstep(float(VIGNETTE_RANGE[0]), float(VIGNETTE_RANGE[1]), screenUV.sub(0.5).length()).mul(uVignette));
    // Grade in linear HDR before the output transform: exposure, white balance, split tone, saturation, contrast pivot.
    const uSat = uniform(NEUTRAL_GRADE.saturation);
    const uContrast = uniform(NEUTRAL_GRADE.contrast);
    const uExposure = uniform(1);
    const uBalance = uniform(new Vector3(1, 1, 1));
    const uShadow = uniform(new Vector3(1, 1, 1));
    const uHigh = uniform(new Vector3(1, 1, 1));
    const luma = dot(image.rgb, vec3(0.2126, 0.7152, 0.0722));
    const toned = image.rgb.mul(uExposure).mul(uBalance).mul(mix(uShadow, uHigh, smoothstep(float(0.02), float(0.6), luma)));
    const toneLuma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
    const saturated = max(mix(vec3(toneLuma), toned, uSat), vec3(0));
    const pivot = float(0.18);
    const contrasted = pow(saturated.div(pivot).add(1e-5), vec3(uContrast)).mul(pivot);
    const graded = clamp(contrasted, vec3(0), vec3(64)).mul(vignette);
    const gradedNode = vec4(graded, color.a);
    let output: ReturnType<typeof vec4> = gradedNode;
    if (effects.taa && traaMod && prePassDepth && prePassVelocity) {
      // The graded image as a texture of our own, so its render target is disposed with the pipeline.
      const beauty = convertToTexture(gradedNode);
      const traaNode = traaMod.traa(beauty, prePassDepth, prePassVelocity, camera);
      // The placeholder depth texture is replaced after the first frame: keep a handle to free it.
      const placeholder = (traaNode as unknown as { _previousDepthNode?: { value?: { dispose?: () => void } } })._previousDepthNode?.value;
      disposables.push(beauty, traaNode, { dispose: () => disposeTraaTextures(traaNode, placeholder) });
      output = vec4(traaNode.rgb, color.a);
    }
    const uGrain = uniform(effects.grain ? GRAIN_AMPLITUDE : 0);
    const uSeed = uniform(0);
    const pipeline = new RenderPipeline(renderer);
    if (effects.grain) {
      // Tone curve and sRGB first, then grain in display space: it dithers 8-bit banding and sells the "photograph".
      pipeline.outputColorTransform = false;
      const mapped = renderOutput(output);
      const noise = interleavedGradientNoise(screenCoordinate.add(vec2(uSeed.mul(5.588238), uSeed.mul(2.7132)))).sub(0.5);
      pipeline.outputNode = vec4(mapped.rgb.add(noise.mul(uGrain)), mapped.a);
    } else {
      pipeline.outputNode = output;
    }
    let seed = 0;
    let sceneScale = 1;
    return {
      sceneScalable: !prepass,
      setSceneScale: (scale: number, width: number, height: number) => {
        if (prepass) return;
        const k = Number.isFinite(scale) ? Math.max(0.25, Math.min(1, scale)) : 1;
        if (k === sceneScale && uTexel.value.x > 0) return;
        sceneScale = k;
        scenePass.setResolutionScale(k);
        // One texel of the scaled target in frame UV units; the sharpening fades out as the scale nears 1.
        uTexel.value.set(1 / Math.max(1, Math.floor(width * k)), 1 / Math.max(1, Math.floor(height * k)));
        uSharp.value = k >= 0.98 ? 0 : SCENE_SHARPEN;
      },
      quality: prepass ? 'studio' : 'standard',
      effects,
      key: effectsKey(effects),
      render: () => {
        seed = (seed + 1) % 4096;
        uSeed.value = seed;
        pipeline.render();
      },
      setBloom: (s: number) => {
        bloomNode.strength.value = bloomStrength(s);
      },
      setGrade: (g: Grade) => {
        uSat.value = g.saturation;
        uContrast.value = g.contrast;
        uExposure.value = g.exposure ?? 1;
        const wb = g.balance ?? [1, 1, 1];
        uBalance.value.set(wb[0], wb[1], wb[2]);
        uShadow.value.set(...g.shadowTint);
        uHigh.value.set(...g.highlightTint);
        if (effects.grain) uGrain.value = GRAIN_AMPLITUDE * (g.grain ?? 1);
      },
      setVignette: (strength: number) => {
        uVignette.value = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : VIGNETTE_STRENGTH;
      },
      setAo: (t) => setAo(t),
      setFocus: (distance: number) => {
        const p = dofParams(distance);
        uFocus.value = p.focus;
        uRange.value = p.range;
        uBokeh.value = p.bokeh;
      },
      dispose: () => {
        pipeline.dispose();
        for (const d of disposables) d.dispose();
      },
    };
  } catch (e) {
    log.warn(`post-processing (${effectsKey(effects)}) disabled: ${errorMessage(e)}`);
    return null;
  }
}
