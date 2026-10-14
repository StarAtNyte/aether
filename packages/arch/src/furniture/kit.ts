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
import { Geom, cylinder, roundedBox } from '../mesh';
import type { ArchOutput } from '../types';
import type { P2 } from '../math2';

/** How a piece is placed in a room. */
export type Mount = 'floor' | 'wall' | 'ceiling' | 'surface';

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
  build(p: ParamReader, seed: number): ArchOutput;
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
