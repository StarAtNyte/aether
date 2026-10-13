/**
 * One typed parameter control, driven by a generator `ParamSpec` or a
 * behaviour parameter spec: sliders for bounded numbers (live `onPreview`
 * while dragging, `onCommit` on release), toggles, colour pickers, enum
 * selects, vec3 inputs and a small JSON field for lists. Values are
 * validated before they are committed.
 */
import { memo, useEffect, useState, type ReactElement } from 'react';
import type { Json } from '@aether/core';
import { fieldNumber } from '../../lib/format';
import { ColorField, NumberField, SelectField, Switch, TextField, humanize, parseNumberInput } from '../fields';

/** The parameter description both catalogs share. */
export interface ParamSpecLike {
  type: string;
  default: Json;
  min?: number;
  max?: number;
  options?: string[];
  description?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A live slider: previews while dragging, commits on release. */
const LiveSlider = memo(function LiveSlider({ label, value, min, max, step, disabled, onPreview, onCommit }: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onPreview?: (v: number) => void; onCommit: (v: number) => void }): ReactElement {
  const [draft, setDraft] = useState(value);
  const [text, setText] = useState(fieldNumber(value));
  useEffect(() => {
    setDraft(value);
    setText(fieldNumber(value));
  }, [value]);
  const commit = (v: number): void => {
    const n = Math.min(max, Math.max(min, v));
    if (n !== value) onCommit(n);
  };
  const pct = max > min ? ((draft - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider-field slider-field--edit">
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          setText(fieldNumber(v));
          onPreview?.(v);
        }}
        onPointerUp={() => commit(draft)}
        onKeyUp={() => commit(draft)}
        onBlur={() => commit(draft)}
      />
      <input
        className="slider-field__input"
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={`${label} value`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseNumberInput(text);
          if (n === null) setText(fieldNumber(value));
          else commit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') setText(fieldNumber(value));
        }}
      />
    </div>
  );
});

/** JSON list editor (vec3[] / string[] params). */
const JsonField = memo(function JsonField({ label, value, disabled, onCommit, validate }: { label: string; value: Json; disabled?: boolean; onCommit: (v: Json) => void; validate: (v: unknown) => v is Json }): ReactElement {
  const initial = JSON.stringify(value);
  const [draft, setDraft] = useState(initial);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(JSON.stringify(value));
    setBad(false);
  }, [value]);
  return (
    <input
      className={`input input--sm input--mono${bad ? ' has-error' : ''}`}
      value={draft}
      maxLength={4000}
      disabled={disabled}
      aria-label={label}
      aria-invalid={bad}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === initial) return;
        try {
          const v: unknown = JSON.parse(draft);
          if (!validate(v)) throw new Error('invalid');
          setBad(false);
          onCommit(v);
        } catch {
          setBad(true);
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
});

const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isVec3List = (v: unknown): v is Json => Array.isArray(v) && v.length <= 64 && v.every(isVec3);
const isStringList = (v: unknown): v is Json => Array.isArray(v) && v.length <= 64 && v.every((s) => typeof s === 'string' && s.length <= 120);

/** Default slider bounds for unbounded numbers: around the default value. */
function bounds(spec: ParamSpecLike, value: number): { min: number; max: number } | null {
  if (typeof spec.min === 'number' && typeof spec.max === 'number' && spec.max > spec.min) return { min: spec.min, max: spec.max };
  return Number.isFinite(value) ? null : null;
}

/**
 * Field for one parameter. `onPreview` (optional) receives slider values
 * while dragging; `onCommit` receives the final value.
 */
export const ParamField = memo(function ParamField({
  name,
  spec,
  value,
  disabled,
  onCommit,
  onPreview,
}: {
  name: string;
  spec: ParamSpecLike;
  value: Json | undefined;
  disabled?: boolean;
  onCommit: (v: Json) => void;
  onPreview?: (v: Json) => void;
}): ReactElement {
  const v = value === undefined ? spec.default : value;
  const label = humanize(name);
  let control: ReactElement;
  switch (spec.type) {
    case 'number':
    case 'int': {
      const n = typeof v === 'number' ? v : typeof spec.default === 'number' ? spec.default : 0;
      const b = bounds(spec, n);
      const step = spec.type === 'int' ? 1 : b ? Math.max(0.001, Number(((b.max - b.min) / 100).toPrecision(1))) : 0.1;
      const round = (x: number): number => (spec.type === 'int' ? Math.round(x) : x);
      control = b ? (
        <LiveSlider label={label} value={n} min={b.min} max={b.max} step={step} disabled={disabled} onPreview={onPreview ? (x) => onPreview(round(x)) : undefined} onCommit={(x) => onCommit(round(x))} />
      ) : (
        <NumberField label={label} value={n} step={step} {...(typeof spec.min === 'number' ? { min: spec.min } : {})} {...(typeof spec.max === 'number' ? { max: spec.max } : {})} disabled={disabled} onCommit={(x) => onCommit(round(x))} />
      );
      break;
    }
    case 'boolean':
      control = <Switch label={label} checked={v === true} disabled={disabled} onChange={(b) => onCommit(b)} />;
      break;
    case 'color':
      control = <ColorField label={label} value={typeof v === 'string' && HEX.test(v) ? v : '#cccccc'} disabled={disabled} onCommit={(c) => onCommit(c)} />;
      break;
    case 'enum': {
      const options = spec.options && spec.options.length > 0 ? spec.options : [String(v)];
      control = <SelectField label={label} value={typeof v === 'string' && options.includes(v) ? v : (options[0] as string)} options={options} disabled={disabled} onChange={(o) => onCommit(o)} />;
      break;
    }
    case 'vec3': {
      const vec = isVec3(v) ? v : isVec3(spec.default) ? spec.default : ([0, 0, 0] as [number, number, number]);
      control = (
        <div className="vec3">
          {(['x', 'y', 'z'] as const).map((axis, i) => (
            <NumberField
              key={axis}
              axis={axis}
              label={`${label} ${axis}`}
              value={vec[i] as number}
              disabled={disabled}
              onCommit={(x) => {
                const next: [number, number, number] = [vec[0], vec[1], vec[2]];
                next[i] = x;
                onCommit(next);
              }}
            />
          ))}
        </div>
      );
      break;
    }
    case 'vec3[]':
      control = <JsonField label={label} value={v} disabled={disabled} onCommit={onCommit} validate={isVec3List} />;
      break;
    case 'string[]':
      control = <JsonField label={label} value={v} disabled={disabled} onCommit={onCommit} validate={isStringList} />;
      break;
    default:
      control = <TextField label={label} value={typeof v === 'string' ? v : JSON.stringify(v ?? '')} maxLength={200} disabled={disabled} mono={spec.type === 'selector'} onCommit={(s) => onCommit(s.slice(0, 200))} />;
  }
  return (
    <div className="field-row" title={spec.description ?? name}>
      <span className="field-row__label" title={spec.description ?? name}>
        {label}
      </span>
      <div className="field-row__control">{control}</div>
    </div>
  );
});
