/**
 * Wall space: the one place that decides where a wall-mounted piece (art,
 * mirror, TV, whiteboard, sconce, switch, curtain) may hang. A wall is a
 * line of metres with blockers on it (doors, windows, corners, other wall
 * pieces, tall furniture); a piece needs a stretch of wall that none of the
 * blockers touches, with a per-kind margin. The layout machinery uses it to
 * place pieces (`layout.ts`) and the placement analysis uses it to audit a
 * finished document (`placement.ts`), so both agree on what "overlapping a
 * door" means.
 */

/** Kinds of things that sit on a wall face. */
export const WALL_MOUNT_KINDS: ReadonlySet<string> = new Set(['art', 'mirror', 'tv', 'whiteboard', 'sconce', 'switch', 'curtain', 'blind', 'pelmet']);

export type BlockerKind = 'door' | 'window' | 'item' | 'furniture' | 'corner';

/** Something occupying a stretch of wall (metres along the wall, heights above the floor). */
export interface WallBlocker {
  kind: BlockerKind;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  /** Entity id, plan id or label, for reports. */
  ref?: string;
}

/** How much clear wall a kind of piece wants beside each kind of blocker. */
export interface MountRule {
  /** Clear wall beside a door casing. */
  door: number;
  /** Clear wall beside a window casing. */
  window: number;
  /** Clear wall beside another wall piece. */
  item: number;
  /** Clear wall beside tall furniture. */
  furniture: number;
  /** The piece reaches this far past its nominal width on each side (a curtain rod). */
  reach: number;
  /** Furniture lower than this does not block the piece (curtains hang behind low furniture). */
  furnitureMinTop: number;
}

const DEFAULT_RULE: MountRule = { door: 0.12, window: 0.1, item: 0.06, furniture: 0.02, reach: 0, furnitureMinTop: 0 };

/** Margins per kind. Light switches sit by the door frame; curtains hang beside windows. */
export function mountRule(kind: string): MountRule {
  switch (kind) {
    case 'switch':
      return { ...DEFAULT_RULE, door: 0.03, window: 0.05, item: 0.05 };
    case 'blind':
      return { door: 0.06, window: 0.03, item: 0.03, furniture: 0, reach: 0, furnitureMinTop: 1.0 };
    case 'curtain':
      return { door: 0.06, window: 0.03, item: 0.03, furniture: 0, reach: 0.08, furnitureMinTop: 1.0 };
    case 'sconce':
      return { ...DEFAULT_RULE, door: 0.15, window: 0.12 };
    default:
      return DEFAULT_RULE;
  }
}

/** How far a curtain panel (rod included) may overlap the window it is anchored to (the pleats gather over the frame). */
export const CURTAIN_WINDOW_OVERLAP = 0.2;
/** Clear height margin above and below doors and windows. */
const V_MARGIN = 0.04;
/** Slack added to blocker margins when choosing a spot. */
const SLACK = 0.015;

/** A piece wanting wall: nominal centre, width, bottom and top. */
export interface MountSpec {
  kind: string;
  t: number;
  width: number;
  y0: number;
  y1: number;
}

/** Stretch of wall the piece occupies, rod/reach included. */
export function mountExtent(spec: MountSpec): [number, number] {
  const r = mountRule(spec.kind).reach;
  return [spec.t - spec.width / 2 - r, spec.t + spec.width / 2 + r];
}

/** The wall stretch (min, max) forbidden to `spec` by one blocker, or null when it does not block. */
export function forbiddenBy(spec: MountSpec, b: WallBlocker, anchor?: string): [number, number] | null {
  // A cornice runs along the whole top of a wall, over windows, curtains and corners alike.
  if (spec.kind === 'cornice' || spec.kind === 'pelmet') return null;
  const rule = mountRule(spec.kind);
  if (b.kind === 'furniture' && b.y1 <= rule.furnitureMinTop) return null;
  // Furniture may reach 10 cm into a piece's height (a lamp or cistern top behind a frame); openings need a clear margin.
  const vm = b.kind === 'door' || b.kind === 'window' ? V_MARGIN : b.kind === 'furniture' ? -0.1 : 0.02;
  if (spec.y1 <= b.y0 - vm || spec.y0 >= b.y1 + vm) return null;
  // A blind hangs over its own window: that window never blocks it.
  if (b.kind === 'window' && anchor !== undefined && b.ref === anchor && spec.kind === 'blind') return null;
  if (b.kind === 'window' && anchor !== undefined && b.ref === anchor && spec.kind === 'curtain') {
    // Its own window: only the glass area stays clear.
    const lo = b.t0 + CURTAIN_WINDOW_OVERLAP;
    const hi = b.t1 - CURTAIN_WINDOW_OVERLAP;
    return hi > lo ? [lo, hi] : null;
  }
  const m = b.kind === 'door' ? rule.door : b.kind === 'window' ? rule.window : b.kind === 'item' ? rule.item : b.kind === 'furniture' ? rule.furniture : 0;
  return [b.t0 - m, b.t1 + m];
}

/** The blockers `spec` collides with at its position (empty when the spot is clear). */
export function collisions(spec: MountSpec, blockers: readonly WallBlocker[], anchor?: string, tolerance = 1e-6): WallBlocker[] {
  const [e0, e1] = mountExtent(spec);
  const out: WallBlocker[] = [];
  for (const b of blockers) {
    const f = forbiddenBy(spec, b, anchor);
    if (f && e1 > f[0] + tolerance && e0 < f[1] - tolerance) out.push(b);
  }
  return out;
}

/**
 * Free stretches of wall (extent intervals) for a piece of this kind and
 * height range: the wall `[0, length]` minus everything that forbids it.
 */
export function freeWallSpans(length: number, kind: string, y0: number, y1: number, blockers: readonly WallBlocker[], anchor?: string): Array<[number, number]> {
  const probe: MountSpec = { kind, t: 0, width: 0, y0, y1 };
  let free: Array<[number, number]> = [[0, length]];
  for (const b of blockers) {
    const f = forbiddenBy(probe, b, anchor);
    if (!f) continue;
    const next: Array<[number, number]> = [];
    for (const [s, u] of free) {
      if (f[1] <= s || f[0] >= u) next.push([s, u]);
      else {
        if (f[0] > s) next.push([s, f[0]]);
        if (f[1] < u) next.push([f[1], u]);
      }
    }
    free = next;
  }
  return free.filter(([s, u]) => u - s > 0.02);
}

/**
 * Nearest valid centre to `t` for a piece of `width`, or null when no stretch
 * of the wall is wide enough. The requested spot wins when it is clear.
 */
export function nearestMountCentre(length: number, spec: MountSpec, blockers: readonly WallBlocker[], anchor?: string): number | null {
  const reach = mountRule(spec.kind).reach;
  const need = spec.width + 2 * reach;
  let best: number | null = null;
  let bestD = Infinity;
  for (const [s, u] of freeWallSpans(length, spec.kind, spec.y0, spec.y1, blockers, anchor)) {
    if (u - s < need - 1e-6) continue;
    // A hair of slack so rounding of stored positions never reads as a touch.
    if (u - s < need + SLACK * 2 && s > 0.001 && u < length - 0.001) continue;
    const lo = s + need / 2 + (s > 0.001 ? SLACK : 0);
    const hi = u - need / 2 - (u < length - 0.001 ? SLACK : 0);
    if (hi < lo - 1e-9) continue;
    const c = Math.min(hi, Math.max(lo, spec.t));
    const d = Math.abs(c - spec.t);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
