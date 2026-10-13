/**
 * Project actions for the home page and the command palette: open, create
 * (blank / template / prompt), rename, duplicate, export, delete (with an
 * undo toast) and import. Failures surface as toasts.
 */
import { useMemo } from 'react';
import { MAX_IMPORT_BYTES } from '../config';
import { useApp } from '../app/appContext';
import { downloadText, readFileText } from '../lib/download';
import { exportFileName } from '../lib/worldIO';
import { createBlankProject, createFromPrompt, createFromTemplate, type BlankKind } from '../projects/create';
import type { ProjectMeta } from '../projects/model';
import type { RepoResult } from '../projects/repo';

/** Bound project actions. */
export interface ProjectActions {
  open(id: string): void;
  createBlank(kind: BlankKind): Promise<void>;
  createFromTemplate(slug: string): Promise<void>;
  createFromPrompt(prompt: string): Promise<void>;
  rename(id: string, name: string): Promise<boolean>;
  duplicate(id: string): Promise<void>;
  exportProject(id: string): Promise<void>;
  remove(project: ProjectMeta): Promise<void>;
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
      remove: async (project) => {
        if (!repo) return unavailable();
        const r = await repo.remove(project.id);
        if (!r.ok) {
          toast(r.error, 'error', 6);
          return;
        }
        const deleted = r.value;
        toast(`Deleted “${project.name}”`, 'info', 8, {
          label: 'Undo',
          run: () => {
            void repo.restore(deleted).then((x) => {
              if (!x.ok) toast(x.error, 'error', 6);
            });
          },
        });
      },
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
