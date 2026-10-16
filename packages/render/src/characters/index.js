/** People in the renderer: rigs, the scene-wide system, props, tinting and IK. */
export { CharacterRig } from './rig';
export { CharacterSystem, LOD_NEAR, LOD_MID, LOD_FAR, MAX_FULL_DETAIL, MAX_CHARACTERS } from './system';
export { buildProp } from './props';
export { tintedMaterial, tintKey, hasTint, DEFAULT_REFS } from './tint';
export { applyLook, solveTwoBone, rotateBoneWorld } from './ik';
