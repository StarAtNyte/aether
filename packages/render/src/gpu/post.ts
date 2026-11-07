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
import type { Camera, DirectionalLight, PerspectiveCamera, RenderTarget, Scene, ToneMapping } from 'three';
import type { Node as TslNode, WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';
import { ABERRATION_STRENGTH, GRAIN_AMPLITUDE, effectsKey, needsPrePass, type PostEffects } from './finishing';
import { NEUTRAL_GRADE, type Grade } from './grade';
import { createUpsampler, type Upsampler } from './upsample';
import { installAgxLook } from './agx-look';
import { resolveSatsuei, type SatsueiState } from './satsuei';

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
  /**
   * The scene pass's target, for a compile walk to prepare the very render objects the pass draws (a compile to the canvas
   * builds a set that is never drawn while the chain runs). Null when the pass changes the materials' context (occlusion in
   * the materials): a compile without that context would not match either.
   */
  readonly compileTarget: RenderTarget | null;
  setBloom(strength: number): void;
  /**
   * Scale the sun shafts (1: as tuned). From a drone's height every ray of the view crosses long stretches of sunlit air and
   * the shafts' in-scatter became one uniform veil of the sun's colour over the whole ground: the caller lowers it with height.
   */
  setShaftScale(scale: number): void;
  /** Apply a colour grade (uniform updates only; no shader rebuild). */
  setGrade(grade: Grade): void;
  /**
   * The renderer's tone-mapping constant for AgX with the grade's look (see `agx-look.ts`), or null when it could not be
   * installed (the plain AgX curve is used then).
   */
  readonly agxToneMapping: ToneMapping | null;
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
  /** The compositing layer of a painted world (uniforms only; no-op unless built with `effects.satsuei`). */
  setSatsuei(state: SatsueiState): void;
  dispose(): void;
}

/**
 * Bloom tuning. The threshold sits above the brightest diffusely lit
 * surface (white albedo under a full sun ≈ 0.8 linear), so only emissive
 * materials, the sun disc and sharp specular glints bloom.
 */
const BLOOM_RADIUS = 0.35;
/** Strength of the sharpening of the temporal AA's resolved image (0 = none). */
export const TAA_SHARPEN = 0.45;
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
  /**
   * Occlusion and contact shadows multiply the composite instead of entering every lit material. For a split chain
   * (motion phase without them): in the materials they made each lit material a program of its own per phase, a third of
   * the programs of a world (306 against 157 on a terrace town), with their memory and a link on the first turn.
   */
  screenOcclusion?: boolean;
  /**
   * Runs the effect passes (after the scene passes) with their programs linked on the spot. The passes are a handful of
   * small full-screen programs; drawn while still linking they were skipped, and the first frame of a chain (the first
   * turn of the camera) composited empty targets: a black or orange flash.
   */
  linkNow?: (run: () => void) => void;
  /** Direction toward the sun the compositing layer's rays and flare come from (world space; read every frame). */
  satsueiSun?: () => readonly [number, number, number] | null;
}

/**
 * The compositing layer (see `satsuei.ts`). Gains turn the 0..1 amounts into the shader's units; the light rays are a
 * radial blur of the bright sky round the sun at a quarter of the frame's resolution, `rayTaps` samples per texel.
 */
export const SATSUEI_TUNING = Object.freeze({
  /** Bloom high pass of the diffusion glow: linear luminance where it starts and where it is full, and its gain at amount 1. */
  diffusionLo: 0.6,
  diffusionHi: 1.4,
  diffusionGain: 0.3,
  rayTaps: 24,
  rayScale: 0.25,
  /** Luminance of the sky that sheds rays (start, full), how tightly round the sun (per frame-height unit), the gain. */
  rayLo: 0.7,
  rayHi: 1.4,
  rayFocus: 5,
  rayGain: 0.9,
  flareGain: 0.6,
  dustGain: 0.9,
  /** Display-space grain amplitude at amount 1. */
  grainGain: 0.04,
  /** Corner fringe (UV units at the corner) at amount 1. */
  chromaGain: 0.012,
});

/** Lens-flare ghosts: position along the sun-centre axis (1 = the centre), radius (frame heights), colour, weight. */
const FLARE_GHOSTS: ReadonlyArray<{ t: number; r: number; c: [number, number, number]; w: number }> = [
  { t: 0.5, r: 0.035, c: [1.0, 0.72, 0.42], w: 0.35 },
  { t: 1.3, r: 0.028, c: [0.55, 0.8, 1.0], w: 0.4 },
  { t: 1.62, r: 0.075, c: [0.8, 0.6, 1.0], w: 0.22 },
  { t: 2.05, r: 0.13, c: [0.55, 0.95, 0.75], w: 0.12 },
];

/** Share of the occlusion and of the contact shadows kept when they multiply the composite (see PostOptions.screenOcclusion). */
const SCREEN_AO_WEIGHT = 0.7;
const SCREEN_CONTACT_WEIGHT = 0.5;

const COMPOSITE_ONLY: PostEffects = Object.freeze({ composite: true, ao: false, gi: false, taa: false, contact: false, ssr: false, shafts: false, halation: false, aberration: false, grain: false, dof: false });

/** Build the pipeline, or null when unsupported. */
export async function createPostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, strength: number, quality: PostQuality = 'standard', opts: PostOptions = {}): Promise<PostPipeline | null> {
  const effects: PostEffects = opts.effects ?? (quality === 'studio' ? { ...COMPOSITE_ONLY, ao: true, taa: true } : COMPOSITE_ONLY);
  try {
    const prepass = needsPrePass(effects);
    const sun = effects.shafts && opts.sun?.castShadow ? opts.sun : null;
    const contactLight = effects.contact && opts.contactLight?.castShadow ? opts.contactLight : null;
    const [three, tsl, bloomMod, gtao, denoiseMod, ssgiMod, traaMod, ssrMod, godMod, blendMod, dofMod, caMod, sssMod] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
      effects.ao ? import('three/addons/tsl/display/GTAONode.js') : Promise.resolve(null),
      effects.ao && !effects.taa ? import('three/addons/tsl/display/DenoiseNode.js') : Promise.resolve(null),
      effects.gi ? import('three/addons/tsl/display/SSGINode.js') : Promise.resolve(null),
      effects.taa ? import('three/addons/tsl/display/TRAANode.js') : Promise.resolve(null),
      effects.ssr ? import('three/addons/tsl/display/SSRNode.js') : Promise.resolve(null),
      sun ? import('three/addons/tsl/display/GodraysNode.js') : Promise.resolve(null),
      sun ? import('three/addons/tsl/display/depthAwareBlend.js') : Promise.resolve(null),
      effects.dof ? import('three/addons/tsl/display/DepthOfFieldNode.js') : Promise.resolve(null),
      effects.aberration ? import('three/addons/tsl/display/ChromaticAberrationNode.js') : Promise.resolve(null),
      contactLight ? import('three/addons/tsl/display/SSSNode.js') : Promise.resolve(null),
    ]);
    const { RenderPipeline, Vector2, Vector3, UnsignedByteType, HalfFloatType, RGFormat, Color } = three;
    const { Fn, luminance, exp, length, floor, fract, sin, step, pass, screenUV, screenSize, screenCoordinate, smoothstep, float, uniform, vec2, vec3, vec4, dot, mix, pow, max, min, clamp, mrt, packNormalToRGB, unpackRGBToNormal, normalView, velocity, sample, context, diffuseColor, convertToTexture, renderOutput, interleavedGradientNoise, metalness, roughness } = tsl;
    const { bloom } = bloomMod;
    const agxLook = installAgxLook(renderer, three, tsl);
    const disposables: Array<{ dispose(): void }> = [];
    // Temporal AA replaces MSAA (its history needs single-sampled targets); without it the scene pass keeps MSAA.
    const variant = (globalThis as { __UPVAR?: string }).__UPVAR ?? 'taau:bilin:cross:hcr:w15';
    // The temporal pass reads the scene pass's depth, which a multisampled pass only resolves on the WebGL2 backend (WebGPU keeps the
    // spatial filter and MSAA until its depth read is tested).
    const temporalOk = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend?.isWebGPUBackend !== true;
    const temporalScene = !needsPrePass(effects) && temporalOk && variant.startsWith('taau');
    // MSAA stays: cut-out foliage is alpha-to-coverage, which without multisampling came out as bright speckle (measured, see the review log).
    // The motion phase of a split chain (screenOcclusion) draws single-sampled too, its temporal upsampler resolving the edges:
    // three keys render state by sample count, and an MSAA motion pass beside the TAA rest pass gave every mesh a second
    // set of render objects and bindings (2 GB of page heap on a cliff town, the tab out of memory).
    const singleSampled = effects.taa || (opts.screenOcclusion === true && temporalScene);
    const scenePass = singleSampled ? pass(scene, camera, { samples: 0 }) : pass(scene, camera);
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
      // The normals stay in the pass's own half-float type: set to 8-bit, the target came back to half float after its
      // first frames, and three keys render state by the target's type, so every mesh was built a second time for the
      // pre-pass (830 objects on a hillside town). Four more bytes a pixel for one target.
      void normalTexture;
      if (effects.ssr) {
        // Reflections consume only metalness and roughness; preserve their 8-bit precision without unused BA channels.
        const materialTexture = prePass.getTexture('material');
        materialTexture.type = UnsignedByteType;
        materialTexture.format = RGFormat;
      }
      const pp = prePass;
      prePassNormal = sample((uv) => unpackRGBToNormal(pp.getTextureNode().sample(uv)));
      prePassDepth = prePass.getTextureNode('depth');
      if (effects.taa) {
        // Motion is signed NDC displacement. Cloning the 8-bit normal target would clamp negative motion to zero.
        // RG16F keeps both signed components at the same four bytes per pixel as RGBA8.
        const motionTexture = prePass.getTexture('velocity');
        motionTexture.type = HalfFloatType;
        motionTexture.format = RGFormat;
        prePassVelocity = prePass.getTextureNode('velocity');
      }
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
      if (denoiseMod) {
        // Without temporal AA the occlusion is resolved in the frame: a depth- and normal-aware blur takes the noise out (nothing crawls).
        const denoised = denoiseMod.denoise(aoPass.getTextureNode(), prePassDepth, prePassNormal, camera);
        denoised.index.value = 0;
        denoised.radius.value = 4;
        aoValue = (denoised as unknown as { r: Value }).r;
      } else aoValue = aoPass.getTextureNode().sample(screenUV).r as unknown as Value;
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
    if ((aoValue || contactValue) && !opts.screenOcclusion) {
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
    let upsampler: Upsampler | null = null;
    if (!prepass && variant !== 'old' && variant !== 'bilinear') {
      upsampler = createUpsampler(three, tsl, renderer, scenePass, camera, temporalScene, variant);
      disposables.push(upsampler);
      hdr = upsampler.rgb;
    } else if (!prepass) {
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
    if (opts.screenOcclusion) {
      // On the whole picture, direct light included: softer than in the materials, where they shade the ambient (and the
      // sun's direct light) only.
      if (aoValue) hdr = hdr.mul(mix(float(1), aoValue, SCREEN_AO_WEIGHT));
      if (contactValue) hdr = hdr.mul(mix(float(1), contactValue, SCREEN_CONTACT_WEIGHT));
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
    // Without a pre-pass (the motion phase of a split chain) the shafts march the scene pass's own depth: the haze is most
    // of a golden-hour picture's tone, and dropping it while the camera moved made every start and stop of the view a
    // visible jump between a warm and a cold picture.
    const shaftDepth = prePassDepth ?? (sun ? scenePass.getTextureNode('depth') : null);
    /** The shafts pass, run in order with the other passes (see render). */
    let shaftsPass: unknown = null;
    let shaftNodes: { density: { value: number }; maxDensity: { value: number } } | null = null;
    if (sun && godMod && blendMod && shaftDepth) {
      const shafts = godMod.godrays(shaftDepth, camera, sun);
      shaftsPass = shafts;
      shafts.raymarchSteps.value = SHAFT_TUNING.steps;
      shafts.density.value = SHAFT_TUNING.density;
      shafts.maxDensity.value = SHAFT_TUNING.maxDensity;
      shafts.distanceAttenuation.value = SHAFT_TUNING.distanceAttenuation;
      shafts.resolutionScale = SHAFT_TUNING.resolutionScale;
      shaftNodes = shafts as unknown as { density: { value: number }; maxDensity: { value: number } };
      const shaftColor = new Color(sun.color).multiplyScalar(SHAFT_TUNING.brightness);
      if (prepass) {
        const blendInput = convertToTexture(vec4(hdr, 1));
        const blended = blendMod.depthAwareBlend(blendInput, shafts.getTextureNode(), shaftDepth, camera, { blendColor: vec3(shaftColor.r, shaftColor.g, shaftColor.b), edgeRadius: 2, edgeStrength: 2 });
        hdr = blended.rgb;
        // The render-to-texture node owns a target of its own: release it with the chain.
        disposables.push(shafts, blendInput);
      } else {
        // The motion phase: the same mix (picture toward the sun's colour by the shafts' amount) straight on the picture.
        // The depth-aware blend reads the picture through a target of its own, which came out empty on the frame the
        // resolution scale changed (a dark frame); its edge refinement is invisible at motion resolution anyway.
        hdr = mix(hdr, vec3(shaftColor.r, shaftColor.g, shaftColor.b), shafts.getTextureNode().sample(screenUV).r);
        disposables.push(shafts);
      }
    }
    const sats = effects.satsuei === true;
    const T = SATSUEI_TUNING;
    // Compositing-layer uniforms (only read by the nodes built when `sats`).
    const uHard = uniform(bloomStrength(strength));
    const uSoft = uniform(0);
    const uSunUV = uniform(new Vector2(0.5, 0.25));
    const uRays = uniform(0);
    const uFlare = uniform(0);
    const uDust = uniform(0);
    const uChroma = uniform(0);
    const uSatGrain = uniform(0);
    const uGradTop = uniform(new Vector3(0.5, 0.5, 0.5));
    const uGradBottom = uniform(new Vector3(0.5, 0.5, 0.5));
    const uGradAmount = uniform(0);
    const uLetterbox = uniform(0);
    const uTime = uniform(0);
    let satsState: SatsueiState = resolveSatsuei(null, null);
    type Tex = { sample(uv: unknown): ReturnType<typeof vec4> };
    let raysTexture: (Tex & { autoUpdate: boolean }) | null = null;
    const aspect = screenSize.x.div(screenSize.y);
    const toSun = (p: TslNode<'vec2'>): TslNode<'float'> => length(p.sub(uSunUV).mul(vec2(aspect, 1)));
    if (sats) {
      // Corner fringe: red pushed out and blue pulled in, growing with the square of the distance from the centre.
      const off = screenUV.sub(0.5);
      const shift = off.mul(dot(off, off).mul(uChroma));
      hdr = hdr.add(vec3(color.sample(screenUV.add(shift)).r.sub(color.r), 0, color.sample(screenUV.sub(shift)).b.sub(color.b)));
    }
    const bloomNode = bloom(color, bloomStrength(strength), BLOOM_RADIUS, BLOOM_THRESHOLD);
    disposables.push(bloomNode);
    if (sats) {
      // One bloom carries both: what is brighter than white at the bloom strength, and the bright mid-tones at the diffusion's.
      const highPass = Fn(({ input, threshold, smoothWidth }: { input: ReturnType<typeof vec4>; threshold: Value; smoothWidth: Value }) => {
        const v = luminance(input.rgb);
        const hard = smoothstep(threshold, threshold.add(smoothWidth), v);
        const soft = smoothstep(float(T.diffusionLo), float(T.diffusionHi), v);
        return vec4(input.rgb.mul(hard.mul(uHard).add(soft.mul(uSoft))), 1);
      });
      (bloomNode as unknown as { highPassFn: unknown }).highPassFn = highPass;
      bloomNode.strength.value = 1;
    }
    hdr = hdr.add(bloomNode.rgb);
    if (sats) {
      // Light rays: each texel gathers the bright sky round the sun along its line to the sun (a quarter-resolution pass).
      const rays = Fn(() => {
        const uv = screenUV;
        const delta = uSunUV.sub(uv);
        const jitter = interleavedGradientNoise(screenCoordinate);
        let acc: TslNode<'vec3'> = vec3(0);
        for (let i = 0; i < T.rayTaps; i++) {
          const p = uv.add(delta.mul(float(i).add(jitter).div(T.rayTaps)));
          const c = color.sample(p).rgb;
          const inside = step(0, p.x).mul(step(p.x, 1)).mul(step(0, p.y)).mul(step(p.y, 1));
          const mask = smoothstep(float(T.rayLo), float(T.rayHi), luminance(c)).mul(exp(toSun(p).mul(-T.rayFocus))).mul(inside);
          acc = acc.add(min(c, vec3(1.5)).mul(mask));
        }
        return vec4(acc.div(T.rayTaps).mul(exp(toSun(uv).mul(-2))), 1);
      })();
      const raysRtt = convertToTexture(rays) as unknown as Tex & { setResolutionScale(s: number): void; autoUpdate: boolean; dispose(): void };
      raysRtt.setResolutionScale(T.rayScale);
      raysTexture = raysRtt;
      disposables.push(raysRtt);
      hdr = hdr.add(raysRtt.sample(screenUV).rgb.mul(uRays));
    }
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
      // The temporal resolve blends sub-pixel jittered frames, which softens the whole picture a little (texture detail and
      // thin edges a step blurrier than the MSAA tiers). A light sharpen of the resolved image against its four neighbours,
      // limited to their range so nothing rings, gives the detail back (contrast-limited, like AMD's CAS).
      const resolved = (traaNode as unknown as { getTextureNode(): typeof color }).getTextureNode();
      const px = vec2(float(1).div(screenSize.x), float(1).div(screenSize.y));
      const c = resolved.sample(screenUV).rgb;
      const n = resolved.sample(screenUV.add(vec2(0, px.y))).rgb;
      const s = resolved.sample(screenUV.sub(vec2(0, px.y))).rgb;
      const e = resolved.sample(screenUV.add(vec2(px.x, 0))).rgb;
      const w = resolved.sample(screenUV.sub(vec2(px.x, 0))).rgb;
      const lo = min(min(min(n, s), min(e, w)), c);
      const hi = max(max(max(n, s), max(e, w)), c);
      const sharpened = clamp(c.add(c.sub(n.add(s).add(e).add(w).mul(0.25)).mul(TAA_SHARPEN)), lo, hi);
      output = vec4(sharpened, color.a);
    }
    const uGrain = uniform(effects.grain ? GRAIN_AMPLITUDE : 0);
    const uSeed = uniform(0);
    const pipeline = new RenderPipeline(renderer);
    if (sats) {
      // Lens flare and dust over the resolved picture (after the temporal AA, which would smear what moves on its own).
      const ax = vec2(0.5, 0.5).sub(uSunUV);
      const d0 = toSun(screenUV);
      // The sun is hidden behind a roof or a cloud: the picture at its position is no longer brighter than white.
      const sunSeen = smoothstep(float(0.8), float(2.5), luminance(color.sample(uSunUV).rgb));
      let flare: TslNode<'vec3'> = vec3(0);
      for (const g of FLARE_GHOSTS) {
        const d = length(screenUV.sub(uSunUV.add(ax.mul(g.t))).mul(vec2(aspect, 1)));
        // A soft disc with a slightly brighter rim.
        const disc = smoothstep(float(g.r), float(g.r * 0.55), d).mul(0.7).add(smoothstep(float(g.r * 0.12), float(0), d.sub(g.r * 0.9).abs()).mul(0.3));
        flare = flare.add(vec3(...g.c).mul(disc.mul(g.w)));
      }
      // A veiling glow round the sun and a faint ring.
      flare = flare.add(vec3(1.0, 0.78, 0.55).mul(exp(d0.mul(-7)).mul(0.12).add(exp(d0.sub(0.36).div(0.025).pow(2).negate()).mul(0.03))));
      flare = flare.mul(uFlare.mul(sunSeen).mul(T.flareGain));
      // Dust motes: two layers of cells drifting up and across, one mote in some cells, lit by the rays and the glow round the sun.
      const raysAt = raysTexture ? raysTexture.sample(screenUV).rgb : vec3(0);
      const light = luminance(raysAt).mul(3).add(exp(d0.mul(-2.5)).mul(0.4)).add(0.02);
      const hash = (p: TslNode<'vec2'>, k: number): TslNode<'float'> => fract(sin(dot(p, vec2(127.1 + k, 311.7 - k))).mul(43758.5453));
      let motes: TslNode<'float'> = float(0);
      for (const [cells, sx, sy, size, k, density] of [[14, 0.004, -0.007, 0.1, 1, 0.8], [30, -0.002, -0.004, 0.08, 9, 0.9]] as const) {
        const q = screenUV.mul(vec2(aspect, 1)).add(vec2(uTime.mul(sx), uTime.mul(sy))).mul(cells);
        const cell = floor(q);
        const f = fract(q);
        const h1 = hash(cell, k);
        const h2 = hash(cell, k + 3.1);
        const h3 = hash(cell, k + 7.7);
        const centre = vec2(h1, h2).mul(0.6).add(0.2).add(vec2(sin(uTime.mul(0.6).add(h3.mul(6.283))), sin(uTime.mul(0.45).add(h1.mul(6.283)))).mul(0.12));
        const r = float(size).mul(h3.mul(0.6).add(0.4));
        const twinkle = sin(uTime.mul(h2.mul(1.5).add(0.8)).add(h1.mul(6.283))).mul(0.35).add(0.65);
        motes = motes.add(smoothstep(r, float(0), length(f.sub(centre))).mul(step(density, h3)).mul(twinkle));
      }
      const dust = vec3(1.0, 0.86, 0.66).mul(motes.mul(light).mul(uDust).mul(T.dustGain));
      pipeline.outputColorTransform = false;
      const mapped = renderOutput(vec4(output.rgb.add(flare).add(dust), output.a));
      // The gradient layer in display space (soft light: mid grey leaves the picture as it is).
      const gc = mix(uGradTop, uGradBottom, screenUV.y);
      const c = clamp(mapped.rgb, vec3(0), vec3(1));
      const softLight = vec3(1).sub(gc.mul(2)).mul(c.mul(c)).add(gc.mul(2).mul(c));
      let shown: TslNode<'vec3'> = mix(c, softLight, uGradAmount);
      const noise = interleavedGradientNoise(screenCoordinate.add(vec2(uSeed.mul(5.588238), uSeed.mul(2.7132)))).sub(0.5);
      shown = shown.add(noise.mul(uSatGrain));
      // Letterbox toward 2.39:1, its edge one pixel soft.
      const bar = max(float(0), float(1).sub(aspect.div(2.39)).mul(0.5)).mul(uLetterbox);
      const edge = float(1).div(screenSize.y);
      const y = screenUV.y;
      const open = smoothstep(bar, bar.add(edge), y).mul(smoothstep(bar, bar.add(edge), float(1).sub(y)));
      pipeline.outputNode = vec4(shown.mul(mix(float(1), open, step(1e-4, uLetterbox))), mapped.a);
    } else if (effects.grain) {
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
    const sunPoint = new Vector3();
    const sunView = new Vector3();
    const t0 = performance.now();
    /** The compositing layer's per-frame uniforms: the sun's place on the frame (and how far it is off it), the clock. */
    const satsueiFrame = (): void => {
      const light = opts.sun;
      const dir = opts.satsueiSun?.() ?? (light ? [light.position.x - light.target.position.x, light.position.y - light.target.position.y, light.position.z - light.target.position.z] : null);
      uTime.value = (performance.now() - t0) / 1000;
      let rays = 0;
      let flare = 0;
      if (dir) {
        sunView.set(dir[0], dir[1], dir[2]).normalize().transformDirection(camera.matrixWorldInverse);
        if (sunView.z < -1e-3) {
          sunPoint.set(dir[0], dir[1], dir[2]).normalize().multiplyScalar(1000).add(camera.position).project(camera);
          const u = sunPoint.x * 0.5 + 0.5;
          const v = 0.5 - sunPoint.y * 0.5;
          uSunUV.value.set(u, v);
          const out = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
          const fade = (a: number, b: number): number => Math.max(0, Math.min(1, (b - out) / (b - a)));
          rays = fade(0.5, 1.1) * Math.min(1, -sunView.z * 4);
          flare = fade(0.48, 0.56);
        }
      }
      uRays.value = satsState.godRays * T.rayGain * rays;
      uFlare.value = satsState.flare * flare;
      if (raysTexture) raysTexture.autoUpdate = uRays.value > 0 || satsState.dust > 0;
    };
    /** One frame of the chain: the scene passes first, then the effects. */
    const renderOnce = (): void => {
      seed = (seed + 1) % 4096;
      uSeed.value = seed;
      if (sats) satsueiFrame();
      upsampler?.begin();
      try {
        // The scene passes first, from the top: three keys render state (and with it every mesh's render objects and
        // node builds) by call depth too, and inside the chain the scene pass ran at whatever depth the first effect that
        // read it reached (1 in the motion phase, 2 to 5 at rest): each phase built every mesh again (3,000 objects, a
        // minute of a hillside town's load). Once per frame either way: the chain then finds them done.
        const frame = (renderer as unknown as { _nodes?: { nodeFrame?: { renderer?: unknown; updateBeforeNode?: (n: unknown) => void } } })._nodes?.nodeFrame;
        if (frame?.updateBeforeNode && (globalThis as { __AETHER_PASS_FIRST?: boolean }).__AETHER_PASS_FIRST !== false) {
          frame.renderer ??= renderer;
          if (prePass) frame.updateBeforeNode(prePass);
          frame.updateBeforeNode(scenePass);
          // The upsampler next: the shafts blend reads its output through a target of its own, and on the frame the
          // resolution scale switched it on (new, empty targets) it read them before the resolve: a dark frame.
          // Its full-screen pass draws only while it is on, so its program is first needed the moment the resolution scale
          // falls: linked on the spot here (with the shafts after it), not skipped as still linking, which showed one
          // black frame with only the lamps' bloom.
          const passes = (): void => {
            if (upsampler?.pass) frame.updateBeforeNode!(upsampler.pass);
            if (shaftsPass && !prePass) frame.updateBeforeNode!(shaftsPass);
          };
          if (opts.linkNow) opts.linkNow(passes);
          else passes();
        }
        if (opts.linkNow) opts.linkNow(() => pipeline.render());
        else pipeline.render();
      } finally {
        upsampler?.end();
      }
    };
    return {
      sceneScalable: !prepass,
      setSceneScale: (scale: number, width: number, height: number) => {
        if (prepass) return;
        const k = Number.isFinite(scale) ? Math.max(0.15, Math.min(1, scale)) : 1;
        if (k === sceneScale && uTexel.value.x > 0) return;
        sceneScale = k;
        scenePass.setResolutionScale(k);
        // One texel of the scaled target in frame UV units; the sharpening fades out as the scale nears 1.
        uTexel.value.set(1 / Math.max(1, Math.floor(width * k)), 1 / Math.max(1, Math.floor(height * k)));
        uSharp.value = k >= 0.98 || variant === 'bilinear' ? 0 : SCENE_SHARPEN;
        upsampler?.setScale(k, Math.max(1, Math.floor(width * k)), Math.max(1, Math.floor(height * k)), width, height);
      },
      get compileTarget() { return scenePass.contextNode === null ? (scenePass as unknown as { renderTarget: RenderTarget }).renderTarget : null; },
      quality: prepass ? 'studio' : 'standard',
      agxToneMapping: agxLook?.toneMapping ?? null,
      effects,
      key: effectsKey(effects),
      render: () => {
        renderOnce();
      },
      setBloom: (s: number) => {
        if (sats) uHard.value = bloomStrength(s);
        else bloomNode.strength.value = bloomStrength(s);
      },
      setSatsuei: (st: SatsueiState) => {
        if (!sats) return;
        satsState = st;
        uSoft.value = st.diffusion * T.diffusionGain;
        uDust.value = st.dust;
        uChroma.value = st.chroma * T.chromaGain;
        uSatGrain.value = st.grain * T.grainGain;
        uGradTop.value.set(...st.gradientTop);
        uGradBottom.value.set(...st.gradientBottom);
        uGradAmount.value = st.gradientAmount;
        uLetterbox.value = st.letterbox;
      },
      setShaftScale: (k: number) => {
        if (!shaftNodes) return;
        const f = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 1;
        shaftNodes.density.value = SHAFT_TUNING.density * f;
        shaftNodes.maxDensity.value = SHAFT_TUNING.maxDensity * f;
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
        agxLook?.set(g.look ?? 0);
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
