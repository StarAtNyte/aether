/**
 * Texture sharpness of a scene pass drawn below the frame size. At a scale `k` one pixel covers 1 / k² texels more than
 * at the frame size, so every mip chain is read `log2(1 / k)` levels too coarse: the picture is soft, and cut-out
 * foliage (whose coarse mips average below the alpha threshold) thins out and disappears. The bias is the standard
 * remedy of upscalers (a negative level bias of `log2(k)`): it brings back the texture detail of the frame size, and
 * the temporal upsampling (`upsample.ts`) integrates the aliasing it leaves over the jittered frames.
 *
 * One uniform ({@link setTextureLodBias}) feeds the bias node of every mip-mapped colour texture sample; it is 0 whenever
 * the frame is drawn at its size (the program is the same, nothing recompiles). Depth, shadow, cube, 3D and render
 * target textures, and samples that already set a level, a bias or a gradient, are left alone.
 */

/** Most negative bias applied (a scale of 0.25 asks for -2). */
export const MAX_LOD_BIAS = 2;

/** The bias for a scene pass at `scale` (0 at and above 0.95; negative below). */
export function lodBiasFor(scale: number): number {
  if (!Number.isFinite(scale) || scale >= 0.95) return 0;
  return -Math.min(MAX_LOD_BIAS, Math.log2(1 / Math.max(0.05, scale)));
}

/** Whether the bias is on. `globalThis.__AETHER_LOD_BIAS = false` (or the older `__NOBIAS = true`) turns it off. */
export function lodBiasEnabled(): boolean {
  const g = globalThis as { __AETHER_LOD_BIAS?: boolean; __NOBIAS?: boolean };
  return g.__AETHER_LOD_BIAS !== false && g.__NOBIAS !== true;
}

let value = 0;
const listeners: Array<(bias: number) => void> = [];

/** Follow the bias (a shader uniform of its own, e.g. the foliage alpha boost that must read the mip the texture is sampled at). */
export function onTextureLodBias(fn: (bias: number) => void): void {
  listeners.push(fn);
  fn(value);
}
let uniformNode: { value: number } | null = null;
let installed = false;

/** Set the bias in levels (0 or negative). Takes effect on the next draw. */
export function setTextureLodBias(bias: number): void {
  value = Number.isFinite(bias) && lodBiasEnabled() ? Math.min(0, Math.max(-MAX_LOD_BIAS, bias)) : 0;
  if (uniformNode) uniformNode.value = value;
  for (const fn of listeners) fn(value);
}

/** The bias in force (tests and diagnostics). */
export function textureLodBias(): number {
  return value;
}

interface Patched {
  __aetherLodBias?: boolean;
  setup: (builder: unknown) => unknown;
}

const MIPMAPPED = new Set([1004, 1005, 1007, 1008]);

/** Patch three's texture node (idempotent). Falls back to unbiased sampling when its internals are not as expected. */
export async function installLodBias(): Promise<void> {
  if (installed) return;
  installed = true;
  try {
    const [three, tsl] = await Promise.all([import('three/webgpu'), import('three/tsl')]);
    const proto = three.TextureNode.prototype as unknown as Patched;
    if (proto.__aetherLodBias || typeof proto.setup !== 'function') return;
    proto.__aetherLodBias = true;
    uniformNode = tsl.uniform(value) as unknown as { value: number };
    const bias = uniformNode;
    const setup = proto.setup;
    proto.setup = function (this: { value: unknown; biasNode: unknown; levelNode: unknown; gradNode: unknown; compareNode: unknown; gatherNode: unknown }, builder: unknown): unknown {
      const t = this.value as { isTexture?: boolean; isDepthTexture?: boolean; isCubeTexture?: boolean; isData3DTexture?: boolean; isRenderTargetTexture?: boolean; minFilter?: number } | undefined;
      const eligible =
        this.biasNode === null &&
        this.levelNode === null &&
        this.gradNode === null &&
        this.compareNode === null &&
        this.gatherNode === null &&
        t?.isTexture === true &&
        t.isDepthTexture !== true &&
        t.isCubeTexture !== true &&
        t.isData3DTexture !== true &&
        t.isRenderTargetTexture !== true &&
        MIPMAPPED.has(t.minFilter ?? 0);
      if (!eligible) return setup.call(this, builder);
      this.biasNode = bias;
      try {
        return setup.call(this, builder);
      } finally {
        this.biasNode = null;
      }
    };
  } catch {
    // Textures stay unbiased.
  }
}
