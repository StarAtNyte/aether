/**
 * Kaho's texture atlas, painted procedurally (no image source): the face
 * (eyes with a layered iris and catchlights, lashes, brows, nose, mouth,
 * blush), the hair strip with its highlight shape, the sailor collar's stripe
 * and flat colour swatches for everything else.
 *
 * Alpha is a shading code read by the toon shader, not opacity:
 * 1 = ordinary cel shading, 0.6 = hair highlight (shown on the lit side),
 * 0.2 = unshaded (eye whites and irises keep their colour in shadow).
 */

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;

export const ALPHA_NORMAL = 1;
export const ALPHA_HIGHLIGHT = 0.6;
export const ALPHA_UNSHADED = 0.2;

/** Face projection: head-local metres to the face square (left half of the atlas). */
export const FACE_HALF = 0.1;
export const FACE_Y0 = 0.07;
/** Eye line height and eye centre offset in head-local metres. */
export const EYE_Y = 0.093;
export const EYE_X = 0.035;
/** Size of the painted eyes relative to their authored shapes. */
export const EYE_SCALE = 1.1;

export type Swatch = 'skin' | 'blouse' | 'blouseInner' | 'cuff' | 'ribbon' | 'sock' | 'skirt' | 'skirtInner' | 'shoe' | 'sole' | 'hairInner' | 'scrunchie';

const SWATCH_CELL: Record<Swatch, [number, number]> = {
  skin: [0, 0],
  blouse: [1, 0],
  blouseInner: [2, 0],
  cuff: [3, 0],
  ribbon: [4, 0],
  scrunchie: [5, 0],
  sock: [6, 0],
  skirt: [0, 1],
  skirtInner: [1, 1],
  shoe: [2, 1],
  sole: [3, 1],
  hairInner: [4, 1],
};

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const PALETTE = {
  skin: hex('#fbdccb'),
  blouse: hex('#f7f6f1'),
  blouseInner: hex('#d9dae8'),
  navy: hex('#24305a'),
  ribbon: hex('#d22f3e'),
  sock: hex('#f5f4f0'),
  skirt: hex('#28335c'),
  skirtInner: hex('#1a2244'),
  shoe: hex('#4b2b21'),
  sole: hex('#2a1915'),
  hair: hex('#5a3127'),
  hairDeep: hex('#45241d'),
  hairLight: hex('#8e5343'),
};

const SWATCH_COLOUR: Record<Swatch, RGB> = {
  skin: PALETTE.skin,
  blouse: PALETTE.blouse,
  blouseInner: PALETTE.blouseInner,
  cuff: PALETTE.navy,
  ribbon: PALETTE.ribbon,
  scrunchie: PALETTE.ribbon,
  sock: PALETTE.sock,
  skirt: PALETTE.skirt,
  skirtInner: PALETTE.skirtInner,
  shoe: PALETTE.shoe,
  sole: PALETTE.sole,
  hairInner: PALETTE.hairDeep,
};

/** UV of a flat colour. */
export function swatchUv(s: Swatch): [number, number] {
  const [cx, cy] = SWATCH_CELL[s];
  return [(1024 + cx * 128 + 64) / ATLAS_W, (512 + cy * 128 + 64) / ATLAS_H];
}

/** UV of a head-local point for the face square (clamped inside it). */
export function faceUv(x: number, y: number): [number, number] {
  const u = Math.max(0.004, Math.min(0.996, 0.5 + x / (2 * FACE_HALF)));
  const v = Math.max(0.004, Math.min(0.996, 0.5 - (y - FACE_Y0) / (2 * FACE_HALF)));
  return [(u * 1024) / ATLAS_W, (v * 1024) / ATLAS_H];
}

/** UV in the hair strip: `across` 0..1 over a lock's width, `down` 0..1 from the crown to the tips. */
export function hairUv(across: number, down: number): [number, number] {
  const u = Math.max(0.01, Math.min(0.99, across));
  const v = Math.max(0.005, Math.min(0.995, down));
  return [(1024 + u * 512) / ATLAS_W, (v * 512) / ATLAS_H];
}

/** UV in the collar strip by distance (m) from the collar's outer edge. */
export function collarUv(dist: number): [number, number] {
  const v = Math.max(0.005, Math.min(0.995, dist / COLLAR_RANGE));
  return [(1536 + 64) / ATLAS_W, (v * 512) / ATLAS_H];
}
export const COLLAR_RANGE = 0.05;
/** The white stripe of the collar, as distances from the edge (m). */
export const COLLAR_STRIPE: [number, number] = [0.0075, 0.0125];

/** Hair strip highlight centre (fraction of `down`) at `across`. */
export const HAIR_BAND = 0.24;

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number];

function over(dst: RGBA, c: RGB, a: number, code?: number): void {
  if (a <= 0) return;
  dst[0] = dst[0] * (1 - a) + c[0] * a;
  dst[1] = dst[1] * (1 - a) + c[1] * a;
  dst[2] = dst[2] * (1 - a) + c[2] * a;
  if (code !== undefined) dst[3] = dst[3] * (1 - a) + code * a;
}

const sat = (x: number): number => Math.max(0, Math.min(1, x));
const sstep = (a: number, b: number, x: number): number => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Distance from p to segment a-b (2D). */
function seg2(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l > 0 ? sat(((px - ax) * dx + (py - ay) * dy) / l) : 0;
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

/** A stroke along a polyline with a width profile over its length: coverage 0..1 (pixel size `px` for anti-aliasing). */
function stroke(x: number, y: number, pts: ReadonlyArray<readonly [number, number]>, width: (t: number) => number, px: number): number {
  let best = 1e9;
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as readonly [number, number];
    const b = pts[i + 1] as readonly [number, number];
    lens.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    total += lens[i] as number;
  }
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as readonly [number, number];
    const b = pts[i + 1] as readonly [number, number];
    const s = seg2(x, y, a[0], a[1], b[0], b[1]);
    const t = (acc + s.t * (lens[i] as number)) / (total || 1);
    const w = width(t) * 0.5;
    const d = s.d - w;
    if (d < best) best = d;
    acc += lens[i] as number;
  }
  return sat(0.5 - best / px);
}

/** Sample a curve y(x) into a polyline. */
function curve(x0: number, x1: number, f: (x: number) => number, n = 24): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    out.push([x, f(x)]);
  }
  return out;
}

// Eye shape in eye-local coordinates (ex: outward toward the temple, ey: up), metres.
const EX_IN = -0.0152;
const EX_OUT = 0.0158;
function lidU(ex: number): number {
  const u = sat((ex - EX_IN) / (EX_OUT - EX_IN));
  return 0.0005 + (0.0055 - 0.0005) * u + 0.0148 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.62);
}
function lidL(ex: number): number {
  const u = sat((ex - EX_IN) / (EX_OUT - EX_IN));
  return -0.0015 + (0.0012 + 0.0015) * u - 0.0138 * Math.pow(Math.sin(Math.PI * Math.pow(u, 1.1)), 0.9);
}

const IRIS_TOP = hex('#18224c');
const IRIS_MID = hex('#2a6a92');
const IRIS_LOW = hex('#4fb9c4');
const IRIS_GLOW = hex('#a6ece0');
const PUPIL = hex('#0e1430');
const WHITE = hex('#fbf9fb');
const WHITE_SHADE = hex('#c4bddc');
const LASH = hex('#3a1f2e');
const LASH_SOFT = hex('#7a4652');
const BROW = hex('#4d2a22');
const MOUTH = hex('#9b3d45');
const BLUSH = hex('#f39a9c');
const HATCH = hex('#e47a84');
const NOSE = hex('#e0a294');

const upper = curve(EX_IN - 0.0006, EX_OUT, (v) => lidU(v) + 0.0004, 28);
upper.push([EX_OUT + 0.0032, lidU(EX_OUT) + 0.0018]);
upper.push([EX_OUT + 0.0052, lidU(EX_OUT) + 0.0036]);
const lower = curve(EX_IN + (EX_OUT - EX_IN) * 0.5, EX_OUT - 0.0004, (v) => lidL(v) - 0.0003, 14);
const crease = curve(EX_IN + (EX_OUT - EX_IN) * 0.3, EX_OUT - 0.001, (v) => lidU(v) + 0.0042 - 0.0008 * sat((v - 0.006) / 0.01), 14);
const brow = curve(-0.0125, 0.0165, (v) => 0.0262 + 0.0026 * Math.sin(Math.PI * sat((v + 0.0125) / 0.03)) - 0.0012 * sat((v - 0.006) / 0.01), 18);
const MOUTH_LINE = curve(-0.0062, 0.0062, (v) => EYE_Y - 0.0545 + 0.0016 * (v / 0.0062) ** 2 - 0.0003, 16);

/** One eye painted onto `dst` (head-local x, y; `side` +1 for her left eye). */
function paintEye(dst: RGBA, x: number, y: number, side: number, px: number): void {
  // Painted shapes are authored at 1:1; EYE_SCALE enlarges the whole eye about its centre.
  const ex = ((x - side * EYE_X) * side) / EYE_SCALE;
  const ey = (y - EYE_Y) / EYE_SCALE;
  px /= EYE_SCALE;
  if (Math.abs(ex) > 0.026 || Math.abs(ey) > 0.03) return;
  const up = lidU(ex);
  const lo = lidL(ex);
  const insideX = sstep(EX_IN - px, EX_IN + px, ex) * (1 - sstep(EX_OUT - px, EX_OUT + px, ex));
  const open = insideX * sat(0.5 + (up - ey) / px) * sat(0.5 + (ey - lo) / px);
  if (open > 0) {
    // Eye white, shaded lilac under the upper lid.
    const shade = 1 - sstep(0.0, 0.0075, up - ey);
    over(dst, mixc(WHITE, WHITE_SHADE, shade * 0.85), open, ALPHA_UNSHADED);
    // Iris: tall ellipse, darker top, bright lower crescent, darker rim, faint radial streaks.
    const icx = 0.0004;
    const icy = -0.0012;
    const rx = 0.0099;
    const ry = 0.0134;
    const nx = (ex - icx) / rx;
    const ny = (ey - icy) / ry;
    const r = Math.hypot(nx, ny);
    const iris = open * sat(0.5 + ((1 - r) * Math.min(rx, ry)) / px);
    if (iris > 0) {
      const t = sat(0.5 - ny * 0.5);
      let c = t < 0.55 ? mixc(IRIS_TOP, IRIS_MID, sstep(0.0, 0.55, t)) : mixc(IRIS_MID, IRIS_LOW, sstep(0.55, 1, t));
      const ang = Math.atan2(ny, nx);
      const streak = 0.06 * Math.sin(ang * 17 + 0.6) * sstep(0.35, 0.8, r);
      c = mixc(c, IRIS_TOP, Math.max(0, streak));
      // Lower crescent glow.
      const cres = sstep(0.25, 0.75, -ny) * (1 - sstep(0.72, 0.92, r)) * sstep(0.3, 0.6, r);
      c = mixc(c, IRIS_GLOW, cres * 0.75);
      // Limbal ring.
      c = mixc(c, IRIS_TOP, sstep(0.82, 0.98, r) * 0.85);
      // Lid shadow over the top of the iris.
      c = mixc(c, IRIS_TOP, (1 - sstep(0.0, 0.007, up - ey)) * 0.7);
      over(dst, c, iris, ALPHA_UNSHADED);
      // Pupil.
      const pr = Math.hypot((ex - icx) / 0.0036, (ey - icy - 0.0012) / 0.0058);
      over(dst, PUPIL, iris * sat(0.5 + ((1 - pr) * 0.0036) / px) * 0.92, ALPHA_UNSHADED);
      // A soft ring of light around the pupil's lower half.
      const ring = sstep(1.2, 1.5, pr) * (1 - sstep(1.6, 2.1, pr)) * sstep(0.1, 0.5, -ny);
      over(dst, IRIS_GLOW, iris * ring * 0.35, ALPHA_UNSHADED);
    }
    // Catchlights: the same side on both eyes (one light), a big oval high and a small dot low.
    const wx = (x - side * EYE_X) / EYE_SCALE; // world-aligned eye offset (+ = her left)
    const big = Math.hypot((wx + 0.0036) / 0.0034, (ey - 0.0046) / 0.0043);
    over(dst, [1, 1, 1], open * sat(0.5 + ((1 - big) * 0.0034) / px), ALPHA_UNSHADED);
    const small = Math.hypot((wx - 0.0042) / 0.0014, (ey + 0.0068) / 0.0014);
    over(dst, [1, 1, 1], open * sat(0.5 + ((1 - small) * 0.0014) / px) * 0.95, ALPHA_UNSHADED);
  }
  // Upper lid line (lash line): thick, thicker toward the outer corner, with a flick past it.
  const lash = stroke(ex, ey, upper, (t) => (t < 0.08 ? 0.0012 + t * 0.012 : t < 0.86 ? 0.0021 + (t - 0.08) * 0.0028 : Math.max(0.0004, 0.0043 * (1 - (t - 0.86) / 0.14))), px);
  over(dst, LASH, lash, ALPHA_NORMAL);
  // Two lashes at the outer end.
  for (const [ax, ay, bx, by] of [
    [EX_OUT - 0.0028, lidU(EX_OUT - 0.0028) + 0.0012, EX_OUT + 0.0012, lidU(EX_OUT - 0.0028) + 0.0052],
    [EX_OUT - 0.0006, lidU(EX_OUT - 0.0006) + 0.0010, EX_OUT + 0.0040, lidU(EX_OUT) + 0.0052],
  ] as const) {
    over(dst, LASH, stroke(ex, ey, [[ax, ay], [bx, by]], (t) => 0.0013 * (1 - t) + 0.0003, px), ALPHA_NORMAL);
  }
  // Lower lash line: short and soft, outer half only.
  over(dst, LASH_SOFT, stroke(ex, ey, lower, (t) => 0.0004 + 0.0006 * Math.sin(Math.PI * t), px) * 0.85, ALPHA_NORMAL);
  // Lid crease.
  over(dst, LASH_SOFT, stroke(ex, ey, crease, (t) => 0.0006 * Math.sin(Math.PI * t), px) * 0.55, ALPHA_NORMAL);
  // Brow: thin, gently arched, tapering outward.
  over(dst, BROW, stroke(ex, ey, brow, (t) => 0.0019 * (1 - t * 0.75), px), ALPHA_NORMAL);
}

/** The face colour at head-local (x, y). */
function paintFace(dst: RGBA, x: number, y: number, px: number): void {
  // Blush with hatching.
  for (const side of [1, -1]) {
    const bx = side * 0.038;
    const by = EYE_Y - 0.029;
    const g = Math.exp(-(((x - bx) / 0.013) ** 2) - (((y - by) / 0.0055) ** 2));
    over(dst, BLUSH, g * 0.42, ALPHA_NORMAL);
    for (let k = -1; k <= 1; k++) {
      const hx = bx + k * 0.0052 * side;
      const h = stroke(x, y, [[hx - 0.0012, by - 0.0024], [hx + 0.0016, by + 0.0026]], () => 0.0007, px);
      over(dst, HATCH, h * 0.55, ALPHA_NORMAL);
    }
  }
  // Nose: a small tick on her right side of the bridge, and a faint shadow under the tip.
  over(dst, NOSE, stroke(x, y, [[-0.0016, EYE_Y - 0.026], [-0.0006, EYE_Y - 0.0315], [0.0012, EYE_Y - 0.0322]], (t) => 0.0009 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)), px) * 0.8, ALPHA_NORMAL);
  // Mouth: a small soft smile with a hint of the lower lip.
  const my = EYE_Y - 0.0545;
  const mouth = MOUTH_LINE;
  over(dst, MOUTH, stroke(x, y, mouth, (t) => 0.00055 + 0.0006 * Math.sin(Math.PI * t), px), ALPHA_NORMAL);
  over(dst, NOSE, stroke(x, y, [[-0.0018, my - 0.0042], [0.0018, my - 0.0042]], (t) => 0.0007 * Math.sin(Math.PI * t), px) * 0.45, ALPHA_NORMAL);
  for (const side of [1, -1]) paintEye(dst, x, y, side, px);
}

/** Paint the whole atlas: 8-bit RGBA, sRGB. */
export function paintAtlas(): Uint8Array {
  const out = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const put = (ix: number, iy: number, c: RGBA): void => {
    const o = (iy * ATLAS_W + ix) * 4;
    out[o] = Math.round(sat(c[0]) * 255);
    out[o + 1] = Math.round(sat(c[1]) * 255);
    out[o + 2] = Math.round(sat(c[2]) * 255);
    out[o + 3] = Math.round(sat(c[3]) * 255);
  };
  // Background: skin (the face square's border must be skin: the back of the head clamps onto it).
  for (let iy = 0; iy < ATLAS_H; iy++) for (let ix = 0; ix < ATLAS_W; ix++) put(ix, iy, [...PALETTE.skin, ALPHA_NORMAL]);
  // Face square, 3x3 supersampled.
  const mpp = (2 * FACE_HALF) / 1024;
  const ss = 3;
  for (let iy = 0; iy < 1024; iy++) {
    for (let ix = 0; ix < 1024; ix++) {
      const acc: RGBA = [0, 0, 0, 0];
      const x0 = -FACE_HALF + (ix + 0.5) * mpp;
      const y0 = FACE_Y0 + FACE_HALF - (iy + 0.5) * mpp;
      const near = Math.abs(Math.abs(x0) - 0.035) < 0.04 && y0 > EYE_Y - 0.07 && y0 < EYE_Y + 0.04;
      if (!near) {
        put(ix, iy, [...PALETTE.skin, ALPHA_NORMAL]);
        continue;
      }
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = x0 + ((sx + 0.5) / ss - 0.5) * mpp;
          const y = y0 - ((sy + 0.5) / ss - 0.5) * mpp;
          const c: RGBA = [...PALETTE.skin, ALPHA_NORMAL];
          paintFace(c, x, y, mpp / ss * 1.4);
          for (let k = 0; k < 4; k++) acc[k] = (acc[k] as number) + (c[k] as number) / (ss * ss);
        }
      }
      put(ix, iy, acc);
    }
  }
  // Hair strip: base colour, darker toward the tips and the lock edges, a jagged highlight band (lit side only).
  for (let iy = 0; iy < 512; iy++) {
    for (let ix = 0; ix < 512; ix++) {
      const u = (ix + 0.5) / 512;
      const v = (iy + 0.5) / 512;
      let c: RGB = mixc(PALETTE.hair, PALETTE.hairDeep, sstep(0.55, 1.0, v) * 0.7);
      const edge = Math.abs(u - 0.5) * 2;
      c = mixc(c, PALETTE.hairDeep, sstep(0.75, 1.0, edge) * 0.35);
      const centre = HAIR_BAND + 0.024 * (1 - edge) + 0.008 * Math.sin(u * 31);
      const top = HAIR_BAND - 0.008 + 0.008 * edge;
      const inBand = sstep(top - 0.003, top + 0.003, v) * (1 - sstep(centre - 0.004, centre + 0.004, v)) * (1 - sstep(0.82, 0.95, edge));
      const rgba: RGBA = [...c, ALPHA_NORMAL];
      over(rgba, PALETTE.hairLight, inBand, ALPHA_HIGHLIGHT);
      put(1024 + ix, iy, rgba);
    }
  }
  // Collar strip: navy with one white stripe.
  for (let iy = 0; iy < 512; iy++) {
    const d = ((iy + 0.5) / 512) * COLLAR_RANGE;
    const w = sstep(COLLAR_STRIPE[0] - 0.0004, COLLAR_STRIPE[0] + 0.0004, d) * (1 - sstep(COLLAR_STRIPE[1] - 0.0004, COLLAR_STRIPE[1] + 0.0004, d));
    const c = mixc(PALETTE.navy, PALETTE.blouse, w);
    for (let ix = 1536; ix < 1664; ix++) put(ix, iy, [...c, ALPHA_NORMAL]);
  }
  // Swatches.
  for (const [name, [cx, cy]] of Object.entries(SWATCH_CELL) as Array<[Swatch, [number, number]]>) {
    const c = SWATCH_COLOUR[name];
    for (let iy = 0; iy < 128; iy++) for (let ix = 0; ix < 128; ix++) put(1024 + cx * 128 + ix, 512 + cy * 128 + iy, [...c, ALPHA_NORMAL]);
  }
  return out;
}
