/**
 * Compiles the material expression language (`material.shader`, parsed and type-checked by `@aether/core`'s
 * shader-lang) into TSL nodes, plus the noise and bump helpers the surface layers share.
 *
 * The parser has already checked every name, arity and size, so this is a direct walk of the AST: floats that meet a
 * vector in a component-wise function are widened explicitly (WGSL's built-ins want equal argument types).
 */
import { Fn } from 'three/tsl';
import type { positionWorld } from 'three/tsl';
import { parseShaderChannel, type ShaderChannel, type ShaderExpr, type ShaderType, type ShaderVar } from '@aether/core';
import { T, type Nd } from './tsl-lite';
import { noise01 } from './noise-texture';

/**
 * How much shading a material may cost. `low`: texture noise only, no bump or displacement, colour and emissive
 * expressions only, two surface layers; `medium`: everything with noise octaves capped at {@link MEDIUM_OCTAVES};
 * `high` / `ultra`: everything.
 */
export type ShadeTier = 'low' | 'medium' | 'high' | 'ultra';
export const MEDIUM_OCTAVES = 3;
export const LOW_OCTAVES = 2;

/** The inputs an expression reads (`p`, `n`, ... see SHADER_VARS), built for the stage it runs in. */
export type ShadeInputs = Record<ShaderVar, Nd>;

/** A dynamic swizzle (TSL nodes take any `xyz` combination as a property). */
const swz = (a: Nd, comps: string): Nd => (a as unknown as Record<string, Nd>)[comps] as Nd;

/** Widen a float to a vector of `size` (vectors pass through). */
export function widen(a: Nd, from: ShaderType, size: ShaderType): Nd {
  if (from === size || from !== 1) return a;
  // A one-argument constructor splats (the float is evaluated once).
  return size === 2 ? T.vec2(a) : T.vec3(a);
}

/** A pseudo-random 0..1 of a float, vec2 or vec3 (the classic sine hash: cheap, no texture). */
export function hashNode(a: Nd, t: ShaderType): Nd {
  const d = t === 1 ? a.mul(12.9898) : t === 2 ? T.dot(a, T.vec2(12.9898, 78.233)) : T.dot(a, T.vec3(12.9898, 78.233, 37.719));
  return T.fract(T.sin(d).mul(43758.5453));
}

/** Smooth noise, roughly -1..1: true 3D gradient noise, or the shared noise texture on the low tier. */
export function noiseNode(p3: Nd, tier: ShadeTier): Nd {
  if (tier === 'low') return noise01(p3 as unknown as typeof positionWorld, 1, 0).mul(2).sub(1) as unknown as Nd;
  return T.mx_noise_float(p3);
}

/** Octave offsets keep successive octaves from lining up at the origin. */
const OCTAVE_SHIFT = [0, 17.13, 31.71, 47.29, 63.37, 89.11] as const;

function octaves(n: number, tier: ShadeTier): number {
  const cap = tier === 'low' ? LOW_OCTAVES : tier === 'medium' ? MEDIUM_OCTAVES : 6;
  return Math.max(1, Math.min(n, cap));
}

/** Fractal noise, roughly -1..1 (amplitudes normalised). */
export function fbmNode(p3: Nd, n: number, tier: ShadeTier): Nd {
  const k = octaves(n, tier);
  let sum: Nd | null = null;
  let norm = 0;
  for (let i = 0; i < k; i++) {
    const amp = 0.5 ** i;
    const term = noiseNode(p3.mul(2 ** i).add(OCTAVE_SHIFT[i] ?? 0), tier).mul(amp);
    sum = sum ? sum.add(term) : term;
    norm += amp;
  }
  return (sum as Nd).div(norm);
}

/** Ridged fractal noise 0..1: sharp crests (mountain ridges, crack networks, veins). */
export function ridgedNode(p3: Nd, n: number, tier: ShadeTier): Nd {
  const k = octaves(n, tier);
  let sum: Nd | null = null;
  let norm = 0;
  for (let i = 0; i < k; i++) {
    const amp = 0.5 ** i;
    const r = T.abs(noiseNode(p3.mul(2 ** i).add(OCTAVE_SHIFT[i] ?? 0), tier)).oneMinus();
    const term = r.mul(r).mul(amp);
    sum = sum ? sum.add(term) : term;
    norm += amp;
  }
  return (sum as Nd).div(norm);
}

/**
 * Voronoi in 3D: distance to the nearest jittered feature point (x, about 0..1) and a 0..1 id of its cell (y). One
 * shader function with a fixed layout, so many calls share one body; the 27 neighbours are unrolled selects (no loop or
 * branch for a backend to get wrong).
 */
const voronoi = Fn(([pIn]: [Nd]) => {
  const p = pIn;
  const cell = T.floor(p);
  let best: Nd = T.float(8);
  let id: Nd = T.float(0);
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const c = cell.add(T.vec3(x, y, z));
        const jitter = T.vec3(hashNode(c, 3), hashNode(c.add(19.19), 3), hashNode(c.add(47.47), 3));
        const d = T.length(c.add(jitter).sub(p));
        const closer = d.lessThan(best);
        id = T.select(closer, hashNode(c.add(71.3), 3), id);
        best = T.min(best, d);
      }
    }
  }
  return T.vec2(best, id);
}).setLayout({ name: 'aetherVoronoi', type: 'vec2', inputs: [{ name: 'p', type: 'vec3' }] }) as unknown as (p: Nd) => Nd;

const to3 = (a: Nd, t: ShaderType): Nd => (t === 3 ? a : t === 2 ? T.vec3(a, 0) : T.vec3(a, 0, 0));

const UNARY: Readonly<Record<string, (a: Nd) => Nd>> = {
  sin: (a) => T.sin(a), cos: (a) => T.cos(a), abs: (a) => T.abs(a), floor: (a) => T.floor(a), fract: (a) => T.fract(a),
  sqrt: (a) => T.sqrt(T.max(a, 0)), exp: (a) => T.exp(a), sign: (a) => T.sign(a), saturate: (a) => T.clamp(a, 0, 1),
};

/** Build the node of a type-checked expression. */
export function compileExpr(e: ShaderExpr, inputs: ShadeInputs, tier: ShadeTier): Nd {
  const go = (x: ShaderExpr): Nd => compileExpr(x, inputs, tier);
  switch (e.k) {
    case 'num':
      return T.float(e.v);
    case 'col':
      return T.vec3(e.rgb[0], e.rgb[1], e.rgb[2]);
    case 'var':
      return inputs[e.name];
    case 'neg':
      return go(e.a).negate();
    case 'swz':
      return swz(go(e.a), e.comps);
    case 'bin': {
      const a = go(e.a);
      const b = go(e.b);
      return e.op === '+' ? a.add(b) : e.op === '-' ? a.sub(b) : e.op === '*' ? a.mul(b) : a.div(b);
    }
    case 'call': {
      const args = e.args;
      const arg = (i: number): Nd => go(args[i] as ShaderExpr);
      const wide = (i: number): Nd => widen(arg(i), (args[i] as ShaderExpr).t, e.t);
      const unary = UNARY[e.fn];
      if (unary) return unary(arg(0));
      switch (e.fn) {
        case 'min':
          return T.min(wide(0), wide(1));
        case 'max':
          return T.max(wide(0), wide(1));
        case 'pow':
          return T.pow(T.max(wide(0), 0), wide(1));
        case 'clamp':
          return T.clamp(wide(0), wide(1), wide(2));
        case 'mix':
          return T.mix(wide(0), wide(1), wide(2));
        case 'step':
          return T.step(wide(0), wide(1));
        case 'smoothstep':
          return T.smoothstep(wide(0), wide(1), wide(2));
        case 'length':
          return (args[0] as ShaderExpr).t === 1 ? T.abs(arg(0)) : T.length(arg(0));
        case 'dot':
          return (args[0] as ShaderExpr).t === 1 ? arg(0).mul(arg(1)) : T.dot(arg(0), arg(1));
        case 'cross':
          return T.cross(arg(0), arg(1));
        case 'normalize':
          return T.normalize(arg(0));
        case 'vec2':
          return args.length === 1 ? T.vec2(arg(0)) : T.vec2(...args.map(go));
        case 'vec3':
          return args.length === 1 ? T.vec3(arg(0)) : T.vec3(...args.map(go));
        case 'noise':
          return noiseNode(to3(arg(0), (args[0] as ShaderExpr).t), tier);
        case 'fbm':
          return fbmNode(to3(arg(0), (args[0] as ShaderExpr).t), (args[1] as { v: number }).v, tier);
        case 'ridged':
          return ridgedNode(to3(arg(0), (args[0] as ShaderExpr).t), (args[1] as { v: number }).v, tier);
        case 'cells':
          return voronoi(to3(arg(0), (args[0] as ShaderExpr).t)).x;
        case 'cellId':
          return voronoi(to3(arg(0), (args[0] as ShaderExpr).t)).y;
        case 'hash':
          return hashNode(arg(0), (args[0] as ShaderExpr).t);
      }
      throw new Error(`no compiler for ${e.fn}()`);
    }
  }
}

/** Parse, check and compile one channel (throws the parser's message on a bad expression). */
export function compileChannel(channel: ShaderChannel, src: string, inputs: ShadeInputs, tier: ShadeTier): Nd {
  const e = parseShaderChannel(channel, src);
  const node = compileExpr(e, inputs, tier);
  return channel === 'color' || channel === 'emissive' ? widen(node, e.t, 3) : node;
}

/**
 * A view-space normal bent by a height field `h` (metres) with screen-space derivatives (Mikkelsen's surface gradient,
 * with unnormalised position derivatives so a height in metres gives the true slope at any distance).
 */
export function bumpNormal(baseNormalView: Nd, h: Nd): Nd {
  const pv = T.positionView;
  const sx = T.dFdx(pv);
  const sy = T.dFdy(pv);
  const r1 = T.cross(sy, baseNormalView);
  const r2 = T.cross(baseNormalView, sx);
  const det = T.dot(sx, r1).mul(T.faceDirection);
  const g = T.dFdx(h).mul(r1).add(T.dFdy(h).mul(r2)).mul(T.sign(det));
  return T.normalize(T.abs(det).mul(baseNormalView).sub(g));
}

/** Signed surface curvature (1/m; convex edges positive, creases negative) from screen-space derivatives of the normal. */
export function curvatureNode(n: Nd, p: Nd): Nd {
  const dnx = T.dFdx(n);
  const dny = T.dFdy(n);
  const dpx = T.dFdx(p);
  const dpy = T.dFdy(p);
  return T.dot(dnx, dpx).add(T.dot(dny, dpy)).div(T.dot(dpx, dpx).add(T.dot(dpy, dpy)).add(1e-8));
}
