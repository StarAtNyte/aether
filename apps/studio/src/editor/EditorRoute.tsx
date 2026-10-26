/**
 * Editor route: opens a project from the repository, creates the Studio
 * controller bound to it (autosave through the repository), runs a queued
 * template/prompt once the viewport is ready, captures thumbnails at
 * natural moments (after an agent turn, when the tab is hidden, when
 * leaving) and tears everything down when the route changes.
 */
import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useApp } from '../app/appContext';
import { StudioProvider } from '../app/context';
import { Studio } from '../engine/Studio';
import { settleWithin } from '../lib/deadline';
import { createLogger } from '../lib/log';
import { takeRun } from '../projects/pending';
import { abandonedPromptReply } from '../projects/create';
import type { ProjectRepo } from '../projects/repo';
import { Icon } from '../components/Icon';
import { useProjectActions } from '../home/useProjectActions';
import { EditorContext, type EditorServices } from './editorContext';
import { EditorShell } from './EditorShell';
import { EditorSkeleton } from './EditorSkeleton';

const log = createLogger('editor');
/** Delay after an agent turn before the thumbnail is taken (grow-in animation, camera flight). */
const THUMB_AFTER_TURN_MS = 1600;
/** Delay after opening a project without a thumbnail. */
const THUMB_FIRST_MS = 2500;
/** Longest wait for a fresh thumbnail when leaving the editor (navigation never hangs on it). */
const LEAVE_THUMB_MS = 2500;

declare global {
  interface Window {
    /** Debug/e2e handle (dev builds or `?debug=1` only). */
    __aether?: { readonly history: Studio['history']; readonly simulation: Studio['simulation']; readonly store: Studio['store']; readonly studio: Studio };
  }
}

function debugEnabled(): boolean {
  try {
    return import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

/** Expose the `window.__aether` debug handle (dev builds or `?debug=1` only). */
export function exposeDebug(studio: Studio): void {
  if (!debugEnabled()) return;
  window.__aether = {
    studio,
    get history() {
      return studio.history;
    },
    get simulation() {
      return studio.simulation;
    },
    get store() {
      return studio.store;
    },
  };
}

/** Capture a thumbnail and store it (best effort). */
async function saveThumbnail(studio: Studio, repo: ProjectRepo, id: string): Promise<void> {
  try {
    const blob = await studio.captureThumbnail();
    if (blob) await repo.setThumbnail(id, blob);
  } catch (err) {
    log.warn('thumbnail capture failed', err);
  }
}

/** Error page for a project that cannot be opened. */
function EditorError({ message, onBack }: { message: string; onBack: () => void }): ReactElement {
  return (
    <div className="page-center">
      <div className="empty-state">
        <span className="empty-state__icon">
          <Icon name="alert" size={20} />
        </span>
        <h3 className="empty-state__title">Can’t open this project</h3>
        <p className="empty-state__text">{message}</p>
        <button type="button" className="btn btn--primary" onClick={onBack}>
          <Icon name="arrowLeft" /> Back to projects
        </button>
      </div>
    </div>
  );
}

/** The editor route for project `id`. */
export const EditorRoute = memo(function EditorRoute({ id }: { id: string }): ReactElement {
  const { repo, store, navigate } = useApp();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectActions = useProjectActions();

  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    let created: Studio | null = null;
    const cleanups: Array<() => void> = [];
    void repo.open(id).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const s = new Studio({
        projectId: id,
        project: { world: r.value.world, chat: r.value.chat, session: r.value.session },
        onSave: async (world, chat, session) => {
          const x = await repo.save(id, world, chat, session ?? undefined);
          return x.ok ? null : x.error;
        },
        onSettings: (settings) => store.getState().mirrorSettings(settings),
      });
      created = s;
      void s.boot();
      exposeDebug(s);

      // Queued template / prompt: run once the viewport is ready.
      const pending = takeRun(id);
      let thumbTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleThumb = (ms: number): void => {
        if (thumbTimer !== null) clearTimeout(thumbTimer);
        thumbTimer = setTimeout(() => {
          thumbTimer = null;
          const st = s.store.getState();
          if (st.agentBusy || st.mode === 'play') return;
          void saveThumbnail(s, repo, id);
        }, ms);
      };
      let sentPending = pending === null;
      let abandonChecked = false;
      const abandon = async (reply: string): Promise<void> => {
        await s.flush();
        if (cancelled) return;
        const removed = await repo.remove(id);
        if (cancelled || !removed.ok) return;
        // The planner's own reason (up to its "Nothing was built…" sentence), then what happened to the project.
        const cut = reply.search(/\s+Nothing was built/);
        const reason = (cut > 0 ? reply.slice(0, cut) : reply).slice(0, 170);
        store.getState().toast(`${reason} Nothing was built, so no project was kept.`, 'info', 14);
        navigate({ name: 'home' });
      };
      let firstThumb = !r.value.meta.hasThumbnail;
      const unsub = s.store.subscribe((st, prev) => {
        const ready = st.loading === null && s.simulation !== null && st.fatal === null;
        if (ready && !sentPending && pending) {
          sentPending = true;
          void s.send(pending.prompt, { offline: pending.offline });
        }
        if (ready && firstThumb && sentPending && !st.agentBusy) {
          firstThumb = false;
          scheduleThumb(THUMB_FIRST_MS);
        }
        if (prev.agentBusy && !st.agentBusy) {
          // A project made only for a prompt the offline planner could not build would stay empty under the
          // prompt's name: remove it and give the answer on the home page instead.
          const reply = pending?.fresh && sentPending && !abandonChecked ? abandonedPromptReply(st.chat, s.history) : null;
          abandonChecked = abandonChecked || (pending?.fresh === true && sentPending);
          if (reply !== null) {
            void abandon(reply);
            return;
          }
          scheduleThumb(THUMB_AFTER_TURN_MS);
        }
      });
      const onHidden = (): void => {
        if (document.visibilityState === 'hidden') {
          void s.flush();
          void saveThumbnail(s, repo, id);
        }
      };
      document.addEventListener('visibilitychange', onHidden);
      cleanups.push(unsub, () => document.removeEventListener('visibilitychange', onHidden), () => thumbTimer !== null && clearTimeout(thumbTimer));
      setStudio(s);
    });
    return () => {
      cancelled = true;
      for (const c of cleanups.splice(0)) c();
      if (created) {
        if (window.__aether?.studio === created) delete window.__aether;
        created.dispose();
      }
      setStudio(null);
      setError(null);
    };
  }, [repo, id, store, navigate]);

  const services = useMemo<EditorServices | null>(() => {
    if (!studio || !repo) return null;
    const settle = async (): Promise<void> => {
      await studio.flush();
      // Best effort: a heavy world on a slow GPU must not hold the navigation (the project keeps its last thumbnail).
      await settleWithin(saveThumbnail(studio, repo, id), LEAVE_THUMB_MS);
    };
    return {
      projectId: id,
      leave: async () => {
        await settle();
        navigate({ name: 'home' });
      },
      newProject: async () => {
        await settle();
        store.getState().setNewProjectOpen(true);
        navigate({ name: 'home' });
      },
      duplicate: async () => {
        await settle();
        const r = await repo.duplicate(id);
        if (r.ok) navigate({ name: 'editor', id: r.value.id });
        else studio.store.getState().toast(r.error, 'error', 6);
      },
      deleteProject: async () => {
        // Write pending edits first so Undo restores the latest state, then delete and leave.
        await studio.flush();
        const meta = await repo.meta(id);
        if (!meta) {
          navigate({ name: 'home' });
          return;
        }
        const gone = await projectActions.removeMany([meta]);
        if (gone.length === 0) {
          studio.store.getState().toast('Could not delete this project. It is still saved.', 'error', 6);
          return;
        }
        navigate({ name: 'home' });
      },
    };
  }, [studio, repo, id, navigate, store, projectActions]);

  if (error) return <EditorError message={error} onBack={() => navigate({ name: 'home' })} />;
  if (!studio || !services) return <EditorSkeleton />;
  return (
    <StudioProvider studio={studio}>
      <EditorContext.Provider value={services}>
        <EditorShell />
      </EditorContext.Provider>
    </StudioProvider>
  );
});
