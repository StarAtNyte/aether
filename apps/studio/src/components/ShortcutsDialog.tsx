/**
 * Keyboard shortcuts overlay ("?"): every shortcut, grouped, in a modal
 * dialog. Opened from anywhere with "?" (outside text fields), from the
 * command palette and the menus. One page-wide open flag.
 */
import { memo, type ReactElement } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { shortcut } from '../lib/keys';
import { Dialog } from './ui/Dialog';

/** A group of shortcuts: [keys, action][]. */
export interface ShortcutGroup {
  title: string;
  items: ReadonlyArray<readonly [string, string]>;
}

/** The shortcut reference, grouped (also the source of the flat `SHORTCUTS` list). */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = Object.freeze([
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
      ['0 – 4', 'Opening / 3D / top / front / side view'],
      ['O', 'Overview of the whole world (again: back)'],
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
      ['Shift · C', 'Sprint (hold) · crouch (toggle)'],
      ['Mouse · 1–9 · E · V', 'Block worlds: break / place · hotbar · inventory · view'],
    ],
  },
]);

interface ShortcutsState {
  open: boolean;
}

/** Page-wide open flag. */
export const shortcutsStore = createStore<ShortcutsState>()(() => ({ open: false }));

/** Open or close the overlay. */
export function setShortcutsOpen(open: boolean): void {
  shortcutsStore.setState({ open });
}

/** True for the "?" key press that opens the overlay (Shift+/ on most layouts). Pure. */
export function isHelpKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** The overlay (mount once per page). */
export const ShortcutsDialog = memo(function ShortcutsDialog(): ReactElement {
  const open = useStore(shortcutsStore, (s) => s.open);
  return (
    <Dialog open={open} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" size="lg" className="shortcuts">
      <div className="shortcuts__grid">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title} className="shortcuts__group" aria-labelledby={`sc-${g.title}`}>
            <h3 id={`sc-${g.title}`} className="shortcuts__title">
              {g.title}
            </h3>
            <dl className="shortcut-list">
              {g.items.map(([keys, what]) => (
                <div key={keys + what} className="shortcut-list__row">
                  <dt>{what}</dt>
                  <dd>
                    <kbd>{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
});
