/**
 * Eye adaptation for buildings, without reading pixels back: a camera standing under a ceiling is in a room
 * lit far more dimly than the sky outside, so the exposure rises (the eye opens up) and the sky-blue image
 * based light eases off (a room is lit by bounced warm light, not by the open sky). Pure decisions; the
 * renderer keeps the smoothed state. The factor is 1 under a ceiling, 0 outdoors, and fades over a
 * short distance of the ceiling's edge so stepping through a door ramps the exposure instead of popping it.
 */

/** A ceiling's footprint and height (world metres). */
export interface CeilingBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the ceiling's underside. */
  y: number;
}

/** Exposure boost of a fully interior view, in stops. */
export const INTERIOR_EV = 0.45;
/** Share of the sky image light kept in a fully interior view. */
export const INTERIOR_ENV_KEEP = 0.6;
/** Metres over which the interior factor fades at a ceiling's edge. */
export const INTERIOR_FADE = 0.9;
/** Highest ceiling a room can have for the factor to count (metres above the eye). */
export const MAX_CEILING_ABOVE = 6;
/** Time constant (seconds) of the adaptation. */
export const ADAPT_SECONDS = 0.55;

/** Interior factor (0..1) of an eye at `x, y, z` under `ceilings`. Non-finite input counts as outdoors. */
export function interiorFactor(x: number, y: number, z: number, ceilings: readonly CeilingBox[]): number {
  if (!Number.isFinite(x + y + z)) return 0;
  let best = 0;
  for (const c of ceilings) {
    const above = c.y - y;
    if (above < 0.05 || above > MAX_CEILING_ABOVE) continue;
    // Distance inside the footprint (negative outside), so the factor ramps in over INTERIOR_FADE.
    const inside = Math.min(x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z);
    const f = Math.max(0, Math.min(1, (inside + 0.1) / INTERIOR_FADE));
    if (f > best) best = f;
  }
  return best;
}

/** One smoothing step of the adaptation toward `target` after `dt` seconds. */
export function adaptStep(current: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-Math.max(0, Math.min(1, dt)) / ADAPT_SECONDS);
  return current + (target - current) * k;
}

/** Exposure multiplier and image-light scale at interior factor `f`. */
export function adaptedLook(f: number): { exposure: number; envScale: number } {
  const t = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  return { exposure: 2 ** (INTERIOR_EV * t), envScale: 1 - (1 - INTERIOR_ENV_KEEP) * t };
}

/** Share of the light drop between outdoors and the eye's spot that the exposure makes up (a render keeps rooms darker than the garden). */
export const VOLUME_ADAPT_SHARE = 0.75;
/** Largest exposure boost (stops) the light volume asks for. */
export const VOLUME_MAX_EV = 3;
/** Largest exposure cut (stops): a room full of lamps at dusk is brighter than the dim garden. */
export const VOLUME_MIN_EV = -2;

/**
 * Exposure change (stops) for an eye inside a baked light volume: `inside` is what the volume gives the eye
 * (mean sky visibility, mean bounce luminance, the lamps' direct light), `outdoor` the luminance of the sky ambient
 * and the sun on an open site. The darker the spot relative to outdoors, the more the eye opens, by
 * {@link VOLUME_ADAPT_SHARE} of the difference, at most {@link VOLUME_MAX_EV}; a spot brighter than outdoors (lamps
 * at dusk) closes it, at most {@link VOLUME_MIN_EV}. Non-finite input asks for no change.
 */
export function volumeExposure(inside: { vis: number; bounce: number; lamps?: number }, outdoor: { ambient: number; sun: number }): number {
  const amb = Math.max(0, outdoor.ambient);
  const out = amb + 0.4 * Math.max(0, outdoor.sun);
  const lit = Math.max(0, inside.vis) * amb + Math.max(0, inside.bounce) + Math.max(0, inside.lamps ?? 0);
  if (!Number.isFinite(out) || !Number.isFinite(lit) || out <= 1e-6) return 0;
  const ratio = Math.max(1e-4, lit / out);
  return Math.max(VOLUME_MIN_EV, Math.min(VOLUME_MAX_EV, -Math.log2(ratio) * VOLUME_ADAPT_SHARE));
}
