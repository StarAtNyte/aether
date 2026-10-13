/**
 * Post-processing: scene pass + bloom + a sky-derived colour grade + a soft vignette through three's node
 * `RenderPipeline` (formerly `PostProcessing`, renamed in r183). Tone
 * mapping and color space conversion happen in the pipeline's output
 * transform. Any failure (missing feature, shader compile error) disables
 * post and the caller renders directly.
 */
import type { Camera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';
import { NEUTRAL_GRADE, type Grade } from './grade';

/** A running post pipeline. */
export interface PostPipeline {
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

/** Build the pipeline, or null when unsupported. */
export async function createPostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, strength: number): Promise<PostPipeline | null> {
  try {
    const [{ RenderPipeline, Vector3 }, { pass, screenUV, smoothstep, float, uniform, vec3, vec4, dot, mix, pow, max, clamp }, { bloom }] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
    ]);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const bloomNode = bloom(color, bloomStrength(strength), BLOOM_RADIUS, BLOOM_THRESHOLD);
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
    const pipeline = new RenderPipeline(renderer, vec4(graded, color.a));
    return {
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
        bloomNode.dispose();
        scenePass.dispose();
      },
    };
  } catch (e) {
    log.warn(`post-processing disabled: ${errorMessage(e)}`);
    return null;
  }
}
