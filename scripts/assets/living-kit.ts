/**
 * Living models (dev-only): a creature is a skeleton, a set of distance primitives owned by its bones, a coat
 * function that paints it, a few rigid parts (ears, antlers, eyes, beaks) and animation clips written as bone
 * rotations over time. `buildCreature` sculpts the body (surface nets), simplifies it, skins every vertex to the bones
 * by flesh distance, paints it, and writes a glTF document with a real skeleton and real animation clips, in the
 * library frame (faces -Z, stands on y = 0).
 *
 * Authoring frame: +X forward, +Y up, +Z to the right. A bone rotates about its pivot; a clip channel gives Euler
 * angles in that frame (pitch about Z lifts the nose, roll about X tips to the right, yaw about Y turns left).
 */
import { Document, type Material } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Sculpt, type Prim } from './sdf';
import { append, mesh, smooth, type Mesh, type V3 } from './vehicle-geo';

/** One bone: its pivot in the authoring frame and its parent. */
export interface BoneDef {
  name: string;
  parent: string | null;
  at: V3;
}

/** A rigid part (ear, antler, eye) that follows one bone. */
export interface Rigid {
  bone: string;
  mat: string;
  geo: Mesh;
  /** Paints the part per vertex (linear RGB); default white. */
  paint?: (p: V3, n: V3) => V3;
}

/** One channel of a clip: Euler angles (rad) and position offset (m) of a bone over time, authoring frame. */
export interface Channel {
  bone: string;
  rot?: (t: number) => V3;
  pos?: (t: number) => V3;
}

/** A looping animation. */
export interface Clip {
  name: string;
  /** Seconds per loop. */
  duration: number;
  channels: Channel[];
}

/** Material recipe (linear base colour factor). */
export interface MatSpec {
  color: readonly [number, number, number];
  rough: number;
  metal?: number;
  alpha?: number;
  /** Double-sided (cards: ears, wings). */
  double?: boolean;
}

/** A creature design. */
export interface Creature {
  id: string;
  name: string;
  tags: string;
  bones: BoneDef[];
  prims: Prim[];
  /** Voxel size, smooth-union radius, target triangles of the skin, skin falloff (m). */
  voxel: number;
  k: number;
  tris: number;
  sigma: number;
  /** Paints the body per vertex: position, unit normal, sculpt (for ambient occlusion probes); linear RGB. */
  coat: (p: V3, n: V3, s: Sculpt) => V3;
  mats: Record<string, MatSpec>;
  rigid: Rigid[];
  clips: Clip[];
  /** Material of the skin (default "coat"). */
  skinMat?: string;
  /** Clip names for the gait roles when they differ from "idle", "walk" and "run". */
  roles?: { idle?: string; walk?: string; run?: string };
}

/** Linear RGB from sRGB hex. */
export function lin(hex: string): V3 {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (c: number): number => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/** Mix two linear colours. */
export function mixc(a: V3, b: V3, t: number): V3 {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Smooth step. */
export function sstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

/** Cheap value noise in [0, 1] (hash lattice, smooth interpolation). */
export function noise3(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number): number => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Fractal noise of three octaves in [0, 1]. */
export function fbm(x: number, y: number, z: number): number {
  return noise3(x, y, z) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.15;
}

/** Ambient occlusion estimate in [0, 1] (1 = open) from a few probes along the normal. */
export function occlusion(s: Sculpt, p: V3, n: V3, reach = 0.06): number {
  let open = 0;
  const steps = [0.25, 0.5, 0.75, 1];
  for (const t of steps) {
    const d = s.d(p[0] + n[0] * reach * t, p[1] + n[1] * reach * t, p[2] + n[2] * reach * t);
    open += Math.max(0, Math.min(1, d / (reach * t)));
  }
  return open / steps.length;
}

const half = (a: number): number => a / 2;

function eulerQuat(e: V3): [number, number, number, number] {
  // Order: yaw (Y), then pitch (Z), then roll (X): q = qY * qZ * qX.
  const [rx, ry, rz] = e;
  const qx: [number, number, number, number] = [Math.sin(half(rx)), 0, 0, Math.cos(half(rx))];
  const qy: [number, number, number, number] = [0, Math.sin(half(ry)), 0, Math.cos(half(ry))];
  const qz: [number, number, number, number] = [0, 0, Math.sin(half(rz)), Math.cos(half(rz))];
  const mul = (a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  return mul(mul(qy, qz), qx);
}

/** Authoring-frame quaternion to the library frame ((x, y, z) -> (z, y, -x)). */
function toLibQuat(q: [number, number, number, number]): [number, number, number, number] {
  return [q[2], q[1], -q[0], q[3]];
}

/** Frames per second of the baked clips. */
export const CLIP_FPS = 30;

/** What `buildCreature` returns. */
export interface Built {
  doc: Document;
  tris: number;
  /** Positions of every vertex in the library frame (for bounds and colliders). */
  positions: Float32Array;
  size: [number, number, number];
}

function simplifyMesh(positions: number[], indices: number[], target: number): { p: Float32Array<ArrayBuffer>; i: Uint32Array<ArrayBuffer> } {
  const pos = Float32Array.from(positions);
  const idx = Uint32Array.from(indices);
  const want = Math.min(idx.length, Math.max(300, target * 3));
  const out = want >= idx.length ? idx : MeshoptSimplifier.simplify(idx, pos, 3, want, 0.02, [])[0];
  // Compact the vertex list.
  const remap = new Map<number, number>();
  const p: number[] = [];
  const i: number[] = [];
  for (const v of out) {
    let o = remap.get(v);
    if (o === undefined) {
      o = p.length / 3;
      remap.set(v, o);
      p.push(pos[v * 3] as number, pos[v * 3 + 1] as number, pos[v * 3 + 2] as number);
    }
    i.push(o);
  }
  return { p: Float32Array.from(p), i: Uint32Array.from(i) };
}

/** Sculpt, skin, paint and animate a creature into a glTF document. */
export async function buildCreature(c: Creature): Promise<Built> {
  await MeshoptSimplifier.ready;
  const sculpt = new Sculpt(c.prims, { voxel: c.voxel, k: c.k });
  const dense = sculpt.polygonise();
  const slim = simplifyMesh(dense.positions, dense.indices, c.tris);
  const boneIndex = new Map(c.bones.map((b, i) => [b.name, i]));
  const nv = slim.p.length / 3;

  // Vertex data in the authoring frame.
  const normals = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 4);
  const joints = new Uint16Array(nv * 4);
  const weights = new Float32Array(nv * 4);
  const n: V3 = [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    const p: V3 = [slim.p[v * 3] as number, slim.p[v * 3 + 1] as number, slim.p[v * 3 + 2] as number];
    sculpt.normal(p[0], p[1], p[2], n);
    normals.set(n, v * 3);
    const col = c.coat(p, [n[0], n[1], n[2]], sculpt);
    colors.set([col[0], col[1], col[2], 1], v * 4);
    const w = sculpt.weights(p[0], p[1], p[2], boneIndex, c.sigma);
    for (let k = 0; k < 4; k++) {
      const e = w[k];
      joints[v * 4 + k] = e ? e[0] : 0;
      weights[v * 4 + k] = e ? e[1] : 0;
    }
    if (w.length === 0) weights[v * 4] = 1;
  }

  // ---- glTF document (library frame) -------------------------------------------------------------------------------
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(c.id);
  const lib = (p: V3): V3 => [p[2], p[1], -p[0]];
  const nodes = new Map<string, ReturnType<Document['createNode']>>();
  const armature = doc.createNode(`${c.id}-armature`);
  scene.addChild(armature);
  for (const b of c.bones) {
    const parent = b.parent ? c.bones.find((x) => x.name === b.parent) : undefined;
    const at = lib(b.at);
    const pat = parent ? lib(parent.at) : ([0, 0, 0] as V3);
    const node = doc.createNode(b.name).setTranslation([at[0] - pat[0], at[1] - pat[1], at[2] - pat[2]]);
    nodes.set(b.name, node);
    if (!parent) armature.addChild(node);
    else (nodes.get(b.parent as string) as ReturnType<Document['createNode']>).addChild(node);
  }
  const ibm = new Float32Array(c.bones.length * 16);
  c.bones.forEach((b, i) => {
    const at = lib(b.at);
    // Inverse of a pure translation to the pivot.
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -at[0], -at[1], -at[2], 1], i * 16);
  });
  const skin = doc.createSkin(`${c.id}-skin`).setInverseBindMatrices(doc.createAccessor('ibm', buffer).setType('MAT4').setArray(ibm));
  skin.setSkeleton(nodes.get((c.bones.find((b) => b.parent === null) as BoneDef).name) as ReturnType<Document['createNode']>);
  for (const b of c.bones) skin.addJoint(nodes.get(b.name) as ReturnType<Document['createNode']>);

  const mats = new Map<string, Material>();
  const getMat = (name: string): Material => {
    let m = mats.get(name);
    if (m) return m;
    const s = c.mats[name];
    if (!s) throw new Error(`${c.id}: unknown material ${name}`);
    m = doc.createMaterial(name).setBaseColorFactor([s.color[0], s.color[1], s.color[2], s.alpha ?? 1]).setMetallicFactor(s.metal ?? 0).setRoughnessFactor(s.rough);
    if (s.alpha !== undefined && s.alpha < 1) m.setAlphaMode('BLEND');
    if (s.double) m.setDoubleSided(true);
    mats.set(name, m);
    return m;
  };
  const gm = doc.createMesh(c.id);
  const libPositions: number[] = [];
  const libVec = (src: ArrayLike<number>, count: number): Float32Array<ArrayBuffer> => {
    const out = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      out[v * 3] = src[v * 3 + 2] as number;
      out[v * 3 + 1] = src[v * 3 + 1] as number;
      out[v * 3 + 2] = -(src[v * 3] as number);
    }
    return out;
  };
  const addPrimitive = (mat: string, pos: Float32Array<ArrayBuffer>, nor: Float32Array<ArrayBuffer>, idx: Uint32Array<ArrayBuffer>, col: Float32Array<ArrayBuffer> | null, jnt: Uint16Array<ArrayBuffer>, wgt: Float32Array<ArrayBuffer>): void => {
    const prim = doc
      .createPrimitive()
      .setMaterial(getMat(mat))
      .setIndices(doc.createAccessor('idx', buffer).setType('SCALAR').setArray(idx))
      .setAttribute('POSITION', doc.createAccessor('pos', buffer).setType('VEC3').setArray(pos))
      .setAttribute('NORMAL', doc.createAccessor('nor', buffer).setType('VEC3').setArray(nor))
      .setAttribute('JOINTS_0', doc.createAccessor('jnt', buffer).setType('VEC4').setArray(jnt))
      .setAttribute('WEIGHTS_0', doc.createAccessor('wgt', buffer).setType('VEC4').setArray(wgt));
    if (col) prim.setAttribute('COLOR_0', doc.createAccessor('col', buffer).setType('VEC4').setArray(col));
    gm.addPrimitive(prim);
    for (let k = 0; k < pos.length; k++) libPositions.push(pos[k] as number);
  };
  // Skin: indices flipped because the library frame mirrors one axis pair (a rotation, not a mirror: winding kept).
  addPrimitive(c.skinMat ?? 'coat', libVec(slim.p, nv), libVec(normals, nv), slim.i, colors, joints, weights);
  // Rigid parts, grouped by (bone, material).
  const groups = new Map<string, { bone: string; mat: string; geo: Mesh; paints: Rigid[] }>();
  for (const r of c.rigid) {
    const key = `${r.bone}|${r.mat}|${r.paint ? 'p' : 'n'}`;
    const g = groups.get(key) ?? { bone: r.bone, mat: r.mat, geo: mesh(), paints: [] };
    groups.set(key, g);
    append(g.geo, r.geo);
    g.paints.push(r);
  }
  for (const g of groups.values()) {
    smooth(g.geo);
    const count = g.geo.p.length / 3;
    const idx = Uint32Array.from(g.geo.i);
    const bi = boneIndex.get(g.bone);
    if (bi === undefined) throw new Error(`${c.id}: rigid part on unknown bone ${g.bone}`);
    const jnt = new Uint16Array(count * 4);
    const wgt = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      jnt[v * 4] = bi;
      wgt[v * 4] = 1;
    }
    let col: Float32Array<ArrayBuffer> | null = null;
    const painter = g.paints.find((r) => r.paint)?.paint;
    if (painter) {
      col = new Float32Array(count * 4);
      for (let v = 0; v < count; v++) {
        const rgb = painter([g.geo.p[v * 3] as number, g.geo.p[v * 3 + 1] as number, g.geo.p[v * 3 + 2] as number], [g.geo.n[v * 3] as number, g.geo.n[v * 3 + 1] as number, g.geo.n[v * 3 + 2] as number]);
        col.set([rgb[0], rgb[1], rgb[2], 1], v * 4);
      }
    }
    addPrimitive(g.mat, libVec(g.geo.p, count), libVec(g.geo.n, count), idx, col, jnt, wgt);
  }
  // A skinned mesh node sits at the scene root; its own transform plays no part in the skinning.
  scene.addChild(doc.createNode(`${c.id}-body`).setMesh(gm).setSkin(skin));

  // ---- Clips ------------------------------------------------------------------------------------------------------
  for (const clip of c.clips) {
    const anim = doc.createAnimation(clip.name);
    const frames = Math.max(2, Math.round(clip.duration * CLIP_FPS));
    const times = new Float32Array(frames + 1);
    for (let f = 0; f <= frames; f++) times[f] = (clip.duration * f) / frames;
    for (const ch of clip.channels) {
      const node = nodes.get(ch.bone);
      const bone = c.bones.find((b) => b.name === ch.bone);
      if (!node || !bone) throw new Error(`${c.id}: clip ${clip.name} animates unknown bone ${ch.bone}`);
      if (ch.rot) {
        const out = new Float32Array((frames + 1) * 4);
        for (let f = 0; f <= frames; f++) {
          // The last key repeats the first so the loop closes.
          const t = f === frames ? 0 : times[f] as number;
          out.set(toLibQuat(eulerQuat(ch.rot(t / clip.duration))), f * 4);
        }
        const sampler = doc.createAnimationSampler().setInput(doc.createAccessor('t', buffer).setType('SCALAR').setArray(times)).setOutput(doc.createAccessor('r', buffer).setType('VEC4').setArray(out)).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
      }
      if (ch.pos) {
        const base = node.getTranslation();
        const out = new Float32Array((frames + 1) * 3);
        for (let f = 0; f <= frames; f++) {
          const t = f === frames ? 0 : times[f] as number;
          const d = ch.pos(t / clip.duration);
          out.set([base[0] + d[2], base[1] + d[1], base[2] - d[0]], f * 3);
        }
        const sampler = doc.createAnimationSampler().setInput(doc.createAccessor('t', buffer).setType('SCALAR').setArray(times)).setOutput(doc.createAccessor('p', buffer).setType('VEC3').setArray(out)).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
      }
    }
  }

  let mnx = Infinity;
  let mxx = -Infinity;
  let mnz = Infinity;
  let mxz = -Infinity;
  let mxy = -Infinity;
  let mny = Infinity;
  for (let k = 0; k < libPositions.length; k += 3) {
    mnx = Math.min(mnx, libPositions[k] as number);
    mxx = Math.max(mxx, libPositions[k] as number);
    mny = Math.min(mny, libPositions[k + 1] as number);
    mxy = Math.max(mxy, libPositions[k + 1] as number);
    mnz = Math.min(mnz, libPositions[k + 2] as number);
    mxz = Math.max(mxz, libPositions[k + 2] as number);
  }
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  // Stand on y = 0 and centre in x / z by shifting the skeleton root and the bone pivots together.
  const shift: V3 = [-(mnx + mxx) / 2, -mny, -(mnz + mxz) / 2];
  armature.setTranslation(shift);
  const positions = new Float32Array(libPositions.length);
  for (let k = 0; k < libPositions.length; k += 3) {
    positions[k] = (libPositions[k] as number) + shift[0];
    positions[k + 1] = (libPositions[k + 1] as number) + shift[1];
    positions[k + 2] = (libPositions[k + 2] as number) + shift[2];
  }
  return { doc, tris: slim.i.length / 3 + [...groups.values()].reduce((s, g) => s + g.geo.i.length / 3, 0), positions, size: [r3(mxx - mnx), r3(mxy - mny), r3(mxz - mnz)] };
}
