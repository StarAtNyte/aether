/**
 * `material.surface`: layered, world-space procedural weathering and effects for any mesh (generated, sculpted,
 * imported), with no UVs.
 *
 * Every layer is a weight (amount × its own pattern × the optional mask) that pulls the colour, roughness and metalness
 * toward the layer's look, adds relief (a height in metres for the bump) and, for the glowing kinds, emission. The
 * patterns read the shared noise texture (one fetch per octave, see noise-texture.ts) at world positions, so a wall,
 * a statue and a rock weather alike at every scale. Face orientation comes from the geometric normal; crevices and
 * edges from the screen-space curvature of that normal (smooth-shaded meshes; a flat-shaded face has none).
 */
import type { positionWorld } from 'three/tsl';
import type { MaterialSurface, SurfaceLayer, SurfaceLayerKind, SurfaceMask } from '@aether/core';
import { T, type Nd } from './tsl-lite';
import { noise01 } from './noise-texture';
import { hashNode, type ShadeTier } from './shader-nodes';

/** The surface inputs the layers read (world space). */
export interface LayerInputs {
  /** World position. */
  p: Nd;
  /** Geometric world normal. */
  n: Nd;
  /** Object-space height above the piece's base (generators stand on y = 0). */
  oy: Nd;
  /** Unit vector from the surface toward the camera. */
  v: Nd;
  /** Signed curvature (1/m): convex edges positive, crevices negative. */
  k: Nd;
  /** Seconds. */
  t: Nd;
}

/** What the layers make of a base look. */
export interface LayerResult {
  color: Nd;
  roughness: Nd;
  metalness: Nd;
  /** Added emission (linear), or null. */
  emissive: Nd | null;
  /** Relief in metres for the bump, or null. */
  height: Nd | null;
}

/** Default feature size (m) of each kind (a pulse's period in seconds). */
export const LAYER_SCALE: Readonly<Record<SurfaceLayerKind, number>> = Object.freeze({
  tone: 3, veins: 1.2, strata: 0.6, moss: 1.5, snow: 2, grime: 1.5, streaks: 1.2, edgeWear: 0.15, wet: 1, lichen: 0.12, rust: 0.8,
  scratches: 0.3, cracks: 0.8, glowCracks: 0.8, runes: 0.5, pattern: 1, pulse: 2, rim: 1, sparkle: 0.05,
});

/** Default colours (sRGB) of the kinds that paint one. */
const LAYER_COLOR: Partial<Record<SurfaceLayerKind, string>> = {
  moss: '#4a5a2a', snow: '#f2f5fa', grime: '#2b261f', lichen: '#b4ac72', rust: '#7a3a18', glowCracks: '#ff5010', runes: '#40c0ff',
  pattern: '#40c0ff', pulse: '#60d0ff', rim: '#60d0ff', sparkle: '#ffffff',
};

/** Layers kept on the low tier. */
export const LOW_TIER_LAYERS = 2;

const hexLinear = (hex: string): [number, number, number] => {
  const f = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [f(1), f(3), f(5)];
};
const colorOf = (layer: SurfaceLayer): Nd | null => {
  const hex = layer.color ?? LAYER_COLOR[layer.kind];
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r, g, b] = hexLinear(hex);
  return T.vec3(r, g, b);
};

/** The coverage of a mask at this point (1 everywhere without one). */
export function maskNode(mask: SurfaceMask | undefined, inp: LayerInputs, salt: number): Nd | null {
  if (!mask) return null;
  let m: Nd | null = null;
  const and = (x: Nd): void => {
    m = m ? m.mul(x) : x;
  };
  const ny = inp.n.y;
  if (mask.up !== undefined) and(T.smoothstep(mask.up - 0.1, mask.up + 0.1, ny));
  if (mask.down !== undefined) and(T.smoothstep(mask.down - 0.1, mask.down + 0.1, ny.negate()));
  if (mask.slope) {
    // Angle from straight up, compared in the cosine domain (no acos per pixel).
    const lo = Math.min(mask.slope[0], mask.slope[1]);
    const hi = Math.max(mask.slope[0], mask.slope[1]);
    const cosLo = Math.cos((lo * Math.PI) / 180);
    const cosHi = Math.cos((hi * Math.PI) / 180);
    const steepEnough = T.smoothstep(cosLo - 0.05, cosLo + 0.05, ny).oneMinus();
    const flatEnough = T.smoothstep(cosHi - 0.05, cosHi + 0.05, ny);
    and(lo <= 0 ? flatEnough : hi >= 180 ? steepEnough : flatEnough.mul(steepEnough));
  }
  if (mask.height) {
    const lo = Math.min(mask.height[0], mask.height[1]);
    const hi = Math.max(mask.height[0], mask.height[1]);
    and(T.smoothstep(lo - 0.25, lo + 0.25, inp.p.y).mul(T.smoothstep(hi - 0.25, hi + 0.25, inp.p.y).oneMinus()));
  }
  if (mask.noise !== undefined) {
    const c = mask.noise;
    and(T.smoothstep(1 - c - 0.08, 1 - c + 0.08, n01(inp, 4, 2, salt + 0.5)));
  }
  if (m === null) return mask.invert ? T.float(0) : null;
  return mask.invert ? (m as Nd).oneMinus() : m;
}

/**
 * The plane each face-normal axis projects onto, as two world coordinates (0 = x, 1 = y, 2 = z): a face along x reads
 * (z, y), the top (x, z), a face along z (x, y). Walls keep height as their second coordinate, so a stretch along it
 * runs down the wall. Every face sees the field at its own metric: one metre on the face is one metre of noise.
 */
export const LAYER_NOISE_PLANES: readonly (readonly [0 | 1 | 2, 0 | 1 | 2])[] = [[2, 1], [0, 2], [0, 1]];
/** Blend sharpness of the three projections (power of |n|): faces read one plane, only bevels and curves mix. */
export const LAYER_NOISE_BLEND = 4;
/** Per-plane offsets of the field, so the three planes never show the same pattern at a corner. */
const PLANE_OFFSET: readonly (readonly [number, number])[] = [[0.13, 0.71], [0, 0], [0.47, 0.29]];

/**
 * The shared noise field (0..1) at a feature size in metres, projected per face (triplanar on the geometric normal);
 * `salt` decorrelates layers and `stretch` scales the two in-plane coordinates (scratches, runs).
 *
 * The plain world-space lookup (noise01 maps a 3D point onto its 2D field by a fixed skew of height) is fine for
 * ground but not for weathering on walls: on a face along z the skew squeezes the field about four to one along a
 * diagonal, so thresholded patches (rust, lichen) came out as broad diagonal stripes. Here each face samples the plane
 * it faces at its own metric, and the blend keeps the field's spread where planes mix.
 */
function n01(inp: Pick<LayerInputs, 'p' | 'n'>, size: number, channel: 0 | 1 | 2, salt: number, q: Nd = inp.p, stretch: readonly [number, number] = [1, 1]): Nd {
  const a = T.abs(inp.n);
  const a2 = a.mul(a);
  const wRaw = LAYER_NOISE_BLEND === 4 ? a2.mul(a2) : T.pow(a, LAYER_NOISE_BLEND);
  const w = wRaw.div(T.max(wRaw.x.add(wRaw.y).add(wRaw.z), 1e-5));
  const comp = (axis: 0 | 1 | 2): Nd => (axis === 0 ? q.x : axis === 1 ? q.y : q.z);
  let sum: Nd | null = null;
  for (let i = 0; i < 3; i++) {
    const [ua, va] = LAYER_NOISE_PLANES[i]!;
    const off = PLANE_OFFSET[i]!;
    // noise01 reads (x + y·skew, z + y·skew): with y = 0 it is a plain 2D lookup of (u, v).
    const uv = T.vec3(comp(ua).mul(stretch[0]), 0, comp(va).mul(stretch[1]));
    const f = (noise01(uv as unknown as typeof positionWorld, 1 / Math.max(1e-3, size), channel, [salt * 0.37 + off[0], salt * 0.61 + off[1]]) as unknown as Nd).sub(0.5);
    const wi = i === 0 ? w.x : i === 1 ? w.y : w.z;
    sum = sum ? sum.add(f.mul(wi)) : f.mul(wi);
  }
  // A weighted mean of independent fields has less spread than one; divide by the weights' norm to give it back.
  const norm = T.sqrt(T.dot(w, w));
  return T.clamp((sum as Nd).div(T.max(norm, 1e-3)).add(0.5), 0, 1);
}

/** Thin lines along the 0.5 crossings of a noise field (cracks, veins): 1 on the line, 0 away from it. */
const crest = (field: Nd, width: number): Nd => T.smoothstep(0, width, T.abs(field.sub(0.5))).oneMinus();

/** UVs on the plane facing the normal most (runes and patterns on walls, floors and ceilings alike). */
function planarUv(p: Nd, n: Nd): Nd {
  const a = T.abs(n);
  const yz = T.select(a.x.greaterThan(a.z), T.vec2(p.z, p.y), T.vec2(p.x, p.y));
  return T.select(a.y.greaterThan(T.max(a.x, a.z)), T.vec2(p.x, p.z), yz);
}

interface Look {
  w: Nd;
  color?: Nd;
  rough?: Nd | number;
  metal?: number;
  height?: Nd;
  emissive?: Nd;
  /** A direct transform of the colour (tone, wet), instead of a pull toward `color`. */
  recolor?: (c: Nd) => Nd;
  reroughen?: (r: Nd) => Nd;
}

function layerLook(layer: SurfaceLayer, inp: LayerInputs, i: number, sizeScale: number, base: Nd, rough: Nd): Look | null {
  const A = layer.amount ?? 0.5;
  const kind = layer.kind;
  const s = (layer.scale ?? LAYER_SCALE[kind]) * (kind === 'pulse' ? 1 : sizeScale);
  const col = colorOf(layer);
  const { p, n } = inp;
  const salt = i * 3 + 1;
  const N = (size: number, ch: 0 | 1 | 2): Nd => n01(inp, size, ch, salt);
  const crevice = T.smoothstep(0, 2, inp.k.negate());
  const convex = (k0: number): Nd => T.smoothstep(k0 * 0.5, k0 * 2, inp.k);
  switch (kind) {
    case 'tone': {
      const v = N(s, 0).sub(0.5).mul(2);
      const hue = N(s * 0.35, 1).sub(0.5).mul(2);
      const tint = col;
      return {
        w: T.float(1),
        recolor: (c) => {
          const shaded = c.mul(v.mul(0.35 * A).add(1));
          return tint ? T.mix(shaded, tint.mul(T.dot(c, T.vec3(0.3, 0.59, 0.11)).mul(2)), T.clamp(hue, 0, 1).mul(0.5 * A)) : shaded;
        },
        reroughen: (r) => T.clamp(r.mul(v.mul(0.2 * A).add(1)), 0.02, 1),
      };
    }
    case 'veins': {
      const dir = T.dot(p, T.vec3(0.8, 0.45, 0.3)).mul(Math.PI / s);
      const warp = N(s * 0.5, 0).add(N(s * 0.25, 1).mul(0.5)).mul(8);
      const vein = T.smoothstep(0, 0.12, T.abs(T.sin(dir.add(warp)))).oneMinus();
      return { w: vein.mul(A), color: col ?? base.mul(0.35), rough: rough.mul(0.85) };
    }
    case 'strata': {
      const band = T.fract(p.y.div(s).add(N(s * 3, 0).sub(0.5).mul(0.6)));
      const seam = T.smoothstep(0, 0.12, band).mul(T.smoothstep(0.88, 1, band).oneMinus()).oneMinus();
      // Each bed its own shade: a hash of the bed index.
      const bed = hashNode(T.floor(p.y.div(s).add(N(s * 3, 0).sub(0.5).mul(0.6))), 1).sub(0.5).mul(0.3 * A);
      return {
        w: seam.mul(A),
        color: col ?? base.mul(0.55),
        recolor: (c) => c.mul(bed.add(1)),
        height: seam.mul(-Math.min(0.01, s * 0.02) * A),
      };
    }
    case 'moss': {
      const cover = T.max(T.smoothstep(0.2, 0.8, n.y).mul(0.8), crevice);
      const m = cover.mul(N(s, 0).mul(0.8).add(0.6));
      const w = T.smoothstep(1 - A, 1.15 - A, m);
      const c = (col as Nd).mul(N(s * 0.15, 1).mul(0.4).add(0.8));
      return { w, color: c, rough: 0.95, metal: 0, height: w.mul(0.004).mul(N(s * 0.05, 2)) };
    }
    case 'snow': {
      const w = T.smoothstep(0.55 - A * 0.5, 0.75 - A * 0.5, n.y.add(N(s, 0).sub(0.5).mul(0.5)));
      return { w, color: col as Nd, rough: 0.55, metal: 0, height: w.mul(0.01) };
    }
    case 'grime': {
      const low = T.smoothstep(0, 1.2, inp.oy).oneMinus();
      const under = T.smoothstep(0, 0.6, n.y.negate()).mul(0.6);
      const g = T.max(T.max(low, crevice), under).mul(N(s, 0).add(0.5));
      const w = T.clamp(g.mul(A * 1.4), 0, 1).mul(0.85);
      return { w, color: col as Nd, rough: 0.9 };
    }
    case 'streaks': {
      const steep = T.smoothstep(0.3, 0.6, T.abs(n.y)).oneMinus();
      const runs = n01(inp, s * 0.25, 1, salt, p.mul(T.vec3(1, 0.06, 1)));
      const w = steep.mul(T.smoothstep(0.5, 0.75, runs)).mul(A);
      return { w, color: col ?? base.mul(0.45) };
    }
    case 'edgeWear': {
      const conv = convex(0.5 / s);
      const chips = N(s * 0.5, 2);
      const w = T.clamp(T.smoothstep(0.3, 0.7, conv.mul(chips.add(0.4))).mul(A * 1.5), 0, 1);
      return { w, color: col ?? base.mul(1.45).add(0.03), rough: rough.mul(0.85), height: w.mul(-0.002) };
    }
    case 'wet':
      return { w: T.float(A), recolor: (c) => c.mul(T.mix(T.vec3(1, 1, 1), col ? col.mul(0.6) : T.vec3(0.5, 0.5, 0.5), A)), rough: 0.08 };
    case 'lichen': {
      const spots = T.smoothstep(0.66, 0.7, N(s, 0)).mul(T.smoothstep(0.4, 0.6, N(s * 8, 1)));
      const upish = T.clamp(n.y, 0, 1).mul(0.5).add(0.5);
      const w = T.clamp(spots.mul(upish).mul(A * 1.6), 0, 1);
      return { w, color: col as Nd, rough: 0.9, height: w.mul(0.0015) };
    }
    case 'rust': {
      // Patches with ragged edges (a finer octave on the broad one), leaning to crevices, edges and the foot.
      const field = N(s, 0).add(N(s * 0.3, 2).sub(0.5).mul(0.35));
      const lean = field.add(T.max(crevice, convex(10)).mul(0.12)).add(T.smoothstep(0, 1, inp.oy).oneMinus().mul(0.08));
      // The field sits at 0.5 ± 0.14: the threshold puts `amount` 0.5 at about a quarter of the surface, 1 at nearly all of it
      // (it was centred below the field's mean, so even a light rust covered most of a wall).
      const t0 = 0.76 - 0.32 * A;
      const w = T.smoothstep(t0 - 0.03, t0 + 0.03, lean);
      const detail = N(s * 0.1, 1);
      return { w, color: (col as Nd).mul(detail.mul(0.6).add(0.7)), rough: 0.92, metal: 0, height: w.mul(detail).mul(0.002) };
    }
    case 'scratches': {
      // Two families of fine lines on every face: the field squeezed along one in-plane axis, then along the other.
      const a = crest(n01(inp, s * 0.2, 0, salt, p, [0.05, 1]), 0.015);
      const b = crest(n01(inp, s * 0.2, 1, salt, p, [1, 0.05]), 0.015);
      const w = T.max(a, b).mul(T.smoothstep(0.4, 0.6, N(s * 4, 2))).mul(A);
      return { w, color: col ?? base.mul(1.3).add(0.04), rough: rough.mul(0.6), height: w.mul(-0.0005) };
    }
    case 'cracks':
    case 'glowCracks': {
      const net = crest(N(s, 0), 0.02 + 0.03 * A).mul(T.smoothstep(0.45 - A * 0.3, 0.6 - A * 0.3, N(s * 2.7, 1)));
      const fine = crest(N(s * 0.35, 2), 0.02).mul(0.6 * A);
      const w = T.max(net, fine);
      if (kind === 'cracks') return { w, color: col ?? base.mul(0.15), rough: 0.95, height: w.mul(-0.006 * Math.min(1, s)) };
      const flicker = T.sin(inp.t.mul(1.7).add(N(s * 2, 2).mul(6))).mul(0.15).add(0.85);
      return { w: w.mul(0.6), color: base.mul(0.2), height: w.mul(-0.006 * Math.min(1, s)), emissive: (col as Nd).mul(w.mul(flicker).mul(1 + 3 * A)) };
    }
    case 'runes':
    case 'pattern': {
      const g = planarUv(p, n).div(s);
      const cell = T.floor(g);
      const f = T.fract(g);
      const h = (k: number): Nd => hashNode(cell.add(k), 2);
      let w: Nd;
      if (kind === 'runes') {
        const inner = T.step(0.2, f.y).mul(T.step(f.y, 0.8));
        const innerX = T.step(0.2, f.x).mul(T.step(f.x, 0.8));
        const vert = T.step(T.abs(f.x.sub(0.5)), 0.06).mul(inner).mul(T.step(0.5, h(1)));
        const horiz = T.step(T.abs(f.y.sub(0.5)), 0.06).mul(innerX).mul(T.step(0.5, h(2)));
        const diag = T.step(T.abs(f.x.sub(f.y)), 0.06).mul(inner).mul(innerX).mul(T.step(0.6, h(3)));
        const ring = T.step(T.abs(T.length(f.sub(0.5)).sub(0.28)), 0.05).mul(T.step(0.7, h(4)));
        // Amount is the share of cells that carry a glyph.
        w = T.max(T.max(vert, horiz), T.max(diag, ring)).mul(T.step(1 - A, h(9)));
      } else {
        const edge = T.min(T.min(f.x, f.x.oneMinus()), T.min(f.y, f.y.oneMinus()));
        const line = T.smoothstep(0.02, 0.05, edge).oneMinus();
        const node = T.step(T.length(f.sub(0.5)), 0.08).mul(T.step(0.5, h(5)));
        w = T.max(line, node);
      }
      return { w: w.mul(0.7), color: base.mul(0.4), height: w.mul(-0.002), emissive: (col as Nd).mul(w.mul(0.5 + 2.5 * A)) };
    }
    case 'pulse': {
      const phase = T.sin(inp.t.mul((2 * Math.PI) / Math.max(0.05, s))).mul(0.5).add(0.5);
      return { w: T.float(0), emissive: (col as Nd).mul(phase.mul(2 * A)) };
    }
    case 'rim': {
      const facing = T.clamp(T.dot(n, inp.v), 0, 1).oneMinus();
      return { w: T.float(0), emissive: (col as Nd).mul(T.pow(facing, 3 - 1.5 * A).mul(1 + 3 * A)) };
    }
    case 'sparkle': {
      const twinkle = T.fract(N(s, 0).mul(31).add(T.dot(inp.v, T.vec3(4.1, 3.3, 2.7))).add(N(s * 1.7, 1).mul(17)));
      const sp = T.smoothstep(1 - 0.02 * (0.3 + A), 1, twinkle);
      return { w: T.float(0), emissive: (col as Nd).mul(sp.mul(4 * A)) };
    }
  }
  return null;
}

/** Apply the layers in order to a base colour / roughness / metalness. */
export function surfaceNodes(spec: MaterialSurface, inp: LayerInputs, base: { color: Nd; roughness: Nd; metalness: Nd }, tier: ShadeTier): LayerResult {
  const layers = tier === 'low' ? spec.layers.slice(0, LOW_TIER_LAYERS) : spec.layers;
  const sizeScale = spec.scale ?? 1;
  let color = base.color;
  let rough = base.roughness;
  let metal = base.metalness;
  let emissive: Nd | null = null;
  let height: Nd | null = null;
  layers.forEach((layer, i) => {
    const look = layerLook(layer, inp, i, sizeScale, color, rough);
    if (!look) return;
    const mask = maskNode(layer.mask, inp, i);
    const w = mask ? look.w.mul(mask) : look.w;
    if (look.recolor) color = T.mix(color, look.recolor(color), mask ?? T.float(1));
    if (look.color) color = T.mix(color, look.color, w);
    if (look.reroughen) rough = T.mix(rough, look.reroughen(rough), mask ?? T.float(1));
    if (look.rough !== undefined) rough = T.mix(rough, typeof look.rough === 'number' ? T.float(look.rough) : look.rough, w);
    if (look.metal !== undefined) metal = T.mix(metal, T.float(look.metal), w);
    if (look.height && tier !== 'low') {
      const h = mask ? look.height.mul(mask) : look.height;
      height = height ? height.add(h) : h;
    }
    if (look.emissive) {
      const e = mask ? look.emissive.mul(mask) : look.emissive;
      emissive = emissive ? emissive.add(e) : e;
    }
  });
  return { color, roughness: rough, metalness: metal, emissive, height };
}
