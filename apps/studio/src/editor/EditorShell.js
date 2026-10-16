import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Editor layout. The viewport keeps the same position in the tree in every
 * layout mode, so resizing across breakpoints never remounts the canvas
 * (which would recreate the renderer).
 */
import { lazyBoundary } from '../components/ErrorBoundary';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useStudio, useUI, useWorld } from '../app/context';
import { useApp } from '../app/appContext';
import { useShortcuts } from '../app/useShortcuts';
import { useStore } from 'zustand';
/** The Publish hub and its camera timeline load only when first opened. */
const PublishHub = lazyBoundary(async () => ({ default: (await import('./publish/PublishHub')).PublishHub }), { what: 'publish tools', fallback: null, variant: 'inline' });
const CameraTimeline = lazyBoundary(async () => ({ default: (await import('./publish/CameraTimeline')).CameraTimeline }), { what: 'camera timeline', fallback: null, variant: 'inline' });
/** Dialogs of the asset pipeline load only when first opened. */
const CreditsDialog = lazyBoundary(async () => ({ default: (await import('./library/CreditsDialog')).CreditsDialog }), { what: 'credits', fallback: null, variant: 'inline' });
const ForgeDialog = lazyBoundary(async () => ({ default: (await import('./library/ForgeDialog')).ForgeDialog }), { what: 'generator forge', fallback: null, variant: 'inline' });
const AssetDialogs = memo(function AssetDialogs() {
    const studio = useStudio();
    const credits = useStore(studio.assets.state, (s) => s.creditsOpen);
    const forge = useStore(studio.forge.state, (s) => s.open);
    return (_jsxs(_Fragment, { children: [credits && _jsx(CreditsDialog, {}), forge && _jsx(ForgeDialog, {})] }));
});
import { SettingsDialog } from '../components/SettingsDialog';
import { Toasts } from '../components/Toasts';
import { TopBar } from '../components/TopBar';
import { CommandPalette } from '../components/ui/CommandPalette';
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
const EditorSettings = memo(function EditorSettings() {
    const studio = useStudio();
    const open = useUI((s) => s.settingsOpen);
    const settings = useUI((s) => s.settings);
    const memory = useUI((s) => s.memory);
    const gpu = useUI((s) => s.gpu);
    const tab = useUI((s) => s.settingsTab);
    const aiPrefs = useUI((s) => s.aiPrefs);
    // A choice made on the first-run screen applies to the open project at once.
    useAiPrefsEvent((patch) => studio.store.getState().setAiPrefs(patch));
    return (_jsx(SettingsDialog, { open: open, onClose: () => studio.store.getState().setSettingsOpen(false), settings: settings, update: (p) => studio.store.getState().updateSettings(p), context: { memory, gpu }, initialTab: tab, ai: { prefs: aiPrefs, update: (p) => studio.store.getState().setAiPrefs(p) } }));
});
/** Keeps the tab title on the project name (isolated so world edits re-render nothing else). */
const DocumentTitle = memo(function DocumentTitle() {
    const name = useWorld().name;
    useEffect(() => {
        document.title = `${name || 'Untitled world'} · Aether`;
    }, [name]);
    return null;
});
const EditorPalette = memo(function EditorPalette() {
    const studio = useStudio();
    const { repo } = useApp();
    const open = useUI((s) => s.paletteOpen);
    const projects = useProjectList(open ? repo : null);
    const commands = useEditorCommands(projects ?? []);
    // Free text the palette cannot match is a prompt: send it to the agent.
    const fallback = useCallback((q) => ({
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
    }), [studio]);
    return _jsx(CommandPalette, { open: open, onClose: () => studio.store.getState().setPaletteOpen(false), commands: commands, placeholder: "Search actions, objects, assets \u2014 or describe a change\u2026", fallback: fallback });
});
/** The editor. */
export const EditorShell = memo(function EditorShell() {
    const studio = useStudio();
    const layout = useLayoutMode();
    const panels = useUI((s) => s.panels);
    const mode = useUI((s) => s.mode);
    const busy = useUI((s) => s.agentBusy);
    const tool = useUI((s) => s.tool);
    const immersive = useUI((s) => s.mode === 'play' && s.settings.immersivePlay);
    const widths = usePanelWidths();
    const rootRef = useRef(null);
    const publishOpen = useStore(studio.publish.state, (s) => s.open);
    const publishTarget = useStore(studio.publish.state, (s) => s.target);
    useShortcuts();
    useEffect(() => studio.store.getState().setLayout(layout), [layout, studio]);
    const desktop = layout === 'wide' || layout === 'medium';
    const tablet = layout === 'tablet';
    const phone = layout === 'phone';
    const style = { '--left-w': `${widths.left}px`, '--right-w': `${widths.right}px` };
    const closeDrawers = () => {
        const st = studio.store.getState();
        st.setPanel('left', false);
        st.setPanel('right', false);
    };
    return (_jsxs("div", { ref: rootRef, className: "editor", "data-layout": layout, "data-mode": mode, "data-tool": tool, "data-immersive": immersive && (layout === 'wide' || layout === 'medium') ? 'true' : undefined, "data-busy": busy ? 'true' : undefined, "data-left": panels.left ? 'open' : 'closed', "data-right": panels.right ? 'open' : 'closed', "data-publish": publishOpen ? (publishTarget === 'video' ? 'video' : 'open') : undefined, style: style, children: [_jsx(TopBar, { layout: layout }), _jsxs("div", { className: "editor__body", children: [desktop ? _jsx(IconRail, {}) : null, desktop && panels.left ? (_jsxs("div", { className: "editor__left", children: [_jsx(LeftPanel, {}), _jsx(ResizeHandle, { side: "left", width: widths.left, onCommit: (w) => widths.setWidth('left', w), hostRef: rootRef })] })) : tablet ? (_jsxs("div", { className: `drawer drawer--left${panels.left ? ' is-open' : ''}`, inert: !panels.left, children: [_jsx(IconRail, {}), _jsx(LeftPanel, {})] })) : null, _jsxs("main", { className: "editor__canvas", children: [_jsx(Viewport, {}), publishOpen && publishTarget === 'video' && mode === 'edit' && (desktop || layout === 'tablet') ? (_jsx(CameraTimeline, {})) : null] }), publishOpen ? (_jsx(PublishHub, {})) : null, desktop && panels.right ? (_jsxs("div", { className: "editor__right", children: [_jsx(ResizeHandle, { side: "right", width: widths.right, onCommit: (w) => widths.setWidth('right', w), hostRef: rootRef }), _jsx(RightPanel, {})] })) : layout === 'medium' ? (_jsx(RightRail, {})) : tablet ? (_jsx("div", { className: `drawer drawer--right${panels.right ? ' is-open' : ''}`, inert: !panels.right, children: _jsx(RightPanel, {}) })) : null, tablet && (panels.left || panels.right) ? _jsx("div", { className: "scrim", onClick: closeDrawers, "aria-hidden": "true" }) : null, phone ? _jsx(MobileSheet, {}) : null] }), _jsx(DocumentTitle, {}), _jsx(Toasts, {}), _jsx(EditorSettings, {}), _jsx(EditorPalette, {}), _jsx(AssetDialogs, {}), _jsx(ShortcutsDialog, {}), _jsx(Tour, {})] }));
});
