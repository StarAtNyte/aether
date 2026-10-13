/**
 * Context bar (top-centre of the viewport): the options of whatever the
 * user is doing right now — mesh component editing (mode, operations, soft
 * selection), the sculpt / paint / scatter brushes, or the armed material
 * eyedropper. Hidden otherwise.
 */
import { memo, useState, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon, type IconName } from '../Icon';
import { Segmented } from '../ui/Segmented';
import { Menu } from '../ui/Menu';
import { NumberField, SelectField, SliderField } from '../fields';
import type { MeshAction } from '../../engine/editor/meshEditor';
import { SCATTER_ITEMS } from '../../editor/model/scatterPaint';

/** Paint swatches: terrain "biome" colours first, then accents. */
export const PAINT_SWATCHES: ReadonlyArray<{ color: string; label: string }> = [
  { color: '#5e8c3a', label: 'Grass' },
  { color: '#8a6a45', label: 'Dirt' },
  { color: '#8d8d88', label: 'Rock' },
  { color: '#d9c58f', label: 'Sand' },
  { color: '#f4f6f8', label: 'Snow' },
  { color: '#3f6fb5', label: 'Water' },
  { color: '#c0392b', label: 'Red' },
  { color: '#f1c40f', label: 'Yellow' },
];

function OpButton({ icon, label, onClick, disabled, testId }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; testId?: string }): ReactElement {
  return (
    <button type="button" className="ctx-btn" onClick={onClick} disabled={disabled} aria-label={label} data-tip={label} data-tip-pos="bottom" data-testid={testId}>
      <Icon name={icon} />
    </button>
  );
}

/** Mesh component editing controls. */
const MeshBar = memo(function MeshBar(): ReactElement | null {
  const studio = useStudio();
  const me = useUI((s) => s.meshEdit);
  const busy = useUI((s) => s.meshBusy);
  const [distance, setDistance] = useState(0.5);
  const [inset, setInset] = useState(0.25);
  if (!me) return null;
  const count = me.mode === 'face' ? me.faces.length : me.mode === 'edge' ? me.edges.length / 2 : me.vertices.length;
  const run = (action: MeshAction): void => {
    void studio.editor.mesh.run(action).then((err) => {
      if (err) studio.store.getState().toast(err, 'error', 4);
    });
  };
  return (
    <div className="ctx-bar" role="toolbar" aria-label="Mesh editing" data-testid="mesh-bar">
      <Segmented<'vertex' | 'edge' | 'face'>
        label="Component"
        size="sm"
        value={me.mode}
        onChange={(m) => studio.editor.mesh.setMode(m)}
        options={[
          ['vertex', <Icon key="v" name="vertex" label="Vertices" />],
          ['edge', <Icon key="e" name="edge" label="Edges" />],
          ['face', <Icon key="f" name="face" label="Faces" />],
        ]}
        titles={{ vertex: 'Vertices (1)', edge: 'Edges (2)', face: 'Faces (3)' }}
      />
      <span className="ctx-count" aria-live="polite">
        {count} selected
      </span>
      <span className="ctx-sep" aria-hidden="true" />
      <OpButton icon="extrude" label={`Extrude ${distance} m`} disabled={busy} onClick={() => run({ kind: 'extrude', distance })} testId="mesh-extrude" />
      <label className="ctx-num" data-tip="Extrude distance (m)" data-tip-pos="bottom">
        <NumberField label="Extrude distance" value={distance} step={0.1} min={-100} max={100} onCommit={setDistance} />
      </label>
      <OpButton icon="inset" label="Inset faces" disabled={busy} onClick={() => run({ kind: 'inset', amount: inset })} testId="mesh-inset" />
      <label className="ctx-num" data-tip="Inset amount (0–0.95)" data-tip-pos="bottom">
        <NumberField label="Inset amount" value={inset} step={0.05} min={0.01} max={0.95} onCommit={setInset} />
      </label>
      <OpButton icon="subdivide" label="Subdivide (whole mesh: smooth)" disabled={busy} onClick={() => run({ kind: 'subdivide', smooth: true })} testId="mesh-subdivide" />
      <OpButton icon="sparkles" label="Smooth" disabled={busy} onClick={() => run({ kind: 'smooth', iterations: 3, factor: 0.5 })} />
      <Menu
        label="More mesh operations"
        align="end"
        width={230}
        items={[
          { id: 'merge', label: 'Merge by distance (1 mm)', icon: 'link', onSelect: () => run({ kind: 'merge', distance: 0.001 }) },
          { id: 'flip', label: 'Flip normals', icon: 'refresh', onSelect: () => run({ kind: 'flip' }) },
          { id: 'orient', label: 'Recompute normals (outward)', icon: 'check', onSelect: () => run({ kind: 'orient' }) },
          { id: 'box', label: 'UV unwrap: box', icon: 'cube', onSelect: () => run({ kind: 'unwrap', mode: 'box' }) },
          { id: 'planar', label: 'UV unwrap: planar', icon: 'square', onSelect: () => run({ kind: 'unwrap', mode: 'planar' }) },
          { kind: 'separator', id: 's1' },
          { id: 'all', label: 'Select all', onSelect: () => studio.editor.mesh.selectAll() },
          { id: 'none', label: 'Select none', onSelect: () => studio.editor.mesh.selectAll(true) },
          { kind: 'separator', id: 's2' },
          { id: 'delete', label: 'Delete faces', icon: 'trash', danger: true, onSelect: () => run({ kind: 'delete' }) },
        ]}
        trigger={(t) => (
          <button {...t} type="button" className="ctx-btn" aria-label="More mesh operations" data-tip="More" data-tip-pos="bottom">
            <Icon name="more" />
          </button>
        )}
      />
      <span className="ctx-sep" aria-hidden="true" />
      <label className="ctx-num ctx-num--wide" data-tip="Soft selection radius (m): nearby vertices follow with falloff" data-tip-pos="bottom">
        <span className="ctx-num__label">Soft</span>
        <NumberField label="Soft selection radius" value={me.soft} step={0.25} min={0} max={50} onCommit={(n) => studio.editor.mesh.setSoft(n)} />
      </label>
      <button type="button" className="btn btn--sm btn--primary" onClick={() => studio.editor.mesh.exit()} data-tip="Back to objects" data-kbd="Tab" data-tip-pos="bottom">
        Done
      </button>
    </div>
  );
});

/** Brush size / strength / falloff (shared by all brushes). */
const BrushCommon = memo(function BrushCommon(): ReactElement {
  const studio = useStudio();
  const b = useUI((s) => s.brush);
  const set = studio.store.getState().setBrush;
  return (
    <>
      <label className="ctx-slider" data-tip="Brush radius ([ and ])" data-tip-pos="bottom">
        <span className="ctx-num__label">Size</span>
        <SliderField label="Brush size" value={b.size} min={0.25} max={30} step={0.25} format={(v) => `${v.toFixed(v < 10 ? 2 : 1)} m`} onCommit={(v) => set({ size: v })} />
      </label>
      <label className="ctx-slider" data-tip="Brush strength (Shift+[ and ])" data-tip-pos="bottom">
        <span className="ctx-num__label">Strength</span>
        <SliderField label="Brush strength" value={b.strength} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set({ strength: v })} />
      </label>
      <SelectField<'smooth' | 'linear' | 'sharp' | 'constant'> label="Falloff" value={b.falloff} options={['smooth', 'linear', 'sharp', 'constant']} onChange={(v) => set({ falloff: v })} />
    </>
  );
});

/** Sculpt brush options. */
const SculptBar = memo(function SculptBar(): ReactElement {
  const studio = useStudio();
  const mode = useUI((s) => s.brush.sculpt);
  return (
    <div className="ctx-bar" role="toolbar" aria-label="Sculpt brush" data-testid="sculpt-bar">
      <Segmented<'raise' | 'lower' | 'smooth' | 'flatten' | 'noise'>
        label="Sculpt mode"
        size="sm"
        value={mode}
        onChange={(v) => studio.store.getState().setBrush({ sculpt: v })}
        options={[['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten'], ['noise', 'Noise']]}
        titles={{ raise: 'Raise (hold Alt to lower)', lower: 'Lower', smooth: 'Smooth', flatten: 'Flatten to the first height', noise: 'Roughen with noise' }}
      />
      <span className="ctx-sep" aria-hidden="true" />
      <BrushCommon />
    </div>
  );
});

/** Vertex paint options. */
const PaintBar = memo(function PaintBar(): ReactElement {
  const studio = useStudio();
  const color = useUI((s) => s.brush.color);
  const erase = useUI((s) => s.brush.erase);
  const set = studio.store.getState().setBrush;
  return (
    <div className="ctx-bar" role="toolbar" aria-label="Paint brush" data-testid="paint-bar">
      <div className="ctx-swatches" role="radiogroup" aria-label="Paint colour">
        {PAINT_SWATCHES.map((s) => (
          <button
            key={s.color}
            type="button"
            role="radio"
            aria-checked={color === s.color && !erase}
            aria-label={s.label}
            data-tip={s.label}
            data-tip-pos="bottom"
            className={`ctx-swatch${color === s.color && !erase ? ' is-active' : ''}`}
            style={{ background: s.color }}
            onClick={() => set({ color: s.color, erase: false })}
          />
        ))}
        <input className="ctx-color" type="color" value={color} aria-label="Custom colour" onChange={(e) => set({ color: e.target.value, erase: false })} />
      </div>
      <button type="button" className={`ctx-btn${erase ? ' is-active' : ''}`} aria-pressed={erase} aria-label="Erase paint" data-tip="Erase paint (or hold Alt)" data-tip-pos="bottom" onClick={() => set({ erase: !erase })}>
        <Icon name="x" />
      </button>
      <span className="ctx-sep" aria-hidden="true" />
      <BrushCommon />
    </div>
  );
});

/** Scatter brush options. */
const ScatterBar = memo(function ScatterBar(): ReactElement {
  const studio = useStudio();
  const b = useUI((s) => s.brush);
  const set = studio.store.getState().setBrush;
  return (
    <div className="ctx-bar" role="toolbar" aria-label="Scatter brush" data-testid="scatter-bar">
      <select className="select select--sm" aria-label="What to paint" value={b.scatterItem} onChange={(e) => set({ scatterItem: e.target.value })}>
        {SCATTER_ITEMS.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </select>
      <label className="ctx-slider" data-tip="Instances per square metre" data-tip-pos="bottom">
        <span className="ctx-num__label">Density</span>
        <SliderField label="Density" value={b.density} min={0.05} max={10} step={0.05} format={(v) => `${v.toFixed(2)}/m²`} onCommit={(v) => set({ density: v })} />
      </label>
      <button type="button" className={`ctx-btn${b.erase ? ' is-active' : ''}`} aria-pressed={b.erase} aria-label="Erase instances" data-tip="Erase (or hold Alt)" data-tip-pos="bottom" onClick={() => set({ erase: !b.erase })}>
        <Icon name="x" />
      </button>
      <span className="ctx-sep" aria-hidden="true" />
      <BrushCommon />
    </div>
  );
});

/** The context bar. */
export const ContextBar = memo(function ContextBar(): ReactElement | null {
  const studio = useStudio();
  const meshEdit = useUI((s) => s.meshEdit !== null);
  const tool = useUI((s) => s.tool);
  const picking = useUI((s) => s.materialPick);
  if (picking) {
    return (
      <div className="ctx-bar" role="status" data-testid="eyedropper-bar">
        <Icon name="eyedropper" />
        <span className="ctx-count">Click an object to copy its material onto the selection</span>
        <button type="button" className="btn btn--sm" onClick={() => studio.editor.armEyedropper(false)}>
          Cancel
        </button>
      </div>
    );
  }
  if (meshEdit) return <MeshBar />;
  if (tool === 'sculpt') return <SculptBar />;
  if (tool === 'paint') return <PaintBar />;
  if (tool === 'scatter') return <ScatterBar />;
  return null;
});
