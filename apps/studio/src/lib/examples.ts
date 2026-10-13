/**
 * Built-in templates: curated prompts that the offline planner turns into
 * complete worlds. They seed the projects home ("Start from a template"),
 * the agent's empty state and the command palette. Each has a pre-rendered
 * thumbnail in `public/templates/<slug>.webp` (see `npm run thumbnails`).
 */

/** Template category (shown as a neutral label). */
export type TemplateKind = 'scene' | 'physics' | 'game' | 'story';

/** One built-in template. */
export interface WorldTemplate {
  /** URL-safe id (`#/new/<slug>`, thumbnail file name). */
  slug: string;
  /** Card title. */
  title: string;
  /** One-line description for cards. */
  description: string;
  /** Full prompt sent to the agent. */
  prompt: string;
  kind: TemplateKind;
}

/** Human labels for template categories. */
export const TEMPLATE_KIND_LABEL: Readonly<Record<TemplateKind, string>> = Object.freeze({ scene: 'Scene', physics: 'Physics', game: 'Game', story: 'Story' });

/** The built-in templates, in display order. */
export const TEMPLATES: readonly WorldTemplate[] = Object.freeze([
  { slug: 'lakeside-camp', title: 'Lakeside camp', kind: 'scene', description: 'Sunset camp with a campfire, tents and fireflies.', prompt: 'A cozy lakeside camp at sunset with a campfire, tents and fireflies' },
  { slug: 'domino-run', title: 'Domino run', kind: 'physics', description: 'A chain of dominoes that topples a bell tower.', prompt: 'Build a domino run that knocks over a bell tower' },
  { slug: 'coin-island', title: 'Coin island', kind: 'game', description: 'Collect 10 coins on a tropical island in 60 s.', prompt: 'A coin collecting game on a tropical island — collect 10 coins in 60 seconds' },
  { slug: 'medieval-village', title: 'Medieval village', kind: 'scene', description: 'Windmill, market stalls and a patrolling guard.', prompt: 'A medieval village with a windmill, market stalls and a patrolling guard' },
  { slug: 'asteroid-field', title: 'Asteroid field', kind: 'physics', description: 'Low gravity rocks and glowing crystals.', prompt: 'Low-gravity asteroid field with glowing crystals' },
  { slug: 'bowling-alley', title: 'Bowling alley', kind: 'physics', description: 'Knock down a pyramid of 15 crates.', prompt: 'Bowling alley: knock down a pyramid of 15 crates with a heavy ball' },
  { slug: 'haunted-forest', title: 'Haunted forest', kind: 'story', description: 'Foggy woods at night and a storyteller.', prompt: 'Haunted forest at night with fog and an NPC who tells a story' },
  { slug: 'obstacle-course', title: 'Obstacle course', kind: 'game', description: 'Moving platforms, lava and a goal flag.', prompt: 'Obstacle course with moving platforms, lava and a goal flag' },
  { slug: 'canyon-of-colossi', title: 'Canyon of colossi', kind: 'scene', description: 'A million trees and ancient statues: 200M+ triangles, drawn by the screen.', prompt: 'A canyon with a million trees and ancient statues' },
] satisfies WorldTemplate[]);

/** Template by slug (undefined when unknown). */
export function templateBySlug(slug: string): WorldTemplate | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}

/** Public URL of a template's thumbnail. */
export function templateThumbnail(slug: string): string {
  return `/templates/${slug}.webp`;
}

/** A curated starter prompt (legacy shape, kept for the agent's empty state). */
export interface ExamplePrompt {
  title: string;
  prompt: string;
  kind: TemplateKind;
}

/** The template prompts as example prompts. */
export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = Object.freeze(TEMPLATES.map((t) => ({ title: t.title, prompt: t.prompt, kind: t.kind })));

/** Short suggestions offered as chips in the agent's empty state. */
export const SUGGESTION_CHIPS: readonly string[] = Object.freeze([
  'A windmill on a grassy hill',
  'Stack of crates to knock over',
  'Night sky with a campfire',
  'Make it snow',
]);
