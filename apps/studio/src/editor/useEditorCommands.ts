/** Command palette entries for the editor: actions, views, camera, assets, objects, templates and projects. */
import { useMemo } from 'react';
import { useStudio, useUI, useWorld } from '../app/context';
import { useApp } from '../app/appContext';
import type { Command } from '../components/ui/CommandPalette';
import type { IconName } from '../components/Icon';
import { TEMPLATES } from '../lib/examples';
import { shortcut } from '../lib/keys';
import { PALETTE_ITEMS } from '../lib/palette';
import { formatRelative } from '../lib/relativeTime';
import type { ProjectMeta } from '../projects/model';
import { useEditor } from './editorContext';
import { LEFT_VIEWS } from './IconRail';
import { setShortcutsOpen } from '../components/ShortcutsDialog';
import { startTour } from '../onboarding/tour';

const MAX_ENTITY_COMMANDS = 400;

/** Commands for the editor's palette. */
export function useEditorCommands(projects: readonly ProjectMeta[]): Command[] {
  const studio = useStudio();
  const editor = useEditor();
  const { navigate } = useApp();
  const world = useWorld();
  const settings = useUI((s) => s.settings);
  const mode = useUI((s) => s.mode);
  const selection = useUI((s) => s.selection);
  return useMemo(() => {
    const st = (): ReturnType<typeof studio.store.getState> => studio.store.getState();
    const playing = mode === 'play';
    const out: Command[] = [
      { id: 'play', title: playing ? 'Stop' : 'Play', group: 'Actions', icon: playing ? 'stop' : 'play', shortcut: shortcut('Mod+Enter'), run: () => void studio.togglePlay() },
      { id: 'prompt', title: 'Write a prompt', group: 'Actions', icon: 'sparkles', shortcut: '/', run: () => {
        st().showLeftView('agent');
        requestAnimationFrame(() => document.getElementById('prompt-input')?.focus());
      } },
      { id: 'hardcore', title: 'Hardcore mode: refine to match reference pictures', group: 'Actions', icon: 'sparkles', keywords: 'references look development art bible beautiful passes', run: () => void studio.hardcoreMode() },
      { id: 'undo', title: 'Undo', group: 'Actions', icon: 'undo', shortcut: shortcut('Mod+Z'), run: () => studio.undo() },
      { id: 'redo', title: 'Redo', group: 'Actions', icon: 'redo', shortcut: shortcut('Mod+Shift+Z'), run: () => studio.redo() },
      { id: 'checks', title: 'Run physics checks', group: 'Actions', icon: 'shield', run: () => {
        st().showLeftView('verify');
        void studio.runVerify();
      } },
      { id: 'share', title: 'Share link', group: 'Publish', icon: 'share', run: () => studio.publish.open('share') },
      { id: 'share-remix', title: 'Copy remix link (read-only viewer)', group: 'Publish', icon: 'share', keywords: 'share view remix', run: () => void studio.share() },
      { id: 'publish-game', title: 'Publish as a game', group: 'Publish', icon: 'gamepad', run: () => studio.publish.open('game') },
      { id: 'publish-video', title: 'Make a video (camera path)', group: 'Publish', icon: 'film', run: () => studio.publish.open('video') },
      { id: 'publish-render', title: 'Render a still (up to 4K)', group: 'Publish', icon: 'image', run: () => studio.publish.open('render') },
      { id: 'publish-model', title: 'Export 3D model (glTF / GLB)', group: 'Publish', icon: 'box3d', run: () => studio.publish.open('model') },
      { id: 'publish-plan', title: 'Export floor plan (SVG / PDF)', group: 'Publish', icon: 'plan', run: () => studio.publish.open('plan') },
      { id: 'publish-history', title: 'Versions and publish history', group: 'Publish', icon: 'history', run: () => studio.publish.open('history') },
      { id: 'export', title: 'Export .aether.json', group: 'Actions', icon: 'download', run: () => studio.exportToFile() },
      { id: 'export-gltf', title: 'Quick export 3D model (.glb)', group: 'Actions', icon: 'cube', keywords: 'gltf glb model download', run: () => void studio.exportGltf() },
      ...(selection.length > 0
        ? [
            { id: 'focus', title: 'Focus selection', group: 'Actions', icon: 'focus' as IconName, shortcut: 'F', run: () => selection[0] && studio.focus(selection[0]) },
            { id: 'delete', title: 'Delete selection', group: 'Actions', icon: 'trash' as IconName, shortcut: 'Del', run: () => studio.deleteEntities(selection) },
          ]
        : []),
      ...LEFT_VIEWS.map((v, i) => ({ id: `view-${v.id}`, title: `Show ${v.label}`, group: 'Panels', icon: v.icon, shortcut: `Alt+${i + 1}`, run: () => st().showLeftView(v.id) })),
      { id: 'inspector', title: 'Show inspector', group: 'Panels', icon: 'sliders', run: () => st().showInspector() },
      { id: 'tool-select', title: 'Select tool', group: 'Tools', icon: 'pointer', shortcut: 'V', run: () => st().setTool('select') },
      { id: 'tool-move', title: 'Move tool', group: 'Tools', icon: 'move', shortcut: 'W', run: () => st().setTool('move') },
      { id: 'tool-rotate', title: 'Rotate tool', group: 'Tools', icon: 'rotate', shortcut: 'E', run: () => st().setTool('rotate') },
      { id: 'tool-scale', title: 'Scale tool', group: 'Tools', icon: 'scale', shortcut: 'R', run: () => st().setTool('scale') },
      { id: 'cam-reset', title: 'Frame world', group: 'Camera', icon: 'maximize', shortcut: '0', run: () => studio.viewPreset('reset') },
      { id: 'cam-iso', title: '3D view', group: 'Camera', icon: 'box3d', shortcut: '1', run: () => studio.viewPreset('iso') },
      { id: 'cam-top', title: 'Top view', group: 'Camera', icon: 'viewTop', shortcut: '2', run: () => studio.viewPreset('top') },
      { id: 'cam-front', title: 'Front view', group: 'Camera', icon: 'square', shortcut: '3', run: () => studio.viewPreset('front') },
      { id: 'cam-side', title: 'Side view', group: 'Camera', icon: 'square', shortcut: '4', run: () => studio.viewPreset('side') },
      { id: 'labels', title: settings.showLabels ? 'Hide object labels' : 'Show object labels', group: 'View', icon: 'tag', shortcut: 'L', run: () => st().updateSettings({ showLabels: !settings.showLabels }) },
      { id: 'perf', title: settings.showPerf ? 'Hide performance overlay' : 'Show performance overlay', group: 'View', icon: 'activity', shortcut: shortcut('Shift+P'), run: () => st().updateSettings({ showPerf: !settings.showPerf }) },
      { id: 'colliders', title: settings.showColliders ? 'Hide colliders' : 'Show colliders', group: 'View', icon: 'physics', run: () => st().updateSettings({ showColliders: !settings.showColliders }) },
      { id: 'theme', title: settings.darkTheme ? 'Switch to light theme' : 'Switch to dark theme', group: 'View', icon: settings.darkTheme ? 'sun' : 'moon', run: () => st().updateSettings({ darkTheme: !settings.darkTheme }) },
      { id: 'settings', title: 'Settings', group: 'View', icon: 'settings', run: () => st().setSettingsOpen(true) },
      { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Help', icon: 'keyboard', shortcut: '?', run: () => setShortcutsOpen(true) },
      { id: 'tour', title: 'Take the quick tour', group: 'Help', icon: 'sparkles', run: () => startTour() },
      ...(editor
        ? [
            { id: 'home', title: 'Back to projects', group: 'Projects', icon: 'arrowLeft' as IconName, run: () => void editor.leave() },
            { id: 'new', title: 'New project…', group: 'Projects', icon: 'plus' as IconName, run: () => void editor.newProject() },
            { id: 'dup', title: 'Duplicate project', group: 'Projects', icon: 'copy' as IconName, run: () => void editor.duplicate() },
          ]
        : []),
      ...projects
        .filter((p) => p.id !== editor?.projectId)
        .slice(0, 20)
        .map((p) => ({ id: `proj-${p.id}`, title: `Open ${p.name}`, group: 'Projects', icon: 'folder' as IconName, hint: formatRelative(p.updatedAt), run: () => navigate({ name: 'editor', id: p.id }) })),
      ...PALETTE_ITEMS.map((p) => ({ id: `add-${p.id}`, title: `Add ${p.label.toLowerCase()}`, group: 'Add', icon: 'plus' as IconName, keywords: p.keywords, run: () => void studio.addFromPalette(p.id) })),
      ...TEMPLATES.filter((t) => t.origin !== 'photo').map((t) => ({ id: `tpl-${t.slug}`, title: `Build ${t.title.toLowerCase()}`, group: 'Templates', icon: 'template' as IconName, keywords: t.description, run: () => void studio.send(t.prompt, { offline: true }) })),
    ];
    const ids = Object.keys(world.entities).slice(0, MAX_ENTITY_COMMANDS);
    for (const id of ids) {
      const e = world.entities[id];
      if (!e || e.template) continue;
      out.push({ id: `ent-${id}`, title: e.name || id, group: 'Objects', icon: 'cube', keywords: `${id} ${e.tags.join(' ')}`, hint: id, run: () => {
        studio.pick(id);
        studio.focus(id);
        st().showInspector();
      } });
    }
    return out;
  }, [studio, editor, navigate, world, settings, mode, selection, projects]);
}
