/**
 * Global editor keyboard shortcuts. Keys typed into text fields are left
 * alone (except Escape). In play mode only Stop/Escape apply — everything
 * else is game input. Copy / cut / paste use the DOM clipboard events, which
 * work in every browser without clipboard permissions.
 */
import { useEffect } from 'react';
import { isTypingTarget } from '../engine/input';
import { shortcut } from '../lib/keys';
import type { LeftView } from '../state/store';
import type { EditorTool } from '../engine/Simulation';
import { useStudio } from './context';

const VIEW_KEYS: Readonly<Record<string, LeftView>> = { '1': 'agent', '2': 'objects', '3': 'assets', '4': 'logic', '5': 'verify', '6': 'history' };
const TOOL_KEYS: Readonly<Record<string, EditorTool>> = { v: 'select', b: 'box', w: 'move', e: 'rotate', r: 'scale', s: 'sculpt', p: 'paint', t: 'scatter' };
const CAMERA_KEYS: Readonly<Record<string, 'reset' | 'iso' | 'top' | 'front' | 'side'>> = { '0': 'reset', '1': 'iso', '2': 'top', '3': 'front', '4': 'side' };
const COMPONENT_KEYS: Readonly<Record<string, 'vertex' | 'edge' | 'face'>> = { '1': 'vertex', '2': 'edge', '3': 'face' };

/** Shortcut reference shown in Settings and the docs: [keys, action]. */
export const SHORTCUTS: ReadonlyArray<[string, string]> = [
  [shortcut('Mod+K'), 'Command palette'],
  [shortcut('Mod+Enter'), 'Play / stop'],
  [shortcut('Mod+Z'), 'Undo'],
  [shortcut('Mod+Shift+Z'), 'Redo'],
  ['/', 'Write a prompt'],
  ['A', 'Add an object'],
  ['V · B', 'Select · box select'],
  ['W · E · R', 'Move · rotate · scale'],
  ['S · P · T', 'Sculpt · paint · scatter brushes'],
  ['[ / ]', 'Brush size (Shift: strength)'],
  [shortcut('Shift+S'), 'Toggle snapping (hold Ctrl while dragging to invert)'],
  [`${shortcut('Mod+D')} · ${shortcut('Mod+C')} · ${shortcut('Mod+V')}`, 'Duplicate · copy · paste'],
  [`${shortcut('Mod+G')} · ${shortcut('Mod+Shift+G')}`, 'Group · ungroup'],
  [shortcut('Mod+A'), 'Select all'],
  ['H · Alt+H', 'Hide selection · show all'],
  [shortcut('Shift+L'), 'Lock / unlock selection'],
  ['Tab', 'Edit mesh (vertices · edges · faces: 1 · 2 · 3)'],
  ['F', 'Focus selection'],
  ['Delete', 'Delete selection'],
  ['Esc', 'Stop play / leave mesh editing / deselect'],
  ['0 – 4', 'Frame world / 3D / top / front / side view'],
  ['L', 'Object labels'],
  [shortcut('Shift+P'), 'Performance overlay'],
  ['Alt+1 – 6', 'Agent, Objects, Assets, Logic, Checks, History'],
  [shortcut('Mod+[') + ' / ]', 'Toggle left panel / inspector'],
  ['WASD · Space · E', 'Move · jump · act (play)'],
  ['Mouse · 1–9 · E · V', 'Block worlds: break / place · hotbar · inventory · view'],
];

/** Install the global shortcut handler. */
export function useShortcuts(): void {
  const studio = useStudio();
  useEffect(() => {
    const editor = studio.editor;
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
        if (st.mode === 'play' && st.voxelHud?.inventoryOpen) studio.simulation?.voxel.game?.setInventoryOpen(false);
        else if (st.mode === 'play') void studio.togglePlay();
        else if (st.agentBusy && typing) studio.stopAgent();
        else if (typing && e.target instanceof HTMLElement) e.target.blur();
        else if (st.materialPick) editor.armEyedropper(false);
        else if (st.meshEdit) editor.mesh.exit();
        else if (st.tool !== 'select' && st.tool !== 'move' && st.tool !== 'rotate' && st.tool !== 'scale') st.setTool('select');
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
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        editor.duplicate();
        return;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) editor.ungroup();
        else editor.group();
        return;
      }
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (st.meshEdit) editor.mesh.selectAll();
        else editor.selectAll();
        return;
      }
      if (e.key === 'Tab' && !mod && !e.altKey) {
        // Tab toggles mesh editing only when an object is selected (otherwise keep focus navigation).
        if (st.meshEdit || st.selection.length > 0) {
          e.preventDefault();
          void editor.toggleMeshEdit();
        }
        return;
      }
      if (e.altKey && !mod) {
        if (e.code === 'KeyH') {
          e.preventDefault();
          editor.unhideAll();
          return;
        }
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
      if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        st.setGizmoSettings({ snap: !st.gizmo.snap });
        return;
      }
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        editor.toggleLocked();
        return;
      }
      if (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') {
        const up = e.key === ']' || e.key === '}';
        const b = st.brush;
        if (e.shiftKey) st.setBrush({ strength: Math.round((b.strength + (up ? 0.1 : -0.1)) * 100) / 100 });
        else st.setBrush({ size: Math.round(b.size * (up ? 1.2 : 1 / 1.2) * 100) / 100 });
        return;
      }
      if (st.meshEdit && !e.shiftKey && Object.prototype.hasOwnProperty.call(COMPONENT_KEYS, e.key)) {
        editor.mesh.setMode(COMPONENT_KEYS[e.key] as 'vertex');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.meshEdit) {
          e.preventDefault();
          void editor.mesh.run({ kind: 'delete' }).then((err) => err && studio.store.getState().toast(err, 'info', 3));
        } else if (st.selection.length > 0) {
          e.preventDefault();
          editor.deleteSelection();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        const id = st.selection[0];
        if (id) studio.focus(id);
      } else if (e.key === 'h' || e.key === 'H') {
        editor.toggleHidden();
      } else if (e.key === 'l' || e.key === 'L') {
        st.updateSettings({ showLabels: !st.settings.showLabels });
      } else if ((e.key === 'a' || e.key === 'A') && !e.shiftKey) {
        st.showLeftView('assets');
      } else if (!e.shiftKey && Object.prototype.hasOwnProperty.call(TOOL_KEYS, e.key.toLowerCase())) {
        st.setTool(TOOL_KEYS[e.key.toLowerCase()] as EditorTool);
      } else if (!e.shiftKey && !st.meshEdit && Object.prototype.hasOwnProperty.call(CAMERA_KEYS, e.key)) {
        studio.viewPreset(CAMERA_KEYS[e.key] as 'reset');
      } else if (e.key === '/') {
        e.preventDefault();
        st.showLeftView('agent');
        requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
      }
    };
    const editable = (e: ClipboardEvent): boolean => {
      const st = studio.store.getState();
      return st.mode === 'edit' && !st.paletteOpen && !isTypingTarget(e.target) && !isTypingTarget(document.activeElement);
    };
    const onCopy = (e: ClipboardEvent): void => {
      if (!editable(e) || studio.store.getState().selection.length === 0) return;
      e.preventDefault();
      editor.copy();
      const text = (() => {
        try {
          return window.localStorage.getItem('aether.clipboard.v1');
        } catch {
          return null;
        }
      })();
      if (text) e.clipboardData?.setData('text/plain', text);
    };
    const onCut = (e: ClipboardEvent): void => {
      if (!editable(e) || studio.store.getState().selection.length === 0) return;
      onCopy(e);
      editor.deleteSelection();
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (!editable(e)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text && !text.includes('aether/entities')) return;
      e.preventDefault();
      editor.paste(text || undefined);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [studio]);
}
