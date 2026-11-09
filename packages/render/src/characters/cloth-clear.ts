/**
 * Cloth that clears the legs, per vertex: the net under the skirt springs.
 *
 * The skirt's panels (spring chains) are kept out of the leg capsules along their length, but the cloth between two
 * panels is a blend of their turns, and the foot IK on a stair or a slope lifts a knee past anything the clips author.
 * So the toon vertex stage moves every cloth vertex (`_toon.w` = 1, written by the character pipeline for skirts) off the
 * leg capsules of the pose being drawn: the thigh and calf capsules of the body file's colliders, posed this frame after
 * the clip, the IK and the springs, plus a margin.
 *
 * Two steps, both without a new shader program (uniforms only):
 *
 * 1. The drape ({@link drapeOver}). Seen from the hips' vertical axis, the cloth behind a leg in its line of sight (a
 *    thigh lifted forward on a stair, a stride's back leg) is carried out to the leg's far side along that line, like
 *    cloth hanging over a thigh, so no gap between two panels lets the skin through.
 * 2. The nearest-way-out push. A vertex still inside a capsule moves to its surface along the line from the capsule's
 *    axis, never toward the body's own axis (what the line of sight misses: tilted ends, the calf).
 *
 * Bodies without cloth vertices, or without leg colliders, are unchanged (a zero radius pushes nothing; the axis slot
 * is 0 so the drape is off).
 *
 * The rig writes the posed capsules (world space) and the hips' axis on its body scene each update
 * ({@link writeLegCapsules}); each drawn mesh reads them in its own local space through per-object uniforms
 * ({@link clothClearNode}), so the shared toon program stays one program for every body.
 */
import { Matrix4, Vector3, Vector4, type Object3D } from 'three';
import { clamp, dot, float, length, max, mix, sqrt, step, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { closestOnSegment, LINE_EXTEND, softExit } from './springs';

/** Leg capsules drawn against (each thigh in two, as it tapers to the knee; two calves). */
export const LEG_CAPSULES = 6;
/** Clearance kept between the cloth and the leg's capsule (m). */
export const CLOTH_MARGIN = 0.006;
/** The most the drape moves a vertex (m). */
export const MAX_DRAPE = 0.45;
/**
 * The drape rides this far outside the capsule (m): the cloth between a vertex over the leg and its neighbour beside it
 * slopes, and the leg would come through the slope were it not wider by about the vertex spacing's sag.
 */
export const DRAPE_BAND = 0.02;
/** Beyond the band the drape fades at a slope of 45 degrees for this much more (m): it bridges the gap between two legs. */
export const DRAPE_SPAN = 0.045;
const KEY = 'toonLegs';
/** Uniform slot after the capsules: the hips' vertical axis (x, z in the scene's frame; w = 1 when set, 0 off). */
const AXIS = LEG_CAPSULES * 2;
const SLOTS = LEG_CAPSULES * 2 + 1;

/** One posed capsule, world space. */
export interface WorldCapsule {
  a: Vector3;
  b: Vector3;
  radius: number;
}

interface LegData {
  /** The body scene the capsules are stored in (its own frame: the body may move while its pose is held). */
  scene: Object3D;
  /** Per capsule: a (xyz) and radius, b (xyz), in the scene's frame; then the axis. */
  v: Vector4[];
  count: number;
}

const _inv = new Matrix4();
const _m = new Matrix4();
const _p = new Vector3();
const ZERO = new Vector4();

/**
 * Store the posed leg capsules (world space now; radius already including the margin; empty = off) on a body scene,
 * with the hips' position (the drape's vertical axis; null = no drape).
 */
export function writeLegCapsules(scene: Object3D, caps: readonly WorldCapsule[], axis: Vector3 | null = null): void {
  let d = scene.userData[KEY] as LegData | undefined;
  if (!d) {
    d = { scene, v: Array.from({ length: SLOTS }, () => new Vector4()), count: 0 };
    scene.userData[KEY] = d;
  }
  _inv.copy(scene.matrixWorld).invert();
  const k = 1 / Math.max(1e-6, _p.setFromMatrixColumn(scene.matrixWorld, 0).length());
  d.count = Math.min(LEG_CAPSULES, caps.length);
  for (let i = 0; i < LEG_CAPSULES; i++) {
    const c = caps[i];
    if (i >= d.count || !c) {
      d.v[i * 2]!.copy(ZERO);
      d.v[i * 2 + 1]!.copy(ZERO);
      continue;
    }
    _p.copy(c.a).applyMatrix4(_inv);
    d.v[i * 2]!.set(_p.x, _p.y, _p.z, c.radius * k);
    _p.copy(c.b).applyMatrix4(_inv);
    d.v[i * 2 + 1]!.set(_p.x, _p.y, _p.z, 0);
  }
  if (axis && d.count > 0) {
    _p.copy(axis).applyMatrix4(_inv);
    d.v[AXIS]!.set(_p.x, _p.y, _p.z, 1);
  } else d.v[AXIS]!.copy(ZERO);
}

function legDataOf(o: Object3D): LegData | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    const d = p.userData[KEY] as LegData | undefined;
    if (d) return d;
  }
  return null;
}

/** Slot `k` of the capsules of the body `object` belongs to, in the object's local space ((a, r) or (b, 0), the axis last). */
function localEntry(object: Object3D, k: number): Vector4 {
  const d = legDataOf(object);
  const src = d?.v[k];
  if (!d || !src || (k < AXIS && Math.floor(k / 2) >= d.count)) return ZERO;
  const out = ((object.userData['_toonLegsLocal'] as Vector4[] | undefined) ??= Array.from({ length: SLOTS }, () => new Vector4()))[k]!;
  // scene frame -> world -> the object's frame
  _m.copy(object.matrixWorld).invert().multiply(d.scene.matrixWorld);
  _p.set(src.x, src.y, src.z).applyMatrix4(_m);
  const x = _p.x;
  const y = _p.y;
  const z = _p.z;
  // (a radius in the object's units: a body scaled at runtime)
  out.set(x, y, z, k === AXIS ? src.w : k % 2 === 0 ? src.w * _p.setFromMatrixColumn(_m, 0).length() : 0);
  return out;
}

let uniforms: Node[] | null = null;

function legUniforms(): Node[] {
  if (!uniforms) {
    uniforms = Array.from({ length: SLOTS }, (_, k) =>
      uniform(new Vector4()).onObjectUpdate(({ object }) => (object ? localEntry(object, k) : ZERO)) as unknown as Node,
    );
  }
  return uniforms;
}

type V3 = Node<'vec3'>;
type F1 = Node<'float'>;

/** Far root of |w + s u|² = r² for a sphere (w from the sphere's centre to the line's start), -1 when it misses. */
function sphereExit(w: V3, uh: V3, r: F1): F1 {
  const B = dot(w, uh);
  const D = B.mul(B).sub(dot(w, w).sub(r.mul(r)));
  return mix(float(-1), B.negate().add(sqrt(max(D, float(0)))), step(float(0), D)) as unknown as F1;
}

/**
 * The far exit (distance along the line of sight from `c` toward `uh`) of the capsule a-b of radius r, or -1 when it
 * misses: the larger root of the infinite cylinder (counted when the hit lies within the segment) and of the two end
 * spheres.
 */
function capsuleExit(c: V3, uh: V3, a0: V3, b0: V3, r: F1): F1 {
  const e0 = b0.sub(a0).div(max(length(b0.sub(a0)), float(1e-5)));
  // (lengthened at both ends, as lineExit)
  const a = a0.sub(e0.mul(LINE_EXTEND));
  const b = b0.add(e0.mul(LINE_EXTEND));
  const ab = b.sub(a);
  const len = max(length(ab), float(1e-5));
  const e = ab.div(len);
  const w0 = c.sub(a);
  const w0p = w0.sub(e.mul(dot(w0, e)));
  const up = uh.sub(e.mul(dot(uh, e)));
  const A = dot(up, up);
  const B = dot(w0p, up);
  const C = dot(w0p, w0p);
  const D = B.mul(B).sub(A.mul(C.sub(r.mul(r))));
  const s = B.negate().add(sqrt(max(D, float(0)))).div(max(A, float(1e-6)));
  const t = dot(w0.add(uh.mul(s)), e).div(len);
  const ok = step(float(1e-6), A).mul(step(float(0), D)).mul(step(float(0), t)).mul(step(t, float(1)));
  const cyl = mix(float(-1), s, ok);
  return max(max(cyl, sphereExit(w0, uh, r)), sphereExit(c.sub(b), uh, r)) as unknown as F1;
}

/**
 * `p` (the skinned local position) with the cloth carried over the legs: along the horizontal line of sight from the
 * hips' axis, a cloth vertex (`w` the cloth flag) that lies short of the far side of a leg capsule moves out to it (by
 * at most {@link MAX_DRAPE}).
 */
export function drapeOver(p: Node, w: Node): Node {
  const u = legUniforms() as unknown as Array<Node<'vec4'>>;
  const ax = u[AXIS]!;
  const q = p as unknown as V3;
  const c = vec3(ax.x, q.y, ax.z);
  const dh = vec3(q.x.sub(ax.x), float(0), q.z.sub(ax.z));
  const rho = max(length(dh), float(1e-4));
  const uh = dh.div(rho);
  let exit = float(-1) as unknown as F1;
  for (let k = 0; k < LEG_CAPSULES; k++) {
    const A = u[k * 2]!;
    const B = u[k * 2 + 1]!;
    // (an empty slot, radius 0, stays empty)
    const on = step(float(1e-6), A.w);
    const a = vec3(A.x, A.y, A.z);
    const b = vec3(B.x, B.y, B.z);
    const near = capsuleExit(c, uh, a, b, A.w.add(DRAPE_BAND).mul(on));
    const far = capsuleExit(c, uh, a, b, A.w.add(DRAPE_BAND + DRAPE_SPAN).mul(on)).sub(DRAPE_SPAN);
    exit = max(exit, max(near, far)) as unknown as F1;
  }
  const push = clamp(exit.sub(rho), 0, MAX_DRAPE).mul(clamp(w as unknown as F1, 0, 1)).mul(ax.w);
  return q.add(uh.mul(push)) as unknown as Node;
}

/**
 * `p` (the skinned local position) moved off the leg capsules by `w` (the vertex's cloth flag): the toon body and
 * outline materials put it before anything else in their position. The drape first, then the nearest way out of any
 * capsule still holding it, except where that way points toward the body's vertical axis (the springs carry that part).
 */
export function clothClearNode(p: Node, w: Node): Node {
  const u = legUniforms() as unknown as Array<Node<'vec4'>>;
  let q = drapeOver(p, w) as unknown as V3;
  const flag = clamp(w as unknown as F1, 0, 1);
  for (let c = 0; c < LEG_CAPSULES; c++) {
    const A = u[c * 2]!;
    const B = u[c * 2 + 1]!;
    const a = vec3(A.x, A.y, A.z);
    const b = vec3(B.x, B.y, B.z);
    const r = A.w;
    const ab = b.sub(a);
    const t = clamp(dot(q.sub(a), ab).div(max(dot(ab, ab), float(1e-8))), 0, 1);
    const near = a.add(ab.mul(t));
    const d = q.sub(near);
    const l = max(length(d), float(1e-4));
    // the nearest way out, unless it points toward the body's axis (mesh space: y up, the body on its origin)
    const o = vec3(q.x, float(0), q.z);
    const outward = step(float(0), dot(d, o));
    const inside = step(l, r).mul(flag).mul(outward);
    q = mix(q, near.add(d.mul(r.div(l))), inside);
  }
  return q as unknown as Node;
}

/** {@link drapeOver} on the CPU (tests and the in-player probe): `p` moved in place; `axis` the hips' x, z. */
export function drapeOverCpu(p: Vector3, axis: { x: number; z: number }, caps: readonly { a: Vector3; b: Vector3; radius: number }[], w = 1): Vector3 {
  if (w < 0.5) return p;
  const dx = p.x - axis.x;
  const dz = p.z - axis.z;
  const rho = Math.max(Math.hypot(dx, dz), 1e-4);
  const ux = dx / rho;
  const uz = dz / rho;
  let exit = -1;
  for (const c of caps) exit = Math.max(exit, softExit(axis.x, p.y, axis.z, ux, uz, c.a, c.b, c.radius, DRAPE_BAND, DRAPE_BAND + DRAPE_SPAN));
  const push = Math.min(MAX_DRAPE, Math.max(0, exit - rho));
  p.x += ux * push;
  p.z += uz * push;
  return p;
}

/** The nearest-way-out push on the CPU (tests and the in-player probe): `p` (mesh space, y up) moved in place. */
export function clothClearCpu(p: Vector3, caps: readonly { a: Vector3; b: Vector3; radius: number }[], w = 1, axis: { x: number; z: number } | null = null): Vector3 {
  const near = new Vector3();
  const o = new Vector3();
  if (w < 0.5) return p;
  if (axis) drapeOverCpu(p, axis, caps, w);
  for (const c of caps) {
    closestOnSegment(p, c.a, c.b, near);
    const d = p.clone().sub(near);
    const l = Math.max(d.length(), 1e-4);
    if (l >= c.radius) continue;
    o.set(p.x, 0, p.z);
    if (d.dot(o) >= 0) p.copy(near).addScaledVector(d, c.radius / l);
  }
  return p;
}
