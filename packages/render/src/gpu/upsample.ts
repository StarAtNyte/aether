/**
 * Temporal upsampling of a scene pass drawn below the frame resolution (the light chain while the view moves).
 *
 * Each frame the camera is jittered by a sub-texel offset (Halton 2,3), the scene is drawn small, and this pass resolves it to
 * the frame size: the new frame is upsampled with a Catmull-Rom filter (sharper than bilinear, no blocks), the previous
 * result is moved to where its pixels are now (the depth of the new frame and both camera matrices give the position, no
 * velocity buffer) and clamped to the colour range of the new frame's neighbourhood, so a stale pixel is pulled to the
 * picture instead of ghosting. A pixel that stays put keeps collecting new sub-texel samples: fine foliage and edges fill
 * in over a few frames at a fraction of the pixels per frame. Blending happens in a compressed (Karis) space so a single
 * bright sample cannot dominate the history.
 *
 * One implementation for both backends (TSL nodes). Not used while the scene pass is near the frame size.
 */
import type { Camera, Matrix4 as Mat4, PerspectiveCamera } from 'three';
import type * as ThreeWebGPU from 'three/webgpu';
import type * as TslModule from 'three/tsl';

/** A TSL node (the generated types reject ordinary node arithmetic, see `materials/tsl-lite.ts`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Scene scale above which the pass is skipped (the picture is drawn near the frame size). */
export const UPSAMPLE_MAX_SCALE = 0.5;
/** Scene scale above which the upsample is the plain frame-size sample (between the two: Catmull-Rom only). */
export const SPATIAL_MAX_SCALE = 0.92;
/** Weight of the new frame at a pixel that has not moved (the history keeps the rest). */
export const UPSAMPLE_STILL_WEIGHT = 0.1;
/** Weight of the new frame where the picture moves 16 pixels or more per frame. */
export const UPSAMPLE_MOVING_WEIGHT = 0.5;
/** Pixels of motion per frame at which the new frame's weight is the moving one. */
export const UPSAMPLE_MOTION_PX = 16;

/** Halton sequence value of `index` (1-based) in `base`. */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Sub-texel jitter of frame `index` in texels of the small target, each in [-0.5, 0.5). 8 phases. */
export function jitterOffset(index: number): [number, number] {
  const i = (index % 8) + 1;
  return [halton(i, 2) - 0.5, halton(i, 3) - 0.5];
}

/** Handle on the pass: wire its `rgb` into the chain and call `begin` / `end` around each pipeline render. */
export interface Upsampler {
  /** The resolved frame (linear HDR) as a node. */
  rgb: N;
  /** Size of the small target and of the frame; switches the pass on or off by the scale. */
  setScale(scale: number, smallW: number, smallH: number, fullW: number, fullH: number): void;
  /** Before the pipeline renders: current matrices, jitter on the camera. */
  begin(): void;
  /** After the pipeline rendered: jitter off, matrices kept for the next frame. */
  end(): void;
  /** True while the pass jitters and resolves. */
  readonly active: boolean;
  /** The resolve pass (a node the frame updates once), for a chain that must run it before what reads its output. */
  readonly pass: unknown;
  dispose(): void;
}

/** Build the pass for `scenePass` (a `pass()` node of the camera's scene). */
export function createUpsampler(three: typeof ThreeWebGPU, tsl: typeof TslModule, renderer: ThreeWebGPU.WebGPURenderer, scenePass: N, camera: Camera, temporal = true, flags = ''): Upsampler {
  const bilinearCurrent = flags.includes('bilin');
  const crossClamp = flags.includes('cross');
  const historyCatmull = flags.includes('hcr');
  const sharpen = flags.includes('sharp');
  const stillWeight = flags.includes('w15') ? 0.15 : flags.includes('w20') ? 0.2 : UPSAMPLE_STILL_WEIGHT;
  const { TempNode, NodeMaterial, QuadMesh, RenderTarget, RendererUtils, NodeUpdateType, HalfFloatType, Matrix4, Vector2, LinearFilter, WebGPUCoordinateSystem } = three;
  const { Fn, If, uniform, uv, vec2, vec3, vec4, float, max, min, clamp, mix, floor, texture, passTexture, context, screenUV } = tsl as unknown as Record<string, N>;
  const cam = camera as PerspectiveCamera;
  const webgpuDepth = renderer.coordinateSystem === WebGPUCoordinateSystem;

  const uOn = uniform(0);
  const uSpatial = uniform(0);
  const uReset = uniform(1);
  const uSmallSize = uniform(new Vector2(1, 1));
  const uFullSize = uniform(new Vector2(1, 1));
  // Jitter of the frame being resolved, in uv units of the frame (the scene sample at a texel centre is this far from it).
  const uJitterUv = uniform(new Vector2(0, 0));
  const uInvViewProj = uniform(new Matrix4());
  const uPrevViewProj = uniform(new Matrix4());

  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const history = (texture as N)(new RenderTarget(1, 1).texture);

  // Karis weighting: compress by the brightest channel, so a firefly counts for little in the blend and the clamp.
  const compress = (c: N): N => c.div(max(max(c.r, c.g), c.b).add(1));
  const expand = (c: N): N => c.div(max(float(1).sub(max(max(c.r, c.g), c.b)), 1e-3));

  // Catmull-Rom of the small colour target with five bilinear taps.
  const catmullOf = (tex: N, uvIn: N, size: N): N => {
    const pos = uvIn.mul(size);
    const centre = floor(pos.sub(0.5)).add(0.5);
    const f = pos.sub(centre);
    const w0 = f.mul(f.mul(float(1).sub(f.mul(0.5))).sub(0.5));
    const w1 = float(1).add(f.mul(f).mul(f.mul(1.5).sub(2.5)));
    const w2 = f.mul(f.mul(float(2).sub(f.mul(1.5))).add(0.5));
    const w3 = f.mul(f).mul(f.mul(0.5).sub(0.5));
    const w12 = w1.add(w2);
    const t12 = centre.add(w2.div(w12)).div(size);
    const t0 = centre.sub(1).div(size);
    const t3 = centre.add(2).div(size);
    const a = tex.sample(vec2(t12.x, t0.y)).rgb.mul(w12.x.mul(w0.y));
    const b = tex.sample(vec2(t0.x, t12.y)).rgb.mul(w0.x.mul(w12.y));
    const c = tex.sample(vec2(t12.x, t12.y)).rgb.mul(w12.x.mul(w12.y));
    const d = tex.sample(vec2(t3.x, t12.y)).rgb.mul(w3.x.mul(w12.y));
    const e = tex.sample(vec2(t12.x, t3.y)).rgb.mul(w12.x.mul(w3.y));
    const sum = w12.x.mul(w0.y).add(w0.x.mul(w12.y)).add(w12.x.mul(w12.y)).add(w3.x.mul(w12.y)).add(w12.x.mul(w3.y));
    return max(a.add(b).add(c).add(d).add(e).div(sum), 0);
  };

  // Two full-size targets: one holds the last result (the history), the other receives the new one; they swap each frame.
  const catmull = (uvIn: N): N => catmullOf(color, uvIn, uSmallSize);

  const targets = [0, 1].map((i) => {
    const rt = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType });
    rt.texture.name = `Upsample.${i}`;
    rt.texture.minFilter = LinearFilter;
    rt.texture.magFilter = LinearFilter;
    return rt;
  }) as [ThreeWebGPU.RenderTarget, ThreeWebGPU.RenderTarget];
  let current = 0;
  history.value = targets[1].texture;
  const material = new NodeMaterial();
  material.name = 'Upsample.resolve';
  const quad = new QuadMesh(material);
  let rendererState: unknown;

  class UpsampleNode extends TempNode {
    textureNode: N;
    constructor() {
      super('vec4');
      this.updateBeforeType = NodeUpdateType.FRAME;
      this.textureNode = passTexture(this, targets[0].texture);
    }

    getTextureNode(): N {
      return this.textureNode;
    }

    setup(builder: N): N {
      const resolve = Fn(() => {
        const out = vec3(0).toVar();
        const uvNode = uv();
        // Where the scene sample under this pixel sits in the small target: the jitter moves the sample grid.
        const small = uvNode.sub(uJitterUv);
        If(uOn.lessThan(0.5), () => {
          out.assign(color.sample(uvNode).rgb);
        }).Else(() => {
          const current = bilinearCurrent ? color.sample(small).rgb : catmull(small);
          // The depth nearest to the pixel, the picture's position in the last frame from it.
          const d = depth.sample(small).r;
          const ndcZ = webgpuDepth ? d : d.mul(2).sub(1);
          const clip = vec4(uvNode.x.mul(2).sub(1), float(1).sub(uvNode.y).mul(2).sub(1), ndcZ, 1);
          const world = uInvViewProj.mul(clip);
          const prevClip = uPrevViewProj.mul(vec4(world.xyz.div(world.w), 1));
          const prevNdc = prevClip.xy.div(prevClip.w);
          const prevUv = vec2(prevNdc.x.mul(0.5).add(0.5), float(0.5).sub(prevNdc.y.mul(0.5)));
          const inside = prevUv.x.greaterThan(0).and(prevUv.x.lessThan(1)).and(prevUv.y.greaterThan(0)).and(prevUv.y.lessThan(1)).and(prevClip.w.greaterThan(0));
          // Colour range of the new frame around the pixel: nearest small texel and its eight neighbours.
          const centre = floor(small.mul(uSmallSize)).add(0.5).div(uSmallSize);
          const texel = float(1).div(uSmallSize);
          const cc = compress(color.sample(centre).rgb).toVar();
          const lo = cc.toVar();
          const hi = cc.toVar();
          const offsets = crossClamp ? [[0, -1], [-1, 0], [1, 0], [0, 1]] : [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
          for (const [ox, oy] of offsets) {
            const s = compress(max(color.sample(centre.add(vec2(texel.x.mul(ox as number), texel.y.mul(oy as number)))).rgb, 0));
            lo.assign(min(lo, s));
            hi.assign(max(hi, s));
          }
          const now = compress(current);
          const past = compress(max(historyCatmull ? catmullOf(history, prevUv, uFullSize) : history.sample(prevUv).rgb, 0));
          const kept = clamp(past, lo, hi);
          const motion = prevUv.sub(uvNode).mul(uFullSize).length();
          const w = mix(stillWeight, UPSAMPLE_MOVING_WEIGHT, clamp(motion.div(UPSAMPLE_MOTION_PX), 0, 1));
          const weight = inside.and(uReset.lessThan(0.5)).select(w, float(1));
          out.assign(expand(mix(kept, now, weight)));
        });
        return vec4(out, 1);
      });
      material.contextNode = context(builder.getSharedContext());
      material.colorNode = resolve();
      return this.textureNode;
    }

    updateBefore(frame: N): boolean | undefined {
      // The scene pass first (a node of the main graph; the frame update runs it once).
      frame.updateBeforeNode(scenePass);
      const fullW = Math.max(1, Math.round(uFullSize.value.x));
      const fullH = Math.max(1, Math.round(uFullSize.value.y));
      rendererState = RendererUtils.resetRendererState(renderer, rendererState as never);
      if (targets[0].width !== fullW || targets[0].height !== fullH) {
        for (const rt of targets) {
          rt.setSize(fullW, fullH);
          renderer.initRenderTarget(rt);
        }
        uReset.value = 1;
      }
      if (uOn.value > 0.5) {
        // Read the last result, write the other target, show it.
        history.value = targets[current]!.texture;
        current = 1 - current;
        renderer.setRenderTarget(targets[current]!);
        quad.material = material;
        quad.name = 'Upsample';
        quad.render(renderer);
        renderer.setRenderTarget(null);
        this.textureNode.value = targets[current]!.texture;
        uReset.value = 0;
      }
      RendererUtils.restoreRendererState(renderer, rendererState as never);
      return undefined;
    }

    dispose(): void {
      super.dispose();
      for (const rt of targets) rt.dispose();
      material.dispose();
    }
  }

  const node = temporal ? new UpsampleNode() : null;
  // Spatial only: the filter in the main graph, no jitter, no history.
  const spatial = Fn(() => {
    const out = vec3(0).toVar();
    If(uSpatial.lessThan(0.5), () => {
      out.assign(color.sample(screenUV).rgb);
    }).Else(() => {
      out.assign(catmull(screenUV));
    });
    return out;
  })();
  const unjittered: Mat4 = new Matrix4();
  const view: Mat4 = new Matrix4();
  let frameIndex = 0;
  let jittering = false;
  let hadHistory = false;
  let width = 1;
  let height = 1;

  // Contrast-limited sharpening of the resolved frame (one frame-size texel around the pixel, clamped to the neighbours' range).
  const sharpened = (t: N): N => {
    const texel = float(1).div(uFullSize);
    const c = t.sample(screenUV).rgb;
    const n1 = t.sample(screenUV.add(vec2(0, texel.y))).rgb;
    const n2 = t.sample(screenUV.sub(vec2(0, texel.y))).rgb;
    const n3 = t.sample(screenUV.add(vec2(texel.x, 0))).rgb;
    const n4 = t.sample(screenUV.sub(vec2(texel.x, 0))).rgb;
    const lo = min(min(min(n1, n2), min(n3, n4)), c);
    const hi = max(max(max(n1, n2), max(n3, n4)), c);
    const blur = n1.add(n2).add(n3).add(n4).mul(0.25);
    return clamp(c.add(c.sub(blur).mul(0.8)), lo, hi);
  };

  return {
    rgb: node ? Fn(() => {
      // The resolved frame while the pass runs; the scene pass itself when it is off (the target is then not written).
      const out = vec3(0).toVar();
      If(uOn.lessThan(0.5), () => {
        If(uSpatial.greaterThan(0.5), () => {
          out.assign(catmull(screenUV));
        }).Else(() => {
          out.assign(color.sample(screenUV).rgb);
        });
      }).Else(() => {
        out.assign(sharpen ? sharpened(node.getTextureNode() as N) : (node.getTextureNode() as N).sample(screenUV).rgb);
      });
      return out;
    })() : spatial,
    pass: node,
    get active(): boolean {
      return uOn.value > 0.5;
    },
    setScale(scale: number, smallW: number, smallH: number, fullW: number, fullH: number): void {
      const on = temporal && scale <= UPSAMPLE_MAX_SCALE ? 1 : 0;
      uSpatial.value = on === 0 && scale <= SPATIAL_MAX_SCALE ? 1 : 0;
      if (on === 0 && uOn.value > 0.5) uReset.value = 1;
      if (on === 1 && uOn.value < 0.5) uReset.value = 1;
      uOn.value = on;
      if (!temporal) uSpatial.value = scale <= SPATIAL_MAX_SCALE ? 1 : 0;
      uSmallSize.value.set(Math.max(1, smallW), Math.max(1, smallH));
      uFullSize.value.set(Math.max(1, fullW), Math.max(1, fullH));
      width = Math.max(1, fullW);
      height = Math.max(1, fullH);
    },
    begin(): void {
      jittering = false;
      if (!node || uOn.value < 0.5 || cam.view?.enabled === true) return;
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      view.copy(cam.matrixWorld).invert();
      unjittered.multiplyMatrices(cam.projectionMatrix, view);
      uInvViewProj.value.copy(unjittered).invert();
      if (!hadHistory) {
        uPrevViewProj.value.copy(unjittered);
        uReset.value = 1;
      }
      const [jx, jy] = jitterOffset(frameIndex++);
      const k = uSmallSize.value.x / width;
      // View offset in frame pixels: one small texel is 1 / k of them. The sample grid shifts by the same amount in uv.
      const dx = jx / k;
      const dy = jy / (uSmallSize.value.y / height);
      cam.setViewOffset(width, height, dx, dy, width, height);
      uJitterUv.value.set(dx / width, dy / height);
      jittering = true;
    },
    end(): void {
      if (!jittering) {
        hadHistory = false;
        return;
      }
      cam.clearViewOffset();
      uPrevViewProj.value.copy(unjittered);
      hadHistory = true;
      jittering = false;
    },
    dispose(): void {
      node?.dispose();
    },
  };
}
