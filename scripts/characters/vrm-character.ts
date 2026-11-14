/**
 * A cast body from a VRM 1.0 avatar (someone else's model, under its own licence): the step that turns the `.vrm` into
 * a toon body the runtime plays, then hands it to the character finishing step's install (finish-character.ts).
 *
 *   npx tsx scripts/characters/vrm-character.ts --brief scripts/characters/vrm/<id>.json --vrm <file.vrm> [--work <dir>] [--install]
 *
 * The brief (scripts/characters/vrm/<id>.json) names the cast id, the look, the source (URL, SHA-256 of the .vrm,
 * licence, author, credit line) and optional per-material recolours. The licence flags in the file's own VRMC_vrm meta
 * are checked: redistribution, modification and commercial use must all be allowed.
 *
 * The VRM's mesh is posed into the Biped rest pose (each limb bone turned so it points where the rest's does; the hands
 * by two vectors so the palm turns too), baked, and bound to a Biped skeleton whose rest rotations are exactly the rest
 * template's (scripts/characters/vrm/biped-rest.glb: the Blender Kaho's Biped and her five extra clips, from
 * scripts/blender/character/build.py), only the joint positions being the VRM's, scaled so the legs are as long as the
 * template's. Every Biped clip, the procedural gait, IK and look-at then drive it unchanged. Bones outside the humanoid
 * table (hair, skirt, twist helpers, eyes) ride along under their nearest mapped ancestor; aim-constrained helpers ride
 * with the limb that drives them; the hair chains become toon springs. The VRM preset expressions are written as the
 * cast's face morphs (smile = happy, blink, surprised, sad, determined = angry, mouth_open = aa; teary has none and stays
 * empty). Materials become the shared toon pair (body + inverted-hull outline); textures are recoloured when the brief
 * says so, their alpha rewritten into the toon atlas codes (eyes unshaded), down-sized and stored as WebP
 * (scripts/characters/vrm_textures.py).
 *
 * Output: `<work>/<id>.glb` and `<work>/<id>.lod1.glb` (no morphs, meshopt-simplified to about 40 %), both
 * meshopt-compressed. With `--install`: `assets/lib/c/<id>.<hash8>.glb` and `<id>.lod1.<hash8>.glb`, the cast entries in
 * `assets/characters-original.json` and `packages/assets/src/characters/original.ts` with the brief's `credit`.
 *
 * Known gaps: roll/twist helper bones are rigid (wrists can pinch at full twist); springs have no colliders (hair can
 * pass into the body); skirt chains are not springs; `teary` is empty.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Document, type Accessor, type Material, type Node as GNode, type Primitive, type Texture } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { VRM_AIM, VRM_FACE, VRM_TO_BIPED } from '../../packages/assets/src/characters/vrm-scheme';
import { gltfIO } from './kaho/source';
import { installCast, installLod } from './finish-character';

interface Brief {
  id: string;
  gender: 'female' | 'male';
  look: string;
  /** SHA-256 of the source .vrm (checked). */
  sha256: string;
  credit: { source: string; author: string; licence: string; licenceUrl: string; url: string; line?: string };
  /** Per material (regex on the VRM material name): a recolour op and colour (vrm_textures.py). */
  recolour?: { match: string; op: 'lum' | 'mul' | 'lift'; colour: string }[];
  /** Long side of each texture in pixels (default 512); `textureMaxBy` per material regex. */
  textureMax?: number;
  textureMaxBy?: { match: string; max: number }[];
  /** Far level: share of triangles kept (default 0.4). */
  lodRatio?: number;
}

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const REPO = new URL('../../', import.meta.url).pathname;
const BRIEF_FILE = resolve(arg('brief') ?? '');
const brief = JSON.parse(readFileSync(BRIEF_FILE, 'utf8')) as Brief;
const VRM = resolve(arg('vrm') ?? '');
const REST = resolve(arg('rest') ?? join(REPO, 'scripts/characters/vrm/biped-rest.glb'));
const WORK = resolve(arg('work') ?? join(REPO, 'probe-out/vrm', brief.id));
const INSTALL = argv.includes('--install');
mkdirSync(WORK, { recursive: true });
/** Materials drawn unshaded (eyes keep their colour) and cut by their alpha. */
const UNSHADED = /EYE|Eyeline|Brow/i;
const CUT = /EyeHighlight|Eyeline|Brow|EyeIris/i;
const NO_OUTLINE = /_(EYE|FACE)$/;
const FACE_MORPHS = ['smile', 'sad', 'surprised', 'teary', 'blink', 'mouth_open', 'determined'];

// --- the VRM's own JSON (humanoid table, expressions, springs) --------------
const glb = readFileSync(VRM);
const sha = createHash('sha256').update(glb).digest('hex');
if (sha !== brief.sha256) throw new Error(`${VRM}: SHA-256 ${sha}, the brief says ${brief.sha256}`);
const raw = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as any;
const vrmExt = raw.extensions?.VRMC_vrm;
if (!vrmExt) throw new Error('not a VRM 1.0 file (no VRMC_vrm)');
{
  const m = vrmExt.meta ?? {};
  const ok = m.allowRedistribution === true && /allowModification/.test(m.modification ?? '') && /corporation|personalProfit/.test(m.commercialUsage ?? '');
  console.log(`licence flags: allowRedistribution ${m.allowRedistribution}, modification ${m.modification}, commercialUsage ${m.commercialUsage}, creditNotation ${m.creditNotation} (${m.licenseUrl}; ${(m.authors ?? []).join(', ')})`);
  if (!ok) throw new Error('the model\'s licence does not allow redistribution, modification and commercial use');
  if (m.creditNotation === 'required' && !brief.credit.line) throw new Error('the model requires a credit: give the brief a credit.line');
}
const human: Record<string, number> = Object.fromEntries(Object.entries(vrmExt.humanoid.humanBones as Record<string, { node: number }>).map(([k, v]) => [k, v.node]));
const humanOf = new Map<number, string>(Object.entries(human).map(([k, v]) => [v, k]));

const io = await gltfIO();
const vdoc = await io.read(VRM);
const vnodes = vdoc.getRoot().listNodes();
raw.nodes.forEach((n: any, i: number) => {
  if (vnodes[i]?.getName() !== (n.name ?? '')) throw new Error(`node order differs at ${i}`);
});

// --- VRM rest transforms (local TRS, parents) --------------------------------
const N = raw.nodes.length;
const parentOf = new Int32Array(N).fill(-1);
raw.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => (parentOf[c] = i)));
const lt: Vector3[] = [];
const lr: Quaternion[] = [];
for (let i = 0; i < N; i++) {
  const n = raw.nodes[i];
  if (n.matrix) {
    const m = new Matrix4().fromArray(n.matrix);
    const t = new Vector3(), q = new Quaternion(), s = new Vector3();
    m.decompose(t, q, s);
    lt.push(t); lr.push(q);
  } else {
    lt.push(new Vector3().fromArray(n.translation ?? [0, 0, 0]));
    lr.push(new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]));
  }
}
const depth = (i: number): number => (parentOf[i]! < 0 ? 0 : 1 + depth(parentOf[i]!));
const order = [...Array(N).keys()].sort((a, b) => depth(a) - depth(b));
const wt: Vector3[] = Array.from({ length: N }, () => new Vector3());
const wr: Quaternion[] = Array.from({ length: N }, () => new Quaternion());
const solve = (): void => {
  for (const i of order) {
    const p = parentOf[i]!;
    if (p < 0) { wt[i]!.copy(lt[i]!); wr[i]!.copy(lr[i]!); }
    else { wr[i]!.copy(wr[p]!).multiply(lr[i]!); wt[i]!.copy(lt[i]!).applyQuaternion(wr[p]!).add(wt[p]!); }
  }
};
solve();
const restW = order.map(() => new Matrix4());
for (let i = 0; i < N; i++) restW[i] = new Matrix4().compose(wt[i]!, wr[i]!, new Vector3(1, 1, 1));

// --- Kaho's Biped rest -----------------------------------------------------------
const kdoc = await io.read(REST);
const kTop = kdoc.getRoot().listNodes().find((n) => n.getName() === 'Bip01');
if (!kTop) throw new Error('no Bip01 in Kaho');
interface KB { name: string; parent: string | null; t: Vector3; r: Quaternion; wt: Vector3; wr: Quaternion }
const kb = new Map<string, KB>();
const kOrder: string[] = [];
const walk = (n: GNode, parent: KB | null): void => {
  if (!n.getName().startsWith('Bip01')) return;
  const t = new Vector3().fromArray(n.getTranslation());
  const r = new Quaternion().fromArray(n.getRotation());
  const b: KB = { name: n.getName(), parent: parent?.name ?? null, t, r, wt: parent ? t.clone().applyQuaternion(parent.wr).add(parent.wt) : t.clone(), wr: parent ? parent.wr.clone().multiply(r) : r.clone() };
  kb.set(b.name, b);
  kOrder.push(b.name);
  for (const c of n.listChildren()) walk(c, b);
};
walk(kTop, null);
const kp = (n: string): Vector3 => { const b = kb.get(n); if (!b) throw new Error(`Kaho has no ${n}`); return b.wt; };

// --- face the same way: yaw the VRM so its left (thigh to thigh) matches Kaho's --
{
  const vl = wt[human['leftUpperLeg']!]!.clone().sub(wt[human['rightUpperLeg']!]!).setY(0).normalize();
  const kl = kp('Bip01_L_Thigh').clone().sub(kp('Bip01_R_Thigh')).setY(0).normalize();
  const yaw = new Quaternion().setFromUnitVectors(vl, kl);
  console.log('yaw to Kaho (deg)', ((2 * Math.acos(Math.min(1, Math.abs(yaw.w))) * 180) / Math.PI).toFixed(1));
  for (let i = 0; i < N; i++) if (parentOf[i]! < 0) { lr[i]!.premultiply(yaw); lt[i]!.applyQuaternion(yaw); }
  solve();
}

// --- pose the VRM into Kaho's rest pose ---------------------------------------
const bipOf = (h: string): string => VRM_TO_BIPED[h] as string;
const turnBone = (i: number, q: Quaternion): void => {
  // world delta q on bone i: new world = q · old world; local = parentWorld⁻¹ · new world
  const nw = q.clone().multiply(wr[i]!);
  const p = parentOf[i]!;
  lr[i]!.copy(p < 0 ? nw : wr[p]!.clone().invert().multiply(nw));
  solve();
};
const basis = (a: Vector3, b: Vector3): Quaternion => {
  const x = a.clone().normalize();
  const z = new Vector3().crossVectors(x, b).normalize();
  const y = new Vector3().crossVectors(z, x);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
};
// (the clavicles are not aimed: a Biped clavicle starts at the neck, a VRM shoulder at the chest side, so their directions differ by build, not pose)
const humanOrder = Object.keys(VRM_AIM).filter((h) => !h.endsWith("Shoulder") && human[h] !== undefined && human[VRM_AIM[h]!] !== undefined).sort((a, b) => depth(human[a]!) - depth(human[b]!));
const restWr = wr.map((q) => q.clone());
let maxTurn = 0;
for (const h of humanOrder) {
  const i = human[h]!;
  const c = human[VRM_AIM[h]!]!;
  const cur = wt[c]!.clone().sub(wt[i]!).normalize();
  const tgt = kp(bipOf(VRM_AIM[h]!)).clone().sub(kp(bipOf(h))).normalize();
  let q: Quaternion;
  const side = h.startsWith('left') ? 'left' : 'right';
  if (h.endsWith('Hand') && human[`${side}IndexProximal`] !== undefined && human[`${side}LittleProximal`] !== undefined) {
    const curB = wt[human[`${side}IndexProximal`]!]!.clone().sub(wt[human[`${side}LittleProximal`]!]!);
    const s = side === 'left' ? 'L' : 'R';
    const tgtB = kp(`Bip01_${s}_Finger1`).clone().sub(kp(`Bip01_${s}_Finger4`));
    q = basis(tgt, tgtB).multiply(basis(cur, curB).invert());
  } else q = new Quaternion().setFromUnitVectors(cur, tgt);
  const ang = (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
  if (ang > maxTurn) maxTurn = ang;
  if (/UpperArm|UpperLeg|Hand$|Shoulder|spine|neck/.test(h)) console.log(`  pose ${h} -> ${bipOf(h)}: ${ang.toFixed(1)} deg`);
  turnBone(i, q);
}
console.log('largest pose turn (deg)', maxTurn.toFixed(1));
// Aim-constrained helpers (VRMC_node_constraint: J_Aim_*_Shoulder / TopsUpperArm / UpperLeg sit under the shoulder or
// hips and aim at the elbow or knee): turned with the limb bone that drives them, and later carried by it. Roll helpers
// stay rigid under their parents (the half-twist they add is lost).
const aimDriver = new Map<number, number>();
raw.nodes.forEach((n: any, i: number) => {
  const aim = n.extensions?.VRMC_node_constraint?.constraint?.aim;
  if (aim) aimDriver.set(i, parentOf[aim.source]!);
});
for (const [i, d] of aimDriver) {
  const delta = wr[d]!.clone().multiply(restWr[d]!.clone().invert());
  turnBone(i, delta.multiply(restWr[i]!).multiply(wr[i]!.clone().invert()));
}
console.log(`aim helpers turned with their limbs: ${[...aimDriver.keys()].map((i) => raw.nodes[i].name).join(' ')}`);
const posedW: Matrix4[] = [];
for (let i = 0; i < N; i++) posedW.push(new Matrix4().compose(wt[i]!, wr[i]!, new Vector3(1, 1, 1)));

// --- scale: legs as long as Kaho's (thigh joint height) ----------------------
const vThigh = (wt[human['leftUpperLeg']!]!.y + wt[human['rightUpperLeg']!]!.y) / 2;
const kThigh = (kp('Bip01_L_Thigh').y + kp('Bip01_R_Thigh').y) / 2;
const S = kThigh / vThigh;
const Sm = new Matrix4().makeScale(S, S, S);
let vTop = 0;
for (const m of vdoc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION')!; vTop = Math.max(vTop, a.getMax([0, 0, 0])[1]!); }
console.log(`scale ${S.toFixed(3)} (thigh ${vThigh.toFixed(3)} -> ${kThigh.toFixed(3)}); VRM height ${vTop.toFixed(3)} -> about ${(vTop * S).toFixed(3)} (Kaho 1.549)`);

// --- the new skeleton ----------------------------------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const sceneRoot = doc.createScene(brief.id);
// (Kaho's file holds everything under an identity node named Biped)
const scene = doc.createNode('Biped');
sceneRoot.addChild(scene);
const newWorld = new Map<GNode, Matrix4>();
const bipNode = new Map<string, GNode>();
const vrmBip = new Map<string, number>(Object.entries(human).filter(([h]) => VRM_TO_BIPED[h]).map(([h, i]) => [bipOf(h), i]));
const vThighMid = wt[human['leftUpperLeg']!]!.clone().add(wt[human['rightUpperLeg']!]!).multiplyScalar(S / 2);
const kThighMid = kp('Bip01_L_Thigh').clone().add(kp('Bip01_R_Thigh')).multiplyScalar(0.5);
for (const name of kOrder) {
  const b = kb.get(name)!;
  let pos: Vector3;
  if (name === 'Bip01' || name === 'Bip01_Pelvis') pos = vThighMid.clone().add(kp(name).clone().sub(kThighMid));
  else if (vrmBip.has(name)) pos = wt[vrmBip.get(name)!]!.clone().multiplyScalar(S);
  else {
    const pw = newWorld.get(bipNode.get(b.parent!)!)!;
    pos = b.t.clone().multiplyScalar(S).applyMatrix4(pw);
    console.log('  unmapped Biped bone kept at Kaho offset:', name);
  }
  const W = new Matrix4().compose(pos, b.wr, new Vector3(1, 1, 1));
  const node = doc.createNode(name);
  newWorld.set(node, W);
  bipNode.set(name, node);
  if (b.parent) bipNode.get(b.parent)!.addChild(node);
  else scene.addChild(node);
}
// VRM nodes that skin vertices or carry springs, outside the humanoid table
const keepVrm = new Set<number>();
for (const s of raw.skins) for (const j of s.joints) keepVrm.add(j);
for (const sp of raw.extensions?.VRMC_springBone?.springs ?? []) for (const j of sp.joints) keepVrm.add(j.node);
const nodeForVrm = new Map<number, GNode>();
for (const [h, i] of Object.entries(human)) if (VRM_TO_BIPED[h]) nodeForVrm.set(i, bipNode.get(bipOf(h))!);
let extras = 0;
for (const i of order) {
  if (!keepVrm.has(i) || nodeForVrm.has(i)) continue;
  let p = aimDriver.get(i) ?? parentOf[i]!;
  while (p >= 0 && !nodeForVrm.has(p)) p = parentOf[p]!;
  const parent = p >= 0 ? nodeForVrm.get(p)! : bipNode.get('Bip01_Pelvis')!;
  const W = new Matrix4().compose(wt[i]!.clone().multiplyScalar(S), wr[i]!, new Vector3(1, 1, 1));
  const node = doc.createNode(raw.nodes[i].name);
  newWorld.set(node, W);
  parent.addChild(node);
  nodeForVrm.set(i, node);
  extras++;
}
// locals from the worlds
const parentNode = (n: GNode): GNode | null => (n.getParentNode() as GNode | null) ?? null;
for (const [n, W] of newWorld) {
  const p = parentNode(n);
  const L = p && newWorld.has(p) ? newWorld.get(p)!.clone().invert().multiply(W) : W.clone();
  const t = new Vector3(), q = new Quaternion(), s = new Vector3();
  L.decompose(t, q, s);
  n.setTranslation(t.toArray() as [number, number, number]).setRotation(q.normalize().toArray() as [number, number, number, number]);
}
// Biped rest locals must equal Kaho's (the clips' frames)
let rotErr = 0;
for (const name of kOrder) rotErr = Math.max(rotErr, 1 - Math.abs(new Quaternion().fromArray(bipNode.get(name)!.getRotation()).dot(kb.get(name)!.r)));
console.log(`skeleton: ${kOrder.length} Biped + ${extras} carried VRM bones; Biped local rotation error vs Kaho ${rotErr.toExponential(1)}`);

const joints = [...newWorld.keys()];
const jointIndex = new Map(joints.map((n, i) => [n, i]));
const ibm = new Float32Array(joints.length * 16);
joints.forEach((n, i) => ibm.set(newWorld.get(n)!.clone().invert().elements, i * 16));
const skin = doc.createSkin(`${brief.id}-skin`).setSkeleton(bipNode.get('Bip01')!).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
for (const n of joints) skin.addJoint(n);

// --- textures -------------------------------------------------------------------
mkdirSync(join(WORK, 'tex'), { recursive: true });
const vmats = vdoc.getRoot().listMaterials();
const jobs: { name: string; src: string; dst: string; code: number; cut: boolean; max: number; recolour?: { op: string; colour: string } }[] = [];
vmats.forEach((m, i) => {
  const tex = m.getBaseColorTexture();
  if (!tex) throw new Error(`material ${m.getName()} has no base colour texture`);
  const src = join(WORK, 'tex', `${i}-src.png`);
  writeFileSync(src, tex.getImage()!);
  const name = m.getName();
  const rc = brief.recolour?.find((r) => new RegExp(r.match, 'i').test(name));
  const max = brief.textureMaxBy?.find((r) => new RegExp(r.match, 'i').test(name))?.max ?? brief.textureMax ?? 512;
  jobs.push({ name, src, dst: join(WORK, 'tex', `${i}.webp`), code: UNSHADED.test(name) ? 0.2 : 1, cut: m.getAlphaMode() !== 'OPAQUE' || CUT.test(name), max, ...(rc ? { recolour: { op: rc.op, colour: rc.colour } } : {}) });
});
writeFileSync(join(WORK, 'tex', 'jobs.json'), JSON.stringify(jobs));
console.log(execFileSync('python3', ['-I', join(REPO, 'scripts/characters/vrm_textures.py'), join(WORK, 'tex', 'jobs.json')], { encoding: 'utf8' }));
doc.createExtension(EXTTextureWebP).setRequired(true);
const bodyMat: Material[] = [];
const lineMat: Material[] = [];
vmats.forEach((m, i) => {
  const tex: Texture = doc.createTexture(m.getName()).setImage(readFileSync(jobs[i]!.dst)).setMimeType('image/webp');
  bodyMat.push(doc.createMaterial(`${brief.id}-${m.getName()}`).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1).setExtras({ toon: 'body' }));
  lineMat.push(doc.createMaterial(`${brief.id}-${m.getName()}-outline`).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1).setExtras({ toon: 'outline' }));
});
const outlined = new Set<Material>();

// --- geometry: bake the pose, rebind ---------------------------------------------
const vskins = vdoc.getRoot().listSkins();
const skinMats = vskins.map((s, si) => raw.skins[si].joints.map((vn: number, j: number) => {
  const ib = new Matrix4().fromArray(s.getInverseBindMatrices()!.getElement(j, new Array(16)) as number[]);
  return Sm.clone().multiply(posedW[vn]!).multiply(ib);
}));
const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4', arr: Float32Array | Uint16Array | Uint32Array): Accessor => doc.createAccessor().setType(type).setArray(arr as Parameters<Accessor["setArray"]>[0]).setBuffer(buffer);
const bodyMesh = doc.createMesh(`${brief.id}-body`);
const faceMesh = doc.createMesh(`${brief.id}-face`).setExtras({ targetNames: FACE_MORPHS });
const expr = vrmExt.expressions?.preset ?? {};
const faceReport: string[] = [];
raw.nodes.forEach((rn: any, ni: number) => {
  if (rn.mesh === undefined) return;
  const vmesh = vdoc.getRoot().listMeshes()[rn.mesh]!;
  const sm = skinMats[rn.skin] as Matrix4[];
  const vskinJoints = raw.skins[rn.skin].joints as number[];
  vmesh.listPrimitives().forEach((p, pi) => {
    const P = p.getAttribute('POSITION')!, Nn = p.getAttribute('NORMAL')!, UV = p.getAttribute('TEXCOORD_0')!, J = p.getAttribute('JOINTS_0')!, Wt = p.getAttribute('WEIGHTS_0')!;
    const n = P.getCount();
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), jo = new Uint16Array(n * 4), we = new Float32Array(n * 4), toon = new Float32Array(n * 4);
    const lin: Matrix3[] = [];
    const e4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0], e3 = [0, 0, 0], e2 = [0, 0];
    const v = new Vector3(), M = new Matrix4();
    const mi = vmats.indexOf(p.getMaterial()!);
    const mname = vmats[mi]!.getName();
    const isFace = /Face|Eye|Mouth|Brow/i.test(mname);
    for (let k = 0; k < n; k++) {
      J.getElement(k, e4); Wt.getElement(k, w4);
      const ws = w4[0]! + w4[1]! + w4[2]! + w4[3]! || 1;
      M.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let c = 0; c < 4; c++) {
        const w = w4[c]! / ws;
        if (w <= 0) continue;
        const sk = sm[e4[c]!]!;
        for (let q = 0; q < 16; q++) M.elements[q]! += sk.elements[q]! * w;
        jo[k * 4 + c] = jointIndex.get(nodeForVrm.get(vskinJoints[e4[c]!]!)!)!;
        we[k * 4 + c] = w;
      }
      v.fromArray(P.getElement(k, e3)).applyMatrix4(M).toArray(pos, k * 3);
      lin.push(new Matrix3().setFromMatrix4(M));
      v.fromArray(Nn.getElement(k, e3)).applyMatrix3(lin[k]!).normalize().toArray(nor, k * 3);
      UV.getElement(k, e2); uv[k * 2] = e2[0]!; uv[k * 2 + 1] = e2[1]!;
      // _toon: outline width factor, shade bias, rim strength, cloth (0 = none)
      toon[k * 4] = isFace ? 0.55 : 0.8; toon[k * 4 + 1] = 0; toon[k * 4 + 2] = isFace ? 0.4 : 1; toon[k * 4 + 3] = 0;
    }
    const prim = doc.createPrimitive().setMaterial(bodyMat[mi]!)
      .setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nor)).setAttribute('TEXCOORD_0', acc('VEC2', uv))
      .setAttribute('JOINTS_0', acc('VEC4', jo)).setAttribute('WEIGHTS_0', acc('VEC4', we)).setAttribute('_TOON', acc('VEC4', toon));
    const idx = p.getIndices();
    if (idx) prim.setIndices(acc('SCALAR', new Uint32Array(idx.getArray()!)));
    const targets = p.listTargets();
    if (targets.length > 0) {
      for (const face of FACE_MORPHS) {
        const d = new Float32Array(n * 3);
        const preset = VRM_FACE[face];
        const binds = preset ? (expr[preset]?.morphTargetBinds ?? []).filter((b: any) => b.node === ni) : [];
        for (const b of binds) {
          const ta = targets[b.index]!.getAttribute('POSITION')!;
          for (let k = 0; k < n; k++) {
            v.fromArray(ta.getElement(k, e3)).applyMatrix3(lin[k]!).multiplyScalar(b.weight);
            d[k * 3]! += v.x; d[k * 3 + 1]! += v.y; d[k * 3 + 2]! += v.z;
          }
        }
        if (pi === 0) faceReport.push(`${face}<-${preset ?? 'none'}${binds.length ? '' : ' (empty)'}`);
        prim.addTarget(doc.createPrimitiveTarget(face).setAttribute('POSITION', acc('VEC3', d)));
      }
    }
    (targets.length > 0 ? faceMesh : bodyMesh).addPrimitive(prim);
    const mode = raw.materials[mi]?.extensions?.VRMC_materials_mtoon?.outlineWidthMode;
    if (mode && mode !== 'none' && !NO_OUTLINE.test(mname)) outlined.add(bodyMat[mi]!);
  });
});
console.log('face morphs:', faceReport.join(', '));
const bodyNode = doc.createNode(bodyMesh.getName()).setMesh(bodyMesh).setSkin(skin);
const faceNode = doc.createNode(faceMesh.getName()).setMesh(faceMesh).setSkin(skin);
scene.addChild(bodyNode).addChild(faceNode);

// --- springs (hair chains) and the rest template's clips -----------------------------------
const springs: unknown[] = [];
for (const sp of raw.extensions?.VRMC_springBone?.springs ?? []) {
  if (!/hair/i.test(sp.name ?? '')) continue;
  const js = sp.joints.map((j: any) => j.node) as number[];
  if (js.length < 2) continue;
  const last = nodeForVrm.get(js[js.length - 1]!)!, prev = nodeForVrm.get(js[js.length - 2]!)!;
  const tip = new Vector3().setFromMatrixPosition(newWorld.get(last)!).applyMatrix4(newWorld.get(prev)!.clone().invert());
  springs.push({ name: raw.nodes[js[0]!].name, bones: js.slice(0, -1).map((j) => raw.nodes[j].name), tip: tip.toArray(), stiffness: 0.3, drag: 0.2, gravity: 0.35, radius: 0.012, limit: 0.7 });
}
sceneRoot.setExtras({ toon: { springs, colliders: [] }, source: { ...brief.credit, sha256: sha, scale: +S.toFixed(4) } });
let clips = 0;
for (const ka of kdoc.getRoot().listAnimations()) {
  const a = doc.createAnimation(ka.getName());
  for (const ch of ka.listChannels()) {
    const target = bipNode.get(ch.getTargetNode()!.getName());
    if (!target) continue;
    const s = ch.getSampler()!;
    const smp = doc.createAnimationSampler().setInterpolation(s.getInterpolation())
      .setInput(acc('SCALAR', new Float32Array(s.getInput()!.getArray()!)))
      .setOutput(doc.createAccessor().setType(s.getOutput()!.getType()).setArray(new Float32Array(s.getOutput()!.getArray()!)).setBuffer(buffer));
    a.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()!).setSampler(smp));
  }
  clips++;
}

// --- outputs ------------------------------------------------------------------------
/** Outline draws: a second primitive per outlined material sharing the body's accessors (and morph targets). */
const outlineNodes = (): GNode[] => {
  const made: GNode[] = [];
  for (const [m, node] of [[bodyMesh, bodyNode], [faceMesh, faceNode]] as const) {
    const line = doc.createMesh(`${m.getName()}-outline`);
    for (const p of m.listPrimitives()) {
      const mat = p.getMaterial()!;
      if (!outlined.has(mat)) continue;
      const lp = doc.createPrimitive().setMaterial(lineMat[bodyMat.indexOf(mat)]!).setIndices(p.getIndices());
      for (const sem of p.listSemantics()) lp.setAttribute(sem, p.getAttribute(sem));
      for (const t of p.listTargets()) lp.addTarget(t);
      line.addPrimitive(lp);
    }
    if (line.listPrimitives().length === 0) { line.dispose(); continue; }
    const ex = m.getExtras() as { targetNames?: string[] };
    if (ex.targetNames && m.listPrimitives().some((p) => p.listTargets().length > 0)) line.setExtras({ targetNames: ex.targetNames });
    const n = doc.createNode(line.getName()).setMesh(line).setSkin(node.getSkin());
    scene.addChild(n);
    made.push(n);
  }
  return made;
};
const measure = (): { height: number; hip: number; triangles: number } => {
  let minY = Infinity, maxY = -Infinity, triangles = 0;
  const e = [0, 0, 0];
  for (const m of [bodyMesh, faceMesh]) for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION')!;
    for (let i = 0; i < P.getCount(); i++) { P.getElement(i, e); minY = Math.min(minY, e[1]!); maxY = Math.max(maxY, e[1]!); }
    triangles += (p.getIndices()?.getCount() ?? P.getCount()) / 3;
  }
  const pelvisY = new Vector3().setFromMatrixPosition(newWorld.get(bipNode.get('Bip01_Pelvis')!)!).y;
  return { height: Math.round((maxY - minY) * 1000) / 1000, hip: Math.round((pelvisY - minY) * 1000) / 1000, triangles: Math.round(triangles) };
};
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
const writeOut = async (lod: boolean): Promise<void> => {
  const lines = outlineNodes();
  const m = measure();
  const bytes = await io.writeBinary(doc);
  const file = join(WORK, `${brief.id}${lod ? '.lod1' : ''}.glb`);
  writeFileSync(file, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const entry = {
    id: brief.id, gender: brief.gender, look: brief.look.slice(0, 200), file: `c/${brief.id}${lod ? '.lod1' : ''}.${hash.slice(0, 8)}.glb`,
    height: m.height, hip: m.hip, triangles: m.triangles, faces: 1 as const, bytes: bytes.byteLength, style: 'toon' as const, credit: brief.credit,
  };
  console.log(`wrote ${file}: ${(bytes.byteLength / 1e6).toFixed(2)} MB, ${m.triangles} triangles, height ${m.height} m, hip ${m.hip} m`);
  if (INSTALL) {
    if (lod) installLod(entry, bytes);
    else installCast(entry, bytes, hash);
    console.log(`installed assets/lib/${entry.file}`);
  }
  for (const n of lines) { const mesh = n.getMesh()!; n.dispose(); mesh.listPrimitives().forEach((p) => p.dispose()); mesh.dispose(); }
};
await writeOut(false);

// --- the far level: no morphs, one mesh, meshopt-simplified -----------------------
await MeshoptSimplifier.ready;
for (const p of faceMesh.listPrimitives()) {
  for (const t of p.listTargets()) { p.removeTarget(t); t.dispose(); }
  faceMesh.removePrimitive(p);
  bodyMesh.addPrimitive(p);
}
faceNode.dispose(); faceMesh.dispose();
const ratio = brief.lodRatio ?? 0.4;
const compact = (p: Primitive, idx: Uint32Array): void => {
  // keep only the vertices the reduced triangles use
  const remap = new Int32Array(p.getAttribute('POSITION')!.getCount()).fill(-1);
  let n = 0;
  for (const i of idx) if (remap[i]! < 0) remap[i] = n++;
  for (const sem of p.listSemantics()) {
    const a = p.getAttribute(sem)!;
    const k = a.getElementSize();
    const src = a.getArray()!;
    const dst = new (src.constructor as Float32ArrayConstructor)(n * k);
    for (let v = 0; v < remap.length; v++) if (remap[v]! >= 0) for (let c = 0; c < k; c++) dst[remap[v]! * k + c] = src[v * k + c]!;
    p.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer));
  }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(idx, (i) => remap[i]!)).setBuffer(buffer));
};
for (const p of bodyMesh.listPrimitives()) {
  const idx = new Uint32Array(p.getIndices()!.getArray()!);
  const pos = new Float32Array(p.getAttribute('POSITION')!.getArray()!);
  const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.01, []);
  compact(p, out.length >= 3 ? out : idx);
}
// (the replaced accessors and the morph targets' deltas are no longer used: drop them)
for (const a of doc.getRoot().listAccessors()) if (a.listParents().every((p) => p === doc.getRoot())) a.dispose();
await writeOut(true);
console.log(`${springs.length} hair springs, ${clips} body clips`);
