/**
 * AgX with a look: three's AgX tone curve (Troy Sobotka's, as Blender ships it) with Blender's ASC-CDL look step
 * (power and saturation on the curve's display-encoded output) between the sigmoid and the outset matrix.
 *
 * AgX alone ("Base") is deliberately gentle: mid-tones sit low in contrast and every colour drifts toward white as it
 * brightens. Under a clear sun that reads as a grey veil: blacks lifted, whites dull, a golden light turned beige. A
 * look's power above 1 deepens the mid-tones and shadows while keeping AgX's soft highlight roll-off, and its saturation
 * returns the chroma the curve took (Blender's "Punchy" look is power 1.35, saturation 1.4). The strength comes from
 * the grade preset ({@link agxLookParams}); 0 is AgX Base exactly.
 *
 * Registered as the renderer's `CustomToneMapping` (see {@link installAgxLook}); the uniforms are per renderer.
 */
import type { ToneMapping } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/** Look of full strength (1): Blender's "Punchy". */
export const AGX_PUNCHY = Object.freeze({ power: 1.35, saturation: 1.4 });

/**
 * Exposure (stops) the look adds at full strength. The power darkens the whole curve; this lifts it back so mid grey
 * lands close to where AgX Base puts it, and the look reads as contrast (deeper shade, brighter highlights) rather
 * than as a darker picture.
 */
export const AGX_LOOK_EV = 0.6;

/** Power, saturation and exposure multiplier of the look at `strength` (0 = AgX Base, 1 = Punchy; clamped to [0, 1.5]). */
export function agxLookParams(strength: number): { power: number; saturation: number; exposure: number } {
  const s = Number.isFinite(strength) ? Math.max(0, Math.min(1.5, strength)) : 0;
  return { power: 1 + (AGX_PUNCHY.power - 1) * s, saturation: 1 + (AGX_PUNCHY.saturation - 1) * s, exposure: 2 ** (AGX_LOOK_EV * s) };
}

/** Uniforms of the installed look. */
export interface AgxLook {
  /** Set the look's strength (see {@link agxLookParams}). */
  set(strength: number): void;
  /** The tone-mapping constant to set on the renderer for AgX with this look. */
  readonly toneMapping: ToneMapping;
}

const installed = new WeakMap<object, AgxLook>();

type Three = typeof import('three/webgpu');
type Tsl = typeof import('three/tsl');

/** Register AgX-with-look as `CustomToneMapping` on `renderer` (once per renderer) and return its controls. */
export function installAgxLook(renderer: WebGPURenderer, three: Three, tsl: Tsl): AgxLook | null {
  const have = installed.get(renderer);
  if (have) return have;
  const library = (renderer as unknown as { library?: { addToneMapping?(fn: unknown, toneMapping: number): void } }).library;
  if (!library?.addToneMapping) return null;
  const { Fn, vec3, mat3, float, log2, clamp, max, pow, dot, mix, uniform } = tsl;
  const uPower = uniform(1);
  const uSat = uniform(1);
  const uExposure = uniform(1);
  // Matrices and constants as in three's `agxToneMapping` (r186).
  const rec2020ToSrgb = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const srgbToRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.088), vec3(0.0433, 0.0113, 0.8956));
  const inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const minEv = float(-12.47393);
  const maxEv = float(4.026069);
  type V3 = ReturnType<typeof vec3>;
  // AgX's sigmoid (a polynomial fit of its default contrast curve), inlined.
  const contrastApprox = (x: V3): V3 => {
    // (typed loosely: TSL's operator types do not follow a vec3 through matrix products)
    const x2 = x.mul(x);
    const x4 = x2.mul(x2);
    return x4.mul(x2).mul(15.5).sub(x4.mul(x).mul(40.14)).add(x4.mul(31.96)).sub(x2.mul(x).mul(6.868)).add(x2.mul(0.4298)).add(x.mul(0.1191)).sub(0.00232) as V3;
  };
  const agxLook = Fn(([color, exposure]: [V3, ReturnType<typeof float>]) => {
    let c = srgbToRec2020.mul(vec3(color).mul(exposure).mul(uExposure));
    c = inset.mul(c);
    c = log2(max(c, vec3(1e-10)));
    c = clamp(c.sub(minEv).div(maxEv.sub(minEv)), vec3(0), vec3(1));
    const curve = contrastApprox(c as unknown as V3).toVar();
    // The look (ASC CDL power, then saturation around Rec. 709 luminance), on the display-encoded curve output.
    const looked = pow(max(curve, vec3(0)), vec3(uPower)).toVar();
    const luma = dot(looked, vec3(0.2126, 0.7152, 0.0722));
    const saturated = mix(vec3(luma, luma, luma), looked, uSat);
    const linear = pow(max(vec3(0), outset.mul(saturated)), vec3(2.2));
    return clamp(rec2020ToSrgb.mul(linear), vec3(0), vec3(1));
  });
  try {
    library.addToneMapping(agxLook, three.CustomToneMapping);
  } catch {
    return null;
  }
  const look: AgxLook = {
    set(strength: number) {
      const p = agxLookParams(strength);
      uPower.value = p.power;
      uSat.value = p.saturation;
      uExposure.value = p.exposure;
    },
    toneMapping: three.CustomToneMapping,
  };
  installed.set(renderer, look);
  return look;
}
