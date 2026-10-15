/**
 * Furniture toolkit: the definition type shared by every `furn-*`
 * generator, a typed reader for resolved params, and small builders (legs,
 * cushions, rounded-rectangle outlines) used across the catalogue.
 *
 * Conventions (all furniture): origin at the centre of the footprint on the
 * floor (y = 0), width along X, depth along Z, the FRONT (where you sit,
 * open doors or look at a screen) faces +Z, so "against a wall" means the
 * back (−Z) touches the wall. Dimensions are real-world metres.
 */
import type { Json, MaterialFinish, MaterialSpec, ParamSpec } from '@aether/core';
import { Geom, box, cylinder, roundedBox } from '../mesh';
import type { ArchOutput } from '../types';
import type { P2 } from '../math2';

/** How a piece is placed in a room. */
export type Mount = 'floor' | 'wall' | 'ceiling' | 'surface';

/** Most movable parts one piece may expose. */
export const MAX_MOVABLES = 16;

/** How a movable part opens, in the piece's frame. */
export type MovableMotion =
  | { type: 'slide'; offset: [number, number, number] }
  | { type: 'swing'; hinge: 'left' | 'right'; angle: number }
  /** A tap or knob: flips on use; while on, a stream of water runs along the given line (piece frame). */
  | { type: 'toggle'; stream: { from: [number, number, number]; to: [number, number, number] } };

/** A drawer, cabinet door or appliance door that is its own entity so it can open. */
export interface MovableSpec {
  /** Stable id within the piece ("drawer-0", "door-1"). */
  id: string;
  /** Shown to the player ("Drawer", "Cabinet door"). */
  name: string;
  kind: 'drawer' | 'door' | 'tap';
  /** Centre of the part box in the piece frame (the part entity sits here). */
  center: [number, number, number];
  /** Box size (width, height, depth) of the part: collider and hinge reference. */
  size: [number, number, number];
  motion: MovableMotion;
  /** Geometry in the piece frame (re-centred on `center` when the part is built). */
  parts: Array<{ geom: Geom; material: MaterialSpec }>;
}

/** Collects the movable parts a builder hands out instead of merging them into the carcass. */
export class MovableSink {
  readonly specs: MovableSpec[] = [];
  add(spec: MovableSpec): void {
    if (this.specs.length < MAX_MOVABLES) this.specs.push(spec);
  }
}

/**
 * A front (cabinet door, drawer face) that is either merged into the static
 * geometry (`sink` undefined) or handed out as a movable part. `front` and
 * `handle` are in the piece frame; `body` (drawer box behind the face) is only
 * drawn for movable parts, since the carcass hides it otherwise.
 */
export function emitFront(
  sink: MovableSink | undefined,
  statics: { front: Geom; handle: Geom },
  spec: Omit<MovableSpec, 'parts'> & { front: Geom; handle: Geom; body?: Geom; frontMaterial: MaterialSpec; handleMaterial: MaterialSpec; bodyMaterial?: MaterialSpec },
): void {
  if (!sink) {
    statics.front.merge(spec.front);
    statics.handle.merge(spec.handle);
    return;
  }
  const parts: MovableSpec['parts'] = [{ geom: spec.front, material: spec.frontMaterial }, { geom: spec.handle, material: spec.handleMaterial }];
  if (spec.body) parts.push({ geom: spec.body, material: spec.bodyMaterial ?? spec.frontMaterial });
  sink.add({ id: spec.id, name: spec.name, kind: spec.kind, center: spec.center, size: spec.size, motion: spec.motion, parts });
}

/** An open-top drawer box (sides, back, bottom) behind a front, in the piece frame; the front plane is at z = zFront. */
export function drawerBox(cx: number, cy: number, width: number, height: number, zFront: number, depth: number): Geom {
  const t = 0.012;
  const g = new Geom();
  const x0 = cx - width / 2 + 0.012;
  const x1 = cx + width / 2 - 0.012;
  const y0 = cy - height / 2 + 0.015;
  const y1 = cy + height / 2 - 0.03;
  const zBack = zFront - depth;
  g.merge(box(x0, y0, zBack, x1, y0 + t, zFront - 0.01));
  g.merge(box(x0, y0, zBack, x0 + t, y1, zFront - 0.01));
  g.merge(box(x1 - t, y0, zBack, x1, y1, zFront - 0.01));
  g.merge(box(x0, y0, zBack, x1, y1, zBack + t));
  return g;
}

/** A furniture generator. */
export interface FurnitureDef {
  /** Generator id (`furn-…`). */
  id: string;
  /** Furniture kind used by layouts, checks and the agent ("sofa"). */
  kind: string;
  description: string;
  params: Record<string, ParamSpec>;
  mount: Mount;
  /** Back against a wall when placed by layout helpers. */
  againstWall: boolean;
  /** Clear floor needed in front (to sit, open doors, walk past) in metres. */
  frontClearance: number;
  /** Footprint (width along X, depth along Z) and height for resolved params. */
  size(p: ParamReader): [number, number, number];
  /**
   * Build the piece. With a `sink` the builder hands its drawers, cabinet
   * doors and appliance doors to the sink (via {@link emitFront}) instead of
   * merging them, so they can become their own, openable entities.
   */
  build(p: ParamReader, seed: number, sink?: MovableSink): ArchOutput;
  /** A small prop the player can pick up, carry and throw (a dynamic body in play mode). */
  portable?: { mass: number };
  /** True when the piece hands out movable parts (it has an `interactive` param). */
  interactive?: boolean;
}

/** Typed access to resolved params. */
export interface ParamReader {
  num(key: string): number;
  int(key: string): number;
  bool(key: string): boolean;
  str(key: string): string;
  color(key: string): string;
}

/** Reader over resolved params (values validated by the caller's resolver). */
export function reader(params: Record<string, Json>, spec: Record<string, ParamSpec>): ParamReader {
  const get = (k: string): Json | undefined => (Object.hasOwn(params, k) ? params[k] : Object.hasOwn(spec, k) ? spec[k]?.default : undefined);
  return {
    num: (k) => {
      const v = get(k);
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    },
    int: (k) => {
      const v = get(k);
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
    },
    bool: (k) => get(k) === true,
    str: (k) => {
      const v = get(k);
      return typeof v === 'string' ? v : '';
    },
    color: (k) => {
      const v = get(k);
      return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#888888';
    },
  };
}

/** Number param. */
export function num(def: number, min: number, max: number, description: string): ParamSpec {
  return { type: 'number', default: def, min, max, description };
}

/** Integer param. */
export function int(def: number, min: number, max: number, description: string): ParamSpec {
  return { type: 'int', default: def, min, max, description };
}

/** Colour param. */
export function color(def: string, description: string): ParamSpec {
  return { type: 'color', default: def, description };
}

/** Enum param. */
export function choice(options: string[], def: string, description: string): ParamSpec {
  return { type: 'enum', default: def, options, description };
}

/** Boolean param. */
export function flag(def: boolean, description: string): ParamSpec {
  return { type: 'boolean', default: def, description };
}

/** Wood options offered by most pieces. */
export const WOODS = ['oak', 'walnut', 'ash', 'black-metal', 'brass', 'chrome'];
/** Upholstery options. */
export const UPHOLSTERY = ['fabric', 'velvet', 'leather'];

/** Material of a finish name from a param (falls back to oak). */
export function mat(name: string, tint?: string): MaterialSpec {
  const f = (name || 'oak') as MaterialFinish;
  return tint ? { finish: f, color: tint } : { finish: f };
}

/** Tapered round leg from the floor to `h`. */
export function leg(x: number, z: number, h: number, r = 0.018, taper = 0.7): Geom {
  return cylinder(r * taper, r, h, 14).translate(x, 0, z);
}

/** Square leg (rounded edges). */
export function squareLeg(x: number, z: number, h: number, s = 0.04): Geom {
  return roundedBox(s, h, s, Math.min(0.006, s * 0.2), 1).translate(x, h / 2, z);
}

/**
 * A soft cushion: a rounded box with generous radius, its bottom at y0.
 * `crown` adds a slight bulge on top by lifting the centre vertices.
 */
export function cushion(w: number, h: number, d: number, y0: number, crown = 0.015): Geom {
  const r = Math.min(h * 0.45, 0.06);
  const g = roundedBox(w, h, d, r, 3);
  if (crown > 0) {
    for (let k = 0; k < g.p.length; k += 3) {
      const y = g.p[k + 1] as number;
      if (y <= 0) continue;
      const fx = 1 - Math.min(1, Math.abs(g.p[k] as number) / (w / 2));
      const fz = 1 - Math.min(1, Math.abs(g.p[k + 2] as number) / (d / 2));
      g.p[k + 1] = y + crown * Math.sqrt(fx * fz) * (y / (h / 2));
    }
  }
  return g.translate(0, y0 + h / 2, 0);
}

/** Rounded rectangle outline (plan), `seg` points per corner. */
export function roundedRect(w: number, d: number, r: number, seg = 6): P2[] {
  const hx = w / 2;
  const hz = d / 2;
  const rr = Math.max(0, Math.min(r, hx - 1e-3, hz - 1e-3));
  const out: P2[] = [];
  const corners: Array<[number, number, number]> = [
    [hx - rr, hz - rr, 0],
    [-hx + rr, hz - rr, 90],
    [-hx + rr, -hz + rr, 180],
    [hx - rr, -hz + rr, 270],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let k = 0; k <= seg; k++) {
      const a = ((a0 + (90 * k) / seg) * Math.PI) / 180;
      out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
  }
  return out;
}

/** Seeded PRNG (sfc32-lite) for deterministic decoration (books, leaves). */
export function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
