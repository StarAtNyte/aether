/**
 * Read-only viewer of a shared world (`#/view/<token>`): the world from the
 * link fills the window with a slim bar — its name, a "Shared" badge, Play,
 * Export and Remix. Nothing is saved; editing tools and the agent are
 * absent. Remix copies the world into a new project and opens the editor.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { WorldDoc } from '@aether/core';
import { useApp } from '../app/appContext';
import { StudioProvider, useStudio, useUI, useWorld } from '../app/context';
import { Studio } from '../engine/Studio';
import { decodeWorldToken } from '../lib/shareLink';
import { shortcut } from '../lib/keys';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { Toasts } from '../components/Toasts';
import { Viewport } from '../components/viewport/Viewport';
import { exposeDebug } from './EditorRoute';
import { EditorSkeleton } from './EditorSkeleton';

/** The viewer's bar and viewport. */
const ViewerShell = memo(function ViewerShell({ onRemix, remixing }: { onRemix: () => void; remixing: boolean }): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const mode = useUI((s) => s.mode);
  const modeBusy = useUI((s) => s.modeBusy);
  const loading = useUI((s) => s.loading);
  const playing = mode === 'play';
  useEffect(() => {
    document.title = `${world.name || 'Shared world'} · Aether`;
  }, [world.name]);
  // Keyboard: play / stop, Esc stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void studio.togglePlay();
      } else if (e.key === 'Escape' && studio.store.getState().mode === 'play') void studio.togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studio]);
  return (
    <div className="viewer editor" data-layout="viewer" data-mode={mode} data-tool="orbit">
      <header className="viewer-bar" aria-label="Shared world">
        <a className="viewer-bar__brand" href="#/" aria-label="Aether home" data-tip="Aether home">
          <Logomark size={22} />
        </a>
        <span className="viewer-bar__title">
          <span className="viewer-bar__name">{world.name || 'Shared world'}</span>
          <span className="badge viewer-bar__badge">
            <Icon name="eye" size={12} /> Shared · read only
          </span>
        </span>
        <span className="spacer" />
        <button type="button" className={`btn btn--sm ${playing ? 'btn--stop' : ''} play-btn`} onClick={() => void studio.togglePlay()} disabled={modeBusy || loading !== null} aria-pressed={playing} data-kbd={shortcut('Mod+Enter')} data-tip={playing ? 'Stop' : 'Play the world'}>
          <Icon name={playing ? 'stop' : 'play'} />
          <span className="btn__label">{playing ? 'Stop' : 'Play'}</span>
        </button>
        <button type="button" className="btn btn--sm hide-phone" onClick={() => studio.exportToFile()} disabled={playing} data-tip="Download as .aether.json">
          <Icon name="download" />
          <span className="btn__label">Export</span>
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={onRemix} disabled={remixing || playing} data-tip="Copy into a new project you can edit">
          <Icon name="branch" />
          <span className="btn__label">{remixing ? 'Remixing…' : 'Remix'}</span>
        </button>
      </header>
      <main className="viewer__canvas">
        <Viewport />
      </main>
      <Toasts />
    </div>
  );
});

/** Error state for a link that cannot be opened. */
function ViewerError({ message }: { message: string }): ReactElement {
  return (
    <div className="page-center">
      <div className="empty-state">
        <span className="empty-state__icon">
          <Icon name="link" size={20} />
        </span>
        <h3 className="empty-state__title">This world link can’t be opened</h3>
        <p className="empty-state__text">{message}</p>
        <a className="btn btn--primary" href="#/">
          <Icon name="arrowLeft" /> Go to Aether
        </a>
      </div>
    </div>
  );
}

/** The viewer route. */
export const ViewerRoute = memo(function ViewerRoute({ token }: { token: string }): ReactElement {
  const { repo, navigate } = useApp();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remixing, setRemixing] = useState(false);
  const original = useRef<WorldDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: Studio | null = null;
    void decodeWorldToken(token).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      original.current = r.world;
      // Nothing is persisted: the project save is a no-op and safe mode never swaps the world.
      const s = new Studio({ project: { world: r.world, chat: [] }, onSave: async () => null, safeMode: false });
      s.store.getState().setViewer(true);
      s.store.getState().setPanel('left', false);
      s.store.getState().setPanel('right', false);
      created = s;
      void s.boot();
      exposeDebug(s);
      setStudio(s);
    });
    return () => {
      cancelled = true;
      if (created) {
        if (window.__aether?.studio === created) delete window.__aether;
        created.dispose();
      }
      setStudio(null);
      setError(null);
    };
  }, [token]);

  const remix = useCallback(async () => {
    const world = original.current;
    if (!repo || !world || remixing) return;
    setRemixing(true);
    const r = await repo.create({ world, name: world.name || 'Remixed world' });
    setRemixing(false);
    if (r.ok) navigate({ name: 'editor', id: r.value.id }, { replace: true });
    else studio?.store.getState().toast(r.error, 'error', 6);
  }, [repo, remixing, navigate, studio]);

  if (error) return <ViewerError message={error} />;
  if (!studio) return <EditorSkeleton />;
  return (
    <StudioProvider studio={studio}>
      <ViewerShell onRemix={() => void remix()} remixing={remixing} />
    </StudioProvider>
  );
});
