/**
 * The prompt set shared by `npm run smoke` (headless agent + verification)
 * and `npm run gallery` (browser screenshots): the showcase themes plus
 * every example-gallery card.
 */
import { EXAMPLE_PROMPTS } from '../apps/studio/src/lib/examples';

/** Real-life architecture and interiors (build_architecture). */
export const ARCH_PROMPTS: readonly string[] = Object.freeze([
  'a modern two-bedroom apartment',
  'scandinavian living room with a fireplace',
  'a small café interior',
  'a two-storey villa with a pool',
  'an office floor with meeting rooms',
]);

/** Worlds built from the curated asset library (real models, HDR sky, animated people, forge originals). */
export const ASSET_PROMPTS: readonly string[] = Object.freeze([
  'a city street with traffic and pedestrians',
  'a town plaza with an ornate fountain, a gazebo and a vintage car',
]);

/** Default smoke/gallery prompts, in report order. */
export const DEFAULT_PROMPTS: readonly string[] = Object.freeze([
  'a cozy forest camp with a campfire and tents',
  'a domino run that knocks over a bell',
  'a coin collecting game: grab 8 coins before time runs out',
  'an asteroid field in space',
  'a bowling alley with ten pins',
  'a minecraft-like survival world',
  'a village of block houses',
  'pixel art heart in the sky over a blocky world',
  'a blocky stone castle on a hill',
  ...EXAMPLE_PROMPTS.map((e) => e.prompt),
  ...ARCH_PROMPTS,
  ...ASSET_PROMPTS,
]);
