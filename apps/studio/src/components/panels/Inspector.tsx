/**
 * Object inspector: sections for the selected entity (object, transform,
 * shape, material, physics, joint, light, behaviours, raw JSON) and, for a
 * multi-selection, arrange / batch tools. Every edit is one undoable 'user'
 * patch; locked objects are read-only until unlocked.
 */
import { memo, useEffect, useState, type ReactElement } from 'react';
import { isEntityId, slugify, type Entity, type Json } from '@aether/core';
import { useStudio, useWorld } from '../../app/context';
import { entityReplacePatches, entityToJson, parseEntityJson, parseTags } from '../../lib/entityEdit';
import { Icon } from '../Icon';
import { ColorField, FieldRow, NumberField, Section, TextField, Toggle, Vec3Field } from '../fields';
import { ShapeSection } from '../inspector/ShapeSection';
import { MaterialSection } from '../inspector/MaterialSection';
import { JointSection, PhysicsSection } from '../inspector/PhysicsSection';
import { BehaviorsSection } from '../inspector/BehaviorsSection';
import { MATERIAL_LIBRARY } from '../../lib/materials';

type Update = (set: Record<string, Json>, message: string) => void;

/** Short kind label of an entity ("Box", "Tree pine", "Light", …). */
export function entityKind(e: Entity): string {
  if (e.light) return `${e.light.type.charAt(0).toUpperCase()}${e.light.type.slice(1)} light`;
  switch (e.shape.kind) {
    case 'primitive':
      return e.shape.primitive.charAt(0).toUpperCase() + e.shape.primitive.slice(1);
    case 'procedural':
      return e.shape.generator.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    case 'scatter':
      return `Scatter ×${e.shape.points ? e.shape.points.length : e.shape.count}`;
    case 'model':
      return 'Model';
    case 'mesh':
      return 'Mesh';
    default:
      return 'Group';
  }
}

const LightSection = memo(function LightSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement | null {
  const l = e.light;
  if (!l) return null;
  return (
    <Section title="Light">
      <FieldRow label="Color">
        <ColorField label="Light color" value={l.color} disabled={disabled} onCommit={(c) => update({ light: { color: c } }, `Set ${e.id} light color`)} />
      </FieldRow>
      <FieldRow label="Intensity">
        <NumberField label="Intensity" value={l.intensity} min={0} step={0.25} disabled={disabled} onCommit={(n) => update({ light: { intensity: n } }, `Set ${e.id} intensity`)} />
      </FieldRow>
      {(l.type === 'point' || l.type === 'spot') && (
        <FieldRow label="Range">
          <NumberField label="Range" value={l.range} min={0} step={1} disabled={disabled} onCommit={(n) => update({ light: { range: n } }, `Set ${e.id} range`)} />
        </FieldRow>
      )}
      {l.type === 'spot' && (
        <FieldRow label="Angle">
          <NumberField label="Spot angle" value={l.angle} min={1} max={89} step={1} disabled={disabled} onCommit={(n) => update({ light: { angle: n } }, `Set ${e.id} spot angle`)} />
        </FieldRow>
      )}
      <Toggle label="Cast shadows" checked={l.castShadow} disabled={disabled} onChange={(v) => update({ light: { castShadow: v } }, `Set ${e.id} light shadows`)} />
    </Section>
  );
});

const RawJson = memo(function RawJson({ e, disabled }: { e: Entity; disabled: boolean }): ReactElement {
  const studio = useStudio();
  const [text, setText] = useState(() => entityToJson(e));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(entityToJson(e));
  }, [e, dirty]);
  const apply = (): void => {
    const r = parseEntityJson(text, e.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const patches = entityReplacePatches(studio.history.current, r.entity);
    const err = patches.length > 0 ? studio.commitUser(patches, `Edit ${e.id} JSON`) : null;
    setError(err);
    if (!err) setDirty(false);
  };
  return (
    <Section title="Advanced (JSON)" defaultOpen={false}>
      <textarea
        className={`code-input${error ? ' has-error' : ''}`}
        value={text}
        spellCheck={false}
        disabled={disabled}
        aria-label="Entity JSON"
        aria-invalid={error !== null}
        onChange={(ev) => {
          setText(ev.target.value);
          setDirty(true);
          setError(null);
        }}
        rows={14}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="add-row add-row--end">
        <button
          type="button"
          className="btn btn--sm"
          disabled={!dirty}
          onClick={() => {
            setText(entityToJson(e));
            setDirty(false);
            setError(null);
          }}
        >
          Revert
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={!dirty || disabled} onClick={apply}>
          Apply
        </button>
      </div>
    </Section>
  );
});

/** Inspector for one entity. */
export const ObjectInspector = memo(function ObjectInspector({ e, count, playing }: { e: Entity; count: number; playing: boolean }): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const locked = e.locked === true;
  const disabled = playing || locked;
  const update: Update = (set, message) => studio.commitUser([{ op: 'update', id: e.id, set }], message);
  return (
    <div className="inspector" key={e.id}>
      {count > 1 && <p className="inspector__note">{count} selected — editing the first.</p>}
      {locked && (
        <div className="inspector__locked" role="note">
          <Icon name="lock" />
          <span>Locked: it cannot be selected in the viewport, moved, or changed by the agent.</span>
          <button type="button" className="btn btn--xs" disabled={playing} onClick={() => studio.editor.setLocked([e.id], false)}>
            Unlock
          </button>
        </div>
      )}
      <Section title="Object">
        <FieldRow label="Name">
          <TextField label="Name" value={e.name} disabled={disabled} placeholder={e.id} onCommit={(v) => update({ name: v.slice(0, 120) }, `Rename ${e.id}`)} />
        </FieldRow>
        <FieldRow label="Id">
          <TextField
            label="Entity id"
            value={e.id}
            maxLength={64}
            disabled={disabled}
            mono
            onCommit={(v) => {
              const next = isEntityId(v) ? v : slugify(v);
              if (next && next !== e.id) {
                if (studio.commitUser([{ op: 'rename', id: e.id, newId: next }], `Rename id ${e.id} → ${next}`) === null) studio.store.getState().select([next]);
              }
            }}
          />
        </FieldRow>
        <FieldRow label="Tags">
          <TextField label="Tags" value={e.tags.join(', ')} disabled={disabled} placeholder="coin, pickup" onCommit={(v) => update({ tags: parseTags(v) }, `Tag ${e.id}`)} />
        </FieldRow>
        {e.description && <p className="section__note">{e.description}</p>}
        <Toggle label="Visible" checked={e.visible} disabled={disabled} onChange={(v) => update({ visible: v }, `${v ? 'Show' : 'Hide'} ${e.id}`)} />
        <Toggle label="Locked" hint="Protects it from viewport edits and the agent" checked={locked} disabled={playing} onChange={(v) => studio.editor.setLocked([e.id], v)} />
        <Toggle label="Casts shadow" checked={e.castShadow} disabled={disabled} onChange={(v) => update({ castShadow: v }, `Set ${e.id} shadows`)} />
      </Section>
      <Section
        title="Transform"
        right={
          <button type="button" className="icon-btn icon-btn--sm" disabled={disabled} aria-label="Drop to the ground" data-tip="Drop to the ground" data-tip-align="end" onClick={() => studio.editor.dropToGround()}>
            <Icon name="ground" />
          </button>
        }
      >
        <Vec3Field label="Position" value={e.transform.position} disabled={disabled} onCommit={(v) => update({ transform: { position: v } }, `Move ${e.id}`)} />
        <Vec3Field label="Rotation" value={e.transform.rotation} step={5} disabled={disabled} onCommit={(v) => update({ transform: { rotation: v } }, `Rotate ${e.id}`)} />
        <Vec3Field label="Scale" value={e.transform.scale} min={0.001} disabled={disabled} onCommit={(v) => update({ transform: { scale: v } }, `Scale ${e.id}`)} />
      </Section>
      <ShapeSection e={e} world={world} update={update} disabled={disabled} />
      {e.shape.kind !== 'none' && <MaterialSection e={e} update={update} disabled={disabled} />}
      <PhysicsSection e={e} update={update} disabled={disabled} />
      <JointSection e={e} world={world} update={update} disabled={disabled} />
      <LightSection e={e} update={update} disabled={disabled} />
      <BehaviorsSection e={e} update={update} disabled={disabled} />
      <RawJson e={e} disabled={disabled} />
    </div>
  );
});

/** Inspector for several selected entities: arrange, organise and batch tools. */
export const MultiInspector = memo(function MultiInspector({ ids, playing }: { ids: readonly string[]; playing: boolean }): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const ed = studio.editor;
  const anyLocked = ids.some((id) => world.entities[id]?.locked === true);
  const allHidden = ids.every((id) => world.entities[id]?.visible === false);
  const axisRow = (axis: 0 | 1 | 2): ReactElement => (
    <FieldRow key={axis} label={`Along ${'XYZ'[axis]}`}>
      <div className="btn-row">
        <button type="button" className="icon-btn icon-btn--sm" disabled={playing} aria-label={`Align ${'XYZ'[axis]} minimum`} data-tip="Align to minimum" onClick={() => ed.align(axis, 'min')}>
          <Icon name="alignStart" />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={playing} aria-label={`Align ${'XYZ'[axis]} centre`} data-tip="Align centres" onClick={() => ed.align(axis, 'center')}>
          <Icon name="alignCenter" />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={playing} aria-label={`Align ${'XYZ'[axis]} maximum`} data-tip="Align to maximum" onClick={() => ed.align(axis, 'max')}>
          <Icon name="alignEnd" />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={playing || ids.length < 3} aria-label={`Distribute along ${'XYZ'[axis]}`} data-tip="Distribute evenly (3 or more)" onClick={() => ed.distribute(axis)}>
          <Icon name="distribute" />
        </button>
      </div>
    </FieldRow>
  );
  return (
    <div className="inspector" data-testid="multi-inspector">
      <Section title="Arrange">
        {axisRow(0)}
        {axisRow(1)}
        {axisRow(2)}
        <div className="add-row">
          <button type="button" className="btn btn--sm" disabled={playing} onClick={() => ed.dropToGround()}>
            <Icon name="ground" /> Drop to ground
          </button>
        </div>
      </Section>
      <Section title="Organise">
        <div className="btn-grid">
          <button type="button" className="btn btn--sm" disabled={playing} onClick={() => ed.group()} data-kbd="⌘G">
            <Icon name="group" /> Group
          </button>
          <button type="button" className="btn btn--sm" disabled={playing} onClick={() => ed.duplicate()}>
            <Icon name="copy" /> Duplicate
          </button>
          <button type="button" className="btn btn--sm" disabled={playing} onClick={() => ed.setHidden(ids, !allHidden)}>
            <Icon name={allHidden ? 'eye' : 'eyeOff'} /> {allHidden ? 'Show' : 'Hide'}
          </button>
          <button type="button" className="btn btn--sm" disabled={playing} onClick={() => ed.setLocked(ids, !anyLocked)}>
            <Icon name={anyLocked ? 'unlock' : 'lock'} /> {anyLocked ? 'Unlock' : 'Lock'}
          </button>
          <button type="button" className="btn btn--sm btn--danger" disabled={playing} onClick={() => ed.deleteSelection()}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </Section>
      <Section title="Material">
        <p className="section__note">Apply to all {ids.length} objects.</p>
        <div className="preset-grid">
          {MATERIAL_LIBRARY.map((m) => (
            <button
              key={m.id}
              type="button"
              className="preset-swatch"
              style={{ ['--swatch' as string]: m.swatch }}
              disabled={playing}
              aria-label={m.name}
              data-tip={m.name}
              onClick={() => ed.applyMaterial(ids, { ...m.spec, color: m.spec.color ?? null, roughness: m.spec.roughness ?? null, metalness: m.spec.metalness ?? null } as never, `Apply ${m.name} to ${ids.length} objects`)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
});
