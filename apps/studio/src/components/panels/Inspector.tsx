/**
 * Object inspector: sections for the selected entity (transform, shape,
 * material, physics, light, behaviours, raw JSON). Every edit is one
 * undoable 'user' patch.
 */
import { memo, useEffect, useState, type ReactElement } from 'react';
import { BodyType, MaterialPreset, PrimitiveKind, isEntityId, slugify, type Entity, type Json } from '@aether/core';
import { BEHAVIOR_CATALOG } from '@aether/logic';
import { useStudio } from '../../app/context';
import { defaultParams, entityReplacePatches, entityToJson, parseEntityJson, parseTags } from '../../lib/entityEdit';
import { formatValue } from '../../lib/ruleFormat';
import { Icon } from '../Icon';
import { ColorField, FieldRow, NumberField, Section, SelectField, Switch, TextField, Toggle, Vec3Field } from '../fields';

type Update = (set: Record<string, Json>, message: string) => void;

const BODY_OPTIONS = ['none', ...BodyType.options] as const;
type BodyOption = (typeof BODY_OPTIONS)[number];
const PRESET_OPTIONS = ['(none)', ...MaterialPreset.options] as const;
type PresetOption = (typeof PRESET_OPTIONS)[number];
const BEHAVIOR_TYPES = BEHAVIOR_CATALOG.map((b) => b.type);

/** Short kind label of an entity ("Box", "Tree pine", "Light", …). */
export function entityKind(e: Entity): string {
  if (e.light) return `${e.light.type.charAt(0).toUpperCase()}${e.light.type.slice(1)} light`;
  switch (e.shape.kind) {
    case 'primitive':
      return e.shape.primitive.charAt(0).toUpperCase() + e.shape.primitive.slice(1);
    case 'procedural':
      return e.shape.generator.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    case 'scatter':
      return `Scatter ×${e.shape.count}`;
    case 'model':
      return 'Model';
    default:
      return 'Group';
  }
}

const ShapeSection = memo(function ShapeSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const s = e.shape;
  return (
    <Section title="Shape">
      {s.kind === 'primitive' && (
        <>
          <FieldRow label="Primitive">
            <SelectField label="Primitive" value={s.primitive} options={PrimitiveKind.options} disabled={disabled} onChange={(v) => update({ shape: { primitive: v } }, `Set ${e.id} primitive`)} />
          </FieldRow>
          <Vec3Field label="Size" value={s.size} min={0.001} disabled={disabled} onCommit={(v) => update({ shape: { size: v } }, `Resize ${e.id}`)} />
        </>
      )}
      {s.kind === 'procedural' && (
        <>
          <FieldRow label="Generator">
            <span className="value-text mono" title={s.generator}>
              {s.generator}
            </span>
          </FieldRow>
          {Object.keys(s.params).length === 0 && <p className="section__note">Default parameters.</p>}
          {Object.entries(s.params).map(([k, v]) => (
            <FieldRow key={k} label={k}>
              {typeof v === 'number' ? (
                <NumberField label={k} value={v} disabled={disabled} onCommit={(n) => update({ shape: { params: { [k]: n } } }, `Set ${e.id} ${k}`)} />
              ) : typeof v === 'boolean' ? (
                <Switch label={k} checked={v} disabled={disabled} onChange={(b) => update({ shape: { params: { [k]: b } } }, `Set ${e.id} ${k}`)} />
              ) : typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? (
                <ColorField label={k} value={v} disabled={disabled} onCommit={(c) => update({ shape: { params: { [k]: c } } }, `Set ${e.id} ${k}`)} />
              ) : (
                <span className="value-text mono" title={formatValue(v)}>
                  {formatValue(v)}
                </span>
              )}
            </FieldRow>
          ))}
          <FieldRow label="Seed">
            <NumberField label="Seed" value={s.seed ?? 1} step={1} disabled={disabled} onCommit={(n) => update({ shape: { seed: Math.round(n) } }, `Reseed ${e.id}`)} />
          </FieldRow>
        </>
      )}
      {s.kind === 'scatter' && (
        <>
          <FieldRow label="Of">
            <span className="value-text mono">{s.of.kind === 'procedural' ? s.of.generator : s.of.primitive}</span>
          </FieldRow>
          <FieldRow label="Count">
            <NumberField label="Count" value={s.count} step={1} min={1} max={200_000} disabled={disabled} onCommit={(n) => update({ shape: { count: Math.round(n) } }, `Set ${e.id} count`)} />
          </FieldRow>
          <FieldRow label="Area">
            <div className="vec2">
              <NumberField label="Area width" axis="x" value={s.area[0]} min={0.1} disabled={disabled} onCommit={(n) => update({ shape: { area: [n, s.area[1]] } }, `Set ${e.id} area`)} />
              <NumberField label="Area depth" axis="z" value={s.area[1]} min={0.1} disabled={disabled} onCommit={(n) => update({ shape: { area: [s.area[0], n] } }, `Set ${e.id} area`)} />
            </div>
          </FieldRow>
          <FieldRow label="Seed">
            <NumberField label="Seed" value={s.seed} step={1} disabled={disabled} onCommit={(n) => update({ shape: { seed: Math.round(n) } }, `Reseed ${e.id}`)} />
          </FieldRow>
        </>
      )}
      {s.kind === 'model' && (
        <FieldRow label="URL">
          <span className="value-text mono" title={s.url}>
            {s.url}
          </span>
        </FieldRow>
      )}
      {s.kind === 'none' && <p className="section__note">No geometry (group, light or logic holder).</p>}
    </Section>
  );
});

const MaterialSection = memo(function MaterialSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const m = e.material ?? {};
  return (
    <Section title="Material">
      <FieldRow label="Preset">
        <SelectField<PresetOption>
          label="Preset"
          value={m.preset ?? '(none)'}
          options={PRESET_OPTIONS}
          disabled={disabled}
          onChange={(v) => update({ material: { preset: v === '(none)' ? null : v } }, `Set ${e.id} material`)}
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorField label="Color" value={m.color ?? '#cccccc'} disabled={disabled} onCommit={(c) => update({ material: { color: c } }, `Recolor ${e.id}`)} />
      </FieldRow>
      <FieldRow label="Roughness">
        <NumberField label="Roughness" value={m.roughness ?? 0.6} min={0} max={1} step={0.05} disabled={disabled} onCommit={(n) => update({ material: { roughness: n } }, `Set ${e.id} roughness`)} />
      </FieldRow>
      <FieldRow label="Metalness">
        <NumberField label="Metalness" value={m.metalness ?? 0} min={0} max={1} step={0.05} disabled={disabled} onCommit={(n) => update({ material: { metalness: n } }, `Set ${e.id} metalness`)} />
      </FieldRow>
      <FieldRow label="Emissive">
        <ColorField label="Emissive" value={m.emissive ?? '#000000'} disabled={disabled} onCommit={(c) => update({ material: { emissive: c } }, `Set ${e.id} glow color`)} />
      </FieldRow>
      <FieldRow label="Glow">
        <NumberField label="Emissive intensity" value={m.emissiveIntensity ?? 0} min={0} max={50} step={0.1} disabled={disabled} onCommit={(n) => update({ material: { emissiveIntensity: n } }, `Set ${e.id} glow`)} />
      </FieldRow>
      <FieldRow label="Opacity">
        <NumberField label="Opacity" value={m.opacity ?? 1} min={0} max={1} step={0.05} disabled={disabled} onCommit={(n) => update({ material: { opacity: n } }, `Set ${e.id} opacity`)} />
      </FieldRow>
    </Section>
  );
});

const PhysicsSection = memo(function PhysicsSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const p = e.physics;
  return (
    <Section title="Physics">
      <FieldRow label="Body">
        <SelectField<BodyOption>
          label="Body type"
          value={p ? p.body : 'none'}
          options={BODY_OPTIONS}
          disabled={disabled}
          onChange={(v) => update({ physics: v === 'none' ? null : { body: v } }, v === 'none' ? `Remove ${e.id} physics` : `Make ${e.id} ${v}`)}
        />
      </FieldRow>
      {p && (
        <>
          {p.body === 'dynamic' && (
            <FieldRow label="Mass (kg)">
              <NumberField label="Mass" value={p.mass ?? 1} min={0.001} step={0.5} disabled={disabled} onCommit={(n) => update({ physics: { mass: n } }, `Set ${e.id} mass`)} />
            </FieldRow>
          )}
          <FieldRow label="Friction">
            <NumberField label="Friction" value={p.friction} min={0} max={5} step={0.05} disabled={disabled} onCommit={(n) => update({ physics: { friction: n } }, `Set ${e.id} friction`)} />
          </FieldRow>
          <FieldRow label="Bounce">
            <NumberField label="Restitution" value={p.restitution} min={0} max={1} step={0.05} disabled={disabled} onCommit={(n) => update({ physics: { restitution: n } }, `Set ${e.id} bounciness`)} />
          </FieldRow>
          <Toggle label="Sensor (trigger)" checked={p.sensor} disabled={disabled} onChange={(v) => update({ physics: { sensor: v } }, `Set ${e.id} sensor`)} />
          <Toggle label="Lock rotation" checked={p.lockRotation} disabled={disabled} onChange={(v) => update({ physics: { lockRotation: v } }, `Set ${e.id} rotation lock`)} />
        </>
      )}
    </Section>
  );
});

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
      <Toggle label="Cast shadows" checked={l.castShadow} disabled={disabled} onChange={(v) => update({ light: { castShadow: v } }, `Set ${e.id} light shadows`)} />
    </Section>
  );
});

const BehaviorsSection = memo(function BehaviorsSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const [adding, setAdding] = useState(BEHAVIOR_TYPES[0] ?? 'spin');
  const setList = (list: Entity['behaviors'], message: string): void => update({ behaviors: list as unknown as Json }, message);
  return (
    <Section title="Behaviours" right={<span className="count-badge">{e.behaviors.length}</span>}>
      {e.behaviors.length === 0 && <p className="section__note">No behaviours. Add one below or ask the agent.</p>}
      {e.behaviors.map((b, i) => (
        <div key={`${b.type}-${i}`} className={`behavior${b.enabled ? '' : ' is-disabled'}`}>
          <div className="behavior__head">
            <span className="behavior__type">{b.type}</span>
            <Switch label={`Enable ${b.type}`} checked={b.enabled} disabled={disabled} onChange={(v) => setList(e.behaviors.map((x, j) => (j === i ? { ...x, enabled: v } : x)), `${v ? 'Enable' : 'Disable'} ${b.type} on ${e.id}`)} />
            <button type="button" className="icon-btn icon-btn--sm" disabled={disabled} aria-label={`Remove ${b.type}`} data-tip="Remove" onClick={() => setList(e.behaviors.filter((_, j) => j !== i), `Remove ${b.type} from ${e.id}`)}>
              <Icon name="trash" />
            </button>
          </div>
          {Object.keys(b.params).length > 0 && (
            <div className="behavior__params">
              {Object.entries(b.params).map(([k, v]) => (
                <span key={k} className="param" title={`${k}: ${formatValue(v)}`}>
                  <span className="param__k">{k}</span>
                  <span className="param__v">{formatValue(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="add-row">
        <SelectField label="Behaviour type" value={adding} options={BEHAVIOR_TYPES} disabled={disabled} onChange={setAdding} />
        <button
          type="button"
          className="btn btn--sm"
          disabled={disabled}
          onClick={() => {
            const entry = BEHAVIOR_CATALOG.find((c) => c.type === adding);
            if (!entry) return;
            setList([...e.behaviors, { type: entry.type, params: defaultParams(entry.params), enabled: true }], `Add ${entry.type} to ${e.id}`);
          }}
        >
          <Icon name="plus" /> Add
        </button>
      </div>
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
  const update: Update = (set, message) => studio.commitUser([{ op: 'update', id: e.id, set }], message);
  return (
    <div className="inspector" key={e.id}>
      {count > 1 && <p className="inspector__note">{count} selected — editing the first.</p>}
      <Section title="Object">
        <FieldRow label="Name">
          <TextField label="Name" value={e.name} disabled={playing} placeholder={e.id} onCommit={(v) => update({ name: v.slice(0, 120) }, `Rename ${e.id}`)} />
        </FieldRow>
        <FieldRow label="Id">
          <TextField
            label="Entity id"
            value={e.id}
            maxLength={64}
            disabled={playing}
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
          <TextField label="Tags" value={e.tags.join(', ')} disabled={playing} placeholder="coin, pickup" onCommit={(v) => update({ tags: parseTags(v) }, `Tag ${e.id}`)} />
        </FieldRow>
        {e.description && <p className="section__note">{e.description}</p>}
        <Toggle label="Visible" checked={e.visible} disabled={playing} onChange={(v) => update({ visible: v }, `${v ? 'Show' : 'Hide'} ${e.id}`)} />
        <Toggle label="Casts shadow" checked={e.castShadow} disabled={playing} onChange={(v) => update({ castShadow: v }, `Set ${e.id} shadows`)} />
      </Section>
      <Section title="Transform">
        <Vec3Field label="Position" value={e.transform.position} disabled={playing} onCommit={(v) => update({ transform: { position: v } }, `Move ${e.id}`)} />
        <Vec3Field label="Rotation" value={e.transform.rotation} step={5} disabled={playing} onCommit={(v) => update({ transform: { rotation: v } }, `Rotate ${e.id}`)} />
        <Vec3Field label="Scale" value={e.transform.scale} min={0.001} disabled={playing} onCommit={(v) => update({ transform: { scale: v } }, `Scale ${e.id}`)} />
      </Section>
      <ShapeSection e={e} update={update} disabled={playing} />
      {e.shape.kind !== 'none' && <MaterialSection e={e} update={update} disabled={playing} />}
      <PhysicsSection e={e} update={update} disabled={playing} />
      <LightSection e={e} update={update} disabled={playing} />
      <BehaviorsSection e={e} update={update} disabled={playing} />
      <RawJson e={e} disabled={playing} />
    </div>
  );
});
