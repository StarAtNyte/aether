/**
 * Secondary motion for toon bodies: hair locks, the ponytail and skirt panels
 * as spring chains (one Verlet point per bone tail, pulled back to where the
 * animated pose puts it, damped, weighted by gravity, kept out of collision
 * capsules on the thighs, head and back, and limited in swing). Cheap: a
 * dozen bones, no allocation per frame.
 *
 * The chains and capsules come from the body file (scene extras `toon`, see
 * `scripts/characters/anime-kaho.ts`). The rig runs this after the clip and
 * its own pose corrections, on the bones the mixer never touches.
 */
import { Quaternion, Vector3, type Object3D } from 'three';

/** One spring chain as stored in the body file. */
export interface SpringChainDef {
  name: string;
  bones: string[];
  /** Tail of the last bone in its local frame. */
  tip: [number, number, number];
  /** Pull toward the animated pose per 1/60 s (0..1). */
  stiffness: number;
  /** Velocity lost per 1/60 s (0..1). */
  drag: number;
  /** Share of gravity. */
  gravity: number;
  radius: number;
  /** Largest swing from the animated direction (radians). */
  limit: number;
  /**
   * Only the capsules on bones whose name contains one of these (a skirt panel collides with the legs, not the hips or
   * the hands). Such a chain is kept out of them at several points along each link, not just its tail and middle.
   */
  collide?: string[];
}

/** One collision capsule on a bone (local head and tail). */
export interface ColliderDef {
  bone: string;
  head: [number, number, number];
  tail: [number, number, number];
  radius: number;
}

interface Link {
  bone: Object3D;
  /** Tail in the bone's local frame. */
  tail: Vector3;
  len: number;
  /** Rest rotation: each update starts from it (the clip never animates these bones). */
  rest: Quaternion;
  cur: Vector3;
  prev: Vector3;
}

interface Chain {
  def: SpringChainDef;
  links: Link[];
  /** The capsules this chain collides with. */
  caps: Capsule[];
  /** Fractions along a link where it is kept out of them (1 = its tail). */
  samples: readonly number[];
}

interface Capsule {
  bone: Object3D;
  head: Vector3;
  tail: Vector3;
  radius: number;
  a: Vector3;
  b: Vector3;
}

const _h = new Vector3();
const _t = new Vector3();
const _n = new Vector3();
const _m = new Vector3();
const _v = new Vector3();
const _d0 = new Vector3();
const _d1 = new Vector3();
const _q = new Quaternion();
const _pq = new Quaternion();
const _wq = new Quaternion();
const _ident = new Quaternion();
const GRAVITY = 9.81;
/** A tail this far (m) from its animated place is a teleport: the chain snaps back to the pose. */
const SNAP = 0.6;
/**
 * Where a link is kept out of the capsules: its tail and middle, or, for a chain with a collider filter (a skirt panel
 * against a thigh or a knee lifted on a stair), along its whole length.
 */
const SAMPLES_TIP_MID = [1, 0.5] as const;
const SAMPLES_ALONG = [1, 0.87, 0.75, 0.64, 0.54, 0.45] as const;
/** Passes of the push-out: a point pushed out of one capsule can end up in the other leg's. */
const COLLIDE_PASSES = 3;
/** The most a point is carried over a leg in one pass (m). */
const MAX_RADIAL = 0.45;
/** The soft shoulder's width beyond the panel's own radius (m). */
const SOFT_SPAN = 0.04;
/** The least share of its posed radius (about the hips' axis) a skirt panel's tail keeps. */
const MIN_RADIAL = 0.8;

/** Closest point on segment a-b to p. */
export function closestOnSegment(p: Vector3, a: Vector3, b: Vector3, out: Vector3): Vector3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2)) : 0;
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

/** How far the drape's capsule reaches past each end of the leg's (m). */
export const LINE_EXTEND = 0.05;

/**
 * The far exit (distance along the line, from its start) of the horizontal line from (cx, cy, cz) in the direction
 * (ux, 0, uz) from the capsule a-b of radius r, or -1 when it misses: the larger root of the infinite cylinder (counted
 * when the hit lies within the segment) and of the two end spheres.
 */
export function lineExit(cx: number, cy: number, cz: number, ux: number, uz: number, a0: Vector3, b0: Vector3, r: number): number {
  const l0 = Math.max(a0.distanceTo(b0), 1e-5);
  // The capsule is lengthened at both ends: cloth rows that straddle the rim of an end sphere (a vertex spacing apart)
  // would otherwise be one pushed over the leg, the next not, with the leg bulging between them.
  const kx = ((b0.x - a0.x) / l0) * LINE_EXTEND;
  const ky = ((b0.y - a0.y) / l0) * LINE_EXTEND;
  const kz = ((b0.z - a0.z) / l0) * LINE_EXTEND;
  const a = { x: a0.x - kx, y: a0.y - ky, z: a0.z - kz };
  const b = { x: b0.x + kx, y: b0.y + ky, z: b0.z + kz };
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len = Math.max(Math.hypot(abx, aby, abz), 1e-5);
  const ex = abx / len;
  const ey = aby / len;
  const ez = abz / len;
  const w0x = cx - a.x;
  const w0y = cy - a.y;
  const w0z = cz - a.z;
  const wd = w0x * ex + w0y * ey + w0z * ez;
  const wpx = w0x - ex * wd;
  const wpy = w0y - ey * wd;
  const wpz = w0z - ez * wd;
  const ud = ux * ex + uz * ez;
  const upx = ux - ex * ud;
  const upy = -ey * ud;
  const upz = uz - ez * ud;
  const A = upx * upx + upy * upy + upz * upz;
  const B = wpx * upx + wpy * upy + wpz * upz;
  const C = wpx * wpx + wpy * wpy + wpz * wpz;
  const D = B * B - A * (C - r * r);
  let exit = -1;
  if (A > 1e-6 && D >= 0) {
    const s = (-B + Math.sqrt(D)) / A;
    const t = ((w0x + ux * s) * ex + w0y * ey + (w0z + uz * s) * ez) / len;
    if (t >= 0 && t <= 1) exit = s;
  }
  const sphere = (wx: number, wy: number, wz: number): number => {
    const Bs = wx * ux + wz * uz;
    const Ds = Bs * Bs - (wx * wx + wy * wy + wz * wz - r * r);
    return Ds >= 0 ? -Bs + Math.sqrt(Ds) : -1;
  };
  return Math.max(exit, sphere(w0x, w0y, w0z), sphere(cx - b.x, cy - b.y, cz - b.z));
}

/**
 * {@link lineExit} with a soft shoulder: the larger of the exit at radius r + near, and the exit at r + far less the
 * difference. Beside a leg the cloth is carried out by at most the leg's exit minus the sideways distance past `near`,
 * so cloth that falls in the gap between two legs is bridged over (a slope of 45 degrees), not left behind them.
 */
export function softExit(cx: number, cy: number, cz: number, ux: number, uz: number, a: Vector3, b: Vector3, r: number, near: number, far: number): number {
  return Math.max(lineExit(cx, cy, cz, ux, uz, a, b, r + near), lineExit(cx, cy, cz, ux, uz, a, b, r + far) - (far - near));
}

/** Per-step factor of a per-1/60 s rate at step `dt` (frame-rate independent). */
export function rateAt(perFrame: number, dt: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, perFrame)), dt * 60);
}

/** The spring chains of one body. */
export class SpringSystem {
  private readonly chains: Chain[] = [];
  private readonly capsules: Capsule[] = [];
  private primed = false;
  /** Swinging on (off: bones stay in their animated pose). */
  enabled = true;

  constructor(root: Object3D, chains: readonly SpringChainDef[], colliders: readonly ColliderDef[] = []) {
    for (const c of colliders) {
      const bone = root.getObjectByName(c.bone);
      if (!bone) continue;
      this.capsules.push({ bone, head: new Vector3(...c.head), tail: new Vector3(...c.tail), radius: c.radius, a: new Vector3(), b: new Vector3() });
    }
    for (const def of chains) {
      const bones = def.bones.map((n) => root.getObjectByName(n)).filter((b): b is Object3D => b !== undefined);
      if (bones.length !== def.bones.length || bones.length === 0) continue;
      const links: Link[] = bones.map((bone, i) => {
        const next = bones[i + 1];
        const tail = next ? next.position.clone() : new Vector3(def.tip[0], def.tip[1], def.tip[2]);
        return { bone, tail, len: tail.length(), rest: bone.quaternion.clone(), cur: new Vector3(), prev: new Vector3() };
      });
      const only = def.collide;
      const caps = only ? this.capsules.filter((c) => only.some((n) => c.bone.name.includes(n))) : this.capsules;
      this.chains.push({ def, links, caps, samples: only ? SAMPLES_ALONG : SAMPLES_TIP_MID });
    }
  }

  /** Number of swinging bones. */
  get size(): number {
    return this.chains.reduce((s, c) => s + c.links.length, 0);
  }

  /**
   * The capsules on bones whose name contains one of `names`, posed now (world space; the skeleton's world matrices must
   * be current), their radius grown by `grow`: the leg capsules the cloth clears per vertex (cloth-clear.ts).
   */
  posedCapsules(names: readonly string[], grow = 0): Array<{ a: Vector3; b: Vector3; radius: number }> {
    const out: Array<{ a: Vector3; b: Vector3; radius: number }> = [];
    for (const c of this.capsules) {
      if (!names.some((n) => c.bone.name.includes(n))) continue;
      c.a.copy(c.head).applyMatrix4(c.bone.matrixWorld);
      c.b.copy(c.tail).applyMatrix4(c.bone.matrixWorld);
      out.push({ a: c.a, b: c.b, radius: c.radius + grow });
    }
    return out;
  }

  /** Forget the motion (after a teleport or a pose jump): the next update starts at rest. */
  reset(): void {
    this.primed = false;
  }

  /**
   * Advance by `dt`. With `axis` (the hips' centre, world) a chain with a collider filter is carried over the capsules
   * along the line of sight from it. The skeleton's world matrices must be current for the animated pose (bones above the chains); the
   * chains' own bones start from their rest rotation each step.
   */
  update(dt: number, axis?: Vector3): void {
    if (!this.enabled || this.chains.length === 0 || !(dt > 0)) return;
    for (const c of this.capsules) {
      c.a.copy(c.head).applyMatrix4(c.bone.matrixWorld);
      c.b.copy(c.tail).applyMatrix4(c.bone.matrixWorld);
    }
    const fresh = !this.primed;
    this.primed = true;
    for (const chain of this.chains) {
      const d = chain.def;
      const k = rateAt(d.stiffness, dt);
      const keep = 1 - rateAt(d.drag, dt);
      const fall = d.gravity * GRAVITY * dt * dt;
      const radial = axis !== undefined && d.collide !== undefined;
      for (const link of chain.links) {
        const bone = link.bone;
        bone.quaternion.copy(link.rest);
        bone.updateMatrixWorld(false);
        _h.setFromMatrixPosition(bone.matrixWorld);
        // Where the animated pose puts the tail.
        _t.copy(link.tail).applyMatrix4(bone.matrixWorld);
        if (fresh || link.cur.distanceToSquared(_t) > SNAP * SNAP) {
          link.cur.copy(_t);
          link.prev.copy(_t);
        }
        // Verlet: inertia, damping, gravity, pull back to the pose.
        _n.copy(link.cur).sub(link.prev).multiplyScalar(keep).add(link.cur);
        _n.y -= fall;
        _n.lerp(_t, k);
        // Stay out of the capsules (posed this frame: after the clip, the foot IK and the pelvis drop): points along the
        // link (a skirt panel must not cut through a thigh or a knee anywhere between its waist and its hem). A point at
        // fraction f pushed out by p moves the tail by p / f about the link's root; the length is kept between passes.
        for (let pass = 0; pass < COLLIDE_PASSES; pass++) {
          let moved = false;
          for (const c of chain.caps) {
            const r = c.radius + d.radius;
            for (const f of chain.samples) {
              _m.copy(_n).sub(_h).multiplyScalar(f).add(_h);
              if (radial) {
                // Over the leg: carried out along the line of sight from the hips' axis to the capsule's far side
                // (the nearest way out is often inward, between the legs, where the panel then hangs through them).
                const dx = _m.x - axis!.x;
                const dz = _m.z - axis!.z;
                const rho = Math.max(Math.hypot(dx, dz), 1e-4);
                const ex = softExit(axis!.x, _m.y, axis!.z, dx / rho, dz / rho, c.a, c.b, c.radius, d.radius, d.radius + SOFT_SPAN);
                if (ex > rho) {
                  const push = Math.min(ex - rho, MAX_RADIAL) / f;
                  _n.x += (dx / rho) * push;
                  _n.z += (dz / rho) * push;
                  moved = true;
                }
                continue;
              }
              closestOnSegment(_m, c.a, c.b, _v);
              const dm = _m.distanceTo(_v);
              if (dm < r && dm > 1e-6) {
                _n.addScaledVector(_m.sub(_v), (r - dm) / dm / f);
                moved = true;
              }
            }
          }
          if (!moved) break;
          _n.sub(_h);
          const l = _n.length();
          if (l > 1e-6) _n.multiplyScalar(link.len / l);
          _n.add(_h);
        }
        // Keep the bone's length.
        _n.sub(_h);
        const nl = _n.length();
        if (nl < 1e-6) _n.copy(_t).sub(_h);
        else _n.multiplyScalar(link.len / nl);
        // Limit the swing from the animated direction.
        _d0.copy(_t).sub(_h).normalize();
        _d1.copy(_n).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, _d0.dot(_d1))));
        if (ang > d.limit) {
          _q.setFromUnitVectors(_d0, _d1);
          _q.slerp(_ident, 1 - d.limit / ang);
          _d1.copy(_d0).applyQuaternion(_q);
          _n.copy(_d1).multiplyScalar(link.len);
        }
        if (radial) {
          // A panel never folds in toward the hips' axis (a lag at a start, a hip turned fast): its tail keeps at least
          // MIN_RADIAL of the radius the pose gives it, the length kept.
          const tx = _t.x - axis!.x;
          const tz = _t.z - axis!.z;
          const rt = Math.hypot(tx, tz);
          const nx = _n.x + _h.x - axis!.x;
          const nz = _n.z + _h.z - axis!.z;
          const rn = Math.hypot(nx, nz);
          if (rt > 0.03 && rn < MIN_RADIAL * rt) {
            const k2 = (MIN_RADIAL * rt) / Math.max(rn, 1e-4);
            _n.x = axis!.x + nx * k2 - _h.x;
            _n.z = axis!.z + nz * k2 - _h.z;
            const nl2 = _n.length();
            if (nl2 > 1e-6) _n.multiplyScalar(link.len / nl2);
          }
        }
        link.prev.copy(link.cur);
        link.cur.copy(_n).add(_h);
        // Turn the bone so its tail points at the point.
        _q.setFromUnitVectors(_d0, _d1.copy(_n).normalize());
        bone.getWorldQuaternion(_wq);
        _wq.premultiply(_q);
        if (bone.parent) bone.parent.getWorldQuaternion(_pq);
        else _pq.identity();
        bone.quaternion.copy(_pq.invert().multiply(_wq));
        bone.updateMatrixWorld(true);
      }
    }
  }
}
