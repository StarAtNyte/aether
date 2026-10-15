/**
 * Bone name maps and rotation retargeting onto the shared Biped skeleton.
 *
 * The cast and its motion sets use the 3ds Max Biped bone names
 * (`Bip01_L_Thigh` ...). Animation from other humanoid rigs (Mixamo-style,
 * Unreal mannequin, Rigify "DEF-") is mapped bone by bone and converted with
 * the world-space delta method: for each mapped bone,
 *
 *   Δ = srcWorldAnimated · srcWorldRest⁻¹        (what the source bone did)
 *   dstWorldAnimated = Δ · dstWorldRest
 *   dstLocal = dstParentWorldAnimated⁻¹ · dstWorldAnimated
 *
 * which is independent of both rigs' local axes and of T/A-pose differences.
 * Pure quaternion math on plain arrays: used by the offline build scripts
 * and unit-tested; the runtime never retargets (clips are baked).
 */

/** Quaternion as [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

/** Supported source naming schemes. */
export type RigScheme = 'mixamo' | 'unreal' | 'rigify';

/** Canonical body bones of the shared skeleton (fingers handled by pattern). */
export const BIPED_BODY: readonly string[] = [
  'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head',
  'Bip01_L_Clavicle', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand',
  'Bip01_R_Clavicle', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand',
  'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_L_Toe0',
  'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot', 'Bip01_R_Toe0',
];

/** Biped finger bone for (side, finger 0..4 thumb..pinky, joint 0..2). Rocketbox: Finger0 = thumb, 1 = index ... */
export function bipedFinger(side: 'L' | 'R', finger: number, joint: number): string {
  return `Bip01_${side}_Finger${finger}${joint === 0 ? '' : joint}`;
}

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

function sides(prefix: (s: 'L' | 'R') => string, bone: string, out: Record<string, string>, biped: (s: 'L' | 'R') => string): void {
  for (const s of ['L', 'R'] as const) out[prefix(s) + bone] = biped(s);
}

function build(scheme: RigScheme): Record<string, string> {
  const m: Record<string, string> = {};
  if (scheme === 'mixamo') {
    Object.assign(m, { mixamorigHips: 'Bip01_Pelvis', mixamorigSpine: 'Bip01_Spine', mixamorigSpine1: 'Bip01_Spine1', mixamorigSpine2: 'Bip01_Spine2', mixamorigNeck: 'Bip01_Neck', mixamorigHead: 'Bip01_Head' });
    const sd = (s: 'L' | 'R'): string => (s === 'L' ? 'Left' : 'Right');
    for (const [src, dst] of [['Shoulder', 'Clavicle'], ['Arm', 'UpperArm'], ['ForeArm', 'Forearm'], ['Hand', 'Hand'], ['UpLeg', 'Thigh'], ['Leg', 'Calf'], ['Foot', 'Foot'], ['ToeBase', 'Toe0']] as const) {
      sides((s) => `mixamorig${sd(s)}`, src, m, (s) => `Bip01_${s}_${dst}`);
    }
    FINGERS.forEach((f, fi) => {
      for (let j = 1; j <= 3; j++) {
        if (j > 3) continue;
        sides((s) => `mixamorig${sd(s)}Hand${f[0]?.toUpperCase()}${f.slice(1)}`, `${j}`, m, (s) => bipedFinger(s, fi, j - 1));
      }
    });
  } else if (scheme === 'unreal') {
    Object.assign(m, { pelvis: 'Bip01_Pelvis', spine_01: 'Bip01_Spine', spine_02: 'Bip01_Spine1', spine_03: 'Bip01_Spine2', neck_01: 'Bip01_Neck', Head: 'Bip01_Head', head: 'Bip01_Head' });
    for (const [src, dst] of [['clavicle', 'Clavicle'], ['upperarm', 'UpperArm'], ['lowerarm', 'Forearm'], ['hand', 'Hand'], ['thigh', 'Thigh'], ['calf', 'Calf'], ['foot', 'Foot'], ['ball', 'Toe0']] as const) {
      for (const s of ['L', 'R'] as const) m[`${src}_${s.toLowerCase()}`] = `Bip01_${s}_${dst}`;
    }
    FINGERS.forEach((f, fi) => {
      for (let j = 1; j <= 3; j++) for (const s of ['L', 'R'] as const) m[`${f}_0${j}_${s.toLowerCase()}`] = bipedFinger(s, fi, j - 1);
    });
  } else {
    Object.assign(m, { 'DEF-hips': 'Bip01_Pelvis', 'DEF-spine': 'Bip01_Spine', 'DEF-spine.001': 'Bip01_Spine1', 'DEF-spine.002': 'Bip01_Spine2', 'DEF-spine.003': 'Bip01_Spine2', 'DEF-neck': 'Bip01_Neck', 'DEF-head': 'Bip01_Head' });
    for (const [src, dst] of [['shoulder', 'Clavicle'], ['upper_arm', 'UpperArm'], ['forearm', 'Forearm'], ['hand', 'Hand'], ['thigh', 'Thigh'], ['shin', 'Calf'], ['foot', 'Foot'], ['toe', 'Toe0']] as const) {
      for (const s of ['L', 'R'] as const) m[`DEF-${src}.${s}`] = `Bip01_${s}_${dst}`;
    }
    const rf = ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'];
    rf.forEach((f, fi) => {
      for (let j = 1; j <= 3; j++) for (const s of ['L', 'R'] as const) m[`DEF-${f}.0${j}.${s}`] = bipedFinger(s, fi, j - 1);
    });
  }
  return m;
}

const MAPS: Partial<Record<RigScheme, Record<string, string>>> = {};

/** Map of source bone names to Biped bone names for a scheme. */
export function boneMap(scheme: RigScheme): Readonly<Record<string, string>> {
  return (MAPS[scheme] ??= build(scheme));
}

/** Biped name for a source bone (null when the bone is unmapped, e.g. twist or IK helpers). */
export function mapBone(scheme: RigScheme, name: string): string | null {
  return boneMap(scheme)[name] ?? null;
}

/** Guess the scheme from a bone list. */
export function detectScheme(names: readonly string[]): RigScheme | 'biped' | null {
  if (names.some((n) => n.startsWith('Bip01'))) return 'biped';
  if (names.some((n) => n.startsWith('mixamorig'))) return 'mixamo';
  if (names.some((n) => n.startsWith('DEF-'))) return 'rigify';
  if (names.includes('pelvis') && names.some((n) => n.startsWith('upperarm_'))) return 'unreal';
  return null;
}

// --- quaternion helpers (plain arrays) -----------------------------------

/** Hamilton product a · b. */
export function qmul(a: Quat, b: Quat): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Inverse of a unit quaternion. */
export function qinv(q: Quat): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rest data of a skeleton: parent names and local rotations. */
export interface RestSkeleton {
  parent: Readonly<Record<string, string | null>>;
  rotation: Readonly<Record<string, Quat>>;
}

/** World rotation of a bone from local rotations (`local` overrides the rest). */
export function worldRotation(sk: RestSkeleton, bone: string, local: Readonly<Record<string, Quat>>): [number, number, number, number] {
  const chain: string[] = [];
  for (let b: string | null | undefined = bone; b; b = sk.parent[b]) chain.push(b);
  let w: [number, number, number, number] = [0, 0, 0, 1];
  for (let i = chain.length - 1; i >= 0; i--) {
    const name = chain[i] as string;
    w = qmul(w, local[name] ?? sk.rotation[name] ?? [0, 0, 0, 1]);
  }
  return w;
}

/**
 * Retarget one frame. `src` holds the source bones' animated local rotations,
 * `map` maps source names to destination names. Returns the destination's
 * local rotations (mapped bones only; the rest keep their rest rotation).
 * Destination bones are visited parents first, so unmapped parents keep rest.
 */
export function retargetFrame(srcRest: RestSkeleton, dstRest: RestSkeleton, src: Readonly<Record<string, Quat>>, map: Readonly<Record<string, string>>, dstOrder: readonly string[]): Record<string, Quat> {
  const delta = new Map<string, [number, number, number, number]>();
  for (const [s, d] of Object.entries(map)) {
    if (!(s in srcRest.rotation) || !dstOrder.includes(d)) continue;
    const animated = worldRotation(srcRest, s, src);
    const rest = worldRotation(srcRest, s, {});
    delta.set(d, qmul(animated, qinv(rest)));
  }
  const out: Record<string, Quat> = {};
  for (const d of dstOrder) {
    const dl = delta.get(d);
    if (!dl) continue;
    const parent = dstRest.parent[d];
    const parentAnimated = parent ? worldRotation(dstRest, parent, out) : ([0, 0, 0, 1] as const);
    const wRest = worldRotation(dstRest, d, {});
    const wAnimated = qmul(dl, wRest);
    out[d] = qmul(qinv(parentAnimated), wAnimated);
  }
  return out;
}
