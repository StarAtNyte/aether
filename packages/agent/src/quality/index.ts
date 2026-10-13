/**
 * 3D quality loop: rubric, deterministic heuristics, offline improvements and
 * the vision critic (see docs/CONTRACTS.md, "Quality loop").
 */
export * from './types';
export { assessWorld, promptKeywords } from './heuristics';
export { improvementPatches, type Improvement } from './improve';
export { blendCritique, buildCriticRequest, criticSystemPrompt, needsRefinement, refineInstruction } from './critic';
export { estimateBounds, isScenery, placedContent, proceduralSize, type Placed } from './geometry';
export { hexToHsl, paletteStats, type PaletteStats } from './color';
export { viewStatsFromPixels } from './pixels';
