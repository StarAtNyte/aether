/**
 * Firefox on WebGL2 (pure, unit-tested): the driver paths that browser warns about, and the lighter start it gets.
 *
 * A Firefox on a real GPU printed three kinds of console hint before a black viewport: a depth texture sampled with a
 * comparison and LINEAR filtering ("behavior is implementation-defined"), pixel-store flags (premultiply, flip Y) on uploads
 * that are not DOM elements ("deprecated"), and textures "incurring lazy initialization" (sampled before ever written).
 * None of them is an error, but each is a place where that browser's behaviour is not the one the other browsers share, so
 * on that path (Gecko + WebGL2 + a GPU that is not a software rasteriser) Aether
 * - samples the sun's shadow map with NEAREST comparison and filters it in the shader,
 * - uploads typed-array textures with the rows already in GL order and no pixel-store flags,
 * - clears every render target a material samples before the first frame,
 * - starts on the light end of the performance ladder and climbs while frames stay comfortably fast.
 */
import { classifyGpu } from './budget';
import type { BackendKind } from './backend';

/** Gecko browsers (Firefox, Zen, LibreWolf) send "Gecko/<date>"; Chromium and Safari only "like Gecko". */
export function isGeckoAgent(ua: string): boolean {
  return /\bGecko\/\d|\bFirefox\/\d/.test(ua);
}

/** The user agent of this browser ('' outside one). */
export function currentAgent(): string {
  return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
}

/**
 * True on the path described above: Gecko on WebGL2 with a GPU that is not a software rasteriser (where the shadow
 * filter, the clears and the light start would only cost looks on a machine that has little to give anyway).
 */
export function geckoSafePath(backend: BackendKind, gpuDescription: string, ua: string = currentAgent()): boolean {
  return backend === 'webgl2' && isGeckoAgent(ua) && classifyGpu(gpuDescription) !== 'software';
}

/** Ladder level a safe path starts at: no baked room light, one shadow map, the lowest tier (no bloom chain). */
export const GECKO_START_LEVEL = 4;

/**
 * Flip the rows of an image held in a typed array, in place (`height` rows of equal length). Returns false when the
 * array does not divide into rows.
 */
export function flipRows(data: { length: number; [i: number]: number }, height: number): boolean {
  if (!(height > 1) || !Number.isInteger(height) || data.length % height !== 0) return false;
  const stride = data.length / height;
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const a = top * stride;
    const b = bottom * stride;
    for (let i = 0; i < stride; i++) {
      const t = data[a + i] as number;
      data[a + i] = data[b + i] as number;
      data[b + i] = t;
    }
  }
  return true;
}

/** A texture whose pixels are a typed array. */
interface DataLike {
  flipY: boolean;
  needsUpdate: boolean;
  image: unknown;
}

/**
 * A texture uploaded from a typed array with `flipY` on makes the driver flip it (a pixel-store flag Firefox calls
 * deprecated for such uploads). Flip the rows once here instead and turn the flag off: the same picture on the GPU.
 * Returns true when it did.
 */
export function bakeFlipY(tex: DataLike): boolean {
  const img = tex.image as { data?: unknown; height?: number } | null | undefined;
  const data = img?.data;
  if (!tex.flipY || !img || !ArrayBuffer.isView(data) || data instanceof DataView) return false;
  if (!flipRows(data as unknown as { length: number; [i: number]: number }, img.height ?? 0)) return false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return true;
}
