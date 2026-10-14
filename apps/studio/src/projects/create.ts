/**
 * Project creation flows shared by the home page, the "new" route and the
 * command palette: blank scenes, templates and prompts.
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import { createStarterWorld } from '../lib/starterWorld';
import { templateBySlug, type WorldTemplate } from '../lib/examples';
import type { ChatEntry } from '../lib/chat';
import { loadTemplateThumbnail, loadTemplateWorld, type FetchLike } from '../showcase/load';
import { queueRun } from './pending';
import type { RepoResult } from './repo';
import type { ProjectRepo } from './repo';
import type { ProjectMeta } from './model';

/** Kinds of blank project. */
export type BlankKind = 'empty' | 'starter';

/** A world with only the default ground and sky. */
export function createEmptyWorld(name = 'Untitled world'): WorldDoc {
  const r = validateWorld({ name });
  if (!r.ok) throw new Error('default world is invalid');
  return r.world;
}

/** New blank project: an empty scene, or the starter scene. */
export function createBlankProject(repo: ProjectRepo, kind: BlankKind): Promise<RepoResult<ProjectMeta>> {
  return kind === 'starter' ? repo.create({ world: createStarterWorld() }) : repo.create({ world: createEmptyWorld() });
}

/** The transcript a template project starts with: its original prompt and a short note. */
export function templateChat(t: WorldTemplate): ChatEntry[] {
  return [
    { id: 1, role: 'user', text: t.prompt },
    { id: 2, role: 'assistant', status: 'done', events: [{ type: 'message', text: `Opened the saved world “${t.title}”: ${t.description} Press Play to try it, or describe a change.` }] },
  ];
}

/**
 * New project from a built-in template: its saved world (fetched lazily and
 * validated) with the template's thumbnail and original prompt. When the
 * saved world cannot be loaded, the project is created empty and the editor
 * rebuilds it from the prompt with the offline planner.
 */
export async function createFromTemplate(repo: ProjectRepo, slug: string, fetchImpl?: FetchLike): Promise<RepoResult<ProjectMeta>> {
  const t = templateBySlug(slug);
  if (!t) return { ok: false, error: 'Unknown template.' };
  const saved = await loadTemplateWorld(t.slug, fetchImpl);
  if (saved.ok) {
    const r = await repo.create({ world: saved.world, name: t.title, template: t.slug, chat: templateChat(t) });
    if (r.ok) {
      const thumb = await loadTemplateThumbnail(t.slug, fetchImpl);
      if (thumb) await repo.setThumbnail(r.value.id, thumb);
    }
    return r;
  }
  const r = await repo.create({ world: createEmptyWorld(t.title), name: t.title, template: t.slug });
  if (r.ok) queueRun(r.value.id, { prompt: t.prompt, offline: true });
  return r;
}

/** New project from a prompt: created empty, the editor sends the prompt to the agent. */
export async function createFromPrompt(repo: ProjectRepo, prompt: string): Promise<RepoResult<ProjectMeta>> {
  const text = prompt.trim();
  if (!text) return { ok: false, error: 'Describe the world first.' };
  const r = await repo.create({ world: createEmptyWorld(projectNameFromPrompt(text)) });
  if (r.ok) queueRun(r.value.id, { prompt: text, offline: false });
  return r;
}

/** A short project name from a prompt ("a cozy camp at sunset with…" → "Cozy camp at sunset"). */
export function projectNameFromPrompt(prompt: string): string {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
  while (words.length > 1 && /^(a|an|the|build|make|create|me)$/i.test(words[0] ?? '')) words.shift();
  const name = words.slice(0, 5).join(' ');
  if (!name) return 'Untitled world';
  return name.charAt(0).toUpperCase() + name.slice(1);
}
