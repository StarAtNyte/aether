/**
 * Project creation flows shared by the home page, the "new" route and the
 * command palette: blank scenes, templates and prompts.
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import { createStarterWorld } from '../lib/starterWorld';
import { templateBySlug } from '../lib/examples';
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

/** New project from a built-in template: created empty, the editor runs the template prompt (offline planner). */
export async function createFromTemplate(repo: ProjectRepo, slug: string): Promise<RepoResult<ProjectMeta>> {
  const t = templateBySlug(slug);
  if (!t) return { ok: false, error: 'Unknown template.' };
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
