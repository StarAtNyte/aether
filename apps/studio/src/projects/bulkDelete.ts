/**
 * Deleting and restoring several projects at once. Pure logic over the
 * repository: the home page shows one confirm, one toast and one Undo for the
 * whole batch, and a failure on one project never hides the others.
 */
import { TEMPLATES } from '../lib/examples';
import type { ProjectMeta } from './model';
import type { DeletedProject, ProjectRepo, RepoResult } from './repo';

/** The repository calls a batch needs (a test double satisfies it). */
export type DeleteRepo = Pick<ProjectRepo, 'remove' | 'restore'>;

/** Result of deleting a batch. */
export interface BulkRemoveResult {
  /** Everything {@link restoreMany} needs, in the order given. */
  removed: DeletedProject[];
  /** Projects that could not be deleted, with the reason. */
  failed: Array<{ project: ProjectMeta; error: string }>;
  /** Projects left alone because they are not user projects (examples). */
  skipped: ProjectMeta[];
}

/** Result of restoring a batch. */
export interface BulkRestoreResult {
  restored: ProjectMeta[];
  failed: Array<{ project: ProjectMeta; error: string }>;
}

/** Project ids that belong to bundled examples. They are never stored as user projects, so they are never deleted. */
export type ProtectedIds = ReadonlySet<string>;

/** Bundled example worlds are never stored as user projects: their ids are never deleted. */
export const EXAMPLE_IDS: ProtectedIds = new Set(TEMPLATES.map((t) => t.slug));

/** True when a project may be deleted (it is a user project, not an example). */
export function isDeletable(project: ProjectMeta, protectedIds: ProtectedIds = EXAMPLE_IDS): boolean {
  return !protectedIds.has(project.id);
}

/** Delete projects one after another (storage writes stay ordered). Never throws. */
export async function removeMany(repo: DeleteRepo, projects: readonly ProjectMeta[], protectedIds: ProtectedIds = EXAMPLE_IDS): Promise<BulkRemoveResult> {
  const out: BulkRemoveResult = { removed: [], failed: [], skipped: [] };
  const seen = new Set<string>();
  for (const project of projects) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    if (!isDeletable(project, protectedIds)) {
      out.skipped.push(project);
      continue;
    }
    let r: RepoResult<DeletedProject>;
    try {
      r = await repo.remove(project.id);
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : 'Could not delete this project.' };
    }
    if (r.ok) out.removed.push(r.value);
    else out.failed.push({ project, error: r.error });
  }
  return out;
}

/** Undo a batch: every project is tried, failures are collected. Never throws. */
export async function restoreMany(repo: DeleteRepo, removed: readonly DeletedProject[]): Promise<BulkRestoreResult> {
  const out: BulkRestoreResult = { restored: [], failed: [] };
  for (const d of removed) {
    let r: RepoResult<ProjectMeta>;
    try {
      r = await repo.restore(d);
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : 'Could not restore this project.' };
    }
    if (r.ok) out.restored.push(r.value);
    else out.failed.push({ project: d.meta, error: r.error });
  }
  return out;
}

/** "3 projects" / "“Name”". */
export function describeProjects(projects: readonly ProjectMeta[]): string {
  return projects.length === 1 ? `“${projects[0]?.name ?? ''}”` : `${projects.length} projects`;
}

/** The toast text after a delete (all, some or none removed). */
export function removeMessage(r: BulkRemoveResult, requested: readonly ProjectMeta[]): { text: string; kind: 'info' | 'error' } {
  const gone = r.removed.length;
  if (gone === 0) {
    const why = r.failed[0]?.error ?? (r.skipped.length > 0 ? 'Example worlds are not projects and cannot be deleted.' : 'Nothing was deleted.');
    return { text: `Could not delete ${describeProjects(requested)}. ${why}`, kind: 'error' };
  }
  const name = gone === 1 ? `“${r.removed[0]?.meta.name ?? ''}”` : `${gone} projects`;
  if (r.failed.length === 0) return { text: `Deleted ${name}`, kind: 'info' };
  const first = r.failed[0]?.error ?? '';
  return { text: `Deleted ${name}; ${r.failed.length} could not be deleted. ${first}`.trim(), kind: 'error' };
}

/** The toast text after an Undo. */
export function restoreMessage(r: BulkRestoreResult): { text: string; kind: 'success' | 'error' } {
  const n = r.restored.length;
  if (r.failed.length === 0) return { text: n === 1 ? `Restored “${r.restored[0]?.name ?? ''}”` : `Restored ${n} projects`, kind: 'success' };
  const first = r.failed[0]?.error ?? '';
  const head = n === 0 ? 'Could not restore' : `Restored ${n} of ${n + r.failed.length} projects. Could not restore`;
  const names = r.failed.map((f) => `“${f.project.name}”`).join(', ');
  return { text: `${head} ${names}. ${first}`.trim(), kind: 'error' };
}
