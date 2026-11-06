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
export const MORE_TEMPLATES: readonly WorldTemplate[] = Object.freeze(SHOWCASE.filter((t) => t.curation === 'candidate' && t.origin !== 'photo' && t.origin !== 'agent'));

/** Example rooms rebuilt from a photograph (credited), in manifest order. */
export const PHOTO_TEMPLATES: readonly WorldTemplate[] = Object.freeze(SHOWCASE.filter((t) => t.curation === 'candidate' && t.origin === 'photo'));

/** Worlds the agent generated from a prompt in recorded runs, saved as they came out, in manifest order. */
export const AGENT_TEMPLATES: readonly WorldTemplate[] = Object.freeze(SHOWCASE.filter((t) => t.curation === 'candidate' && t.origin === 'agent'));

/** Every template that is shown somewhere: featured first, then the others. */
export const TEMPLATES: readonly WorldTemplate[] = Object.freeze([...FEATURED_TEMPLATES, ...MORE_TEMPLATES, ...AGENT_TEMPLATES, ...PHOTO_TEMPLATES]);

/** The groups of the Templates page: one per kind, plus the rooms rebuilt from a photograph. */
export type TemplateGroup = 'game' | 'architecture' | 'scene' | 'physics' | 'story' | 'photo';

/** The group a template is listed under (a room rebuilt from a photo is "Photo to 3D", whatever its kind). */
export const templateGroup = (t: WorldTemplate): TemplateGroup => (t.origin === 'photo' ? 'photo' : t.kind);

/** Groups in display order, with their heading, one-line lead and filter label. */
export const TEMPLATE_GROUPS: readonly { id: TemplateGroup; label: string; title: string; lead: string }[] = Object.freeze([
  { id: 'architecture', label: 'Architecture', title: 'Architecture', lead: 'Houses, venues and interiors you can walk through, cut open and relight. Cards say whether the offline planner or a live AI run built them.' },
  { id: 'game', label: 'Games', title: 'Games', lead: 'Playable worlds with goals, rules and a verified win: open one, play it, then ask the agent to change it.' },
  { id: 'scene', label: 'Scenes', title: 'Scenes', lead: 'Landscapes and settings to explore and restyle.' },
  { id: 'physics', label: 'Physics', title: 'Physics', lead: 'Machines and contraptions run by the physics engine, every bounce verified.' },
  { id: 'story', label: 'Stories', title: 'Stories', lead: 'Short interactive stories told in a world.' },
  { id: 'photo', label: 'Photo to 3D', title: 'Photo to 3D', lead: 'Example rooms the agent reconstructed from a photograph (credited on each card). To rebuild your own, attach a photo in the chat.' },
]);

/** Templates of one group, in display order (featured first, then the rest in manifest order). */
export const templatesInGroup = (id: TemplateGroup): readonly WorldTemplate[] => TEMPLATES.filter((t) => templateGroup(t) === id);

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

/** True when the offline planner rebuilds the template from its prompt (not a photo room, not a world from a live Claude Code or Codex run). */
export const isPlannerRebuildable = (t: WorldTemplate): boolean => t.origin !== 'photo' && t.origin !== 'blender' && !(t.origin === 'agent' && t.provenance !== 'offline-planner');

/** The shown templates' prompts as example prompts (photo rooms and live-run worlds are left out: their prompt does not rebuild the room offline). */
export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = Object.freeze(TEMPLATES.filter(isPlannerRebuildable).map((t) => ({ title: t.title, prompt: t.prompt, kind: t.kind })));

/** Short suggestions offered as chips in the agent's empty state. */
export const SUGGESTION_CHIPS: readonly string[] = Object.freeze([
  'A windmill on a grassy hill',
  'Stack of crates to knock over',
  'Night sky with a campfire',
  'Make it snow',
]);
