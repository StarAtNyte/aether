/**
 * Editor top bar, three zones:
 *  - left: app menu (projects, file actions), panel toggle, editable project name, save status
 *  - centre: Edit | Play mode switch, undo / redo, Add and View menus
 *  - right: performance overlay toggle, command palette, Share, Export, inspector toggle
 * On phones it collapses to logomark menu + name + Play + overflow menu.
 */
import { memo, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { MAX_IMPORT_BYTES } from '../config';
import { useHistoryState, useStudio, useUI, useWorld } from '../app/context';
import { useEditor } from '../editor/editorContext';
import { shortcut } from '../lib/keys';
import { PALETTE_ITEMS } from '../lib/palette';
import type { LayoutMode } from '../lib/layout';
import { Icon } from './Icon';
import { Logomark } from './Logo';
import { Menu, type MenuEntry } from './ui/Menu';
import { SignInChip } from '../onboarding/FirstRunHost';

/** Inline-editable project (world) name. */
const ProjectName = memo(function ProjectName(): ReactElement {
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
    <span className="project-name" data-value={draft || ' '}>
      <input
        className="project-name__input"
        value={draft}
        maxLength={80}
        size={1}
        spellCheck={false}
        disabled={mode === 'play'}
        aria-label="Project name"
        title={world.name}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(world.name);
            setEditing(false);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
    </span>
  );
});

/** "Saved" / "Saving…" indicator. */
const SaveStatus = memo(function SaveStatus(): ReactElement | null {
  const save = useUI((s) => s.save);
  const editor = useEditor();
  if (!editor) return null;
  const text = save.status === 'saving' ? 'Saving…' : save.status === 'unsaved' ? 'Edited' : save.status === 'error' ? 'Not saved' : 'Saved';
  return (
    <span className={`save-status is-${save.status}`} role="status" aria-live="polite" title={save.status === 'error' ? (save.error ?? 'Saving failed') : 'Changes are saved in this browser'}>
      {save.status === 'error' ? <Icon name="alert" /> : save.status === 'saved' ? <Icon name="check" /> : <span className="save-status__dot" aria-hidden="true" />}
      <span className="save-status__text">{text}</span>
    </span>
  );
});

/** Top application bar. */
export const TopBar = memo(function TopBar({ layout }: { layout: LayoutMode }): ReactElement {
  const studio = useStudio();
  const editor = useEditor();
  const backend = useUI((s) => s.backend);
  const mode = useUI((s) => s.mode);
  const modeBusy = useUI((s) => s.modeBusy);
  const loading = useUI((s) => s.loading);
  const panels = useUI((s) => s.panels);
  const settings = useUI((s) => s.settings);
  const memory = useUI((s) => s.memory);
  const selection = useUI((s) => s.selection);
  const { canUndo, canRedo } = useHistoryState();
  const fileRef = useRef<HTMLInputElement>(null);
  const playing = mode === 'play';
  const phone = layout === 'phone';
  const st = (): ReturnType<typeof studio.store.getState> => studio.store.getState();

  const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      st().toast(`That file is too large (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`, 'error');
      return;
    }
    file
      .text()
      .then(async (text) => {
        const err = await studio.importText(text);
        if (err) st().toast(err, 'error', 7);
      })
      .catch(() => st().toast('Could not read the file.', 'error'));
  };

  const appMenu: MenuEntry[] = [
    ...(editor
      ? ([
          { id: 'home', label: 'Back to projects', icon: 'arrowLeft', onSelect: () => void editor.leave() },
          { kind: 'separator', id: 's0' },
          { id: 'new', label: 'New project…', icon: 'plus', onSelect: () => void editor.newProject() },
          { id: 'dup', label: 'Duplicate project', icon: 'copy', onSelect: () => void editor.duplicate() },
        ] satisfies MenuEntry[])
      : []),
    { id: 'import', label: 'Import world…', icon: 'upload', disabled: playing, onSelect: () => fileRef.current?.click() },
    { id: 'export', label: 'Export .aether.json', icon: 'download', onSelect: () => studio.exportToFile() },
    { kind: 'separator', id: 's1' },
    { id: 'palette', label: 'Command palette', icon: 'command', shortcut: shortcut('Mod+K'), onSelect: () => st().setPaletteOpen(true) },
    { id: 'theme', label: settings.darkTheme ? 'Light theme' : 'Dark theme', icon: settings.darkTheme ? 'sun' : 'moon', onSelect: () => st().updateSettings({ darkTheme: !settings.darkTheme }) },
    { id: 'settings', label: 'Settings', icon: 'settings', onSelect: () => st().setSettingsOpen(true) },
  ];

  const addMenu: MenuEntry[] = [
    { kind: 'heading', id: 'h-prim', label: 'Primitives' },
    ...PALETTE_ITEMS.filter((p) => p.section === 'primitives').map((p) => ({ id: p.id, label: p.label, icon: 'cube' as const, onSelect: () => void studio.addFromPalette(p.id) })),
    { kind: 'heading', id: 'h-light', label: 'Lights' },
    ...PALETTE_ITEMS.filter((p) => p.section === 'lights').map((p) => ({ id: p.id, label: p.label, icon: 'lightbulb' as const, onSelect: () => void studio.addFromPalette(p.id) })),
    { kind: 'separator', id: 's-all' },
    { id: 'all', label: 'All assets…', icon: 'shapes', onSelect: () => st().showLeftView('assets') },
  ];

  const viewMenu: MenuEntry[] = [
    { kind: 'heading', id: 'h-cam', label: 'Camera' },
    { id: 'reset', label: 'Frame world', icon: 'maximize', shortcut: '0', onSelect: () => studio.viewPreset('reset') },
    { id: 'iso', label: '3D view', icon: 'box3d', shortcut: '1', onSelect: () => studio.viewPreset('iso') },
    { id: 'top', label: 'Top view', icon: 'viewTop', shortcut: '2', onSelect: () => studio.viewPreset('top') },
    { id: 'front', label: 'Front view', icon: 'square', shortcut: '3', onSelect: () => studio.viewPreset('front') },
    { id: 'focus', label: 'Focus selection', icon: 'focus', shortcut: 'F', disabled: selection.length === 0, onSelect: () => selection[0] && studio.focus(selection[0]) },
    { kind: 'separator', id: 's-v' },
    { kind: 'heading', id: 'h-ov', label: 'Overlays' },
    { id: 'labels', label: 'Object labels', checked: settings.showLabels, shortcut: 'L', onSelect: () => st().updateSettings({ showLabels: !settings.showLabels }) },
    { id: 'perf', label: 'Performance', checked: settings.showPerf, shortcut: shortcut('Shift+P'), onSelect: () => st().updateSettings({ showPerf: !settings.showPerf }) },
    { id: 'colliders', label: 'Colliders', checked: settings.showColliders, onSelect: () => st().updateSettings({ showColliders: !settings.showColliders }) },
  ];

  const phoneMenu: MenuEntry[] = [
    { id: 'undo', label: 'Undo', icon: 'undo', disabled: !canUndo || playing, onSelect: () => studio.undo() },
    { id: 'redo', label: 'Redo', icon: 'redo', disabled: !canRedo || playing, onSelect: () => studio.redo() },
    { kind: 'separator', id: 'p0' },
    { id: 'share', label: 'Share link', icon: 'share', disabled: playing, onSelect: () => void studio.share() },
    ...viewMenu.filter((m) => m.kind !== 'heading' && m.id !== 'focus'),
    { kind: 'separator', id: 'p1' },
    ...appMenu,
  ];

  const playButton = (
    <button
      type="button"
      className={`btn btn--sm ${playing ? 'btn--stop' : 'btn--primary'} play-btn`}
      onClick={() => void studio.togglePlay()}
      disabled={modeBusy || loading !== null}
      aria-pressed={playing}
      data-tip={playing ? 'Stop and restore' : 'Play the world'}
      data-kbd={shortcut('Mod+Enter')}
    >
      <Icon name={playing ? 'stop' : 'play'} />
      <span className="btn__label">{modeBusy ? (playing ? 'Stopping' : 'Starting') : playing ? 'Stop' : 'Play'}</span>
    </button>
  );

  return (
    <header className="topbar" role="banner">
      <div className="topbar__zone topbar__zone--start">
        <Menu
          label="Aether menu"
          items={appMenu}
          width={240}
          trigger={(t) => (
            <button {...t} type="button" className="app-menu-btn" aria-label="Aether menu" data-tip="Menu">
              <Logomark size={22} />
              <Icon name="chevronDown" className="app-menu-btn__chev" />
            </button>
          )}
        />
        {!phone && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => st().togglePanel('left')}
            aria-pressed={panels.left}
            aria-label="Toggle left panel"
            data-tip={panels.left ? 'Hide panel' : 'Show panel'}
            data-kbd={shortcut('Mod+[')}
          >
            <Icon name="panelLeft" />
          </button>
        )}
        <span className="topbar__sep" aria-hidden="true" />
        <ProjectName />
        {!phone && <SaveStatus />}
      </div>

      {!phone && (
        <div className="topbar__zone topbar__zone--center">
          {playButton}
          <span className="topbar__sep" aria-hidden="true" />
          <button type="button" className="icon-btn" disabled={!canUndo || playing} onClick={() => studio.undo()} aria-label="Undo" data-tip="Undo" data-kbd={shortcut('Mod+Z')}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" disabled={!canRedo || playing} onClick={() => studio.redo()} aria-label="Redo" data-tip="Redo" data-kbd={shortcut('Mod+Shift+Z')}>
            <Icon name="redo" />
          </button>
          <span className="topbar__sep" aria-hidden="true" />
          <Menu
            label="Add object"
            items={addMenu}
            width={220}
            trigger={(t) => (
              <button {...t} type="button" className="btn btn--ghost btn--sm" disabled={playing} data-tip="Add an object">
                <Icon name="plus" />
                <span className="btn__label">Add</span>
              </button>
            )}
          />
          <Menu
            label="View"
            items={viewMenu}
            width={232}
            trigger={(t) => (
              <button {...t} type="button" className="btn btn--ghost btn--sm" data-tip="Camera and overlays">
                <Icon name="eye" />
                <span className="btn__label">View</span>
              </button>
            )}
          />
        </div>
      )}

      <div className="topbar__zone topbar__zone--end">
        {phone ? (
          <>
            {playButton}
            <Menu
              label="More"
              align="end"
              items={phoneMenu}
              width={240}
              trigger={(t) => (
                <button {...t} type="button" className="icon-btn" aria-label="More">
                  <Icon name="more" />
                </button>
              )}
            />
          </>
        ) : (
          <>
            <SignInChip />
            {memory.lowMemory && (
              <button type="button" className="chip chip--quiet hide-tablet" onClick={() => st().setSettingsOpen(true)} data-tip={memory.reason ?? 'Low memory mode'}>
                Low memory
              </button>
            )}
            {backend && (
              <span className="chip chip--quiet hide-tablet" data-tip={backend === 'webgpu' ? 'Rendering with WebGPU' : 'Rendering with WebGL2'}>
                {backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}
              </span>
            )}
            <button
              type="button"
              className="icon-btn hide-tablet"
              onClick={() => st().updateSettings({ showPerf: !settings.showPerf })}
              aria-pressed={settings.showPerf}
              aria-label="Performance overlay"
              data-tip="Performance overlay"
              data-kbd={shortcut('Shift+P')}
            >
              <Icon name="activity" />
            </button>
            <button type="button" className="icon-btn" onClick={() => st().setPaletteOpen(true)} aria-label="Command palette" data-tip="Command palette" data-kbd={shortcut('Mod+K')}>
              <Icon name="command" />
            </button>
            <button type="button" className="btn btn--sm hide-tablet" onClick={() => void studio.share()} disabled={playing} data-tip="Upload and copy a share link">
              <Icon name="share" />
              <span className="btn__label">Share</span>
            </button>
            <button type="button" className="btn btn--sm" onClick={() => studio.exportToFile()} aria-label="Export world JSON" data-tip="Download .aether.json">
              <Icon name="download" />
              <span className="btn__label">Export</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => st().togglePanel('right')}
              aria-pressed={panels.right}
              aria-label="Toggle inspector"
              data-tip={panels.right ? 'Hide inspector' : 'Show inspector'}
              data-kbd={shortcut('Mod+]')}
              data-tip-align="end"
            >
              <Icon name="panelRight" />
            </button>
          </>
        )}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </div>
    </header>
  );
});
