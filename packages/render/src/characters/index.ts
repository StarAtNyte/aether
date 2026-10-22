/** People in the renderer: rigs, the scene-wide system, props, tinting and IK. */
export { CharacterRig, type RigOptions, type Foot } from './rig';
export { CharacterSystem, type CharacterSystemOptions, LOD_NEAR, LOD_MID, LOD_FAR, MAX_FULL_DETAIL, MAX_CHARACTERS } from './system';
export { buildProp, type Prop } from './props';
export { tintedMaterial, tintKey, hasTint, type Tint, type TintRefs, DEFAULT_REFS } from './tint';
export { applyLook, LookController, wrapAngle, LOOK_MAX_YAW, LOOK_MAX_PITCH, solveTwoBone, rotateBoneWorld, type LookState, type LookBones } from './ik';
