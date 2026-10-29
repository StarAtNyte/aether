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
  // The card picture downloads beside the world, not after the project is created.
  const thumbP = loadTemplateThumbnail(t.slug, fetchImpl);
  const saved = await loadTemplateWorld(t.slug, fetchImpl);
  if (saved.ok) {
    const r = await repo.create({ world: saved.world, name: t.title, template: t.slug, chat: templateChat(t) });
    if (r.ok) {
      const thumb = await thumbP;
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
  if (r.ok) queueRun(r.value.id, { prompt: text, offline: false, fresh: true });
  return r;
}

/**
 * The offline planner's answer when the first prompt of a project created for it built nothing (another language,
 * a request it cannot map): the project is then empty and only named after the prompt, so the editor removes it
 * and shows this answer on the home page. Null when anything was built or said beyond that one exchange.
 */
export function abandonedPromptReply(chat: readonly ChatEntry[], history: { canUndo(): boolean; canRedo(): boolean }): string | null {
  if (history.canUndo() || history.canRedo()) return null;
  if (chat.filter((e) => e.role === 'user').length !== 1) return null;
  const last = chat[chat.length - 1];
  if (!last || last.role !== 'assistant' || last.status !== 'done') return null;
  if (!last.events.some((e) => e.type === 'notice' && e.offline !== undefined)) return null;
  if (last.events.some((e) => e.type === 'patches' || e.type === 'edit' || e.type === 'generator')) return null;
  const message = last.events.find((e) => e.type === 'message');
  return message && message.type === 'message' && message.text.trim() ? message.text.trim() : 'Offline mode could not build this.';
}

/** Words a name never ends on ("… house with a" is cut back to "… house"). */
const DANGLING = /^(a|an|the|with|and|or|of|in|on|at|to|for|by|from|into|near|where|that|which|featuring|plus|some|my|your|its|their)$/i;
/** Words where a description goes on: a name may stop before them. */
const CONNECTIVE = /^(with|and|where|that|which|featuring|plus|including|for|near|in|on|at|by)$/i;
/** Most words in a name taken from a prompt. */
const NAME_WORDS = 6;

/**
 * A short project name from a prompt, cut where the description goes on, never in the middle of a phrase:
 * "a cozy camp at sunset with…" → "Cozy camp at sunset"; "two-storey modern house with a pool, open plan" →
 * "Two-storey modern house"; "night forest adventure: 5 lanterns" → "Night forest adventure". The assistant
 * usually names a new world itself (setMeta), which then replaces this.
 */
export function projectNameFromPrompt(prompt: string): string {
  // The first clause only: a list after a comma or colon is detail, not the name.
  const clause = prompt.split(/[,;:.!?()[\]{}]|\s[–—-]\s/u).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '';
  const words = clause
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && w !== '-');
  while (words.length > 1 && /^(a|an|the|build|make|create|generate|design|me|please|i|want|need)$/i.test(words[0] ?? '')) words.shift();
  let kept = words;
  if (kept.length > NAME_WORDS) {
    // Stop before the last connective that still leaves at least two words.
    let cut = -1;
    for (let i = 2; i <= NAME_WORDS && i < kept.length; i++) if (CONNECTIVE.test(kept[i] ?? '')) cut = i;
    kept = kept.slice(0, cut > 0 ? cut : NAME_WORDS - 1);
  }
  while (kept.length > 1 && DANGLING.test(kept[kept.length - 1] ?? '')) kept = kept.slice(0, -1);
  const name = kept.join(' ');
  if (!name) return 'Untitled world';
  return name.charAt(0).toUpperCase() + name.slice(1);
}
