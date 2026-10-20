/**
 * Clips Rocketbox does not have (jump, fall, land, death, hit, melee swing,
 * pick-up from the floor, throw, crouch-walk), authored here as keyframed
 * poses on the Biped, so no third-party animation file is needed for them.
 *
 * A pose is a set of world-frame rotation deltas (degrees, model axes: +X is
 * the character's left, +Y up, +Z forward) laid on top of the Rocketbox idle
 * pose. Forward kinematics turns them into local rotations:
 *
 *   local' = (P'⁻¹ · D · P') · local_idle
 *
 * where P' is the parent's new world rotation and D the delta. A bone with
 * no delta keeps its idle rotation, so every authored clip carries a full
 * rotation track set and crossfades cleanly against any Rocketbox clip.
 */
import type { Document } from '@gltf-transform/core';
import { Euler, Quaternion } from 'three';
import { type BakedClip, type BakedTrack, reduceKeys } from './convert';

type V3 = readonly [number, number, number];

/** Short pose keys to Biped bone names. */
const BONE: Readonly<Record<string, string>> = {
  root: 'Bip01',
  pelvis: 'Bip01_Pelvis',
  s0: 'Bip01_Spine',
  s1: 'Bip01_Spine1',
  s2: 'Bip01_Spine2',
  neck: 'Bip01_Neck',
  head: 'Bip01_Head',
  lcl: 'Bip01_L_Clavicle',
  rcl: 'Bip01_R_Clavicle',
  lua: 'Bip01_L_UpperArm',
  rua: 'Bip01_R_UpperArm',
  lfa: 'Bip01_L_Forearm',
  rfa: 'Bip01_R_Forearm',
  lhd: 'Bip01_L_Hand',
  rhd: 'Bip01_R_Hand',
  lth: 'Bip01_L_Thigh',
  rth: 'Bip01_R_Thigh',
  lca: 'Bip01_L_Calf',
  rca: 'Bip01_R_Calf',
  lft: 'Bip01_L_Foot',
  rft: 'Bip01_R_Foot',
};

/** Rotation deltas by short bone key, plus the hip offset in metres. */
export interface Pose {
  r?: Partial<Record<keyof typeof BONE, V3>>;
  /** Hip (root) offset in metres [x, y, z] in model space. */
  hip?: V3;
}

/** A keyframe at time `t` seconds. */
type Key = readonly [number, Pose];

/** Authored clip definition. */
interface Def {
  name: string;
  loop: boolean;
  /** Planar speed the clip is meant for (m/s) when it is a gait. */
  stride?: number;
  keys: readonly Key[];
}

const mirror = (p: Partial<Record<string, V3>>): Partial<Record<string, V3>> => {
  const o: Partial<Record<string, V3>> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!v) continue;
    const m = k.startsWith('l') && BONE[`r${k.slice(1)}`] ? `r${k.slice(1)}` : k.startsWith('r') && BONE[`l${k.slice(1)}`] ? `l${k.slice(1)}` : k;
    // A mirrored world-frame delta flips the signs of the rotations about Y and Z.
    const flip = m !== k || k === 'root' || k === 'pelvis';
    o[m] = flip ? ([v[0], -v[1], -v[2]] as const) : v;
  }
  return o;
};
void mirror;

const crouchLegs = (a: number): NonNullable<Pose['r']> => ({
  lth: [-a, 0, 0],
  rth: [-a, 0, 0],
  lca: [a * 1.6, 0, 0],
  rca: [a * 1.6, 0, 0],
  lft: [-a * 0.6, 0, 0],
  rft: [-a * 0.6, 0, 0],
});

const AIR: Pose = { r: { lth: [-30, 0, 0], rth: [-14, 0, 0], lca: [55, 0, 0], rca: [35, 0, 0], lft: [18, 0, 0], rft: [18, 0, 0], lua: [-38, 0, 26], rua: [-38, 0, -26], lfa: [-28, 0, 0], rfa: [-28, 0, 0], s1: [-4, 0, 0] }, hip: [0, 0, 0] };

/** Clip definitions. */
export const DEFS: readonly Def[] = [
  {
    name: 'jump_start',
    loop: false,
    keys: [
      [0, { r: {}, hip: [0, 0, 0] }],
      [0.17, { r: { ...crouchLegs(46), s0: [14, 0, 0], s1: [10, 0, 0], head: [-12, 0, 0], lua: [34, 0, 0], rua: [34, 0, 0] }, hip: [0, -0.26, 0.04] }],
      [0.3, { r: { lth: [-4, 0, 0], rth: [-4, 0, 0], lca: [6, 0, 0], rca: [6, 0, 0], lft: [30, 0, 0], rft: [30, 0, 0], lua: [-120, 0, 14], rua: [-120, 0, -14], s0: [-4, 0, 0] }, hip: [0, 0.03, 0] }],
    ],
  },
  { name: 'jump_air', loop: true, keys: [[0, AIR], [0.4, { ...AIR, r: { ...AIR.r, lth: [-22, 0, 0], rth: [-26, 0, 0], lua: [-52, 0, 30], rua: [-52, 0, -30] } }], [0.8, AIR]] },
  {
    name: 'fall',
    loop: true,
    keys: [
      [0, { r: { lua: [-58, 0, 34], rua: [-66, 0, -32], lfa: [-34, 0, 0], rfa: [-40, 0, 0], lth: [-12, 0, 8], rth: [6, 0, -8], lca: [24, 0, 0], rca: [34, 0, 0], s1: [-6, 0, 0], head: [-8, 0, 0] } }],
      [0.35, { r: { lua: [-70, 0, 30], rua: [-52, 0, -38], lfa: [-42, 0, 0], rfa: [-26, 0, 0], lth: [4, 0, 8], rth: [-14, 0, -8], lca: [36, 0, 0], rca: [20, 0, 0], s1: [-6, 0, 0], head: [-8, 0, 0] } }],
      [0.7, { r: { lua: [-58, 0, 34], rua: [-66, 0, -32], lfa: [-34, 0, 0], rfa: [-40, 0, 0], lth: [-12, 0, 8], rth: [6, 0, -8], lca: [24, 0, 0], rca: [34, 0, 0], s1: [-6, 0, 0], head: [-8, 0, 0] } }],
    ],
  },
  {
    name: 'land',
    loop: false,
    keys: [
      [0, AIR],
      [0.12, { r: { ...crouchLegs(72), s0: [20, 0, 0], s1: [14, 0, 0], head: [-16, 0, 0], lua: [-46, 0, 20], rua: [-46, 0, -20] }, hip: [0, -0.4, 0.05] }],
      [0.28, { r: { ...crouchLegs(30), s0: [8, 0, 0], lua: [-20, 0, 10], rua: [-20, 0, -10] }, hip: [0, -0.16, 0.02] }],
      [0.45, { r: {}, hip: [0, 0, 0] }],
    ],
  },
  {
    name: 'hit',
    loop: false,
    keys: [
      [0, { r: {} }],
      [0.09, { r: { s0: [-10, 6, 0], s1: [-8, 8, 0], s2: [-6, 6, 0], head: [-20, 14, 0], neck: [-6, 6, 0], lua: [22, 0, 18], rua: [26, 0, -14], lfa: [-20, 0, 0], rfa: [-26, 0, 0], lth: [-8, 0, 0], rth: [6, 0, 0], lca: [12, 0, 0], rca: [8, 0, 0] }, hip: [0, -0.05, -0.05] }],
      [0.28, { r: { s0: [-4, 3, 0], s1: [-3, 3, 0], head: [-8, 6, 0], lua: [8, 0, 6], rua: [10, 0, -6] }, hip: [0, -0.02, -0.02] }],
      [0.5, { r: {} }],
    ],
  },
  {
    name: 'attack',
    loop: false,
    keys: [
      [0, { r: {} }],
      [0.26, { r: { rua: [-165, 0, -18], rfa: [-30, 0, 0], lua: [-20, 0, 24], s0: [-8, -22, 0], s1: [-6, -16, 0], head: [-4, -8, 0], rth: [18, 0, 0], lth: [-14, 0, 0], lca: [12, 0, 0] }, hip: [0, -0.04, 0.02] }],
      [0.42, { r: { rua: [-48, 0, -6], rfa: [-18, 0, 0], lua: [8, 0, 18], s0: [22, 24, 0], s1: [14, 18, 0], head: [10, 6, 0], lth: [-36, 0, 0], lca: [34, 0, 0], rth: [14, 0, 0] }, hip: [0, -0.12, 0.2] }],
      [0.62, { r: { rua: [-30, 0, -8], rfa: [-10, 0, 0], s0: [12, 12, 0], lth: [-22, 0, 0], lca: [20, 0, 0] }, hip: [0, -0.06, 0.12] }],
      [0.85, { r: {} }],
    ],
  },
  {
    name: 'throw',
    loop: false,
    keys: [
      [0, { r: {} }],
      [0.3, { r: { rua: [-150, 0, -34], rfa: [-60, 0, 0], lua: [-30, 0, 38], s0: [-12, -26, 0], s1: [-8, -18, 0], lth: [-10, 0, 0], rth: [14, 0, 0] }, hip: [0, -0.03, -0.02] }],
      [0.46, { r: { rua: [-70, 0, -4], rfa: [-12, 0, 0], lua: [-10, 0, 20], s0: [20, 26, 0], s1: [12, 16, 0], head: [6, 6, 0], lth: [-30, 0, 0], lca: [24, 0, 0], rth: [10, 0, 0] }, hip: [0, -0.1, 0.14] }],
      [0.9, { r: {} }],
    ],
  },
  {
    name: 'pickup',
    loop: false,
    keys: [
      [0, { r: {} }],
      [0.5, { r: { ...crouchLegs(64), s0: [32, 0, 0], s1: [18, 0, 0], head: [-18, 0, 0], lua: [-28, 0, 4], rua: [-30, 0, -4], rfa: [-8, 0, 0], lfa: [-8, 0, 0] }, hip: [0, -0.34, 0.06] }],
      [0.7, { r: { ...crouchLegs(64), s0: [32, 0, 0], s1: [18, 0, 0], head: [-18, 0, 0], lua: [-28, 0, 4], rua: [-34, 0, -4], rfa: [-14, 0, 0], lfa: [-8, 0, 0] }, hip: [0, -0.34, 0.06] }],
      [1.3, { r: { lua: [-22, 0, 4], rua: [-38, 0, -4], rfa: [-60, 0, 0], lfa: [-8, 0, 0], s0: [6, 0, 0] }, hip: [0, 0, 0] }],
    ],
  },
  {
    name: 'death',
    loop: false,
    keys: [
      [0, { r: {} }],
      [0.2, { r: { s0: [-14, 6, 0], s1: [-8, 6, 0], head: [-22, 10, 0], lua: [18, 0, 30], rua: [24, 0, -24], lfa: [-24, 0, 0], rfa: [-30, 0, 0] }, hip: [0, -0.04, -0.06] }],
      [0.7, { r: { ...crouchLegs(42), s0: [10, 0, 0], s1: [8, 0, 0], head: [16, 0, 0], lua: [-14, 0, 8], rua: [-14, 0, -8] }, hip: [0, -0.4, -0.08] }],
      [1.3, { r: { root: [-90, 0, 0], lth: [8, 0, 10], rth: [4, 0, -12], lca: [14, 0, 0], rca: [8, 0, 0], lua: [10, 0, 38], rua: [6, 0, -34], lfa: [-14, 0, 0], rfa: [-20, 0, 0], head: [10, 0, 6] }, hip: [0, -0.72, -0.42] }],
      [1.7, { r: { root: [-90, 0, 0], lth: [8, 0, 12], rth: [2, 0, -14], lca: [10, 0, 0], rca: [6, 0, 0], lua: [10, 0, 42], rua: [6, 0, -38], lfa: [-10, 0, 0], rfa: [-16, 0, 0], head: [8, 0, 8] }, hip: [0, -0.72, -0.42] }],
    ],
  },
  (() => {
    const a = 24;
    const mk = (s: number, w: number): Pose => ({
      r: {
        lth: [-a * s - 18, 0, 0],
        rth: [a * s - 18, 0, 0],
        lca: [Math.max(0, a * s) * 1.4 + 55, 0, 0],
        rca: [Math.max(0, -a * s) * 1.4 + 55, 0, 0],
        lft: [-14, 0, 0],
        rft: [-14, 0, 0],
        s0: [18, w * 4, 0],
        s1: [10, w * 4, 0],
        lua: [-a * s * 0.5 - 6, 0, 8],
        rua: [a * s * 0.5 - 6, 0, -8],
        head: [-10, 0, 0],
      },
      hip: [0, -0.3 + Math.abs(s) * -0.015, 0.05],
    });
    return { name: 'crouch_walk', loop: true, stride: 0.95, keys: [[0, mk(1, 1)], [0.25, mk(0, 0)], [0.5, mk(-1, -1)], [0.75, mk(0, 0)], [1.0, mk(1, 1)]] } satisfies Def;
  })(),
];

const SAMPLE_FPS = 30;

/** Everything FK needs about the skeleton: parent names and the idle pose to build on. */
interface Skel {
  parent: Map<string, string | null>;
  order: string[];
  baseRot: Map<string, Quaternion>;
  baseHip: [number, number, number];
}

function skelOf(doc: Document, idle: BakedClip): Skel {
  const parent = new Map<string, string | null>();
  const order: string[] = [];
  const baseRot = new Map<string, Quaternion>();
  const skin = doc.getRoot().listSkins()[0];
  const root = skin?.getSkeleton();
  if (!root) throw new Error('avatar has no skeleton root');
  const walk = (n: ReturnType<Document['createNode']>, p: string | null): void => {
    parent.set(n.getName(), p);
    order.push(n.getName());
    const r = n.getRotation();
    baseRot.set(n.getName(), new Quaternion(r[0], r[1], r[2], r[3]));
    for (const c of n.listChildren()) walk(c, n.getName());
  };
  walk(root, null);
  const baseHip: [number, number, number] = [0, 0.9, 0];
  for (const t of idle.tracks) {
    if (t.path === 'rotation') baseRot.set(t.node, new Quaternion(t.values[0], t.values[1], t.values[2], t.values[3]));
    else if (t.node === 'Bip01') {
      baseHip[0] = t.values[0] as number;
      baseHip[1] = t.values[1] as number;
      baseHip[2] = t.values[2] as number;
    }
  }
  return { parent, order, baseRot, baseHip };
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

function samplePose(keys: readonly Key[], t: number, bone: string, out: [number, number, number]): void {
  let i = 0;
  while (i < keys.length - 2 && t > (keys[i + 1] as Key)[0]) i++;
  const a = keys[i] as Key;
  const b = keys[Math.min(i + 1, keys.length - 1)] as Key;
  const span = b[0] - a[0] || 1;
  const u = smooth(Math.max(0, Math.min(1, (t - a[0]) / span)));
  const va = a[1].r?.[bone] ?? [0, 0, 0];
  const vb = b[1].r?.[bone] ?? [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = (va[c] as number) + ((vb[c] as number) - (va[c] as number)) * u;
}

function sampleHip(keys: readonly Key[], t: number, out: [number, number, number]): void {
  let i = 0;
  while (i < keys.length - 2 && t > (keys[i + 1] as Key)[0]) i++;
  const a = keys[i] as Key;
  const b = keys[Math.min(i + 1, keys.length - 1)] as Key;
  const span = b[0] - a[0] || 1;
  const u = smooth(Math.max(0, Math.min(1, (t - a[0]) / span)));
  const va = a[1].hip ?? [0, 0, 0];
  const vb = b[1].hip ?? [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = (va[c] as number) + ((vb[c] as number) - (va[c] as number)) * u;
}

/** Bake the authored clips against a skeleton and its idle clip. */
export function bakeAuthored(skeleton: Document, idle: BakedClip, boneNames: ReadonlySet<string>): BakedClip[] {
  const sk = skelOf(skeleton, idle);
  const boneKeys = Object.entries(BONE);
  const keyOfBone = new Map(boneKeys.map(([k, v]) => [v, k]));
  const out: BakedClip[] = [];
  const e = new Euler();
  const d = new Quaternion();
  const tmp: [number, number, number] = [0, 0, 0];
  for (const def of DEF_LIST()) {
    const duration = (def.keys[def.keys.length - 1] as Key)[0];
    const frames = Math.max(2, Math.round(duration * SAMPLE_FPS) + 1);
    const times = new Float32Array(frames);
    const rot = new Map<string, Float32Array>();
    for (const name of sk.order) if (boneNames.has(name) && !/Eye|Eyebrow|Mouth|Lip|Jaw|Tongue|Cheek|Caninus|Masseter|Nose|Nub$/i.test(name)) rot.set(name, new Float32Array(frames * 4));
    const hipVals = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * duration;
      times[f] = t;
      const world = new Map<string, Quaternion>();
      for (const name of sk.order) {
        const p = sk.parent.get(name) ?? null;
        const pw = p ? (world.get(p) as Quaternion) : new Quaternion();
        const base = sk.baseRot.get(name) as Quaternion;
        const key = keyOfBone.get(name);
        let local = base;
        if (key) {
          samplePose(def.keys, t, key, tmp);
          if (tmp[0] !== 0 || tmp[1] !== 0 || tmp[2] !== 0) {
            e.set((tmp[0] * Math.PI) / 180, (tmp[1] * Math.PI) / 180, (tmp[2] * Math.PI) / 180, 'XYZ');
            d.setFromEuler(e);
            // local' = (P'⁻¹ · D · P') · local
            local = pw.clone().invert().multiply(d).multiply(pw).multiply(base);
          }
        }
        world.set(name, pw.clone().multiply(local));
        const arr = rot.get(name);
        if (arr) {
          const q = local.clone();
          // keep the quaternion on one hemisphere so interpolation is the short way
          if (f > 0) {
            const prevDot = q.x * (arr[(f - 1) * 4] as number) + q.y * (arr[(f - 1) * 4 + 1] as number) + q.z * (arr[(f - 1) * 4 + 2] as number) + q.w * (arr[(f - 1) * 4 + 3] as number);
            if (prevDot < 0) q.set(-q.x, -q.y, -q.z, -q.w);
          }
          arr.set([q.x, q.y, q.z, q.w], f * 4);
        }
      }
      sampleHip(def.keys, t, tmp);
      hipVals[f * 3] = sk.baseHip[0] + tmp[0];
      hipVals[f * 3 + 1] = sk.baseHip[1] + tmp[1];
      hipVals[f * 3 + 2] = sk.baseHip[2] + tmp[2];
    }
    const tracks: BakedTrack[] = [];
    for (const [node, vals] of rot) tracks.push({ node, path: 'rotation', ...reduceKeys(times, vals, 4, /Finger|Toe/.test(node) ? 1.5e-4 : 2e-5) });
    tracks.push({ node: 'Bip01', path: 'translation', ...reduceKeys(times, hipVals, 3, 0.001) });
    out.push({ name: def.name, duration, stride: def.stride ?? 0, tracks });
  }
  return out;
}

function DEF_LIST(): readonly Def[] {
  return DEFS;
}

/** Wrapper used by the build: every authored clip for one gender's skeleton and idle. */
export function authoredClips(skeleton: Document, idle: BakedClip, boneNames: ReadonlySet<string>): BakedClip[] {
  return bakeAuthored(skeleton, idle, boneNames);
}
