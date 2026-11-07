/**
 * Re-lightable baked light: the representation the light volume (`light-volume.ts`) and the lightmap (`lightmap.ts`) bake,
 * so that a change of the hour, the sun, the sky or the lamps' daylight scale re-weights stored light and never bakes again.
 *
 * Light transport is linear in its sources and does not mix colour channels, so the bounce light of a building is a sum of
 * parts, each baked once for a unit source and weighted at run time:
 *
 * | part | baked under | live weight (per channel) |
 * | --- | --- | --- |
 * | `sky0` | ambient `a = 1, b = 0` (the constant term of the sky hemisphere and image light) | `ambient.a` |
 * | `sky1` | ambient `a = 0, b = 1` (its up-down gradient, `b · n.y`; signed) | `ambient.b` |
 * | `lamp` | every architectural lamp at its full strength | the lamps' live scale (daylight dimming, look) |
 * | `sun k` | a white sun of irradiance 1 from key direction `k` | sun colour × intensity × the key's interpolation weight |
 *
 * The open ground around the building is lit by the same sources, so its bounce is part of each (sky parts: `a + b`; sun
 * key `k`: `max(0, k.y)`). The sky visibility (ambient occlusion of the sky) depends on the geometry only and is stored once.
 * The direct sun stays real time (the shadow map); only its bounce is baked.
 *
 * The sun keys follow the day arc of `sky-state.ts` (`sunPosition`): {@link SUN_KEYS} hours ({@link sunKeyHours}) plus the moon's fixed direction,
 * which lights the night. A sun between two keys takes both, weighted by the angle to each ({@link sunKeyWeights}). Their
 * directions travel with the baked data, so the run time never has to agree with the bake on the arc itself.
 */
import { bearingDirection, MOON_BEARING, MOON_ELEVATION, sunPosition } from './sky-state';

type V3 = readonly [number, number, number];

/** Bump when the parts, their order or the key arc change: stored relight bakes stop matching. */
export const RELIGHT_VERSION = 1;

/**
 * Version of a cooked package's baked light as a whole (this module, `LIGHTMAP_VERSION`, `VOLUME_BAKE_VERSION`,
 * `VOLUME_ASSET_VERSION`; a test keeps them in step): a manifest whose `lightmap.version` differs loads without baked light,
 * and the template refresh re-cooks it (scripts/cook-upload.ts).
 */
export const BAKED_LIGHT_VERSION = 'r1.lm5.lv2.a1';

/** Day-arc sun keys of a bake (the moon is one more). See docs/LIGHTING-BAKE.md for the measurement that chose this. */
export const SUN_KEYS = 14;

/**
 * Hours the sun can stand at, and where it dwells (`sky-state.ts` `PRESET_WINDOWS`): the dawn sky clamps the hour to
 * 6.38..7 (the daylight study's 5.8..8 h), the day sky to 6.7..17.3, the sunset sky to 17..17.62 (its 17.2..20.6 h). A drag
 * holds the sun at 6.38, 7 and 17.62 for a whole stretch of the slider, and a world's default hours are 6.5, 13 and 17.5:
 * those are keys, so the light shown there is exactly what a bake for that hour gives.
 */
export const SUN_KEY_ANCHORS: readonly number[] = Object.freeze([6.38, 7, 8, 12, 13, 17, 17.62]);

/**
 * Hours of `n` keys (at least the anchors): the {@link SUN_KEY_ANCHORS}, then one more at a time in the middle (by angle along
 * the arc) of the widest gap left, so the keys stay close to evenly spaced in angle between the anchors.
 */
export function sunKeyHours(n: number = SUN_KEYS): number[] {
  const count = Math.max(SUN_KEY_ANCHORS.length, Math.min(15, Math.round(n)));
  const hours = [...SUN_KEY_ANCHORS];
  const dir = (h: number): V3 => sunPosition(h).direction as unknown as V3;
  // Angle along the arc between two hours (summed in small steps: the arc is not a great circle).
  const along = (a: number, b: number): number => {
    let s = 0;
    const steps = 64;
    for (let i = 0; i < steps; i++) s += angle(dir(a + ((b - a) * i) / steps), dir(a + ((b - a) * (i + 1)) / steps));
    return s;
  };
  while (hours.length < count) {
    let best = 0, at = -1;
    for (let i = 0; i + 1 < hours.length; i++) {
      const g = along(hours[i] as number, hours[i + 1] as number);
      if (g > best) {
        best = g;
        at = i;
      }
    }
    // The hour at the gap's angular middle.
    const a = hours[at] as number, b = hours[at + 1] as number;
    let lo = a, hi = b;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (along(a, m) < best / 2) lo = m;
      else hi = m;
    }
    hours.splice(at + 1, 0, Math.round(((lo + hi) / 2) * 1e4) / 1e4);
  }
  return hours;
}

function angle(a: V3, b: V3): number {
  const la = Math.hypot(a[0], a[1], a[2]) || 1, lb = Math.hypot(b[0], b[1], b[2]) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb))));
}

export const PART_SKY0 = 0;
export const PART_SKY1 = 1;
export const PART_LAMP = 2;
/** Index of the first sun key's part. */
export const PART_SUN0 = 3;

/** Unit directions toward the sun of every key: the day arc, then the moon. */
export function sunKeyDirections(hours: readonly number[] = sunKeyHours()): V3[] {
  const out: V3[] = hours.map((h) => unit(sunPosition(h).direction as unknown as V3));
  out.push(unit(bearingDirection(MOON_BEARING, MOON_ELEVATION) as unknown as V3));
  return out;
}

/** Parts of a bake with `keys` sun keys (what the bakers compute, RGB each). */
export function partCount(keys: number): number {
  return PART_SUN0 + keys;
}

/** Luminance weights (linear Rec. 709). */
export const LUM: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/**
 * How the parts are stored. The sun keys differ in where their light lands, hardly in its colour (that is the colour of the
 * surfaces it bounced off, the sun's own being a live weight): each key is stored as luminance, and one chroma per texel or
 * probe (the sum of the keys' RGB) colours them. 14 keys cost 5 layers instead of 14 (docs/LIGHTING-BAKE.md).
 *
 * Volume, per probe: sky0, sky1, lamp as RGB L1 SH (12 floats each), the chroma (RGB of the keys' summed constant terms, and
 * a spare), then each key's luminance as L1 SH (4 floats).
 */
export const VOLUME_CHROMA = 36;
export const VOLUME_SUN = 40;
export function volumeLightFloats(keys: number): number {
  return VOLUME_SUN + 4 * keys;
}

/**
 * Lightmap layers (RGBA8, every layer's alpha the sky visibility): sky0 (sqrt-coded RGB), sky1 (signed), lamp, the sun keys'
 * chroma (RGB over its largest channel, linear), then the keys' luminance three to a layer (sqrt-coded, key `k` in layer
 * `LAYER_SUN0 + ⌊k/3⌋`, channel `k mod 3`).
 */
export const LAYER_SKY0 = 0;
export const LAYER_SKY1 = 1;
export const LAYER_LAMP = 2;
export const LAYER_CHROMA = 3;
export const LAYER_SUN0 = 4;
export function lightmapLayers(keys: number): number {
  return LAYER_SUN0 + Math.ceil(keys / 3);
}
/** Scales stored with a lightmap: one per layer of sky and lamp, one for the chroma (1), one per key. */
export function scaleCount(keys: number): number {
  return LAYER_SUN0 + keys;
}

/** What the live light is, as the bake's parts see it. */
export interface RelightLighting {
  /** Direction toward the sun (or moon) and its irradiance on a surface facing it; null when it is down. */
  sun: { direction: V3; irradiance: V3 } | null;
  /** Ambient of an unoccluded surface with normal n: `a + b · n.y` per channel (sky hemisphere plus image light). */
  ambient: { a: V3; b: V3 };
  /** Scale of the lamps against the strength they were baked at (0 when they are off). */
  lampScale: number;
}

/** The two keys nearest `dir` and their weights (linear in the angle between them; 1 and 0 on a key). */
export function sunKeyWeights(keys: readonly V3[], dir: V3): { i: number; j: number; wi: number; wj: number } {
  const d = unit(dir);
  let i = 0, j = 0;
  let ai = Infinity, aj = Infinity;
  for (let k = 0; k < keys.length; k++) {
    const kk = keys[k] as V3;
    const a = Math.acos(Math.max(-1, Math.min(1, kk[0] * d[0] + kk[1] * d[1] + kk[2] * d[2])));
    if (a < ai) {
      j = i;
      aj = ai;
      i = k;
      ai = a;
    } else if (a < aj) {
      j = k;
      aj = a;
    }
  }
  if (keys.length < 2 || !Number.isFinite(aj) || ai < 1e-6) return { i, j: i, wi: 1, wj: 0 };
  const wi = aj / (ai + aj);
  return { i, j, wi, wj: 1 - wi };
}

/**
 * Per-part RGB weights for the live light (three floats per part, the order of the parts), written into `out` when given.
 * Sum of `weight · part` over the parts is the bounce light the old single-time bake would have stored for this light (exactly
 * so with the sun on a key).
 */
export function relightCoefficients(keys: readonly V3[], l: RelightLighting, out?: Float32Array): Float32Array {
  const P = partCount(keys.length);
  const c = out && out.length >= P * 3 ? out : new Float32Array(P * 3);
  c.fill(0);
  for (let k = 0; k < 3; k++) {
    c[PART_SKY0 * 3 + k] = fin(l.ambient.a[k as 0 | 1 | 2]);
    c[PART_SKY1 * 3 + k] = fin(l.ambient.b[k as 0 | 1 | 2]);
    c[PART_LAMP * 3 + k] = Math.max(0, fin(l.lampScale));
  }
  if (l.sun && keys.length > 0) {
    const w = sunKeyWeights(keys, l.sun.direction);
    for (let k = 0; k < 3; k++) {
      const irr = Math.max(0, fin(l.sun.irradiance[k as 0 | 1 | 2]));
      c[(PART_SUN0 + w.i) * 3 + k] = (c[(PART_SUN0 + w.i) * 3 + k] as number) + irr * w.wi;
      c[(PART_SUN0 + w.j) * 3 + k] = (c[(PART_SUN0 + w.j) * 3 + k] as number) + irr * w.wj;
    }
  }
  return c;
}

/** Radiance factor of the open ground under each part's unit source (times the ground's albedo over π). */
export function groundFactors(keys: readonly V3[]): Float32Array {
  const g = new Float32Array(partCount(keys.length));
  g[PART_SKY0] = 1;
  g[PART_SKY1] = 1;
  g[PART_LAMP] = 0;
  keys.forEach((k, i) => (g[PART_SUN0 + i] = Math.max(0, k[1])));
  return g;
}

function fin(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
