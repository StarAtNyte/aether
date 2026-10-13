/**
 * Renders the inputs of one trigger / action / test (see `lib/ruleFields`)
 * and reports a modified copy on every committed change.
 */
import { memo, type ReactElement } from 'react';
import type { Json } from '@aether/core';
import { NumberField, SelectField, Switch, TextField } from '../../fields';
import { getField, literalText, OPS, parseLiteral, parsePlace, setField, type FieldDef } from '../../../lib/ruleFields';

/** Inputs for the fields of `value`. */
export const KindForm = memo(function KindForm<T extends Record<string, unknown>>({
  fields,
  value,
  onChange,
  disabled,
  entityIds,
}: {
  fields: readonly FieldDef[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** Entity ids offered by `entity` fields (templates first). */
  entityIds: readonly string[];
}): ReactElement {
  return (
    <div className="kind-form">
      {fields.map((f) => {
        const v = getField(value, f.key);
        const set = (x: unknown): void => onChange(setField(value, f.key, x));
        let control: ReactElement;
        switch (f.kind) {
          case 'number':
            control = <NumberField label={f.label} value={typeof v === 'number' ? v : 0} disabled={disabled} onCommit={set} />;
            break;
          case 'bool':
            control = <Switch label={f.label} checked={v === true} disabled={disabled} onChange={set} />;
            break;
          case 'op':
            control = <SelectField label={f.label} raw value={(typeof v === 'string' ? v : '==') as (typeof OPS)[number]} options={OPS} disabled={disabled} onChange={set} />;
            break;
          case 'enum':
            control = <SelectField label={f.label} value={typeof v === 'string' ? v : (f.options?.[0] ?? '')} options={f.options ?? []} disabled={disabled} onChange={set} />;
            break;
          case 'entity': {
            const ids = typeof v === 'string' && !entityIds.includes(v) ? [v, ...entityIds] : entityIds;
            control = ids.length > 0 ? <SelectField label={f.label} raw value={typeof v === 'string' ? v : (ids[0] as string)} options={ids} disabled={disabled} onChange={set} /> : <TextField label={f.label} value={typeof v === 'string' ? v : ''} mono disabled={disabled} onCommit={set} />;
            break;
          }
          case 'vec3': {
            const vec = Array.isArray(v) && v.length === 3 ? (v as number[]) : [0, 0, 0];
            control = (
              <div className="vec3">
                {(['x', 'y', 'z'] as const).map((axis, i) => (
                  <NumberField
                    key={axis}
                    axis={axis}
                    label={`${f.label} ${axis}`}
                    value={vec[i] ?? 0}
                    disabled={disabled}
                    onCommit={(n) => {
                      const next = [vec[0] ?? 0, vec[1] ?? 0, vec[2] ?? 0];
                      next[i] = n;
                      set(next);
                    }}
                  />
                ))}
              </div>
            );
            break;
          }
          case 'place':
            control = (
              <TextField
                label={f.label}
                value={Array.isArray(v) ? (v as number[]).join(', ') : typeof v === 'string' ? v : ''}
                placeholder={f.optional ? 'x, y, z or object (optional)' : 'x, y, z or object'}
                mono
                disabled={disabled}
                onCommit={(t) => set(t.trim() === '' && f.optional ? undefined : parsePlace(t))}
              />
            );
            break;
          case 'value':
            control = <TextField label={f.label} value={literalText(v as Json | undefined)} placeholder="10, true or text" mono disabled={disabled} onCommit={(t) => set(parseLiteral(t))} />;
            break;
          default:
            control = <TextField label={f.label} value={typeof v === 'string' ? v : ''} mono={f.kind === 'selector'} placeholder={f.kind === 'selector' ? 'id, #tag, player or *' : ''} disabled={disabled} onCommit={set} />;
        }
        return (
          <label key={f.key} className="kind-form__row">
            <span className="kind-form__label">{f.label}</span>
            <span className="kind-form__control">{control}</span>
          </label>
        );
      })}
    </div>
  );
});
