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

/** Closest point on segment a-b to p. */
export function closestOnSegment(p: Vector3, a: Vector3, b: Vector3, out: Vector3): Vector3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2)) : 0;
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
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
    for (const def of chains) {
      const bones = def.bones.map((n) => root.getObjectByName(n)).filter((b): b is Object3D => b !== undefined);
      if (bones.length !== def.bones.length || bones.length === 0) continue;
      const links: Link[] = bones.map((bone, i) => {
        const next = bones[i + 1];
        const tail = next ? next.position.clone() : new Vector3(def.tip[0], def.tip[1], def.tip[2]);
        return { bone, tail, len: tail.length(), rest: bone.quaternion.clone(), cur: new Vector3(), prev: new Vector3() };
      });
      this.chains.push({ def, links });
    }
    for (const c of colliders) {
      const bone = root.getObjectByName(c.bone);
      if (!bone) continue;
      this.capsules.push({ bone, head: new Vector3(...c.head), tail: new Vector3(...c.tail), radius: c.radius, a: new Vector3(), b: new Vector3() });
    }
  }

  /** Number of swinging bones. */
  get size(): number {
    return this.chains.reduce((s, c) => s + c.links.length, 0);
  }

  /** Forget the motion (after a teleport or a pose jump): the next update starts at rest. */
  reset(): void {
    this.primed = false;
  }

  /**
   * Advance by `dt`. The skeleton's world matrices must be current for the animated pose (bones above the chains); the
   * chains' own bones start from their rest rotation each step.
   */
  update(dt: number): void {
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
        // Stay out of the capsules: the tip, and the link's middle (a skirt panel must not cut through a thigh between its
        // waist and its hem; a push at the middle moves the tip twice as far, about the link's root).
        for (const c of this.capsules) {
          closestOnSegment(_n, c.a, c.b, _v);
          const r = c.radius + d.radius;
          const dd = _n.distanceTo(_v);
          if (dd < r && dd > 1e-6) _n.sub(_v).multiplyScalar(r / dd).add(_v);
          _m.copy(_n).sub(_h).multiplyScalar(0.5).add(_h);
          closestOnSegment(_m, c.a, c.b, _v);
          const dm = _m.distanceTo(_v);
          if (dm < r && dm > 1e-6) _n.addScaledVector(_m.sub(_v), (2 * (r - dm)) / dm);
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
