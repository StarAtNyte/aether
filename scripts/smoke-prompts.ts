/**
 * The prompt set shared by `npm run smoke` (headless agent + verification)
 * and `npm run gallery` (browser screenshots): the showcase themes plus
 * every example-gallery card.
 */
import { EXAMPLE_PROMPTS } from '../apps/studio/src/lib/examples';

/** Default smoke/gallery prompts, in report order. */
export const DEFAULT_PROMPTS: readonly string[] = Object.freeze([
  'a cozy forest camp with a campfire and tents',
  'a domino run that knocks over a bell',
  'a coin collecting game: grab 8 coins before time runs out',
  'an asteroid field in space',
  'a bowling alley with ten pins',
  ...EXAMPLE_PROMPTS.map((e) => e.prompt),
]);
