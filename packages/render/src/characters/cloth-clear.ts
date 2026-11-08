/**
 * Cloth that clears the legs, per vertex: the safety net under the skirt springs.
 *
 * The skirt's panels (spring chains) are kept out of the leg capsules along their length, but the cloth between two
 * panels is a blend of their turns, and the foot IK on a stair or a slope lifts a knee past anything the clips author.
 * So the toon vertex stage pushes every cloth vertex (`_toon.w` = 1, written by the character pipeline for skirts) out
 * of the leg capsules of the pose being drawn: the thigh and calf capsules of the body file's colliders, posed this frame
 * after the clip, the IK and the springs, plus a margin. A vertex inside a capsule moves to its surface along the line
 * from the capsule's axis (never toward the body's own axis). Bodies
 * without cloth vertices, or without leg colliders, are unchanged (a zero radius pushes nothing).
 *
 * The rig writes the posed capsules (world space) on its body scene each update ({@link writeLegCapsules}); each drawn
 * mesh reads them in its own local space through per-object uniforms ({@link clothClearNode}), so the shared toon
 * program stays one program for every body.
 */
import { Matrix4, Vector3, Vector4, type Object3D } from 'three';
import { clamp, dot, float, length, max, mix, step, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { closestOnSegment } from './springs';

/** Leg capsules drawn against (each thigh in two, as it tapers to the knee; two calves). */
export const LEG_CAPSULES = 6;
/** Clearance kept between the cloth and the leg's capsule (m). */
export const CLOTH_MARGIN = 0.006;
const KEY = 'toonLegs';

/** One posed capsule, world space. */
export interface WorldCapsule {
  a: Vector3;
  b: Vector3;
  radius: number;
}

interface LegData {
  /** The body scene the capsules are stored in (its own frame: the body may move while its pose is held). */
  scene: Object3D;
  /** Per capsule: a (xyz) and radius, b (xyz), in the scene's frame. */
  v: Vector4[];
  count: number;
}

const _inv = new Matrix4();
const _m = new Matrix4();
const _p = new Vector3();
const ZERO = new Vector4();

/** Store the posed leg capsules (world space now; radius already including the margin; empty = off) on a body scene. */
export function writeLegCapsules(scene: Object3D, caps: readonly WorldCapsule[]): void {
  let d = scene.userData[KEY] as LegData | undefined;
  if (!d) {
    d = { scene, v: Array.from({ length: LEG_CAPSULES * 2 }, () => new Vector4()), count: 0 };
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
}

function legDataOf(o: Object3D): LegData | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    const d = p.userData[KEY] as LegData | undefined;
    if (d) return d;
  }
  return null;
}

/** Entry `k` of the capsules of the body `object` belongs to, in the object's local space ((a, r) or (b, 0)). */
function localEntry(object: Object3D, k: number): Vector4 {
  const d = legDataOf(object);
  const src = d?.v[k];
  if (!d || !src || Math.floor(k / 2) >= d.count) return ZERO;
  const out = ((object.userData['_toonLegsLocal'] as Vector4[] | undefined) ??= Array.from({ length: LEG_CAPSULES * 2 }, () => new Vector4()))[k]!;
  // scene frame -> world -> the object's frame
  _m.copy(object.matrixWorld).invert().multiply(d.scene.matrixWorld);
  _p.set(src.x, src.y, src.z).applyMatrix4(_m);
  const x = _p.x;
  const y = _p.y;
  const z = _p.z;
  // (a radius in the object's units: a body scaled at runtime)
  out.set(x, y, z, k % 2 === 0 ? src.w * _p.setFromMatrixColumn(_m, 0).length() : 0);
  return out;
}

let uniforms: Node[] | null = null;

function legUniforms(): Node[] {
  if (!uniforms) {
    uniforms = Array.from({ length: LEG_CAPSULES * 2 }, (_, k) =>
      uniform(new Vector4()).onObjectUpdate(({ object }) => (object ? localEntry(object, k) : ZERO)) as unknown as Node,
    );
  }
  return uniforms;
}

/**
 * `p` (the skinned local position) pushed out of the leg capsules by `w` (the vertex's cloth flag): the toon body and
 * outline materials put it before anything else in their position.
 *
 * Cloth never moves toward the body's vertical axis: where the nearest way out points that way (the leg in front of
 * cloth that hangs from the waist), the vertex stays (the springs carry that part of the skirt).
 */
export function clothClearNode(p: Node, w: Node): Node {
  const u = legUniforms() as unknown as Array<Node<'vec4'>>;
  let q = p as unknown as Node<'vec3'>;
  const flag = clamp(w as unknown as Node<'float'>, 0, 1);
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

/** The same push on the CPU (tests and the in-player probe): `p` (mesh space, y up) moved in place. */
export function clothClearCpu(p: Vector3, caps: readonly { a: Vector3; b: Vector3; radius: number }[], w = 1): Vector3 {
  const near = new Vector3();
  const o = new Vector3();
  if (w < 0.5) return p;
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
