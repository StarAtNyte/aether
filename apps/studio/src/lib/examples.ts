/**
 * Built-in templates: the bundled default projects listed in
 * `../showcase/manifest.ts` (the single place to curate, hide and reorder
 * them). They seed the projects home ("Start from a template"), the agent's
 * empty state and the command palette. Each has a thumbnail in
 * `public/templates/<slug>.webp` and a saved world in
 * `public/templates/worlds/<slug>.json`, fetched only when it is opened.
 */
import { SHOWCASE, type Curation, type ShowcaseEntry, type TemplateKind } from '../showcase/manifest';

export type { Curation, TemplateKind };

/** One built-in template (a bundled default project). */
export type WorldTemplate = ShowcaseEntry;

/** Human labels for template categories. */
export const TEMPLATE_KIND_LABEL: Readonly<Record<TemplateKind, string>> = Object.freeze({ scene: 'Scene', physics: 'Physics', game: 'Game', story: 'Story', architecture: 'Architecture' });

/** The featured templates (home row, agent empty state), in manifest order. */
export const FEATURED_TEMPLATES: readonly WorldTemplate[] = Object.freeze(SHOWCASE.filter((t) => t.curation === 'featured'));

/** The other shown templates ("More worlds"), in manifest order. */
export const MORE_TEMPLATES: readonly WorldTemplate[] = Object.freeze(SHOWCASE.filter((t) => t.curation === 'candidate' && t.origin !== 'photo'));

/** Example rooms rebuilt from a photograph (credited), in manifest order. */
export const PHOTO_TEMPLATES: readonly WorldTemplate[] = Object.freeze(SHOWCASE.filter((t) => t.curation === 'candidate' && t.origin === 'photo'));

/** Every template that is shown somewhere: featured first, then the others. */
export const TEMPLATES: readonly WorldTemplate[] = Object.freeze([...FEATURED_TEMPLATES, ...MORE_TEMPLATES, ...PHOTO_TEMPLATES]);

/** Template by slug, including hidden ones (old links keep working); undefined when unknown. */
export function templateBySlug(slug: string): WorldTemplate | undefined {
  return SHOWCASE.find((t) => t.slug === slug);
}

/** Public URL of a template's thumbnail. */
export function templateThumbnail(slug: string): string {
  return `/templates/${slug}.webp`;
}

/** Public URL of a template's saved world. */
export function templateWorldUrl(slug: string): string {
  return `/templates/worlds/${slug}.json`;
}

/** A curated starter prompt (legacy shape, kept for the agent's empty state). */
export interface ExamplePrompt {
  title: string;
  prompt: string;
  kind: TemplateKind;
}

/** The shown templates' prompts as example prompts (photo rooms are left out: their prompt names a photo, it does not rebuild the room). */
export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = Object.freeze(TEMPLATES.filter((t) => t.origin !== 'photo').map((t) => ({ title: t.title, prompt: t.prompt, kind: t.kind })));

/** Short suggestions offered as chips in the agent's empty state. */
export const SUGGESTION_CHIPS: readonly string[] = Object.freeze([
  'A windmill on a grassy hill',
  'Stack of crates to knock over',
  'Night sky with a campfire',
  'Make it snow',
]);
