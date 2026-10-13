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
import { createLogger } from '../lib/log';
import { takeRun } from '../projects/pending';
import type { ProjectRepo } from '../projects/repo';
import { Icon } from '../components/Icon';
import { EditorContext, type EditorServices } from './editorContext';
import { EditorShell } from './EditorShell';

const log = createLogger('editor');
/** Delay after an agent turn before the thumbnail is taken (grow-in animation, camera flight). */
const THUMB_AFTER_TURN_MS = 1600;
/** Delay after opening a project without a thumbnail. */
const THUMB_FIRST_MS = 2500;

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

function exposeDebug(studio: Studio): void {
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

/** Skeleton shown while a project opens. */
function EditorSkeleton(): ReactElement {
  return (
    <div className="editor editor--skeleton" aria-busy="true" aria-label="Opening project">
      <div className="topbar">
        <span className="skeleton skeleton--block" style={{ width: 120, height: 20 }} />
      </div>
      <div className="editor__body">
        <div className="editor__canvas">
          <div className="viewport">
            <span className="vp-loading__surface skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
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
        project: { world: r.value.world, chat: r.value.chat },
        onSave: async (world, chat) => {
          const x = await repo.save(id, world, chat);
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
        if (prev.agentBusy && !st.agentBusy) scheduleThumb(THUMB_AFTER_TURN_MS);
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
  }, [repo, id, store]);

  const services = useMemo<EditorServices | null>(() => {
    if (!studio || !repo) return null;
    const settle = async (): Promise<void> => {
      await studio.flush();
      await saveThumbnail(studio, repo, id);
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
    };
  }, [studio, repo, id, navigate, store]);

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
