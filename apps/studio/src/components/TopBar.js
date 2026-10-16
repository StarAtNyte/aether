import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Editor top bar, three zones:
 *  - left: app menu (projects, file actions), panel toggle, editable project name, save status
 *  - centre: Edit | Play mode switch, undo / redo, Add and View menus
 *  - right: performance overlay toggle, command palette, Share, Publish, inspector toggle
 * On phones it collapses to logomark menu + name + Play + overflow menu.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { MAX_IMPORT_BYTES } from '../config';
import { useHistoryState, useStudio, useUI, useWorld } from '../app/context';
import { useEditor } from '../editor/editorContext';
import { shortcut } from '../lib/keys';
import { PALETTE_ITEMS } from '../lib/palette';
import { Icon } from './Icon';
import { Logomark } from './Logo';
import { Menu } from './ui/Menu';
import { SignInChip } from '../onboarding/FirstRunHost';
/** Inline-editable project (world) name. */
const ProjectName = memo(function ProjectName() {
    const studio = useStudio();
    const world = useWorld();
    const mode = useUI((s) => s.mode);
    const [draft, setDraft] = useState(world.name);
    const [editing, setEditing] = useState(false);
    useEffect(() => {
        if (!editing)
            setDraft(world.name);
    }, [world.name, editing]);
    const commit = () => {
        setEditing(false);
        studio.renameWorld(draft);
    };
    return (_jsx("span", { className: "project-name", "data-value": draft || ' ', children: _jsx("input", { className: "project-name__input", value: draft, maxLength: 80, size: 1, spellCheck: false, disabled: mode === 'play', "aria-label": "Project name", title: world.name, onFocus: (e) => {
                setEditing(true);
                e.target.select();
            }, onChange: (e) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e) => {
                if (e.key === 'Enter')
                    e.target.blur();
                if (e.key === 'Escape') {
                    setDraft(world.name);
                    setEditing(false);
                    requestAnimationFrame(() => e.target.blur());
                }
            } }) }));
});
/** "Saved" / "Saving…" indicator. */
const SaveStatus = memo(function SaveStatus() {
    const save = useUI((s) => s.save);
    const editor = useEditor();
    if (!editor)
        return null;
    const text = save.status === 'saving' ? 'Saving…' : save.status === 'unsaved' ? 'Edited' : save.status === 'error' ? 'Not saved' : 'Saved';
    return (_jsxs("span", { className: `save-status is-${save.status}`, role: "status", "aria-live": "polite", title: save.status === 'error' ? (save.error ?? 'Saving failed') : 'Changes are saved in this browser', children: [save.status === 'error' ? _jsx(Icon, { name: "alert" }) : save.status === 'saved' ? _jsx(Icon, { name: "check" }) : _jsx("span", { className: "save-status__dot", "aria-hidden": "true" }), _jsx("span", { className: "save-status__text", children: text })] }));
});
/** Top application bar. */
export const TopBar = memo(function TopBar({ layout }) {
    const studio = useStudio();
    const editor = useEditor();
    const backend = useUI((s) => s.backend);
    const mode = useUI((s) => s.mode);
    const modeBusy = useUI((s) => s.modeBusy);
    const loading = useUI((s) => s.loading);
    const agentBusy = useUI((s) => s.agentBusy);
    const panels = useUI((s) => s.panels);
    const settings = useUI((s) => s.settings);
    const memory = useUI((s) => s.memory);
    const selection = useUI((s) => s.selection);
    const { canUndo, canRedo } = useHistoryState();
    const fileRef = useRef(null);
    const playing = mode === 'play';
    const phone = layout === 'phone';
    const st = () => studio.store.getState();
    const onFile = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file)
            return;
        // World packages (.zip with the world, its asset files and credits).
        if (/\.zip$/i.test(file.name)) {
            void studio.assets.importPackage(file).then((err) => {
                if (err)
                    st().toast(err, 'error', 7);
            });
            return;
        }
        if (file.size > MAX_IMPORT_BYTES) {
            st().toast(`That file is too large (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`, 'error');
            return;
        }
        file
            .text()
            .then(async (text) => {
            const err = await studio.importText(text);
            if (err)
                st().toast(err, 'error', 7);
        })
            .catch(() => st().toast('Could not read the file.', 'error'));
    };
    const appMenu = [
        ...(editor
            ? [
                { id: 'home', label: 'Back to projects', icon: 'arrowLeft', onSelect: () => void editor.leave() },
                { kind: 'separator', id: 's0' },
                { id: 'new', label: 'New project…', icon: 'plus', onSelect: () => void editor.newProject() },
                { id: 'dup', label: 'Duplicate project', icon: 'copy', onSelect: () => void editor.duplicate() },
            ]
            : []),
        { id: 'import', label: 'Import world or package…', icon: 'upload', disabled: playing, onSelect: () => fileRef.current?.click() },
        { id: 'publish', label: 'Publish…', icon: 'rocket', onSelect: () => studio.publish.open() },
        { id: 'versions', label: 'Versions and publish history…', icon: 'history', onSelect: () => studio.publish.open('history') },
        { id: 'export', label: 'Export .aether.json', icon: 'download', onSelect: () => studio.exportToFile() },
        { id: 'export-package', label: 'Export package (.zip with assets)', icon: 'package', onSelect: () => void studio.assets.exportPackage() },
        { id: 'export-gltf', label: 'Export 3D model (.glb)', icon: 'cube', disabled: playing, onSelect: () => void studio.exportGltf() },
        { id: 'credits', label: 'Credits', icon: 'credits', onSelect: () => studio.assets.setCreditsOpen(true) },
        { kind: 'separator', id: 's1' },
        { id: 'palette', label: 'Command palette', icon: 'command', shortcut: shortcut('Mod+K'), onSelect: () => st().setPaletteOpen(true) },
        { id: 'theme', label: settings.darkTheme ? 'Light theme' : 'Dark theme', icon: settings.darkTheme ? 'sun' : 'moon', onSelect: () => st().updateSettings({ darkTheme: !settings.darkTheme }) },
        { id: 'settings', label: 'Settings', icon: 'settings', onSelect: () => st().setSettingsOpen(true) },
    ];
    const addMenu = [
        { kind: 'heading', id: 'h-prim', label: 'Primitives' },
        ...PALETTE_ITEMS.filter((p) => p.section === 'primitives').map((p) => ({ id: p.id, label: p.label, icon: 'cube', onSelect: () => void studio.addFromPalette(p.id) })),
        { kind: 'heading', id: 'h-light', label: 'Lights' },
        ...PALETTE_ITEMS.filter((p) => p.section === 'lights').map((p) => ({ id: p.id, label: p.label, icon: 'lightbulb', onSelect: () => void studio.addFromPalette(p.id) })),
        { kind: 'separator', id: 's-all' },
        { id: 'all', label: 'Asset library…', icon: 'shapes', onSelect: () => st().showLeftView('assets') },
    ];
    const viewMenu = [
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
    const phoneMenu = [
        { id: 'undo', label: 'Undo', icon: 'undo', disabled: !canUndo || playing || agentBusy, onSelect: () => studio.undo() },
        { id: 'redo', label: 'Redo', icon: 'redo', disabled: !canRedo || playing || agentBusy, onSelect: () => studio.redo() },
        { kind: 'separator', id: 'p0' },
        { id: 'share', label: 'Share link', icon: 'share', disabled: playing, onSelect: () => studio.publish.open('share') },
        { id: 'publish-phone', label: 'Publish…', icon: 'rocket', disabled: playing, onSelect: () => studio.publish.open() },
        ...viewMenu.filter((m) => m.kind !== 'heading' && m.id !== 'focus'),
        { kind: 'separator', id: 'p1' },
        ...appMenu,
    ];
    const playButton = (_jsxs("button", { type: "button", className: `btn btn--sm ${playing ? 'btn--stop' : 'btn--primary'} play-btn`, onClick: () => void studio.togglePlay(), disabled: modeBusy || loading !== null, "aria-pressed": playing, "data-tip": playing ? 'Stop and restore' : 'Play the world', "data-kbd": shortcut('Mod+Enter'), children: [_jsx(Icon, { name: playing ? 'stop' : 'play' }), _jsx("span", { className: "btn__label", children: modeBusy ? (playing ? 'Stopping' : 'Starting') : playing ? 'Stop' : 'Play' })] }));
    return (_jsxs("header", { className: "topbar", role: "banner", children: [_jsxs("div", { className: "topbar__zone topbar__zone--start", children: [_jsx(Menu, { label: "Aether menu", items: appMenu, width: 240, trigger: (t) => (_jsxs("button", { ...t, type: "button", className: "app-menu-btn", "aria-label": "Aether menu", "data-tip": "Menu", children: [_jsx(Logomark, { size: 22 }), _jsx(Icon, { name: "chevronDown", className: "app-menu-btn__chev" })] })) }), !phone && (_jsx("button", { type: "button", className: "icon-btn", onClick: () => st().togglePanel('left'), "aria-pressed": panels.left, "aria-label": "Toggle left panel", "data-tip": panels.left ? 'Hide panel' : 'Show panel', "data-kbd": shortcut('Mod+['), children: _jsx(Icon, { name: "panelLeft" }) })), _jsx("span", { className: "topbar__sep", "aria-hidden": "true" }), _jsx(ProjectName, {}), !phone && _jsx(SaveStatus, {})] }), !phone && (_jsxs("div", { className: "topbar__zone topbar__zone--center", children: [playButton, _jsx("span", { className: "topbar__sep", "aria-hidden": "true" }), _jsx("button", { type: "button", className: "icon-btn", disabled: !canUndo || playing || agentBusy, onClick: () => studio.undo(), "aria-label": "Undo", "data-tip": "Undo", "data-kbd": shortcut('Mod+Z'), children: _jsx(Icon, { name: "undo" }) }), _jsx("button", { type: "button", className: "icon-btn", disabled: !canRedo || playing || agentBusy, onClick: () => studio.redo(), "aria-label": "Redo", "data-tip": "Redo", "data-kbd": shortcut('Mod+Shift+Z'), children: _jsx(Icon, { name: "redo" }) }), _jsx("span", { className: "topbar__sep", "aria-hidden": "true" }), _jsx(Menu, { label: "Add object", items: addMenu, width: 220, trigger: (t) => (_jsxs("button", { ...t, type: "button", className: "btn btn--ghost btn--sm", disabled: playing, "data-tip": "Add an object", children: [_jsx(Icon, { name: "plus" }), _jsx("span", { className: "btn__label", children: "Add" })] })) }), _jsx(Menu, { label: "View", items: viewMenu, width: 232, trigger: (t) => (_jsxs("button", { ...t, type: "button", className: "btn btn--ghost btn--sm", "data-tip": "Camera and overlays", children: [_jsx(Icon, { name: "eye" }), _jsx("span", { className: "btn__label", children: "View" })] })) })] })), _jsxs("div", { className: "topbar__zone topbar__zone--end", children: [phone ? (_jsxs(_Fragment, { children: [playButton, _jsx(Menu, { label: "More", align: "end", items: phoneMenu, width: 240, trigger: (t) => (_jsx("button", { ...t, type: "button", className: "icon-btn", "aria-label": "More", children: _jsx(Icon, { name: "more" }) })) })] })) : (_jsxs(_Fragment, { children: [_jsx(SignInChip, {}), memory.lowMemory && (_jsx("button", { type: "button", className: "chip chip--quiet hide-tablet", onClick: () => st().setSettingsOpen(true), "data-tip": memory.reason ?? 'Low memory mode', children: "Low memory" })), backend && (_jsx("span", { className: "chip chip--quiet hide-tablet", "data-tip": backend === 'webgpu' ? 'Rendering with WebGPU' : 'Rendering with WebGL2', children: backend === 'webgpu' ? 'WebGPU' : 'WebGL2' })), _jsx("button", { type: "button", className: "icon-btn hide-tablet", onClick: () => st().updateSettings({ showPerf: !settings.showPerf }), "aria-pressed": settings.showPerf, "aria-label": "Performance overlay", "data-tip": "Performance overlay", "data-kbd": shortcut('Shift+P'), children: _jsx(Icon, { name: "activity" }) }), _jsx("button", { type: "button", className: "icon-btn", onClick: () => st().setPaletteOpen(true), "aria-label": "Command palette", "data-tip": "Command palette", "data-kbd": shortcut('Mod+K'), children: _jsx(Icon, { name: "command" }) }), _jsxs("button", { type: "button", className: "btn btn--sm hide-tablet", onClick: () => studio.publish.open('share'), disabled: playing, "data-tip": "Copy a link that plays this world \u2014 no upload", children: [_jsx(Icon, { name: "share" }), _jsx("span", { className: "btn__label", children: "Share" })] }), _jsxs("button", { type: "button", className: "btn btn--sm btn--primary", onClick: () => studio.publish.open(), disabled: playing, "data-tip": "Game, video, render, 3D model, floor plan or link", "data-testid": "topbar-publish", children: [_jsx(Icon, { name: "rocket" }), _jsx("span", { className: "btn__label", children: "Publish" })] }), _jsx("button", { type: "button", className: "icon-btn", onClick: () => st().togglePanel('right'), "aria-pressed": panels.right, "aria-label": "Toggle inspector", "data-tip": panels.right ? 'Hide inspector' : 'Show inspector', "data-kbd": shortcut('Mod+]'), "data-tip-align": "end", children: _jsx(Icon, { name: "panelRight" }) })] })), _jsx("input", { ref: fileRef, type: "file", accept: "application/json,.json,.zip,application/zip", hidden: true, onChange: onFile })] })] }));
});
