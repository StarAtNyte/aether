/**
 * Floating tool dock (bottom-centre of the viewport, edit mode): selection
 * and box selection, move / rotate / scale, the sculpt / paint / scatter
 * brushes, snapping (with a settings popover), add, focus, delete, frame
 * and labels. Every control has a tooltip with its shortcut.
 */
import { memo, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon, type IconName } from '../Icon';
import type { EditorTool } from '../../engine/Simulation';
import { Popover } from '../ui/Popover';
import { Segmented } from '../ui/Segmented';
import { NumberField, Toggle } from '../fields';
import { shortcut } from '../../lib/keys';

/** Tools shown in the dock: id, label, icon, shortcut, tooltip. */
export const DOCK_TOOLS: ReadonlyArray<{ id: EditorTool; label: string; icon: IconName; key: string; tip: string }> = [
  { id: 'select', label: 'Select', icon: 'pointer', key: 'V', tip: 'Select' },
  { id: 'box', label: 'Box select', icon: 'marquee', key: 'B', tip: 'Box select (drag a rectangle)' },
  { id: 'move', label: 'Move', icon: 'move', key: 'W', tip: 'Move the selection' },
  { id: 'rotate', label: 'Rotate', icon: 'rotate', key: 'E', tip: 'Rotate the selection' },
  { id: 'scale', label: 'Scale', icon: 'scale', key: 'R', tip: 'Scale the selection' },
];

/** Brush tools. */
export const BRUSH_TOOLS: ReadonlyArray<{ id: EditorTool; label: string; icon: IconName; key: string; tip: string }> = [
  { id: 'sculpt', label: 'Sculpt', icon: 'sculpt', key: 'S', tip: 'Sculpt terrain and meshes' },
  { id: 'paint', label: 'Paint', icon: 'brush', key: 'P', tip: 'Paint vertex colours' },
  { id: 'scatter', label: 'Scatter', icon: 'sprout', key: 'T', tip: 'Paint trees, grass and rocks' },
];

/** Snapping toggle + settings (grid, angle, scale step, surface / vertex snap, space and pivot). */
const SnapControl = memo(function SnapControl(): ReactElement {
  const studio = useStudio();
  const g = useUI((s) => s.gizmo);
  const set = studio.store.getState().setGizmoSettings;
  const active = g.snap || g.surface || g.vertex;
  return (
    <div className="dock__group" role="group" aria-label="Snapping">
      <button
        type="button"
        className={`dock__btn${active ? ' is-active' : ''}`}
        aria-pressed={g.snap}
        aria-label="Snap to grid"
        data-tip={g.snap ? 'Snapping on (hold Ctrl to bypass)' : 'Snapping off (hold Ctrl to snap)'}
        data-kbd={shortcut('Shift+S')}
        data-tip-pos="top"
        onClick={() => set({ snap: !g.snap })}
      >
        <Icon name="magnet" />
      </button>
      <Popover
        label="Transform options"
        trigger={(t) => (
          <button {...t} type="button" className="dock__btn dock__btn--narrow" aria-label="Transform options" data-tip="Snapping, space and pivot" data-tip-pos="top">
            <Icon name="chevronUp" size={14} />
          </button>
        )}
      >
        <div className="popover__body">
          <h3 className="popover__title">Snapping</h3>
          <Toggle label="Grid, angle and scale" checked={g.snap} onChange={(v) => set({ snap: v })} />
          <div className="popover__grid">
            <label className="popover__field">
              <span>Grid (m)</span>
              <NumberField label="Grid size" value={g.grid} min={0.01} max={100} step={0.25} onCommit={(n) => set({ grid: n })} />
            </label>
            <label className="popover__field">
              <span>Angle (°)</span>
              <NumberField label="Angle step" value={g.angle} min={1} max={90} step={5} onCommit={(n) => set({ angle: n })} />
            </label>
            <label className="popover__field">
              <span>Scale</span>
              <NumberField label="Scale step" value={g.scaleStep} min={0.01} max={10} step={0.05} onCommit={(n) => set({ scaleStep: n })} />
            </label>
          </div>
          <Toggle label="Snap to surfaces" hint="Moved objects rest on what is under the pointer" checked={g.surface} onChange={(v) => set({ surface: v, vertex: v ? false : g.vertex })} />
          <Toggle label="Snap to vertices" hint="The pivot jumps to the nearest vertex" checked={g.vertex} onChange={(v) => set({ vertex: v, surface: v ? false : g.surface })} />
          <h3 className="popover__title">Gizmo</h3>
          <div className="popover__row">
            <span>Space</span>
            <Segmented<'world' | 'local'> label="Gizmo space" size="sm" value={g.space} onChange={(v) => set({ space: v })} options={[['world', 'World'], ['local', 'Local']]} />
          </div>
          <div className="popover__row">
            <span>Pivot</span>
            <Segmented<'center' | 'origin' | 'individual'>
              label="Pivot"
              size="sm"
              value={g.pivot}
              onChange={(v) => set({ pivot: v })}
              options={[['center', 'Centre'], ['origin', 'Active'], ['individual', 'Each']]}
              titles={{ center: 'Selection centre', origin: 'Active object origin', individual: 'Each object about its own origin' }}
            />
          </div>
        </div>
      </Popover>
    </div>
  );
});

/** The dock. */
export const ToolDock = memo(function ToolDock(): ReactElement {
  const studio = useStudio();
  const selection = useUI((s) => s.selection);
  const tool = useUI((s) => s.tool);
  const labels = useUI((s) => s.settings.showLabels);
  const meshEdit = useUI((s) => s.meshEdit !== null);
  const st = studio.store.getState();
  const has = selection.length > 0;
  const toolButton = (t: { id: EditorTool; label: string; icon: IconName; key: string; tip: string }): ReactElement => (
    <button
      key={t.id}
      type="button"
      role="radio"
      aria-checked={tool === t.id}
      className={`dock__btn${tool === t.id ? ' is-active' : ''}`}
      onClick={() => st.setTool(t.id)}
      aria-label={t.label}
      data-tip={t.tip}
      data-kbd={t.key}
      data-tip-pos="top"
      data-testid={`tool-${t.id}`}
    >
      <Icon name={t.icon} />
    </button>
  );
  return (
    <div className="dock" role="toolbar" aria-label="Tools">
      <div className="dock__group" role="radiogroup" aria-label="Tool">
        {DOCK_TOOLS.map(toolButton)}
      </div>
      <span className="dock__sep" aria-hidden="true" />
      <div className="dock__group" role="radiogroup" aria-label="Brushes">
        {BRUSH_TOOLS.map(toolButton)}
      </div>
      <span className="dock__sep" aria-hidden="true" />
      <SnapControl />
      <span className="dock__sep" aria-hidden="true" />
      <button
        type="button"
        className={`dock__btn${meshEdit ? ' is-active' : ''}`}
        disabled={!has && !meshEdit}
        aria-pressed={meshEdit}
        onClick={() => void studio.editor.toggleMeshEdit()}
        aria-label="Edit mesh"
        data-tip={meshEdit ? 'Finish mesh editing' : 'Edit mesh (vertices, edges, faces)'}
        data-kbd="Tab"
        data-tip-pos="top"
        data-testid="edit-mesh"
      >
        <Icon name="mesh" />
      </button>
      <button type="button" className="dock__btn dock__opt" onClick={() => st.showLeftView('assets')} aria-label="Add object" data-tip="Add object" data-kbd="A" data-tip-pos="top">
        <Icon name="plus" />
      </button>
      <button type="button" className="dock__btn dock__opt" disabled={!has} onClick={() => selection[0] && studio.focus(selection[0])} aria-label="Focus selection" data-tip="Focus selection" data-kbd="F" data-tip-pos="top">
        <Icon name="focus" />
      </button>
      <button type="button" className="dock__btn dock__opt" disabled={!has} onClick={() => studio.editor.deleteSelection()} aria-label="Delete selection" data-tip="Delete" data-kbd="Del" data-tip-pos="top">
        <Icon name="trash" />
      </button>
      <span className="dock__sep dock__opt" aria-hidden="true" />
      <button type="button" className="dock__btn dock__opt" onClick={() => studio.viewPreset('reset')} aria-label="Frame world" data-tip="Frame world" data-kbd="0" data-tip-pos="top">
        <Icon name="maximize" />
      </button>
      <button type="button" className={`dock__btn dock__opt${labels ? ' is-active' : ''}`} aria-pressed={labels} onClick={() => st.updateSettings({ showLabels: !labels })} aria-label="Object labels" data-tip="Object labels" data-kbd="L" data-tip-pos="top">
        <Icon name="tag" />
      </button>
    </div>
  );
});
