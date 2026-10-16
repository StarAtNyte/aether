/**
 * Species description of the four-legged anatomy and the rigid parts that go with it (ears, eyes, noses, hooves,
 * antlers, whiskers). Meshes here are in the authoring frame (+X forward, +Y up, +Z right).
 */
import { ellipsoid as ellipsoidMesh, loft, mesh, move, rotX, rotY, rotZ, tube, type Mesh, type V3 } from './vehicle-geo';
import type { Rigid } from './living-kit';

/** Coat colours and patterns (sRGB hex). */
export interface CoatSpec {
  base: string;
  back?: string;
  belly?: string;
  mask?: string;
  maskAmount?: number;
  legs?: string;
  throat?: string;
  rump?: string;
  inner?: string;
  mottle?: number;
  streak?: number;
  spots?: { color: string; scale: number; cut: number; amount: number };
  stripes?: { color: string; freq: number; cut: number; amount: number };
}

/** Head proportions. */
export interface HeadSpec {
  /** Skull semi-axes (x, y, z). */
  skull: V3;
  /** Muzzle length, how far it drops, and its radii as fractions of the skull half-width at the base and tip. */
  muzzle: number;
  muzzleDrop: number;
  muzzleW0: number;
  muzzleW1: number;
  /** Skull pitch (rad) and droop (m). */
  pitch: number;
  droop: number;
}

/** Everything that makes one four-legged species. */
export interface QuadSpec {
  id: string;
  name: string;
  tags: string;
  /** Shoulder-to-hip distance, hip joint height, rise of the back over the hips. */
  torso: number;
  hipHeight: number;
  backRise: number;
  torsoWidth: number;
  rumpDepth: number;
  waistDepth: number;
  chestDepth: number;
  belly: number;
  neck: number;
  /** Angle of the neck above horizontal (rad). */
  neckAngle: number;
  /** Neck radius at the shoulder and at the head. */
  neckR: [number, number];
  head: HeadSpec;
  tail: number;
  /** Rise of the tail line above horizontal (rad); negative hangs. */
  tailRise: number;
  /** Tail radii at four stations. */
  tailR: [number, number, number, number];
  /** Where the ears sit along the skull (fraction of its length from the head base). */
  earX: number;
  /** Ear length, width, outward tilt and backward pitch (rad); 0 length omits ears. */
  ear: { len: number; width: number; tilt: number; pitch: number; pointed?: boolean };
  /** Lateral offset of the legs as a fraction of the torso half-width. */
  legSpread: number;
  /** Segment lengths [upper, lower, foot]. */
  foreLeg: [number, number, number];
  hindLeg: [number, number, number];
  /** Hind-leg angles at the knee (forward) and hock (back), rad. */
  hindKnee: number;
  hindHock: number;
  /** Toe length forward of the ankle. */
  toe: number;
  /** Leg radii at top, mid, ankle, toe. */
  foreR: [number, number, number, number];
  hindR: [number, number, number, number];
  /** Rounded paws instead of hooves. */
  paw?: boolean;
  hooves?: boolean;
  antlers?: boolean;
  whiskers?: boolean;
  eye: number;
  horn?: string;
  noseColor?: string;
  hoofColor?: string;
  coat: CoatSpec;
  // Sculpt resolution.
  voxel: number;
  k: number;
  tris: number;
  sigma?: number;
  // Motion.
  swing: number;
  flex: number;
  walkSpeed: number;
  runSpeed: number;
  bob: number;
  gait: 'trot' | 'bound';
  tailSway: number;
  grazeDip: number;
}

/** A leaf-shaped, thin, closed plate along +X (base at the origin, tip at `len`), `width` tall, `thick` thick. */
export function leaf(len: number, width: number, thick: number, pointed = true): Mesh {
  const secs = [0, 0.12, 0.3, 0.5, 0.7, 0.86, 0.96, 1].map((t) => {
    const w = pointed ? Math.sin(Math.PI * Math.min(1, t ** 0.75 * 0.98 + 0.02)) ** 0.8 * (1 - t * 0.12) : Math.sqrt(Math.max(0, 1 - ((t - 0.45) / 0.55) ** 2)) * 0.95 + 0.05;
    const h = Math.max(0.0035, (width / 2) * (t < 0.1 ? 0.55 + t * 4.5 : w));
    return { x: t * len, hw: thick / 2, y0: -h, y1: h, e: 2.4 };
  });
  return loft(secs, { ring: 12 });
}

/** An ear: a cupped leaf standing from `base`, tilted outward (`tilt`, about the head's long axis) and back (`pitch`). */
export function ear(side: 1 | -1, base: V3, len: number, width: number, tilt: number, pitch: number, pointed = true): Mesh {
  const m = leaf(len, width, Math.max(0.004, len * 0.05), pointed);
  // Along +X -> up (+Y), then tilt outward about X and lean back about Z.
  rotZ(m, Math.PI / 2 - pitch);
  rotX(m, side * tilt);
  return move(m, base[0], base[1], base[2]);
}

/** An eyeball at `c`. */
export function eyeBall(c: V3, r: number): Mesh {
  return ellipsoidMesh(c[0], c[1], c[2], r, r * 0.92, r * 0.85, 8, 12);
}

/** A smooth tube through points. */
export function tubeMesh(points: readonly V3[], r: number, r1?: number, seg = 8): Mesh {
  return tube(points, r, { seg, steps: 6, ...(r1 !== undefined ? { r1 } : {}) });
}

/** Geometry handed to the part builder. */
export interface PartContext {
  skullC: V3;
  headBase: V3;
  muzzleB: V3;
  hd: HeadSpec;
  earAt: (side: 1 | -1) => V3;
  tailAt: (k: number) => V3;
  legPoints: (leg: 'fl' | 'fr' | 'rl' | 'rr') => { top: V3; knee: V3; ankle: V3; toe: V3 };
}

/** Rigid parts of a quadruped: ears, eyes, nose, hooves, antlers, whiskers. */
export function buildCreatureParts(s: QuadSpec, c: PartContext): Rigid[] {
  const out: Rigid[] = [];
  const { skullC, muzzleB, hd } = c;
  // Ears.
  if (s.ear.len > 0) {
    for (const side of [1, -1] as const) {
      const base = c.earAt(side);
      const m = ear(side, [0, 0, 0], s.ear.len, s.ear.width, s.ear.tilt, s.ear.pitch, s.ear.pointed ?? true);
      // The ear bone's pivot is its base: the mesh stays in absolute space.
      move(m, base[0], base[1], base[2]);
      out.push({ bone: side === 1 ? 'earR' : 'earL', mat: 'coat', geo: m, paint: (p) => [0.45 + 0.3 * Math.min(1, Math.max(0, (p[1] - base[1]) / s.ear.len)), 0.38, 0.33] });
      // Pink or dark inside: a thinner leaf inset on the inner face.
      const inner = ear(side, [0, 0, 0], s.ear.len * 0.82, s.ear.width * 0.62, s.ear.tilt, s.ear.pitch, s.ear.pointed ?? true);
      move(inner, base[0] + 0.004, base[1] + s.ear.len * 0.02, base[2] - side * Math.max(0.003, s.ear.len * 0.03));
      out.push({ bone: side === 1 ? 'earR' : 'earL', mat: 'inner', geo: inner });
    }
  }
  // Eyes.
  for (const side of [1, -1] as const) {
    const eye = eyeBall([skullC[0] + hd.skull[0] * 0.12, skullC[1] + hd.skull[1] * 0.28, side * hd.skull[2] * 0.9], s.eye);
    out.push({ bone: 'head', mat: 'eye', geo: eye });
  }
  // Nose pad.
  out.push({ bone: 'head', mat: 'nose', geo: ellipsoidMesh(muzzleB[0] + hd.skull[2] * hd.muzzleW1 * 0.5, muzzleB[1] + hd.skull[2] * hd.muzzleW1 * 0.55, 0, hd.skull[2] * hd.muzzleW1 * 0.85, hd.skull[2] * hd.muzzleW1 * 0.7, hd.skull[2] * hd.muzzleW1 * 1.05, 8, 12) });
  // Hooves.
  if (s.hooves) {
    for (const leg of ['fl', 'fr', 'rl', 'rr'] as const) {
      const p = c.legPoints(leg);
      const r = (leg[0] === 'f' ? s.foreR : s.hindR)[3];
      const h = ellipsoidMesh(p.toe[0] + r * 0.7, p.toe[1] + r * 0.3, p.toe[2], r * 2.1, r * 1.5, r * 1.3, 8, 12);
      out.push({ bone: `${leg}_foot`, mat: 'hoof', geo: h });
    }
  }
  // Antlers: two beams sweeping back and up, with brow, bez and top tines.
  if (s.antlers) {
    const hb = c.headBase;
    for (const side of [1, -1] as const) {
      const root: V3 = [hb[0] + hd.skull[0] * 0.55, hb[1] + hd.skull[1] * 0.85, side * hd.skull[2] * 0.55];
      const at = (dx: number, dy: number, dz: number): V3 => [root[0] + dx * 0.62, root[1] + dy * 0.62, root[2] + side * dz * 0.9];
      const beam = [at(0, 0, 0), at(-0.02, 0.1, 0.03), at(-0.07, 0.22, 0.08), at(-0.1, 0.34, 0.1), at(-0.06, 0.46, 0.1), at(0.02, 0.56, 0.08), at(0.1, 0.62, 0.07)];
      const g = tubeMesh(beam, 0.017, 0.006, 8);
      const tine = (from: V3[], r0: number): void => {
        const t = tubeMesh(from, r0, 0.004, 6);
        g.p.push(...t.p);
        g.n.push(...t.n);
        const base = g.p.length / 3 - t.p.length / 3;
        for (const i of t.i) g.i.push(i + base);
      };
      tine([at(0.0, 0.06, 0.0), at(0.08, 0.1, 0.01), at(0.16, 0.14, 0.0)], 0.011);
      tine([at(-0.04, 0.2, 0.06), at(0.04, 0.26, 0.04), at(0.1, 0.34, 0.02)], 0.01);
      tine([at(-0.1, 0.34, 0.1), at(-0.16, 0.42, 0.12), at(-0.2, 0.5, 0.12)], 0.009);
      tine([at(0.02, 0.56, 0.08), at(0.06, 0.66, 0.1), at(0.04, 0.74, 0.1)], 0.008);
      out.push({ bone: 'head', mat: 'horn', geo: g, paint: (_p, _n) => [0.78, 0.72, 0.6] });
    }
  }
  // Whiskers (thin, pale).
  if (s.whiskers) {
    for (const side of [1, -1] as const) {
      for (let k = 0; k < 4; k++) {
        const y = muzzleB[1] + 0.012 - k * 0.006;
        const w = tubeMesh([[muzzleB[0] - hd.muzzle * 0.35, y, side * hd.skull[2] * 0.45], [muzzleB[0] - hd.muzzle * 0.15, y + 0.01 - k * 0.006, side * hd.skull[2] * 1.4], [muzzleB[0] - hd.muzzle * 0.45, y + 0.02 - k * 0.012, side * hd.skull[2] * 2.6]], 0.0012, 0.0004, 4);
        out.push({ bone: 'head', mat: 'whisker', geo: w });
      }
    }
  }
  void mesh;
  void rotY;
  return out;
}
