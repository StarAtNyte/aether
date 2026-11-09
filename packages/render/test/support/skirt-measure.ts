/**
 * In-engine skirt-against-legs measure, headless: the real rig (clip, foot IK, pelvis drop, springs) is stepped, every
 * frame the body's skinned vertices are computed on the CPU, the toon vertex stage's cloth push is replayed, and each
 * leg vertex the skirt covers at rest is tested: seen from the leg's bone axis, is the cloth still beyond it?
 * A leg vertex with cloth between it and its bone is poking through the skirt (its depth in metres).
 */
import { Matrix4, Vector3, type Object3D, type SkinnedMesh } from 'three';
import type { CharacterRig } from '../../src/characters/rig';
import { CLOTH_MARGIN, clothClearCpu } from '../../src/characters/cloth-clear';
import { closestOnSegment } from '../../src/characters/springs';

export interface SkirtProbe {
  mesh: SkinnedMesh;
  skirt: number[];
  tris: Uint32Array;
  /** Covered leg vertices: index, side (0 left, 1 right), segment kind (0 thigh, 1 calf). */
  covered: Array<[number, number, number]>;
  bones: { th: Object3D[]; ca: Object3D[]; ft: Object3D[] };
  P: Float32Array;
  hemY: number;
  /** 1 for the cloth vertices of the hem band (rest pose). */
  hemRow: Uint8Array;
}

/** Height above the hem (m) of the rim's rows: a leg under it is leaving the skirt, not coming through. */
export const HEM_BAND = 0.03;
/** A leg vertex this far above the hem's local height counts as covered by it. */
export const HEM_MARGIN = 0.015;
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _inv = new Matrix4();

function restPos(mesh: SkinnedMesh, bone: Object3D): Vector3 {
  const i = mesh.skeleton.bones.indexOf(bone as never);
  return new Vector3().setFromMatrixPosition(new Matrix4().copy(mesh.skeleton.boneInverses[i]!).invert()).applyMatrix4(mesh.bindMatrixInverse);
}

/** Ray (o + t d) against the skirt triangles of posed positions P; nearest hit 1e-4 < t < limit or Infinity. */
function nearestHit(P: Float32Array, T: Uint32Array, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, limit: number, hem: Uint8Array | null = null): number {
  let best = Infinity;
  for (let i = 0; i < T.length; i += 3) {
    // (a leg leaving under the hem is not a leg through the cloth: the rim's own faces are skipped)
    if (hem && (hem[T[i]!] || hem[T[i + 1]!] || hem[T[i + 2]!])) continue;
    const a0 = T[i]! * 3;
    const b0 = T[i + 1]! * 3;
    const c0 = T[i + 2]! * 3;
    const e1x = P[b0]! - P[a0]!;
    const e1y = P[b0 + 1]! - P[a0 + 1]!;
    const e1z = P[b0 + 2]! - P[a0 + 2]!;
    const e2x = P[c0]! - P[a0]!;
    const e2y = P[c0 + 1]! - P[a0 + 1]!;
    const e2z = P[c0 + 2]! - P[a0 + 2]!;
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-12 && det < 1e-12) continue;
    const f = 1 / det;
    const sx = ox - P[a0]!;
    const sy = oy - P[a0 + 1]!;
    const sz = oz - P[a0 + 2]!;
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const w = f * (dx * qx + dy * qy + dz * qz);
    if (w < 0 || u + w > 1) continue;
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t > 1e-4 && t < best && t < limit) best = t;
  }
  return best;
}

/** The body's near mesh with its skirt and the leg vertices the skirt covers at rest. `stride` thins the leg vertices. */
export function prepSkirt(rig: CharacterRig, stride = 2): SkirtProbe | null {
  let mesh: SkinnedMesh | null = null;
  rig.root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!mesh && m.isSkinnedMesh && !/outline/i.test(o.name)) mesh = m;
  });
  const sm = mesh as SkinnedMesh | null;
  if (!sm) return null;
  const g = sm.geometry;
  const pos = g.attributes['position']!;
  const si = g.attributes['skinIndex']!;
  const sw = g.attributes['skinWeight']!;
  const tw = g.attributes['_toon'];
  const bones = sm.skeleton.bones;
  const find = (re: string): Object3D[] => [bones.find((b) => b.name.endsWith('L_' + re))!, bones.find((b) => b.name.endsWith('R_' + re))!];
  const th = find('Thigh');
  const ca = find('Calf');
  const ft = find('Foot');
  const thI = th.map((b) => bones.indexOf(b as never));
  const caI = ca.map((b) => bones.indexOf(b as never));
  const n = pos.count;
  const skirt: number[] = [];
  const isSkirt = new Uint8Array(n);
  const legs: Array<[number, number, number]> = [];
  for (let v = 0; v < n; v++) {
    let ws = 0;
    const w = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(v, k);
      const wt = sw.getComponent(v, k);
      if (/^Skirt/i.test(bones[j]!.name)) ws += wt;
      if (j === thI[0]) w[0]! += wt;
      if (j === thI[1]) w[1]! += wt;
      if (j === caI[0]) w[2]! += wt;
      if (j === caI[1]) w[3]! += wt;
    }
    if (tw ? tw.getW(v) > 0.5 : ws > 0.05) {
      skirt.push(v);
      isSkirt[v] = 1;
    } else if (v % stride === 0) {
      if (w[0]! > 0.6 || w[1]! > 0.6) legs.push([v, w[0]! > w[1]! ? 0 : 1, 0]);
      else if (w[2]! > 0.6 || w[3]! > 0.6) legs.push([v, w[2]! > w[3]! ? 0 : 1, 1]);
    }
  }
  const ix = g.index!;
  const t: number[] = [];
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i);
    const b = ix.getX(i + 1);
    const c = ix.getX(i + 2);
    if (isSkirt[a] && isSkirt[b] && isSkirt[c]) t.push(a, b, c);
  }
  const P = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    P[v * 3] = pos.getX(v);
    P[v * 3 + 1] = pos.getY(v);
    P[v * 3 + 2] = pos.getZ(v);
  }
  let hemY = Infinity;
  for (const v of skirt) hemY = Math.min(hemY, P[v * 3 + 1]!);
  const hemRow = new Uint8Array(n);
  for (const v of skirt) if (P[v * 3 + 1]! < hemY + HEM_BAND) hemRow[v] = 1;
  const probe: SkirtProbe = { mesh: sm, skirt, tris: new Uint32Array(t), covered: [], bones: { th, ca, ft }, P, hemY, hemRow };
  const seg = [0, 1].map((s) => [
    [restPos(sm, th[s]!), restPos(sm, ca[s]!)],
    [restPos(sm, ca[s]!), restPos(sm, ft[s]!)],
  ]);
  for (const [v, s, k] of legs) {
    if (P[v * 3 + 1]! < hemY + HEM_BAND) continue;
    const [a, b] = seg[s]![k]!;
    closestOnSegment(_v.set(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!), a!, b!, _a);
    _b.copy(_v).sub(_a);
    const L = _b.length();
    if (L < 1e-5) continue;
    _b.divideScalar(L);
    const hit = nearestHit(P, probe.tris, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z, L + 0.25);
    if (hit >= L - 0.002 && hit < Infinity) probe.covered.push([v, s, k]);
  }
  return probe;
}

export interface FrameResult {
  covered: number;
  /** Leg vertices with cloth between them and their bone deeper than the tolerance. */
  through: number;
  /** Deepest (m). */
  depth: number;
  /** The worst vertex (mesh space) for diagnostics. */
  worst: [number, number, number] | null;
  /** Mesh indices of the vertices counted. */
  flagged: number[];
}

/** Measure the current pose (the rig's world matrices must be current). `tol` m: below it a vertex is not counted. */
export function measureFrame(rig: CharacterRig, pr: SkirtProbe, tol = 0.004, push = true, drape = true): FrameResult {
  const { mesh, P } = pr;
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  _inv.copy(mesh.matrixWorld).invert();
  const sc = Math.hypot(_inv.elements[0]!, _inv.elements[1]!, _inv.elements[2]!);
  const caps =
    push && rig.springs
      ? rig.springs.posedCapsules(['Thigh', 'Calf'], CLOTH_MARGIN).map((c) => ({ a: c.a.clone().applyMatrix4(_inv), b: c.b.clone().applyMatrix4(_inv), radius: c.radius * sc }))
      : [];
  const hl = new Vector3().setFromMatrixPosition(pr.bones.th[0]!.matrixWorld).applyMatrix4(_inv);
  const hr = new Vector3().setFromMatrixPosition(pr.bones.th[1]!.matrixWorld).applyMatrix4(_inv);
  const axis = { x: (hl.x + hr.x) / 2, z: (hl.z + hr.z) / 2 };
  const q = new Vector3();
  const o = new Vector3();
  const d = new Vector3();
  for (const i of pr.skirt) {
    mesh.getVertexPosition(i, q);
    // the toon vertex stage's drape and push (cloth-clear.ts)
    if (push) clothClearCpu(q, caps, 1, drape ? axis : null);
    P[i * 3] = q.x;
    P[i * 3 + 1] = q.y;
    P[i * 3 + 2] = q.z;
  }
  const seg = [0, 1].map((s) => [pr.bones.th[s]!, pr.bones.ca[s]!, pr.bones.ft[s]!].map((b) => new Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(_inv)));
  // the hem ring as posed: (azimuth about the hips' axis, height); a leg vertex below its local hem is leaving under it
  const hemAz: number[] = [];
  const hemYs: number[] = [];
  for (const i of pr.skirt) if (pr.hemRow[i]) { hemAz.push(Math.atan2(P[i * 3]! - axis.x, P[i * 3 + 2]! - axis.z)); hemYs.push(P[i * 3 + 1]!); }
  const localHem = (x: number, z: number): number => {
    const a = Math.atan2(x - axis.x, z - axis.z);
    let best = Infinity;
    let y = 0;
    for (let k = 0; k < hemAz.length; k++) {
      let da = Math.abs(hemAz[k]! - a);
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (da < best) { best = da; y = hemYs[k]!; }
    }
    return y;
  };
  let through = 0;
  let depth = 0;
  let worst: [number, number, number] | null = null;
  const flagged: number[] = [];
  for (const [v, s, k] of pr.covered) {
    mesh.getVertexPosition(v, q);
    if (q.y < localHem(q.x, q.z) + HEM_MARGIN) continue;
    const [a, b] = k === 0 ? [seg[s]![0]!, seg[s]![1]!] : [seg[s]![1]!, seg[s]![2]!];
    closestOnSegment(q, a!, b!, o);
    d.copy(q).sub(o);
    const L = d.length();
    if (L < 1e-5) continue;
    d.divideScalar(L);
    const hit = nearestHit(P, pr.tris, o.x, o.y, o.z, d.x, d.y, d.z, L);
    // cloth strictly between the bone and the vertex: the vertex is outside the cloth
    if (hit < Infinity) {
      const dep = L - hit;
      if (dep > tol) {
        through++;
        flagged.push(v);
        if (process.env['DBG']) console.log('flag', v, 'y', q.y.toFixed(3), 'localHem', localHem(q.x, q.z).toFixed(3), 'dep', (dep * 1000).toFixed(0), 'L', (L * 1000).toFixed(0), 'k', k);
        if (dep > depth) {
          depth = dep;
          worst = [q.x, q.y, q.z];
        }
      }
    }
  }
  return { covered: pr.covered.length, through, depth, worst, flagged };
}
