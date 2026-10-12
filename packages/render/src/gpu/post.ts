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

/** Bloom tuning (threshold keeps only HDR/emissive highlights blooming). */
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 0.82;

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
    const bloomNode = bloom(color, strength, BLOOM_RADIUS, BLOOM_THRESHOLD);
    const pipeline = new RenderPipeline(renderer, color.add(bloomNode));
    return {
      render: () => pipeline.render(),
      setBloom: (s: number) => {
        bloomNode.strength.value = Math.max(0, Math.min(3, Number.isFinite(s) ? s : 0));
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
