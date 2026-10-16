/**
 * Built-in templates: the bundled default projects listed in
 * `../showcase/manifest.ts` (the single place to curate, hide and reorder
 * them). They seed the projects home ("Start from a template"), the agent's
 * empty state and the command palette. Each has a thumbnail in
 * `public/templates/<slug>.webp` and a saved world in
 * `public/templates/worlds/<slug>.json`, fetched only when it is opened.
 */
import { SHOWCASE } from '../showcase/manifest';
/** Human labels for template categories. */
export const TEMPLATE_KIND_LABEL = Object.freeze({ scene: 'Scene', physics: 'Physics', game: 'Game', story: 'Story', architecture: 'Architecture' });
/** The featured templates (home row, agent empty state), in manifest order. */
export const FEATURED_TEMPLATES = Object.freeze(SHOWCASE.filter((t) => t.curation === 'featured'));
/** The other shown templates ("More worlds"), in manifest order. */
export const MORE_TEMPLATES = Object.freeze(SHOWCASE.filter((t) => t.curation === 'candidate'));
/** Every template that is shown somewhere: featured first, then the others. */
export const TEMPLATES = Object.freeze([...FEATURED_TEMPLATES, ...MORE_TEMPLATES]);
/** Template by slug, including hidden ones (old links keep working); undefined when unknown. */
export function templateBySlug(slug) {
    return SHOWCASE.find((t) => t.slug === slug);
}
/** Public URL of a template's thumbnail. */
export function templateThumbnail(slug) {
    return `/templates/${slug}.webp`;
}
/** Public URL of a template's saved world. */
export function templateWorldUrl(slug) {
    return `/templates/worlds/${slug}.json`;
}
/** The shown templates' prompts as example prompts. */
export const EXAMPLE_PROMPTS = Object.freeze(TEMPLATES.map((t) => ({ title: t.title, prompt: t.prompt, kind: t.kind })));
/** Short suggestions offered as chips in the agent's empty state. */
export const SUGGESTION_CHIPS = Object.freeze([
    'A windmill on a grassy hill',
    'Stack of crates to knock over',
    'Night sky with a campfire',
    'Make it snow',
]);
