/**
 * Post-processing: scene pass + bloom + a sky-derived colour grade + a soft vignette through three's node
 * `RenderPipeline` (formerly `PostProcessing`, renamed in r183). Tone
 * mapping and color space conversion happen in the pipeline's output
 * transform. Any failure (missing feature, shader compile error) disables
 * post and the caller renders directly.
 *
 * The `studio` quality (architectural stills) adds a depth/normal/velocity
 * pre-pass, ground-truth ambient occlusion applied to the indirect light
 * only (three's built-in AO context, so sunlit faces keep their contrast)
 * and temporal reprojection anti-aliasing, which also accumulates the AO
 * and shadow noise into a clean image while the camera rests.
 */
import type { Camera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';
import { NEUTRAL_GRADE, type Grade } from './grade';

/** Post pipeline quality: the realtime look, or the studio still (AO + temporal AA). */
export type PostQuality = 'standard' | 'studio';

/** Ambient occlusion tuning of the studio pipeline (metres / unitless). */
export const STUDIO_AO = Object.freeze({ radius: 0.85, thickness: 0.8, distanceExponent: 1.2, scale: 1.7, samples: 12, resolutionScale: 0.5 });

/** A running post pipeline. */
export interface PostPipeline {
  readonly quality: PostQuality;
  render(): void;
  setBloom(strength: number): void;
  /** Apply a colour grade (uniform updates only; no shader rebuild). */
  setGrade(grade: Grade): void;
  dispose(): void;
}

/**
 * Bloom tuning. The threshold sits above the brightest diffusely lit
 * surface (white albedo under a full sun ≈ 0.8 linear), so only emissive
 * materials, the sun disc and sharp specular glints bloom.
 */
const BLOOM_RADIUS = 0.35;
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
export function vignetteFactor(d: number): number {
  const [lo, hi] = VIGNETTE_RANGE;
  const t = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
  return 1 - VIGNETTE_STRENGTH * t * t * (3 - 2 * t);
}

/** Bloom node strength for an `environment.bloom` value. */
export function bloomStrength(bloom: number): number {
  return Math.max(0, Math.min(MAX_BLOOM_STRENGTH, (Number.isFinite(bloom) ? bloom : 0) * BLOOM_SCALE));
}

/**
 * Textures the TRAA node owns but does not release in its own `dispose`
 * (three r186): the placeholder previous-depth texture and the history
 * target's depth texture. Without this, every studio-render toggle leaked
 * three GPU textures.
 */
function disposeTraaTextures(node: unknown): void {
  const n = node as { _previousDepthNode?: { value?: { dispose?: () => void } }; _historyRenderTarget?: { depthTexture?: { dispose?: () => void } | null } };
  n._previousDepthNode?.value?.dispose?.();
  n._historyRenderTarget?.depthTexture?.dispose?.();
}

/** Every texture of a pass's render target (MRT attachments and depth), which the target's own dispose may not release. */
function disposeTargetTextures(pass: unknown): void {
  const rt = (pass as { renderTarget?: { textures?: Array<{ dispose(): void }>; depthTexture?: { dispose(): void } | null } }).renderTarget;
  for (const t of rt?.textures ?? []) t.dispose();
  rt?.depthTexture?.dispose();
}

/** Build the pipeline, or null when unsupported. */
export async function createPostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, strength: number, quality: PostQuality = 'standard'): Promise<PostPipeline | null> {
  try {
    const studio = quality === 'studio';
    const [{ RenderPipeline, Vector3, UnsignedByteType }, tsl, { bloom }, gtao, traaMod] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
      studio ? import('three/addons/tsl/display/GTAONode.js') : Promise.resolve(null),
      studio ? import('three/addons/tsl/display/TRAANode.js') : Promise.resolve(null),
    ]);
    const { pass, screenUV, smoothstep, float, uniform, vec3, vec4, dot, mix, pow, max, clamp, mrt, packNormalToRGB, unpackRGBToNormal, normalView, velocity, sample, builtinAOContext, convertToTexture } = tsl;
    const disposables: Array<{ dispose(): void }> = [];
    // Temporal AA replaces MSAA in the studio pipeline (its depth copies need single-sampled targets).
    const scenePass = studio ? pass(scene, camera, { samples: 0 }) : pass(scene, camera);
    disposables.push(scenePass);
    let prePassDepth: ReturnType<typeof scenePass.getTextureNode> | null = null;
    let prePassVelocity: ReturnType<typeof scenePass.getTextureNode> | null = null;
    if (studio && gtao) {
      // Opaque pre-pass: view normals (8-bit) + velocity, and its depth for AO and TRAA.
      const prePass = pass(scene, camera, { samples: 0 });
      prePass.transparent = false;
      prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
      const normalTexture = prePass.getTexture('output');
      normalTexture.type = UnsignedByteType;
      const prePassNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
      prePassDepth = prePass.getTextureNode('depth');
      prePassVelocity = prePass.getTextureNode('velocity');
      const aoPass = gtao.ao(prePassDepth, prePassNormal, camera);
      aoPass.resolutionScale = STUDIO_AO.resolutionScale;
      aoPass.useTemporalFiltering = true;
      aoPass.radius.value = STUDIO_AO.radius;
      aoPass.thickness.value = STUDIO_AO.thickness;
      aoPass.distanceExponent.value = STUDIO_AO.distanceExponent;
      aoPass.scale.value = STUDIO_AO.scale;
      aoPass.samples.value = STUDIO_AO.samples;
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      disposables.push(prePass, aoPass, { dispose: () => disposeTargetTextures(prePass) }, { dispose: () => disposeTargetTextures(scenePass) });
    }
    const color = scenePass.getTextureNode('output');
    const bloomNode = bloom(color, bloomStrength(strength), BLOOM_RADIUS, BLOOM_THRESHOLD);
    disposables.push(bloomNode);
    const vignette = float(1).sub(smoothstep(float(VIGNETTE_RANGE[0]), float(VIGNETTE_RANGE[1]), screenUV.sub(0.5).length()).mul(VIGNETTE_STRENGTH));
    // Grade in linear HDR before the output transform: split tone, saturation, contrast pivot.
    const uSat = uniform(NEUTRAL_GRADE.saturation);
    const uContrast = uniform(NEUTRAL_GRADE.contrast);
    const uShadow = uniform(new Vector3(1, 1, 1));
    const uHigh = uniform(new Vector3(1, 1, 1));
    const hdr = color.add(bloomNode).rgb;
    const luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    const toned = hdr.mul(mix(uShadow, uHigh, smoothstep(float(0.02), float(0.6), luma)));
    const toneLuma = dot(toned, vec3(0.2126, 0.7152, 0.0722));
    const saturated = max(mix(vec3(toneLuma), toned, uSat), vec3(0));
    const pivot = float(0.18);
    const contrasted = pow(saturated.div(pivot).add(1e-5), vec3(uContrast)).mul(pivot);
    const graded = clamp(contrasted, vec3(0), vec3(64)).mul(vignette);
    const gradedNode = vec4(graded, color.a);
    let pipeline: InstanceType<typeof RenderPipeline>;
    if (studio && traaMod && prePassDepth && prePassVelocity) {
      // The graded image as a texture of our own, so its render target is disposed with the pipeline.
      const beauty = convertToTexture(gradedNode);
      const traaNode = traaMod.traa(beauty, prePassDepth, prePassVelocity, camera);
      disposables.push(beauty, traaNode, { dispose: () => disposeTraaTextures(traaNode) });
      pipeline = new RenderPipeline(renderer, traaNode);
    } else {
      pipeline = new RenderPipeline(renderer, gradedNode);
    }
    return {
      quality,
      render: () => pipeline.render(),
      setBloom: (s: number) => {
        bloomNode.strength.value = bloomStrength(s);
      },
      setGrade: (g: Grade) => {
        uSat.value = g.saturation;
        uContrast.value = g.contrast;
        uShadow.value.set(...g.shadowTint);
        uHigh.value.set(...g.highlightTint);
      },
      dispose: () => {
        pipeline.dispose();
        for (const d of disposables) d.dispose();
      },
    };
  } catch (e) {
    log.warn(`post-processing (${quality}) disabled: ${errorMessage(e)}`);
    return null;
  }
}
