/**
 * Project actions for the home page and the command palette: open, create
 * (blank / template / prompt), rename, duplicate, export, delete (single or
 * several at once, with one undo toast) and import. Failures surface as toasts.
 */
import { useMemo } from 'react';
import { MAX_IMPORT_BYTES } from '../config';
import { useApp } from '../app/appContext';
import { downloadText, readFileText } from '../lib/download';
import { exportFileName } from '../lib/worldIO';
import { createBlankProject, createFromPrompt, createFromTemplate, type BlankKind } from '../projects/create';
import type { ProjectMeta } from '../projects/model';
import type { RepoResult } from '../projects/repo';
import { removeMany, removeMessage, restoreMany, restoreMessage } from '../projects/bulkDelete';

/** Bound project actions. */
export interface ProjectActions {
  open(id: string): void;
  createBlank(kind: BlankKind): Promise<void>;
  createFromTemplate(slug: string): Promise<void>;
  createFromPrompt(prompt: string): Promise<void>;
  rename(id: string, name: string): Promise<boolean>;
  duplicate(id: string): Promise<void>;
  exportProject(id: string): Promise<void>;
  remove(project: ProjectMeta): Promise<boolean>;
  /** Delete several projects with one toast and one Undo. Resolves to the ids that were deleted. */
  removeMany(projects: readonly ProjectMeta[]): Promise<string[]>;
  importFile(file: File): Promise<void>;
}

/** Project actions bound to the app's repository, toasts and navigation. */
export function useProjectActions(): ProjectActions {
  const { repo, store, navigate } = useApp();
  return useMemo<ProjectActions>(() => {
    const toast = store.getState().toast;
    const unavailable = (): void => void toast('Projects are still loading. Try again in a moment.', 'info');
    const openCreated = (r: RepoResult<ProjectMeta>): void => {
      if (r.ok) navigate({ name: 'editor', id: r.value.id });
      else toast(r.error, 'error', 6);
    };
    const removeProjects = async (projects: readonly ProjectMeta[]): Promise<string[]> => {
      if (!repo) {
        unavailable();
        return [];
      }
      const result = await removeMany(repo, projects);
      const msg = removeMessage(result, projects);
      if (result.removed.length === 0) {
        toast(msg.text, msg.kind, 6);
        return [];
      }
      // Forget the projects' resumable AI conversations (loaded lazily: the home page stays light).
      const gone = result.removed.map((d) => d.meta.id);
      void import('../ai/connection').then((m) => gone.forEach((id) => m.aiConnection().forgetProject(id))).catch(() => undefined);
      const removed = result.removed;
      toast(msg.text, msg.kind, msg.kind === 'error' ? 10 : 8, {
        label: 'Undo',
        run: () => {
          void restoreMany(repo, removed).then((x) => {
            // One project restored quietly: the card reappears. Anything else (or any failure) gets a message.
            if (x.failed.length > 0 || removed.length > 1) {
              const m = restoreMessage(x);
              toast(m.text, m.kind, m.kind === 'error' ? 8 : 4);
            }
          });
        },
      });
      return gone;
    };
    return {
      open: (id) => navigate({ name: 'editor', id }),
      createBlank: async (kind) => {
        if (!repo) return unavailable();
        openCreated(await createBlankProject(repo, kind));
      },
      createFromTemplate: async (slug) => {
        if (!repo) return unavailable();
        openCreated(await createFromTemplate(repo, slug));
      },
      createFromPrompt: async (prompt) => {
        if (!repo) return unavailable();
        openCreated(await createFromPrompt(repo, prompt));
      },
      rename: async (id, name) => {
        if (!repo) return false;
        const r = await repo.rename(id, name);
        if (!r.ok) toast(r.error, 'error', 6);
        return r.ok;
      },
      duplicate: async (id) => {
        if (!repo) return unavailable();
        const r = await repo.duplicate(id);
        if (r.ok) toast(`Duplicated as “${r.value.name}”`, 'success');
        else toast(r.error, 'error', 6);
      },
      exportProject: async (id) => {
        if (!repo) return unavailable();
        const r = await repo.exportText(id);
        if (!r.ok) {
          toast(r.error, 'error', 6);
          return;
        }
        downloadText(exportFileName(r.value.world), r.value.text);
      },
      remove: async (project) => (await removeProjects([project])).length === 1,
      removeMany: (projects) => removeProjects(projects),
      importFile: async (file) => {
        if (!repo) return unavailable();
        const read = await readFileText(file, MAX_IMPORT_BYTES);
        if (!read.ok) {
          toast(read.error, 'error', 6);
          return;
        }
        const r = await repo.importText(read.text);
        if (r.ok) toast(`Imported “${r.value.name}”`, 'success');
        else toast(r.error, 'error', 7);
      },
    };
  }, [repo, store, navigate]);
}
