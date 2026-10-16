import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Keyboard shortcuts overlay ("?"): every shortcut, grouped, in a modal
 * dialog. Opened from anywhere with "?" (outside text fields), from the
 * command palette and the menus. One page-wide open flag.
 */
import { memo } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { shortcut } from '../lib/keys';
import { Dialog } from './ui/Dialog';
/** The shortcut reference, grouped (also the source of the flat `SHORTCUTS` list). */
export const SHORTCUT_GROUPS = Object.freeze([
    {
        title: 'General',
        items: [
            [shortcut('Mod+K'), 'Command palette'],
            ['?', 'Keyboard shortcuts'],
            ['/', 'Write a prompt'],
            [shortcut('Mod+Enter'), 'Play / stop'],
            [shortcut('Mod+Z'), 'Undo'],
            [shortcut('Mod+Shift+Z'), 'Redo'],
            ['Esc', 'Stop play / leave mesh editing / deselect'],
        ],
    },
    {
        title: 'Edit',
        items: [
            ['A', 'Add an object'],
            [`${shortcut('Mod+D')} · ${shortcut('Mod+C')} · ${shortcut('Mod+V')}`, 'Duplicate · copy · paste'],
            [`${shortcut('Mod+G')} · ${shortcut('Mod+Shift+G')}`, 'Group · ungroup'],
            [shortcut('Mod+A'), 'Select all'],
            ['H · Alt+H', 'Hide selection · show all'],
            [shortcut('Shift+L'), 'Lock / unlock selection'],
            ['Tab', 'Edit mesh (vertices · edges · faces: 1 · 2 · 3)'],
            ['Delete', 'Delete selection'],
        ],
    },
    {
        title: 'Tools',
        items: [
            ['V · B', 'Select · box select'],
            ['W · E · R', 'Move · rotate · scale'],
            ['S · P · T', 'Sculpt · paint · scatter brushes'],
            ['[ / ]', 'Brush size (Shift: strength)'],
            [shortcut('Shift+S'), 'Toggle snapping (hold Ctrl while dragging to invert)'],
        ],
    },
    {
        title: 'View',
        items: [
            ['F', 'Focus selection'],
            ['0 – 4', 'Frame world / 3D / top / front / side view'],
            ['L', 'Object labels'],
            [shortcut('Shift+P'), 'Performance overlay'],
            ['Alt+1 – 6', 'Agent, Objects, Assets, Logic, Checks, History'],
            [shortcut('Mod+[') + ' / ]', 'Toggle left panel / inspector'],
        ],
    },
    {
        title: 'Play',
        items: [
            ['WASD · Space · E', 'Move · jump · act'],
            ['Mouse · 1–9 · E · V', 'Block worlds: break / place · hotbar · inventory · view'],
        ],
    },
]);
/** Page-wide open flag. */
export const shortcutsStore = createStore()(() => ({ open: false }));
/** Open or close the overlay. */
export function setShortcutsOpen(open) {
    shortcutsStore.setState({ open });
}
/** True for the "?" key press that opens the overlay (Shift+/ on most layouts). Pure. */
export function isHelpKey(e) {
    return e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey;
}
/** The overlay (mount once per page). */
export const ShortcutsDialog = memo(function ShortcutsDialog() {
    const open = useStore(shortcutsStore, (s) => s.open);
    return (_jsx(Dialog, { open: open, onClose: () => setShortcutsOpen(false), title: "Keyboard shortcuts", size: "lg", className: "shortcuts", children: _jsx("div", { className: "shortcuts__grid", children: SHORTCUT_GROUPS.map((g) => (_jsxs("section", { className: "shortcuts__group", "aria-labelledby": `sc-${g.title}`, children: [_jsx("h3", { id: `sc-${g.title}`, className: "shortcuts__title", children: g.title }), _jsx("dl", { className: "shortcut-list", children: g.items.map(([keys, what]) => (_jsxs("div", { className: "shortcut-list__row", children: [_jsx("dt", { children: what }), _jsx("dd", { children: _jsx("kbd", { children: keys }) })] }, keys + what))) })] }, g.title))) }) }));
});
