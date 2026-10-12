/** A curated starter prompt shown in the empty chat gallery. */
export interface ExamplePrompt {
  /** Short card title. */
  title: string;
  /** Full prompt sent to the agent. */
  prompt: string;
  /** Category label shown on the card. */
  kind: 'scene' | 'physics' | 'game' | 'story';
  /** Accent hue (deg) for the card gradient. */
  hue: number;
}

/** The eight curated prompts of the example gallery. */
export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = Object.freeze([
  { title: 'Lakeside camp', kind: 'scene', hue: 28, prompt: 'A cozy lakeside camp at sunset with a campfire, tents and fireflies' },
  { title: 'Domino run', kind: 'physics', hue: 200, prompt: 'Build a domino run that knocks over a bell tower' },
  { title: 'Coin island', kind: 'game', hue: 48, prompt: 'A coin collecting game on a tropical island — collect 10 coins in 60 seconds' },
  { title: 'Medieval village', kind: 'scene', hue: 95, prompt: 'A medieval village with a windmill, market stalls and a patrolling guard' },
  { title: 'Asteroid field', kind: 'physics', hue: 270, prompt: 'Low-gravity asteroid field with glowing crystals' },
  { title: 'Bowling alley', kind: 'physics', hue: 0, prompt: 'Bowling alley: knock down a pyramid of 15 crates with a heavy ball' },
  { title: 'Haunted forest', kind: 'story', hue: 150, prompt: 'Haunted forest at night with fog and an NPC who tells a story' },
  { title: 'Obstacle course', kind: 'game', hue: 12, prompt: 'Obstacle course with moving platforms, lava and a goal flag' },
]);
