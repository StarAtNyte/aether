/**
 * The VRM 1.0 humanoid bone names (VRMC_vrm
 * `humanoid.humanBones` keys) mapped onto the shared Biped skeleton, plus the
 * VRM preset expressions mapped onto the cast's face morph names. A VRM's bone
 * nodes carry free names (VRoid: `J_Bip_C_Hips`); the humanoid table gives the
 * node of each standard bone, so the map is keyed by the standard name.
 * Used by scripts/characters/vrm-character.ts (VRM avatars converted into cast
 * bodies); retarget.ts can import it later as a `vrm` scheme.
 */
import { bipedFinger } from './retarget';

const VRM_FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
const VRM_JOINTS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] } as const;

function build(): Record<string, string> {
  const m: Record<string, string> = {
    hips: 'Bip01_Pelvis', spine: 'Bip01_Spine', chest: 'Bip01_Spine1', upperChest: 'Bip01_Spine2', neck: 'Bip01_Neck', head: 'Bip01_Head',
  };
  for (const [side, s] of [['left', 'L'], ['right', 'R']] as const) {
    for (const [src, dst] of [['Shoulder', 'Clavicle'], ['UpperArm', 'UpperArm'], ['LowerArm', 'Forearm'], ['Hand', 'Hand'], ['UpperLeg', 'Thigh'], ['LowerLeg', 'Calf'], ['Foot', 'Foot'], ['Toes', 'Toe0']] as const) {
      m[`${side}${src}`] = `Bip01_${s}_${dst}`;
    }
    VRM_FINGERS.forEach((f, fi) => {
      const joints = f === 'Thumb' ? VRM_JOINTS.Thumb : VRM_JOINTS.other;
      joints.forEach((j, ji) => (m[`${side}${f}${j}`] = bipedFinger(s, fi, ji)));
    });
  }
  return m;
}

/** VRM humanoid bone name to Biped bone name. */
export const VRM_TO_BIPED: Readonly<Record<string, string>> = build();

/**
 * For aligning a VRM rest pose to the Biped rest pose: the humanoid bone whose
 * joint each bone points at (its "child" along the limb). Leaf bones (head,
 * distal fingers, toes) are left out and follow their parent.
 */
export const VRM_AIM: Readonly<Record<string, string>> = (() => {
  const a: Record<string, string> = { spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head' };
  for (const side of ['left', 'right']) {
    Object.assign(a, {
      [`${side}Shoulder`]: `${side}UpperArm`, [`${side}UpperArm`]: `${side}LowerArm`, [`${side}LowerArm`]: `${side}Hand`, [`${side}Hand`]: `${side}MiddleProximal`,
      [`${side}UpperLeg`]: `${side}LowerLeg`, [`${side}LowerLeg`]: `${side}Foot`, [`${side}Foot`]: `${side}Toes`,
    });
    for (const f of VRM_FINGERS) {
      const j = f === 'Thumb' ? VRM_JOINTS.Thumb : VRM_JOINTS.other;
      a[`${side}${f}${j[0]}`] = `${side}${f}${j[1]}`;
      a[`${side}${f}${j[1]}`] = `${side}${f}${j[2]}`;
    }
  }
  return a;
})();

/** Cast face morph name to the VRM preset expression that drives it (null: no counterpart). */
export const VRM_FACE: Readonly<Record<string, string | null>> = {
  smile: 'happy',
  sad: 'sad',
  surprised: 'surprised',
  teary: null,
  blink: 'blink',
  mouth_open: 'aa',
  determined: 'angry',
};
