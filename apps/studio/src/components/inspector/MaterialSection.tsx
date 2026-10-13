/**
 * Material editor: preset swatches, colour, PBR sliders (roughness,
 * metalness), glow (emissive colour + intensity), opacity, flat shading,
 * vertex colors and the eyedropper ("copy the material of another object
 * onto the selection"). Every change is one undoable edit.
 */
import { memo, type ReactElement } from 'react';
import { MaterialPreset, type Entity, type Json } from '@aether/core';
import { MATERIAL_PRESETS } from '@aether/render';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { ColorField, FieldRow, Section, SliderField, Switch } from '../fields';

type Update = (set: Record<string, Json>, message: string) => void;

const titled = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The material section. */
export const MaterialSection = memo(function MaterialSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const studio = useStudio();
  const picking = useUI((s) => s.materialPick);
  const m = e.material ?? {};
  const preset = m.preset ? MATERIAL_PRESETS[m.preset] : undefined;
  const name = e.name || e.id;
  return (
    <Section
      title="Material"
      right={
        <button
          type="button"
          className={`icon-btn icon-btn--sm${picking ? ' is-active' : ''}`}
          aria-pressed={picking}
          disabled={disabled}
          aria-label="Copy a material from another object"
          data-tip="Eyedropper: click another object to copy its material here"
          data-tip-align="end"
          onClick={() => studio.editor.armEyedropper(!picking)}
        >
          <Icon name="eyedropper" />
        </button>
      }
    >
      <div className="preset-grid" role="radiogroup" aria-label="Material preset">
        {MaterialPreset.options.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={m.preset === p}
            className={`preset-swatch${m.preset === p ? ' is-active' : ''}`}
            style={{ ['--swatch' as string]: MATERIAL_PRESETS[p].color }}
            disabled={disabled}
            aria-label={titled(p)}
            data-tip={titled(p)}
            onClick={() => update({ material: { preset: m.preset === p ? null : p, color: null, roughness: null, metalness: null } }, `${titled(p)} material on ${name}`)}
          />
        ))}
      </div>
      <FieldRow label="Color">
        <ColorField label="Color" value={m.color ?? preset?.color ?? '#cccccc'} disabled={disabled} onCommit={(c) => update({ material: { color: c } }, `Recolor ${name}`)} />
      </FieldRow>
      <FieldRow label="Roughness">
        <SliderField label="Roughness" value={m.roughness ?? preset?.roughness ?? 0.6} min={0} max={1} step={0.01} disabled={disabled} onCommit={(n) => update({ material: { roughness: n } }, `Set ${name} roughness`)} />
      </FieldRow>
      <FieldRow label="Metalness">
        <SliderField label="Metalness" value={m.metalness ?? preset?.metalness ?? 0} min={0} max={1} step={0.01} disabled={disabled} onCommit={(n) => update({ material: { metalness: n } }, `Set ${name} metalness`)} />
      </FieldRow>
      <FieldRow label="Glow color">
        <ColorField label="Emissive color" value={m.emissive ?? '#000000'} disabled={disabled} onCommit={(c) => update({ material: { emissive: c, ...(m.emissiveIntensity === undefined || m.emissiveIntensity === 0 ? { emissiveIntensity: 1 } : {}) } }, `Set ${name} glow color`)} />
      </FieldRow>
      <FieldRow label="Glow">
        <SliderField label="Emissive intensity" value={m.emissiveIntensity ?? 0} min={0} max={10} step={0.1} disabled={disabled} onCommit={(n) => update({ material: { emissiveIntensity: n } }, `Set ${name} glow`)} />
      </FieldRow>
      <FieldRow label="Opacity">
        <SliderField label="Opacity" value={m.opacity ?? 1} min={0.05} max={1} step={0.01} disabled={disabled} format={(v) => `${Math.round(v * 100)}%`} onCommit={(n) => update({ material: { opacity: n >= 0.999 ? null : n } }, `Set ${name} opacity`)} />
      </FieldRow>
      <FieldRow label="Flat shading">
        <Switch label="Flat shading" checked={m.flatShading === true} disabled={disabled} onChange={(v) => update({ material: { flatShading: v ? true : null } }, `${v ? 'Flat' : 'Smooth'} shading on ${name}`)} />
      </FieldRow>
      {(e.shape.kind === 'mesh' || e.shape.kind === 'procedural') && (
        <FieldRow label="Vertex colors">
          <Switch label="Use vertex colors" checked={m.vertexColors !== false} disabled={disabled} onChange={(v) => update({ material: { vertexColors: v ? null : false } }, `${v ? 'Show' : 'Hide'} vertex colors on ${name}`)} />
        </FieldRow>
      )}
      {m.preset !== undefined || m.color !== undefined ? (
        <div className="add-row add-row--end">
          <button type="button" className="btn btn--xs" disabled={disabled} onClick={() => update({ material: null }, `Reset ${name} material`)}>
            Reset
          </button>
        </div>
      ) : null}
    </Section>
  );
});
