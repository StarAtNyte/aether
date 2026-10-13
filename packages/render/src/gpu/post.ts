/**
 * Post-processing: scene pass + bloom through three's node `RenderPipeline`
 * (formerly `PostProcessing`, renamed in r183). Tone mapping and color space
 * conversion happen in the pipeline's output transform. Any failure (missing
 * feature, shader compile error) disables post and the caller renders
 * directly.
 */
import type { Camera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { errorMessage, log } from '../log';

/** A running post pipeline. */
export interface PostPipeline {
  render(): void;
  setBloom(strength: number): void;
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

/** Bloom node strength for an `environment.bloom` value. */
export function bloomStrength(bloom: number): number {
  return Math.max(0, Math.min(MAX_BLOOM_STRENGTH, (Number.isFinite(bloom) ? bloom : 0) * BLOOM_SCALE));
}

/** Build the pipeline, or null when unsupported. */
export async function createPostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, strength: number): Promise<PostPipeline | null> {
  try {
    const [{ RenderPipeline }, { pass }, { bloom }] = await Promise.all([
      import('three/webgpu'),
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
    ]);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const bloomNode = bloom(color, bloomStrength(strength), BLOOM_RADIUS, BLOOM_THRESHOLD);
    const pipeline = new RenderPipeline(renderer, color.add(bloomNode));
    return {
      render: () => pipeline.render(),
      setBloom: (s: number) => {
        bloomNode.strength.value = bloomStrength(s);
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
