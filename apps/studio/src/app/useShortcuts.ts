/**
 * Global editor keyboard shortcuts. Keys typed into text fields are left
 * alone (except Escape). In play mode only Stop/Escape apply — everything
 * else is game input.
 */
import { useEffect } from 'react';
import { isTypingTarget } from '../engine/input';
import { shortcut } from '../lib/keys';
import type { LeftView } from '../state/store';
import { useStudio } from './context';

const VIEW_KEYS: Readonly<Record<string, LeftView>> = { '1': 'agent', '2': 'objects', '3': 'assets', '4': 'logic', '5': 'verify', '6': 'history' };
const CAMERA_KEYS: Readonly<Record<string, 'reset' | 'iso' | 'top' | 'front' | 'side'>> = { '0': 'reset', '1': 'iso', '2': 'top', '3': 'front', '4': 'side' };

/** Shortcut reference shown in Settings and the docs: [keys, action]. */
export const SHORTCUTS: ReadonlyArray<[string, string]> = [
  [shortcut('Mod+K'), 'Command palette'],
  [shortcut('Mod+Enter'), 'Play / stop'],
  [shortcut('Mod+Z'), 'Undo'],
  [shortcut('Mod+Shift+Z'), 'Redo'],
  ['/', 'Write a prompt'],
  ['A', 'Add an object'],
  ['F', 'Focus selection'],
  ['Delete', 'Delete selection'],
  ['Esc', 'Stop play / deselect'],
  ['0 – 4', 'Frame world / 3D / top / front / side view'],
  ['L', 'Object labels'],
  [shortcut('Shift+P'), 'Performance overlay'],
  ['Alt+1 – 6', 'Agent, Objects, Assets, Logic, Checks, History'],
  [shortcut('Mod+[') + ' / ]', 'Toggle left panel / inspector'],
  ['WASD · Space · E', 'Move · jump · act (play)'],
];

/** Install the global shortcut handler. */
export function useShortcuts(): void {
  const studio = useStudio();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = studio.store.getState();
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        st.setPaletteOpen(!st.paletteOpen);
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        void studio.togglePlay();
        return;
      }
      if (e.key === 'Escape') {
        if (st.paletteOpen || st.settingsOpen || document.querySelector('dialog[open]')) return;
        if (st.mode === 'play') void studio.togglePlay();
        else if (st.agentBusy && typing) studio.stopAgent();
        else if (typing && e.target instanceof HTMLElement) e.target.blur();
        else st.select([]);
        return;
      }
      if (st.mode === 'play' || typing || st.paletteOpen) return;
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
      if (e.altKey && !mod) {
        const digit = e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
        if (Object.prototype.hasOwnProperty.call(VIEW_KEYS, digit)) {
          e.preventDefault();
          st.showLeftView(VIEW_KEYS[digit] as LeftView);
        }
        return;
      }
      if (mod) return;
      if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        st.updateSettings({ showPerf: !st.settings.showPerf });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selection.length > 0) {
          e.preventDefault();
          studio.deleteEntities(st.selection);
        }
      } else if (e.key === 'f' || e.key === 'F') {
        const id = st.selection[0];
        if (id) studio.focus(id);
      } else if (e.key === 'l' || e.key === 'L') {
        st.updateSettings({ showLabels: !st.settings.showLabels });
      } else if (e.key === 'a' || e.key === 'A') {
        st.showLeftView('assets');
      } else if (!e.shiftKey && Object.prototype.hasOwnProperty.call(CAMERA_KEYS, e.key)) {
        studio.viewPreset(CAMERA_KEYS[e.key] as 'reset');
      } else if (e.key === '/') {
        e.preventDefault();
        st.showLeftView('agent');
        requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [studio]);
}
