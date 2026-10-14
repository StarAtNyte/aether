/**
 * Editor layout. The viewport keeps the same position in the tree in every
 * layout mode, so resizing across breakpoints never remounts the canvas
 * (which would recreate the renderer).
 */
import { lazy, memo, Suspense, useCallback, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { useStudio, useUI, useWorld } from '../app/context';
import { useApp } from '../app/appContext';
import { useShortcuts } from '../app/useShortcuts';
import { useStore } from 'zustand';

/** Dialogs of the asset pipeline load only when first opened. */
const CreditsDialog = lazy(async () => ({ default: (await import('./library/CreditsDialog')).CreditsDialog }));
const ForgeDialog = lazy(async () => ({ default: (await import('./library/ForgeDialog')).ForgeDialog }));

const AssetDialogs = memo(function AssetDialogs(): ReactElement {
  const studio = useStudio();
  const credits = useStore(studio.assets.state, (s) => s.creditsOpen);
  const forge = useStore(studio.forge.state, (s) => s.open);
  return (
    <Suspense fallback={null}>
      {credits && <CreditsDialog />}
      {forge && <ForgeDialog />}
    </Suspense>
  );
});
import { SettingsDialog } from '../components/SettingsDialog';
import { Toasts } from '../components/Toasts';
import { TopBar } from '../components/TopBar';
import { CommandPalette, type Command } from '../components/ui/CommandPalette';
import { launchPromptFlight } from '../lib/promptFlight';
import { Viewport } from '../components/viewport/Viewport';
import { useProjectList } from '../home/useProjects';
import { IconRail } from './IconRail';
import { MobileSheet } from './MobileSheet';
import { LeftPanel, ResizeHandle, RightPanel, RightRail } from './Panels';
import { useEditorCommands } from './useEditorCommands';
import { useLayoutMode, usePanelWidths } from './useLayout';
import { useAiPrefsEvent } from '../onboarding/useAiPrefsEvent';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { Tour } from '../onboarding/Tour';

const EditorSettings = memo(function EditorSettings(): ReactElement {
  const studio = useStudio();
  const open = useUI((s) => s.settingsOpen);
  const settings = useUI((s) => s.settings);
  const memory = useUI((s) => s.memory);
  const gpu = useUI((s) => s.gpu);
  const tab = useUI((s) => s.settingsTab);
  const aiPrefs = useUI((s) => s.aiPrefs);
  // A choice made on the first-run screen applies to the open project at once.
  useAiPrefsEvent((patch) => studio.store.getState().setAiPrefs(patch));
  return (
    <SettingsDialog
      open={open}
      onClose={() => studio.store.getState().setSettingsOpen(false)}
      settings={settings}
      update={(p) => studio.store.getState().updateSettings(p)}
      context={{ memory, gpu }}
      initialTab={tab}
      ai={{ prefs: aiPrefs, update: (p) => studio.store.getState().setAiPrefs(p) }}
    />
  );
});

/** Keeps the tab title on the project name (isolated so world edits re-render nothing else). */
const DocumentTitle = memo(function DocumentTitle(): null {
  const name = useWorld().name;
  useEffect(() => {
    document.title = `${name || 'Untitled world'} · Aether`;
  }, [name]);
  return null;
});

const EditorPalette = memo(function EditorPalette(): ReactElement {
  const studio = useStudio();
  const { repo } = useApp();
  const open = useUI((s) => s.paletteOpen);
  const projects = useProjectList(open ? repo : null);
  const commands = useEditorCommands(projects ?? []);
  // Free text the palette cannot match is a prompt: send it to the agent.
  const fallback = useCallback(
    (q: string): Command => ({
      id: 'ask-agent',
      title: `Ask the agent: “${q}”`,
      group: 'Agent',
      icon: 'sparkles',
      shortcut: '↵',
      run: () => {
        studio.store.getState().showLeftView('agent');
        launchPromptFlight(q, document.querySelector('.palette') ?? document.getElementById('prompt-input'));
        void studio.send(q);
      },
    }),
    [studio],
  );
  return <CommandPalette open={open} onClose={() => studio.store.getState().setPaletteOpen(false)} commands={commands} placeholder="Search actions, objects, assets — or describe a change…" fallback={fallback} />;
});

/** The editor. */
export const EditorShell = memo(function EditorShell(): ReactElement {
  const studio = useStudio();
  const layout = useLayoutMode();
  const panels = useUI((s) => s.panels);
  const mode = useUI((s) => s.mode);
  const busy = useUI((s) => s.agentBusy);
  const tool = useUI((s) => s.tool);
  const immersive = useUI((s) => s.mode === 'play' && s.settings.immersivePlay);
  const widths = usePanelWidths();
  const rootRef = useRef<HTMLDivElement>(null);
  useShortcuts();

  useEffect(() => studio.store.getState().setLayout(layout), [layout, studio]);

  const desktop = layout === 'wide' || layout === 'medium';
  const tablet = layout === 'tablet';
  const phone = layout === 'phone';
  const style = { '--left-w': `${widths.left}px`, '--right-w': `${widths.right}px` } as CSSProperties;
  const closeDrawers = (): void => {
    const st = studio.store.getState();
    st.setPanel('left', false);
    st.setPanel('right', false);
  };

  return (
    <div
      ref={rootRef}
      className="editor"
      data-layout={layout}
      data-mode={mode}
      data-tool={tool}
      data-immersive={immersive && (layout === 'wide' || layout === 'medium') ? 'true' : undefined}
      data-busy={busy ? 'true' : undefined}
      data-left={panels.left ? 'open' : 'closed'}
      data-right={panels.right ? 'open' : 'closed'}
      style={style}
    >
      <TopBar layout={layout} />
      <div className="editor__body">
        {desktop ? <IconRail /> : null}
        {desktop && panels.left ? (
          <div className="editor__left">
            <LeftPanel />
            <ResizeHandle side="left" width={widths.left} onCommit={(w) => widths.setWidth('left', w)} hostRef={rootRef} />
          </div>
        ) : tablet ? (
          <div className={`drawer drawer--left${panels.left ? ' is-open' : ''}`} inert={!panels.left}>
            <IconRail />
            <LeftPanel />
          </div>
        ) : null}
        <main className="editor__canvas">
          <Viewport />
        </main>
        {desktop && panels.right ? (
          <div className="editor__right">
            <ResizeHandle side="right" width={widths.right} onCommit={(w) => widths.setWidth('right', w)} hostRef={rootRef} />
            <RightPanel />
          </div>
        ) : layout === 'medium' ? (
          <RightRail />
        ) : tablet ? (
          <div className={`drawer drawer--right${panels.right ? ' is-open' : ''}`} inert={!panels.right}>
            <RightPanel />
          </div>
        ) : null}
        {tablet && (panels.left || panels.right) ? <div className="scrim" onClick={closeDrawers} aria-hidden="true" /> : null}
        {phone ? <MobileSheet /> : null}
      </div>
      <DocumentTitle />
      <Toasts />
      <EditorSettings />
      <EditorPalette />
      <AssetDialogs />
      <ShortcutsDialog />
      <Tour />
    </div>
  );
});
