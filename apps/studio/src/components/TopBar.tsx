import { memo, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { MAX_IMPORT_BYTES } from '../config';
import { useHistoryState, useStudio, useUI, useWorld } from '../app/context';
import { Icon } from './Icon';
import { Orb } from './Orb';

/** Inline-editable world name. */
const WorldName = memo(function WorldName(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const mode = useUI((s) => s.mode);
  const [draft, setDraft] = useState(world.name);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(world.name);
  }, [world.name, editing]);
  const commit = (): void => {
    setEditing(false);
    studio.renameWorld(draft);
  };
  return (
    <input
      className="world-name"
      value={draft}
      maxLength={80}
      spellCheck={false}
      disabled={mode === 'play'}
      aria-label="World name"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(world.name);
          setEditing(false);
        }
      }}
    />
  );
});

/** Top application bar: brand, world name, backend, history, play, file actions. */
export const TopBar = memo(function TopBar(): ReactElement {
  const studio = useStudio();
  const backend = useUI((s) => s.backend);
  const provider = useUI((s) => s.provider);
  const mode = useUI((s) => s.mode);
  const modeBusy = useUI((s) => s.modeBusy);
  const loading = useUI((s) => s.loading);
  const panels = useUI((s) => s.panels);
  const darkTheme = useUI((s) => s.settings.darkTheme);
  const { canUndo, canRedo } = useHistoryState();
  const fileRef = useRef<HTMLInputElement>(null);
  const playing = mode === 'play';

  const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const st = studio.store.getState();
    if (file.size > MAX_IMPORT_BYTES) {
      st.toast(`That file is too large (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`, 'error');
      return;
    }
    file
      .text()
      .then(async (text) => {
        const err = await studio.importText(text);
        if (err) st.toast(err, 'error', 7);
      })
      .catch(() => st.toast('Could not read the file.', 'error'));
  };

  return (
    <header className="topbar" role="banner">
      <div className="topbar__group">
        <button type="button" className="icon-btn" onClick={() => studio.store.getState().togglePanel('left')} aria-pressed={panels.left} title="Toggle chat panel (Ctrl+[)">
          <Icon name="panelLeft" />
        </button>
        <div className="brand" aria-label="Aether">
          <Orb size={26} className="brand__mark" />
          <span className="brand__name">Aether</span>
        </div>
        <span className="topbar__divider" aria-hidden="true" />
        <WorldName />
        {backend && (
          <span className={`badge badge--${backend}`} title={backend === 'webgpu' ? 'Rendering with WebGPU' : 'Rendering with WebGL2 (WebGPU unavailable)'}>
            {backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}
          </span>
        )}
        {provider.status === 'offline' && (
          <span className="badge badge--muted" title="No AI backend reachable — prompts are answered by the built-in offline world planner.">
            <span className="dot dot--idle" aria-hidden="true" /> offline planner
          </span>
        )}
        {provider.status === 'live' && (
          <span className="badge badge--live" title={`AI backend: ${provider.name}`}>
            <span className="dot" aria-hidden="true" /> AI live
          </span>
        )}
      </div>

      <div className="topbar__center">
        <div className="segmented" role="group" aria-label="History">
          <button type="button" className="icon-btn" disabled={!canUndo || playing} onClick={() => studio.undo()} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" disabled={!canRedo || playing} onClick={() => studio.redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Icon name="redo" />
          </button>
        </div>
        <button
          type="button"
          className={`play-btn${playing ? ' is-playing' : ''}`}
          onClick={() => void studio.togglePlay()}
          disabled={modeBusy || loading !== null}
          aria-pressed={playing}
          title={playing ? 'Stop and restore the world (Ctrl+Enter)' : 'Play the world (Ctrl+Enter)'}
        >
          <Icon name={playing ? 'stop' : 'play'} size={15} />
          <span>{modeBusy ? (playing ? 'Stopping…' : 'Starting…') : playing ? 'Stop' : 'Play'}</span>
        </button>
      </div>

      <div className="topbar__group topbar__group--end">
        <button type="button" className="btn btn--ghost" onClick={() => void studio.share()} disabled={playing} title="Upload and copy a share link">
          <Icon name="share" /> <span className="hide-narrow">Share</span>
        </button>
        <button type="button" className="icon-btn hide-compact" onClick={() => studio.exportToFile()} title="Export world JSON" aria-label="Export world JSON">
          <Icon name="download" />
        </button>
        <button type="button" className="icon-btn hide-compact" onClick={() => fileRef.current?.click()} disabled={playing} title="Import world JSON" aria-label="Import world JSON">
          <Icon name="upload" />
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
        <button
          type="button"
          className="icon-btn theme-btn"
          onClick={() => studio.store.getState().updateSettings({ darkTheme: !darkTheme })}
          aria-pressed={darkTheme}
          title={darkTheme ? 'Switch to the light theme' : 'Switch to the dark theme'}
          aria-label="Dark theme"
        >
          <Icon name={darkTheme ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="icon-btn" onClick={() => studio.store.getState().setSettingsOpen(true)} title="Settings & shortcuts" aria-label="Settings">
          <Icon name="settings" />
        </button>
        <button type="button" className="icon-btn" onClick={() => studio.store.getState().togglePanel('right')} aria-pressed={panels.right} title="Toggle inspector panel (Ctrl+])">
          <Icon name="panelRight" />
        </button>
      </div>
    </header>
  );
});
