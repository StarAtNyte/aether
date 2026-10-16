/**
 * The scene behind the water, drawn on purpose.
 *
 * The standard and high water tiers need two things from the scene: how far away the bed or bank is under each water
 * pixel (absorption, shore foam) and what it looks like (refraction). WebGL2 gets both by copying the frame buffer
 * (`viewportDepthTexture` / `viewportSharedTexture`). On the WebGPU backend that copy is impossible when the canvas is
 * multisampled: the depth attachment is a multisampled texture and the copy target is not, a validation error on every
 * frame (WebGPU cannot resolve depth in a render pass at all).
 *
 * So on WebGPU the renderer draws the scene itself, before the frame and with the water hidden, into a single-sample
 * target that has a depth texture; the water samples both. This is the same pattern as the planar mirror, and it is also
 * the more correct input: the buffer under a water pixel is always what is behind the water, never the water itself.
 * The target is the size of the frame, so shore foam and the depth edge are as sharp as in the frame itself.
 */
import { DepthTexture, HalfFloatType, RenderTarget, UnsignedIntType, Vector2, type Camera, type Scene, type Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

const _size = new Vector2();

/** The opaque scene of one renderer, with its depth, for the water to read. */
export class SceneBackdrop {
  /** Colour (linear HDR) and depth of the scene without the water. */
  readonly target: RenderTarget;
  private readonly depth: DepthTexture;
  /** Fraction of the drawing buffer the target covers. */
  scale = 1;
  /** True once a frame was drawn into the target (the shader waits for it). */
  ready = false;
  /** True once a water material sampled it (the renderer then draws it each frame). */
  used = false;
  /** Number of times it was drawn (diagnostics and tests). */
  draws = 0;

  constructor() {
    this.depth = new DepthTexture(2, 2);
    this.depth.type = UnsignedIntType;
    this.target = new RenderTarget(2, 2, { type: HalfFloatType, depthBuffer: true, depthTexture: this.depth });
  }

  /** The colour texture, marking the backdrop as used. */
  colorTexture(): Texture {
    this.used = true;
    return this.target.texture;
  }

  /** The depth texture, marking the backdrop as used. */
  depthTexture(): DepthTexture {
    this.used = true;
    return this.depth;
  }

  /**
   * Size the target for a frame of `width`×`height` pixels (scaled by {@link scale}); true when it changed.
   */
  resize(width: number, height: number): boolean {
    const w = Math.max(2, Math.round((width || 2) * this.scale));
    const h = Math.max(2, Math.round((height || 2) * this.scale));
    if (this.target.width === w && this.target.height === h) return false;
    this.target.setSize(w, h);
    return true;
  }

  /**
   * Draw `scene` from `camera` without `hide` (the water materials; restored afterwards). Draws into the target
   * whatever the renderer was bound to, and puts the renderer back as it was.
   */
  render(renderer: WebGPURenderer, scene: Scene, camera: Camera, hide: readonly { visible: boolean }[]): void {
    // The frame is drawn into the output target while stills are captured (a size of its own), else into the canvas.
    const out = renderer.getOutputRenderTarget();
    if (out) _size.set(out.width, out.height);
    else renderer.getDrawingBufferSize(_size);
    this.resize(_size.x, _size.y);

    const hidden = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevMRT = renderer.getMRT();
    const prevAuto = renderer.autoClear;
    renderer.setMRT(null);
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    try {
      renderer.render(scene, camera);
      this.ready = true;
      this.draws++;
    } finally {
      renderer.setMRT(prevMRT);
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
      hide.forEach((o, i) => {
        o.visible = hidden[i] as boolean;
      });
    }
  }

  /** Release the target. */
  dispose(): void {
    this.target.dispose();
    this.depth.dispose();
    this.ready = false;
    this.used = false;
  }
}
