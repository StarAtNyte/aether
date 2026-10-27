/**
 * Everything of the perception layer the photo flow calls, behind ONE dynamic import (`await import('./perception/bundle')` when a
 * photo run starts): the detector, labeller, masks, depth, room geometry, comparison and retrieval code is a separate chunk that the
 * studio fetches (and the service worker caches) only when a photo is rebuilt, not on the first visit.
 */
export { Perceiver, perceptionDownloadMb } from './perceive';
export { APPLY_COLOUR_TOOL, COLOUR_PARAMS, PERCEIVE_TOOL, parseApplyColourInput, parsePerceiveInput, perceivePhoto } from './tool';
export { seedInventory } from './seed';
export { similarModelsText } from './retrieve';
export { compareObjects } from '../objects-measure';
export { normaliseHex } from '@aether/arch/photo';
export { buildFromMeasurements, makeBuildPlan, planText, BUILD_PLAN_TOOL } from './buildplan';
