/**
 * FBX to glTF conversion for the character pipeline (build time, Node only).
 *
 * - {@link convertAvatar}: one Rocketbox body (skinned mesh, 80-bone Biped) to
 *   a glTF document in metres with PBR materials and WebP textures.
 * - {@link convertClips}: Rocketbox motion clips to rotation-only tracks on the
 *   shared Biped (root height kept, planar root drift removed and reported as
 *   the clip's stride speed), reduced to a small keyframe count.
 *
 * The runtime never sees an FBX: it loads the baked glTF files.
 */
import { readFileSync } from 'node:fs';
import { Document, type Buffer as GltfBuffer, type Node, type Material, type Texture } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { Bone, Matrix4, Quaternion, SkinnedMesh, Vector3, type AnimationClip, type Object3D } from 'three';
import { readFbx } from './fbx-node';

/** Rocketbox units are centimetres; the engine uses metres. */
export const UNIT = 0.01;

/** Bones whose tracks are never baked (face rig: the runtime drives the eyes and mouth itself). */
export const FACE_BONE = /Eye|Eyebrow|Mouth|Lip|Jaw|Tongue|Cheek|Caninus|Masseter|Nose|Nub$|HeadNub|Footsteps|Expose/i;

/** Texture files of one character, already converted to WebP. */
export interface AvatarTextures {
  bodyColor?: Uint8Array;
  bodyNormal?: Uint8Array;
  bodyMr?: Uint8Array;
  headColor?: Uint8Array;
  headNormal?: Uint8Array;
  headMr?: Uint8Array;
  hair?: Uint8Array;
}

/** Facts about a converted avatar, recorded in the cast manifest. */
export interface AvatarInfo {
  triangles: number;
  vertices: number;
  bones: number;
  /** Standing height in metres (bind pose bounding box). */
  height: number;
  /** Hip (root bone) height in metres. */
  hip: number;
  /** +1 when the face points to +Z in the file, -1 for -Z. */
  faces: 1 | -1;
}

function sanitize(n: string): string {
  return n.replace(/ /g, '_');
}

/** Read a file as a byte array (or undefined when missing). */
export function readOpt(path: string | null): Uint8Array | undefined {
  if (!path) return undefined;
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return undefined;
  }
}

function tex(doc: Document, buf: Uint8Array | undefined, name: string): Texture | null {
  if (!buf) return null;
  return doc.createTexture(name).setImage(buf).setMimeType('image/webp').setURI(`${name}.webp`);
}

/** Convert one Rocketbox body into a glTF document. */
/** Size of the UV-space planes used to build the outfit masks. */
export const UV_SIZE = 1024;

/**
 * Per-texel facts about the mesh in UV space, for the outfit masks: world
 * height of the surface (m) and how much of it is skinned to the head, neck,
 * hands and feet (NaN height = no surface there).
 */
export interface UvPlanes {
  bodyY: Float32Array;
  bodyHw: Float32Array;
  headY: Float32Array;
}

function planes(): UvPlanes {
  const n = UV_SIZE * UV_SIZE;
  return { bodyY: new Float32Array(n).fill(Number.NaN), bodyHw: new Float32Array(n), headY: new Float32Array(n).fill(Number.NaN) };
}

/** Rasterize one triangle into `y` (and `hw`) with barycentric interpolation. */
function raster(y: Float32Array, hw: Float32Array | null, uv: number[], pos: number[], skinHw: number[], a: number, b: number, c: number): void {
  const px = [uv[a * 2] as number, uv[b * 2] as number, uv[c * 2] as number].map((u) => u * UV_SIZE);
  const py = [uv[a * 2 + 1] as number, uv[b * 2 + 1] as number, uv[c * 2 + 1] as number].map((v) => v * UV_SIZE);
  const wy = [pos[a * 3 + 1] as number, pos[b * 3 + 1] as number, pos[c * 3 + 1] as number];
  const wh = [skinHw[a] as number, skinHw[b] as number, skinHw[c] as number];
  const minX = Math.max(0, Math.floor(Math.min(px[0] as number, px[1] as number, px[2] as number)));
  const maxX = Math.min(UV_SIZE - 1, Math.ceil(Math.max(px[0] as number, px[1] as number, px[2] as number)));
  const minY = Math.max(0, Math.floor(Math.min(py[0] as number, py[1] as number, py[2] as number)));
  const maxY = Math.min(UV_SIZE - 1, Math.ceil(Math.max(py[0] as number, py[1] as number, py[2] as number)));
  const x0 = px[0] as number, y0 = py[0] as number;
  const d = ((py[1] as number) - (py[2] as number)) * (x0 - (px[2] as number)) + ((px[2] as number) - (px[1] as number)) * (y0 - (py[2] as number));
  if (Math.abs(d) < 1e-9) return;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const sx = xx + 0.5;
      const sy = yy + 0.5;
      const l0 = (((py[1] as number) - (py[2] as number)) * (sx - (px[2] as number)) + ((px[2] as number) - (px[1] as number)) * (sy - (py[2] as number))) / d;
      const l1 = (((py[2] as number) - y0) * (sx - (px[2] as number)) + (x0 - (px[2] as number)) * (sy - (py[2] as number))) / d;
      const l2 = 1 - l0 - l1;
      // A small tolerance paints the texel border too, so the mask reaches the seams.
      if (l0 < -0.08 || l1 < -0.08 || l2 < -0.08) continue;
      const i = yy * UV_SIZE + xx;
      y[i] = l0 * (wy[0] as number) + l1 * (wy[1] as number) + l2 * (wy[2] as number);
      if (hw) hw[i] = l0 * (wh[0] as number) + l1 * (wh[1] as number) + l2 * (wh[2] as number);
    }
  }
}

export function convertAvatar(fbxPath: string, id: string, t: AvatarTextures): { doc: Document; info: AvatarInfo; uv: UvPlanes } {
  const g = readFbx(fbxPath);
  g.updateMatrixWorld(true);
  let mesh: SkinnedMesh | null = null;
  g.traverse((o: Object3D) => {
    if (o instanceof SkinnedMesh && !mesh) mesh = o;
  });
  if (!mesh) throw new Error(`${fbxPath}: no skinned mesh`);
  const sm: SkinnedMesh = mesh;
  const skeleton = sm.skeleton;
  const geo = sm.geometry;
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer: GltfBuffer = doc.createBuffer();
  const scene = doc.createScene(id);

  // --- skeleton nodes -------------------------------------------------------
  const nodeOf = new Map<Object3D, Node>();
  const addBone = (b: Object3D, parent: Node | null): void => {
    const n = doc
      .createNode(sanitize(b.name))
      .setTranslation([b.position.x * UNIT, b.position.y * UNIT, b.position.z * UNIT])
      .setRotation([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]);
    nodeOf.set(b, n);
    if (parent) parent.addChild(n);
    else scene.addChild(n);
    for (const c of b.children) if (c instanceof Bone) addBone(c, n);
  };
  let rootBone: Object3D | undefined = skeleton.bones[0];
  while (rootBone?.parent instanceof Bone) rootBone = rootBone.parent;
  if (!rootBone) throw new Error('no root bone');
  addBone(rootBone, null);
  const joints = skeleton.bones.map((b) => {
    const n = nodeOf.get(b);
    if (!n) throw new Error(`bone ${b.name} not under the root`);
    return n;
  });
  const ibms = new Float32Array(joints.length * 16);
  for (let i = 0; i < joints.length; i++) {
    // Vertices are baked to world space at bind, so the inverse bind matrix is inverse(boneWorld),
    // rescaled from centimetres to metres (S · M · S⁻¹ only touches the translation column).
    const m = (skeleton.boneInverses[i] as Matrix4).clone();
    const e = m.elements;
    e[12] = (e[12] as number) * UNIT;
    e[13] = (e[13] as number) * UNIT;
    e[14] = (e[14] as number) * UNIT;
    ibms.set(e, i * 16);
  }
  const skin = doc.createSkin(`${id}-skin`).setSkeleton(nodeOf.get(rootBone) as Node);
  skin.setInverseBindMatrices(doc.createAccessor('ibm', buffer).setType('MAT4').setArray(ibms));
  for (const j of joints) skin.addJoint(j);

  // --- materials ------------------------------------------------------------
  const mk = (name: string, color: Uint8Array | undefined, normal: Uint8Array | undefined, mr: Uint8Array | undefined, hair: boolean): Material => {
    const m = doc.createMaterial(`${id}-${name}`).setMetallicFactor(0).setRoughnessFactor(0.7);
    const c = tex(doc, color, `${id}-${name}-color`);
    if (c) m.setBaseColorTexture(c);
    const n = tex(doc, normal, `${id}-${name}-normal`);
    if (n) m.setNormalTexture(n);
    const r = tex(doc, mr, `${id}-${name}-mr`);
    if (r) m.setMetallicRoughnessTexture(r);
    if (hair) m.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true).setRoughnessFactor(0.85);
    return m;
  };
  const matBody = mk('body', t.bodyColor, t.bodyNormal, t.bodyMr, false);
  const matHead = mk('head', t.headColor, t.headNormal, t.headMr, false);
  const matHair = mk('hair', t.hair, undefined, undefined, true);
  const srcMats = Array.isArray(sm.material) ? sm.material : [sm.material];
  const pick = (i: number): Material => {
    const nm = (srcMats[i]?.name ?? '').toLowerCase();
    return nm.includes('opacity') || nm.includes('hair') ? matHair : nm.includes('head') ? matHead : matBody;
  };

  // --- geometry (welded per material) --------------------------------------
  const P = geo.attributes['position'] as { getX(i: number): number; getY(i: number): number; getZ(i: number): number };
  const N = geo.attributes['normal'] as { getX(i: number): number; getY(i: number): number; getZ(i: number): number };
  const UV = geo.attributes['uv'] as { getX(i: number): number; getY(i: number): number };
  const SI = geo.attributes['skinIndex'] as { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number };
  const SW = geo.attributes['skinWeight'] as { getX(i: number): number; getY(i: number): number; getZ(i: number): number; getW(i: number): number };
  const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: geo.attributes['position']?.count ?? 0, materialIndex: 0 }];
  const index = geo.index;
  const byMat = new Map<Material, number[]>();
  for (const gr of groups) {
    const m = pick(gr.materialIndex ?? 0);
    let list = byMat.get(m);
    if (!list) byMat.set(m, (list = []));
    for (let k = gr.start; k < gr.start + gr.count; k++) list.push(index ? index.getX(k) : k);
  }
  const gmesh = doc.createMesh(id);
  const uvPlanes = planes();
  const skinHwBones = joints.map((j) => /Hand|Finger|Head|Neck/.test(j.getName()));
  let minY = Infinity;
  let maxY = -Infinity;
  let triangles = 0;
  let vertices = 0;
  const v = new Vector3();
  for (const [material, ids] of byMat) {
    const remap = new Map<string, number>();
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const jnt: number[] = [];
    const wgt: number[] = [];
    const idx: number[] = [];
    for (const vi of ids) {
      const px = P.getX(vi), py = P.getY(vi), pz = P.getZ(vi);
      const key = [px, py, pz, N.getX(vi), N.getY(vi), N.getZ(vi), UV.getX(vi), UV.getY(vi), SI.getX(vi), SI.getY(vi), SW.getX(vi), SW.getY(vi)].map((x) => Math.round(x * 1e4)).join(',');
      let o = remap.get(key);
      if (o === undefined) {
        o = pos.length / 3;
        remap.set(key, o);
        v.set(px, py, pz).applyMatrix4(sm.bindMatrix);
        pos.push(v.x * UNIT, v.y * UNIT, v.z * UNIT);
        minY = Math.min(minY, v.y * UNIT);
        maxY = Math.max(maxY, v.y * UNIT);
        nor.push(N.getX(vi), N.getY(vi), N.getZ(vi));
        uv.push(UV.getX(vi), 1 - UV.getY(vi));
        jnt.push(SI.getX(vi), SI.getY(vi), SI.getZ(vi), SI.getW(vi));
        const w = [SW.getX(vi), SW.getY(vi), SW.getZ(vi), SW.getW(vi)];
        const s = w[0]! + w[1]! + w[2]! + w[3]! || 1;
        wgt.push(w[0]! / s, w[1]! / s, w[2]! / s, w[3]! / s);
      }
      idx.push(o);
    }
    vertices += pos.length / 3;
    triangles += idx.length / 3;
    if (material === matBody || material === matHead) {
      const hw: number[] = [];
      for (let v = 0; v < pos.length / 3; v++) {
        let s = 0;
        for (let k = 0; k < 4; k++) if (skinHwBones[jnt[v * 4 + k] as number]) s += wgt[v * 4 + k] as number;
        hw.push(s);
      }
      for (let k = 0; k < idx.length; k += 3) {
        if (material === matBody) raster(uvPlanes.bodyY, uvPlanes.bodyHw, uv, pos, hw, idx[k] as number, idx[k + 1] as number, idx[k + 2] as number);
        else raster(uvPlanes.headY, null, uv, pos, hw, idx[k] as number, idx[k + 1] as number, idx[k + 2] as number);
      }
    }
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setIndices(doc.createAccessor('idx', buffer).setType('SCALAR').setArray(new Uint32Array(idx)))
      .setAttribute('POSITION', doc.createAccessor('pos', buffer).setType('VEC3').setArray(new Float32Array(pos)))
      .setAttribute('NORMAL', doc.createAccessor('nor', buffer).setType('VEC3').setArray(new Float32Array(nor)))
      .setAttribute('TEXCOORD_0', doc.createAccessor('uv', buffer).setType('VEC2').setArray(new Float32Array(uv)))
      .setAttribute('JOINTS_0', doc.createAccessor('jnt', buffer).setType('VEC4').setArray(new Uint16Array(jnt)))
      .setAttribute('WEIGHTS_0', doc.createAccessor('wgt', buffer).setType('VEC4').setArray(new Float32Array(wgt)));
    gmesh.addPrimitive(prim);
  }
  scene.addChild(doc.createNode(`${id}-body`).setMesh(gmesh).setSkin(skin));

  // Which way does the face point? Compare the eye bones with the head bone in the bind pose.
  const w = new Vector3();
  const head = skeleton.bones.find((b) => /Head$/.test(b.name));
  const eye = skeleton.bones.find((b) => /LEye$/.test(b.name));
  let faces: 1 | -1 = 1;
  if (head && eye) {
    const hp = head.getWorldPosition(new Vector3());
    const ep = eye.getWorldPosition(w);
    faces = ep.z - hp.z >= 0 ? 1 : -1;
  }
  const hip = (rootBone.getWorldPosition(new Vector3()).y ?? 0) * UNIT;
  return { doc, info: { triangles, vertices, bones: joints.length, height: maxY - minY, hip, faces }, uv: uvPlanes };
}

/** One baked clip. */
export interface BakedTrack {
  node: string;
  path: 'rotation' | 'translation';
  times: Float32Array<ArrayBuffer>;
  values: Float32Array<ArrayBuffer>;
}

/** Baked clip data before it is written. */
export interface BakedClip {
  name: string;
  duration: number;
  /** Planar root speed the clip was authored for (m/s); 0 for in-place clips. */
  stride: number;
  tracks: BakedTrack[];
}

/** Largest quaternion deviation (as 1 - |dot|) tolerated when dropping a key. */
const ROT_EPS = 2e-5;
/** Fingers and toes tolerate more (they are small on screen). */
const FINE_ROT_EPS = 1.5e-4;
const POS_EPS = 0.0015;

/** Greedy key reduction: keep a key only when linear interpolation of its neighbours misses it. */
export function reduceKeys(times: ArrayLike<number>, values: ArrayLike<number>, stride: 3 | 4, eps: number): { times: Float32Array<ArrayBuffer>; values: Float32Array<ArrayBuffer> } {
  const n = times.length;
  const keep: number[] = [0];
  let last = 0;
  const q0 = new Quaternion();
  const q1 = new Quaternion();
  const q2 = new Quaternion();
  const err = (a: number, b: number, i: number): number => {
    const f = ((times[i] as number) - (times[a] as number)) / (((times[b] as number) - (times[a] as number)) || 1);
    if (stride === 4) {
      q0.fromArray(values as number[], a * 4);
      q1.fromArray(values as number[], b * 4);
      q2.fromArray(values as number[], i * 4);
      const mid = q0.clone().slerp(q1, f);
      return 1 - Math.abs(mid.dot(q2));
    }
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const va = values[a * 3 + c] as number;
      const vb = values[b * 3 + c] as number;
      m = Math.max(m, Math.abs(va + (vb - va) * f - (values[i * 3 + c] as number)));
    }
    return m;
  };
  for (let i = 2; i < n; i++) {
    let bad = false;
    for (let k = last + 1; k < i; k++) {
      if (err(last, i, k) > eps) {
        bad = true;
        break;
      }
    }
    if (bad) {
      keep.push(i - 1);
      last = i - 1;
    }
  }
  if (n > 1) keep.push(n - 1);
  const ts = new Float32Array(keep.length);
  const vs = new Float32Array(keep.length * stride);
  keep.forEach((k, j) => {
    ts[j] = times[k] as number;
    for (let c = 0; c < stride; c++) vs[j * stride + c] = values[k * stride + c] as number;
  });
  return { times: ts, values: vs };
}

/** Bake the first take of a Rocketbox motion file. */
export function bakeClip(fbxPath: string, name: string, boneNames: ReadonlySet<string>): BakedClip {
  const g = readFbx(fbxPath);
  const clip: AnimationClip | undefined = g.animations[0];
  if (!clip) throw new Error(`${fbxPath}: no animation`);
  const tracks: BakedTrack[] = [];
  let stride = 0;
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);
    if (!boneNames.has(bone) || FACE_BONE.test(bone)) continue;
    if (prop === 'quaternion') {
      const r = reduceKeys(t.times, t.values, 4, /Finger|Toe/.test(bone) ? FINE_ROT_EPS : ROT_EPS);
      tracks.push({ node: bone, path: 'rotation', ...r });
    } else if (prop === 'position' && bone === 'Bip01') {
      const n = t.times.length;
      const x0 = t.values[0] as number;
      const z0 = t.values[2] as number;
      const dx = (t.values[(n - 1) * 3] as number) - x0;
      const dz = (t.values[(n - 1) * 3 + 2] as number) - z0;
      const dur = (t.times[n - 1] as number) - (t.times[0] as number) || 1;
      stride = Math.hypot(dx, dz) * UNIT / dur;
      const tt = t.times[0] as number;
      const vals = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const f = ((t.times[i] as number) - tt) / dur;
        // Remove the straight-line drift, keep the sway, and keep Y.
        vals[i * 3] = ((t.values[i * 3] as number) - x0 - dx * f) * UNIT;
        vals[i * 3 + 1] = (t.values[i * 3 + 1] as number) * UNIT;
        vals[i * 3 + 2] = ((t.values[i * 3 + 2] as number) - z0 - dz * f) * UNIT;
      }
      tracks.push({ node: bone, path: 'translation', ...reduceKeys(t.times, vals, 3, POS_EPS) });
    }
  }
  return { name, duration: clip.duration, stride: Math.round(stride * 1000) / 1000, tracks };
}

/** Names of the bones of a converted avatar document (sanitized, in joint order). */
export function jointNames(doc: Document): string[] {
  const skin = doc.getRoot().listSkins()[0];
  return skin ? skin.listJoints().map((j) => j.getName()) : [];
}

/**
 * Foot contacts of a gait clip: for each foot, the cycle phases (0..1) at
 * which the ankle comes down to its lowest height. Computed by forward
 * kinematics over the baked tracks with the avatar's rest translations, so the
 * runtime can fire footstep sounds without touching the skeleton.
 * Result entries are `[phase, foot]` with foot 0 = left, 1 = right.
 */
export function footContacts(clip: BakedClip, skeleton: Document): Array<[number, number]> {
  const skin = skeleton.getRoot().listSkins()[0];
  const root = skin?.getSkeleton();
  if (!root || clip.duration <= 0) return [];
  const rest = new Map<string, { t: Vector3; q: Quaternion; parent: string | null }>();
  const walk = (n: ReturnType<Document['createNode']>, parent: string | null): void => {
    const t = n.getTranslation();
    const r = n.getRotation();
    rest.set(n.getName(), { t: new Vector3(t[0], t[1], t[2]), q: new Quaternion(r[0], r[1], r[2], r[3]), parent });
    for (const c of n.listChildren()) walk(c, n.getName());
  };
  walk(root, null);
  const rot = new Map<string, BakedTrack>();
  let hipTrack: BakedTrack | null = null;
  for (const t of clip.tracks) {
    if (t.path === 'rotation') rot.set(t.node, t);
    else if (t.node === 'Bip01') hipTrack = t;
  }
  const sample = (tr: BakedTrack, time: number, stride: 3 | 4, out: number[]): void => {
    const n = tr.times.length;
    let i = 0;
    while (i < n - 2 && time > (tr.times[i + 1] as number)) i++;
    const a = tr.times[i] as number;
    const b = tr.times[Math.min(i + 1, n - 1)] as number;
    const u = b > a ? Math.max(0, Math.min(1, (time - a) / (b - a))) : 0;
    const j = Math.min(i + 1, n - 1);
    for (let c = 0; c < stride; c++) out[c] = (tr.values[i * stride + c] as number) + ((tr.values[j * stride + c] as number) - (tr.values[i * stride + c] as number)) * u;
  };
  const frames = Math.max(8, Math.round(clip.duration * 30));
  const feet = ['Bip01_L_Foot', 'Bip01_R_Foot'];
  const heights: number[][] = [[], []];
  const buf = [0, 0, 0, 0];
  const worldPos = (name: string, time: number): Vector3 => {
    const chain: string[] = [];
    for (let b: string | null = name; b; b = rest.get(b)?.parent ?? null) chain.push(b);
    const m = new Matrix4();
    for (let i = chain.length - 1; i >= 0; i--) {
      const nm = chain[i] as string;
      const r = rest.get(nm);
      if (!r) continue;
      const q = r.q.clone();
      const tr = rot.get(nm);
      if (tr) {
        sample(tr, time, 4, buf);
        q.set(buf[0] as number, buf[1] as number, buf[2] as number, buf[3] as number).normalize();
      }
      const t = r.t.clone();
      if (nm === 'Bip01' && hipTrack) {
        sample(hipTrack, time, 3, buf);
        t.set(buf[0] as number, buf[1] as number, buf[2] as number);
      }
      m.multiply(new Matrix4().compose(t, q, new Vector3(1, 1, 1)));
    }
    return new Vector3().setFromMatrixPosition(m);
  };
  for (let f = 0; f < frames; f++) {
    const time = (f / frames) * clip.duration;
    for (let k = 0; k < 2; k++) heights[k]?.push(worldPos(feet[k] as string, time).y);
  }
  const out: Array<[number, number]> = [];
  for (let k = 0; k < 2; k++) {
    const h = heights[k] as number[];
    const lo = Math.min(...h);
    const hi = Math.max(...h);
    const thr = lo + (hi - lo) * 0.18;
    // First frame of each run below the threshold (cyclic) is the contact.
    for (let f = 0; f < frames; f++) {
      const prev = h[(f + frames - 1) % frames] as number;
      if ((h[f] as number) <= thr && prev > thr) out.push([Math.round((f / frames) * 1000) / 1000, k]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}
