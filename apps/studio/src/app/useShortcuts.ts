/**
 * Global keyboard shortcuts. Keys typed into text fields are left alone
 * (except Escape). In play mode only Stop/Escape apply — everything else is
 * game input.
 */
import { useEffect } from 'react';
import { isTypingTarget } from '../engine/input';
import type { RightTab } from '../state/store';
import { useStudio } from './context';

const TAB_KEYS: Readonly<Record<string, RightTab>> = { '1': 'outliner', '2': 'inspector', '3': 'logic', '4': 'verify', '5': 'history' };

/** Shortcut reference shown in the settings dialog. */
export const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['Ctrl/⌘ + Enter', 'Play / Stop'],
  ['Ctrl/⌘ + Z', 'Undo'],
  ['Ctrl/⌘ + Shift + Z', 'Redo'],
  ['F', 'Focus selection'],
  ['Delete', 'Delete selection'],
  ['Esc', 'Stop play / clear selection'],
  ['/', 'Focus the prompt box'],
  ['Alt + 1…5', 'Switch inspector tab'],
  ['Ctrl/⌘ + [ / ]', 'Toggle chat / inspector panel'],
  ['WASD · Arrows · Space · E', 'Move · turn · jump · act (play)'],
];

/** Install the global shortcut handler. */
export function useShortcuts(): void {
  const studio = useStudio();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = studio.store.getState();
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        void studio.togglePlay();
        return;
      }
      if (e.key === 'Escape') {
        if (st.settingsOpen) st.setSettingsOpen(false);
        else if (st.mode === 'play') void studio.togglePlay();
        else if (typing && e.target instanceof HTMLElement) e.target.blur();
        else st.select([]);
        return;
      }
      if (st.mode === 'play' || typing) return;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) studio.redo();
        else studio.undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        studio.redo();
        return;
      }
      if (mod && e.key === '[') {
        e.preventDefault();
        st.togglePanel('left');
        return;
      }
      if (mod && e.key === ']') {
        e.preventDefault();
        st.togglePanel('right');
        return;
      }
      if (e.altKey && Object.prototype.hasOwnProperty.call(TAB_KEYS, e.key)) {
        e.preventDefault();
        if (!st.panels.right) st.togglePanel('right');
        st.setRightTab(TAB_KEYS[e.key] as RightTab);
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selection.length > 0) {
          e.preventDefault();
          studio.deleteEntities(st.selection);
        }
      } else if (e.key === 'f' || e.key === 'F') {
        const id = st.selection[0];
        if (id) studio.focus(id);
      } else if (e.key === '/') {
        const input = document.getElementById('prompt-input');
        if (input) {
          e.preventDefault();
          if (!st.panels.left) st.togglePanel('left');
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studio]);
}
